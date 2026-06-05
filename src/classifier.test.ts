import { describe, expect, test } from "vitest";
import { TaskClassifier } from "./classifier.js";
import type { OpenRouterChatClient, OpenRouterChatRequest } from "./providers/openrouter.js";

describe("TaskClassifier", () => {
  test("retries invalid JSON and maps score to configured tier model", async () => {
    const requests: OpenRouterChatRequest[] = [];
    const replies = ["not json", "{\"score\":7,\"reasoning\":\"needs deeper reasoning\"}"];
    const openRouter: OpenRouterChatClient = {
      async chat(request) {
        requests.push(request);
        const text = replies.shift();
        if (text === undefined) {
          throw new Error("unexpected classifier call");
        }

        return {
          id: "classification",
          model: request.model,
          text,
          usage: {
            promptTokens: 1,
            completionTokens: 2,
            totalTokens: 3,
            costUsd: 0.004,
          },
          toolCalls: [],
        };
      },
    };

    const classifier = new TaskClassifier({
      openRouter,
      model: "cheap-classifier",
      thresholds: { tier1: 3, tier2: 6 },
      tierModels: {
        tier1: "cheap-model",
        tier2: "balanced-model",
        tier3: "strong-model",
      },
    });

    const result = await classifier.classify({
      id: "task-1",
      description: "Evaluate an acquisition target",
      agentRole: "analyst",
      dependsOn: [],
    });

    expect(result).toMatchObject({
      score: 7,
      tier: 3,
      model: "strong-model",
      reasoning: "needs deeper reasoning",
    });
    expect(result.usage.totalTokens).toBe(6);
    expect(result.costUsd).toBe(0.008);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)?.content).toContain("valid JSON");
  });
});
