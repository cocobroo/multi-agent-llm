import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, test } from "vitest";
import { Dashboard } from "./dashboard.js";

describe("Dashboard", () => {
  test("renders task tree, costs, and final answer", () => {
    const { lastFrame } = render(
      <Dashboard
        state={{
          objective: "Ship orchestra",
          tasks: new Map([
            [
              "research",
              {
                taskId: "research",
                agentRole: "researcher",
                status: "done",
                model: "model-a",
                durationMs: 1234,
              },
            ],
            [
              "write",
              {
                taskId: "write",
                agentRole: "writer",
                status: "running",
                model: "model-b",
              },
            ],
          ]),
          totalTokens: 42,
          totalCostUsd: 0.12,
          finalAnswer: "Ready to ship.",
        }}
      />,
    );

    expect(lastFrame()).toContain("Ship orchestra");
    expect(lastFrame()).toContain("research");
    expect(lastFrame()).toContain("writer");
    expect(lastFrame()).toContain("42");
    expect(lastFrame()).toContain("1.2s");
    expect(lastFrame()).toContain("Ready to ship.");
  });
});
