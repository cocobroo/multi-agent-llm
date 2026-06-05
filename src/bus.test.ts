import { describe, expect, test } from "vitest";
import { SharedContext } from "./bus.js";

describe("SharedContext", () => {
  test("stores task results and exposes dependency context", async () => {
    const context = new SharedContext();

    await Promise.all([
      context.writeResult({
        taskId: "research",
        agentRole: "researcher",
        output: "market notes",
        status: "done",
        tokens: { promptTokens: 4, completionTokens: 6, totalTokens: 10, costUsd: 0.01 },
        costUsd: 0.01,
      }),
      context.writeResult({
        taskId: "analysis",
        agentRole: "analyst",
        output: "analysis notes",
        status: "done",
        tokens: { promptTokens: 5, completionTokens: 7, totalTokens: 12, costUsd: 0.02 },
        costUsd: 0.02,
      }),
    ]);

    expect(context.readResult("research")?.output).toBe("market notes");
    expect(context.readResult("analysis")?.costUsd).toBe(0.02);
    expect(context.getDependencyContext(["research"])).toContain("market notes");
    expect(context.snapshot()).toContain("analysis notes");
  });
});
