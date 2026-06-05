import { describe, expect, test } from "vitest";
import { Planner } from "./planner.js";
import type { OpenRouterChatClient, OpenRouterChatRequest } from "./providers/openrouter.js";

describe("Planner", () => {
  test("retries invalid JSON and returns a validated DAG", async () => {
    const requests: OpenRouterChatRequest[] = [];
    const replies = [
      "plain text plan",
      JSON.stringify({
        tasks: [
          {
            id: "research",
            description: "Research the market",
            agentRole: "researcher",
            dependsOn: [],
          },
          {
            id: "write",
            description: "Write the final summary",
            agentRole: "writer",
            dependsOn: ["research"],
          },
        ],
      }),
    ];
    const openRouter: OpenRouterChatClient = {
      async chat(request) {
        requests.push(request);
        const text = replies.shift();
        if (text === undefined) {
          throw new Error("unexpected planner call");
        }

        return {
          id: "plan",
          model: request.model,
          text,
          usage: {
            promptTokens: 10,
            completionTokens: 15,
            totalTokens: 25,
            costUsd: 0.02,
          },
          toolCalls: [],
        };
      },
    };

    const planner = new Planner({
      openRouter,
      model: "orchestrator-model",
    });

    const plan = await planner.createPlan("Launch a pricing page");

    expect(plan.objective).toBe("Launch a pricing page");
    expect(plan.tasks).toEqual([
      {
        id: "research",
        description: "Research the market",
        agentRole: "researcher",
        dependsOn: [],
      },
      {
        id: "write",
        description: "Write the final summary",
        agentRole: "writer",
        dependsOn: ["research"],
      },
    ]);
    expect(plan.usage?.totalTokens).toBe(50);
    expect(plan.costUsd).toBe(0.04);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)?.content).toContain("valid JSON");
  });

  test("rejects plans with dependencies that do not exist", async () => {
    const openRouter: OpenRouterChatClient = {
      async chat(request) {
        return {
          id: "plan",
          model: request.model,
          text: JSON.stringify({
            tasks: [
              {
                id: "write",
                description: "Write the summary",
                agentRole: "writer",
                dependsOn: ["missing"],
              },
            ],
          }),
          usage: {
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 2,
            costUsd: 0,
          },
          toolCalls: [],
        };
      },
    };

    const planner = new Planner({
      openRouter,
      model: "orchestrator-model",
    });

    await expect(planner.createPlan("Broken plan")).rejects.toThrow("unknown dependency");
  });

  test("anchors orchestra objectives to the CLI project context", async () => {
    let prompt = "";
    const openRouter: OpenRouterChatClient = {
      async chat(request) {
        prompt = request.messages.at(-1)?.content ?? "";
        return {
          id: "plan",
          model: request.model,
          text: JSON.stringify({
            tasks: [
              {
                id: "explain_cli",
                description: "Explain the orchestra CLI project",
                agentRole: "writer",
                dependsOn: [],
              },
            ],
          }),
          usage: {
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 2,
            costUsd: 0,
          },
          toolCalls: [],
        };
      },
    };

    const planner = new Planner({
      openRouter,
      model: "orchestrator-model",
    });

    await planner.createPlan("Explain orchestra");

    expect(prompt).toContain("When the objective mentions orchestra");
    expect(prompt).toContain("CLI project");
  });

  test("shows configured agents so the model can route arbitrary work", async () => {
    let prompt = "";
    const openRouter: OpenRouterChatClient = {
      async chat(request) {
        prompt = request.messages.at(-1)?.content ?? "";
        return {
          id: "plan",
          model: request.model,
          text: JSON.stringify({
            tasks: [
              {
                id: "triage",
                description: "Triage the objective and decide the best path",
                agentRole: "generalist",
                dependsOn: [],
              },
            ],
          }),
          usage: {
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 2,
            costUsd: 0,
          },
          toolCalls: [],
        };
      },
    };

    const planner = new Planner({
      openRouter,
      model: "orchestrator-model",
      availableAgents: [
        { role: "researcher", model: "perplexity/sonar", tools: ["web_scrape"] },
        { role: "generalist", model: "openai/gpt-4.1-mini", tools: [] },
      ],
    });

    const plan = await planner.createPlan("Do anything");

    expect(plan.tasks[0]?.agentRole).toBe("generalist");
    expect(prompt).toContain("Available agents");
    expect(prompt).toContain("researcher");
    expect(prompt).toContain("web_scrape");
    expect(prompt).toContain("generalist");
  });
});
