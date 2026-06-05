import { describe, expect, test } from "vitest";
import { DagExecutor, type RunnableAgent } from "./executor.js";
import { OrchestraEventEmitter } from "./events.js";
import type { Task, TaskClassification } from "./types.js";

describe("DagExecutor", () => {
  test("runs independent tasks in parallel, waits for dependencies, retries once, and aggregates cost", async () => {
    const starts: string[] = [];
    const finishes: string[] = [];
    const attempts = new Map<string, number>();

    const agent: RunnableAgent = {
      async run(task) {
        starts.push(task.id);
        const attempt = (attempts.get(task.id) ?? 0) + 1;
        attempts.set(task.id, attempt);

        if (task.id === "research" && attempt === 1) {
          throw new Error("temporary failure");
        }

        await new Promise((resolve) => setTimeout(resolve, task.id === "analysis" ? 10 : 1));
        finishes.push(task.id);

        return {
          taskId: task.id,
          agentId: `${task.agentRole}-agent`,
          agentName: task.agentRole,
          agentRole: task.agentRole,
          model: task.classification?.model ?? "role-model",
          output: `${task.id} output`,
          status: "done",
          tokens: {
            promptTokens: 1,
            completionTokens: 2,
            totalTokens: 3,
            costUsd: 0.01,
          },
          costUsd: 0.01,
          calls: [],
          toolResults: [],
        };
      },
    };

    const classifications: TaskClassification[] = [];
    const events = new OrchestraEventEmitter();
    const seenEvents: string[] = [];
    events.on("task:start", (event) => seenEvents.push(`start:${event.taskId}`));
    events.on("task:done", (event) => seenEvents.push(`done:${event.taskId}`));
    events.on("cost:update", (event) => seenEvents.push(`cost:${event.totalTokens}`));
    const executor = new DagExecutor({
      agents: new Map([
        ["researcher", agent],
        ["analyst", agent],
        ["writer", agent],
      ]),
      classifier: {
        async classify(task: Task) {
          const classification: TaskClassification = {
            score: task.id === "write" ? 8 : 2,
            tier: task.id === "write" ? 3 : 1,
            model: task.id === "write" ? "strong-model" : "cheap-model",
            reasoning: "test classification",
            usage: {
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 2,
              costUsd: 0.001,
            },
            costUsd: 0.001,
          };
          classifications.push(classification);
          return classification;
        },
      },
      concurrency: 3,
      events,
    });

    const result = await executor.execute({
      objective: "Build report",
      tasks: [
        { id: "research", description: "Research", agentRole: "researcher", dependsOn: [] },
        { id: "analysis", description: "Analyze", agentRole: "analyst", dependsOn: [] },
        { id: "write", description: "Write", agentRole: "writer", dependsOn: ["research", "analysis"] },
      ],
    });

    expect(starts.slice(0, 2).sort()).toEqual(["analysis", "research"]);
    expect(starts.at(-1)).toBe("write");
    expect(finishes).toContain("research");
    expect(finishes).toContain("analysis");
    expect(attempts.get("research")).toBe(2);
    expect(result.completedTaskIds.sort()).toEqual(["analysis", "research", "write"]);
    expect(result.failedTaskIds).toEqual([]);
    expect(result.totalCostUsd).toBeCloseTo(0.034);
    expect(result.tokens.totalTokens).toBe(15);
    expect(result.context.readResult("write")?.output).toBe("write output");
    expect(classifications).toHaveLength(3);
    expect(result.results.find((item) => item.taskId === "write")?.model).toBe("strong-model");
    expect(seenEvents).toContain("start:research");
    expect(seenEvents).toContain("done:write");
    expect(seenEvents.some((event) => event.startsWith("cost:"))).toBe(true);
  });

  test("marks a task failed after retry and continues independent branches", async () => {
    const agent: RunnableAgent = {
      async run(task) {
        if (task.id === "bad") {
          throw new Error("permanent failure");
        }

        return {
          taskId: task.id,
          agentId: "writer-agent",
          agentName: "Writer",
          agentRole: task.agentRole,
          model: "writer-model",
          output: "ok",
          status: "done",
          tokens: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          },
          costUsd: 0,
          calls: [],
          toolResults: [],
        };
      },
    };

    const executor = new DagExecutor({
      agents: new Map([
        ["writer", agent],
        ["analyst", agent],
      ]),
      concurrency: 2,
    });

    const result = await executor.execute({
      objective: "Continue branches",
      tasks: [
        { id: "bad", description: "Fail", agentRole: "analyst", dependsOn: [] },
        { id: "good", description: "Succeed", agentRole: "writer", dependsOn: [] },
        { id: "blocked", description: "Blocked", agentRole: "writer", dependsOn: ["bad"] },
      ],
    });

    expect(result.completedTaskIds).toEqual(["good"]);
    expect(result.failedTaskIds.sort()).toEqual(["bad", "blocked"]);
    expect(result.results.find((item) => item.taskId === "bad")?.status).toBe("failed");
    expect(result.results.find((item) => item.taskId === "blocked")?.error).toContain("failed dependency");
  });
});
