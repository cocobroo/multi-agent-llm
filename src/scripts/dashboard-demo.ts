import React from "react";
import { render } from "ink";
import { OrchestraEventEmitter } from "../events.js";
import { LiveDashboard } from "../ui/dashboard.js";

const events = new OrchestraEventEmitter();
const app = render(React.createElement(LiveDashboard, { events }));

events.emitPlanReady({
  objective: "Ship a production-ready multi-agent CLI orchestrator.",
  tasks: [
    {
      taskId: "research",
      agentRole: "researcher",
      description: "Map the problem, user expectations, and model choices.",
      dependsOn: [],
    },
    {
      taskId: "architecture",
      agentRole: "analyst",
      description: "Evaluate DAG execution, shared context, and failure modes.",
      dependsOn: [],
    },
    {
      taskId: "implementation",
      agentRole: "coder",
      description: "Implement the core CLI, tools, tests, and dashboard.",
      dependsOn: ["research", "architecture"],
    },
    {
      taskId: "release_notes",
      agentRole: "writer",
      description: "Synthesize the final answer and cost summary.",
      dependsOn: ["implementation"],
    },
  ],
});

await pause(500);
events.emitTaskStart({ taskId: "research", agentRole: "researcher", model: "perplexity/sonar" });
events.emitTaskStart({ taskId: "architecture", agentRole: "analyst", model: "openai/gpt-4.1" });
events.emitCostUpdate({ totalTokens: 180, totalCostUsd: 0.00021 });

await pause(900);
events.emitTaskDone({
  taskId: "research",
  agentRole: "researcher",
  model: "perplexity/sonar",
  output: "Research complete.",
});
events.emitCostUpdate({ totalTokens: 742, totalCostUsd: 0.00066 });

await pause(700);
events.emitTaskDone({
  taskId: "architecture",
  agentRole: "analyst",
  model: "openai/gpt-4.1",
  output: "Architecture complete.",
});
events.emitTaskStart({ taskId: "implementation", agentRole: "coder", model: "anthropic/claude-sonnet-4.6" });
events.emitCostUpdate({ totalTokens: 1289, totalCostUsd: 0.00143 });

await pause(1100);
events.emitTaskDone({
  taskId: "implementation",
  agentRole: "coder",
  model: "anthropic/claude-sonnet-4.6",
  output: "Implementation complete.",
});
events.emitTaskStart({ taskId: "release_notes", agentRole: "writer", model: "openai/gpt-4.1-mini" });
events.emitCostUpdate({ totalTokens: 2210, totalCostUsd: 0.00218 });

await pause(800);
events.emitTaskDone({
  taskId: "release_notes",
  agentRole: "writer",
  model: "openai/gpt-4.1-mini",
  output: "Release notes complete.",
});
events.emitCostUpdate({ totalTokens: 2734, totalCostUsd: 0.00254 });
events.emitFinalAnswer({
  answer:
    "orchestra planned a DAG, routed tasks to specialized agents, executed independent work in parallel, and synthesized the result with live cost tracking.",
});

await pause(1500);
app.unmount();

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
