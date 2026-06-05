import { describe, expect, test } from "vitest";
import { OrchestraEventEmitter } from "./events.js";

describe("OrchestraEventEmitter", () => {
  test("collects typed event snapshots", () => {
    const events = new OrchestraEventEmitter();
    const seen: string[] = [];

    events.on("task:start", (event) => {
      seen.push(`${event.taskId}:${event.agentRole}`);
    });
    events.emitTaskStart({ taskId: "research", agentRole: "researcher", model: "model-a" });

    expect(seen).toEqual(["research:researcher"]);
    expect(events.snapshot().tasks.get("research")).toMatchObject({
      status: "running",
      agentRole: "researcher",
      model: "model-a",
    });
  });

  test("records task duration when a running task finishes", () => {
    const events = new OrchestraEventEmitter();

    events.emitTaskStart({ taskId: "write", agentRole: "writer", model: "model-b" });
    events.emitTaskDone({
      taskId: "write",
      agentRole: "writer",
      model: "model-b",
      output: "done",
    });

    const task = events.snapshot().tasks.get("write");
    expect(task?.status).toBe("done");
    expect(task?.startedAt).toBeInstanceOf(Date);
    expect(task?.finishedAt).toBeInstanceOf(Date);
    expect(task?.durationMs).toBeGreaterThanOrEqual(0);
  });
});
