import { describe, expect, test } from "vitest";
import { SharedContext } from "../bus.js";
import type { OpenRouterChatClient, OpenRouterChatRequest } from "../providers/openrouter.js";
import { WorkerAgent } from "./worker.js";

describe("WorkerAgent", () => {
  test("executes requested tools and aggregates token and cost usage", async () => {
    const requests: OpenRouterChatRequest[] = [];
    const toolInputs: unknown[] = [];
    const openRouter: OpenRouterChatClient = {
      async chat(request) {
        requests.push(request);

        if (requests.length === 1) {
          return {
            id: "call-1",
            model: request.model,
            text: "",
            usage: {
              promptTokens: 4,
              completionTokens: 2,
              totalTokens: 6,
              costUsd: 0.01,
            },
            toolCalls: [
              {
                id: "tool-1",
                name: "lookup",
                argumentsJson: "{\"query\":\"answer\"}",
              },
            ],
          };
        }

        return {
          id: "call-2",
          model: request.model,
          text: "The answer is 42.",
          usage: {
            promptTokens: 3,
            completionTokens: 5,
            totalTokens: 8,
            costUsd: 0.02,
          },
          toolCalls: [],
        };
      },
    };

    const agent = new WorkerAgent(
      {
        id: "coder",
        name: "Coder",
        role: "coder",
        model: "base-model",
        systemPrompt: "You write code.",
        tools: [
          {
            name: "lookup",
            description: "Look up a value",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
            execute: async (input) => {
              toolInputs.push(input);
              return "42";
            },
          },
        ],
      },
      openRouter,
    );

    const context = new SharedContext();
    const result = await agent.run(
      {
        id: "task-1",
        description: "Find the answer",
        agentRole: "coder",
        dependsOn: [],
        classification: {
          score: 4,
          tier: 2,
          model: "tier-model",
          reasoning: "moderate",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
          costUsd: 0,
        },
      },
      context,
    );

    expect(toolInputs).toEqual([{ query: "answer" }]);
    expect(requests[0]?.model).toBe("tier-model");
    expect(requests[0]?.tools?.[0]?.function.name).toBe("lookup");
    expect(requests[1]?.messages.some((message) => message.role === "tool")).toBe(true);
    expect(result.output).toBe("The answer is 42.");
    expect(result.tokens).toEqual({
      promptTokens: 7,
      completionTokens: 7,
      totalTokens: 14,
      costUsd: 0.03,
    });
    expect(result.costUsd).toBe(0.03);
    expect(result.toolResults).toEqual([
      {
        toolCallId: "tool-1",
        toolName: "lookup",
        output: "42",
      },
    ]);
  });
});
