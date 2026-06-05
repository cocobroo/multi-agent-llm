import { SharedContext } from "../bus.js";
import { TaskClassifier } from "../classifier.js";
import { DagExecutor } from "../executor.js";
import { OrchestratorAgent } from "../orchestrator.js";
import { Planner } from "../planner.js";
import type { OpenRouterChatClient, OpenRouterChatRequest, OpenRouterChatResult } from "../providers/openrouter.js";
import { WorkerAgent } from "../agents/worker.js";

class DemoOpenRouterClient implements OpenRouterChatClient {
  public async chat(request: OpenRouterChatRequest): Promise<OpenRouterChatResult> {
    const prompt = request.messages.map((message) => message.content).join("\n");
    const text = this.respond(request.model, prompt);

    return {
      id: `demo-${Date.now().toString(36)}`,
      model: request.model,
      text,
      usage: {
        promptTokens: Math.max(1, Math.ceil(prompt.length / 8)),
        completionTokens: Math.max(1, Math.ceil(text.length / 8)),
        totalTokens: Math.max(2, Math.ceil((prompt.length + text.length) / 8)),
        costUsd: 0,
      },
      toolCalls: [],
    };
  }

  private respond(model: string, prompt: string): string {
    if (prompt.includes("Create a JSON DAG execution plan")) {
      return JSON.stringify({
        tasks: [
          {
            id: "research",
            description: "Research the target audience and pain points for orchestra.",
            agentRole: "researcher",
            dependsOn: [],
          },
          {
            id: "analysis",
            description: "Analyze architecture risks and execution tradeoffs.",
            agentRole: "analyst",
            dependsOn: [],
          },
          {
            id: "summary",
            description: "Write a concise final implementation summary.",
            agentRole: "writer",
            dependsOn: ["research", "analysis"],
          },
        ],
      });
    }

    if (prompt.includes("Classify this subtask complexity")) {
      if (prompt.includes("architecture risks")) {
        return JSON.stringify({ score: 7, reasoning: "Architecture analysis needs stronger reasoning." });
      }

      return JSON.stringify({ score: 3, reasoning: "This is bounded and inexpensive." });
    }

    if (prompt.includes("Return the final response for the user")) {
      return [
        "Demo objective completed.",
        "The planner produced a three-task DAG, classifier routed each task by complexity, executor ran independent tasks first, and the writer synthesized the dependent output.",
      ].join(" ");
    }

    if (prompt.includes("Assigned role: researcher")) {
      return "Researcher output: orchestra users need transparent task routing, visible progress, and cost summaries.";
    }

    if (prompt.includes("Assigned role: analyst")) {
      return "Analyst output: keep planner JSON validation strict, isolate tools, and retry failed agents once.";
    }

    if (prompt.includes("Assigned role: writer")) {
      return "Writer output: orchestra coordinates specialized agents through a validated DAG and shared context.";
    }

    return `Demo response from ${model}.`;
  }
}

const openRouter = new DemoOpenRouterClient();
const planner = new Planner({
  openRouter,
  model: "demo-orchestrator-model",
});
const classifier = new TaskClassifier({
  openRouter,
  model: "demo-classifier-model",
  thresholds: { tier1: 3, tier2: 6 },
  tierModels: {
    tier1: "demo-cheap-model",
    tier2: "demo-balanced-model",
    tier3: "demo-strong-model",
  },
});

const agents = new Map([
  [
    "researcher",
    new WorkerAgent(
      {
        id: "researcher",
        name: "Researcher",
        role: "researcher",
        model: "demo-researcher-model",
        systemPrompt: "You are the Researcher demo agent.",
        tools: [],
      },
      openRouter,
    ),
  ],
  [
    "analyst",
    new WorkerAgent(
      {
        id: "analyst",
        name: "Analyst",
        role: "analyst",
        model: "demo-analyst-model",
        systemPrompt: "You are the Analyst demo agent.",
        tools: [],
      },
      openRouter,
    ),
  ],
  [
    "writer",
    new WorkerAgent(
      {
        id: "writer",
        name: "Writer",
        role: "writer",
        model: "demo-writer-model",
        systemPrompt: "You are the Writer demo agent.",
        tools: [],
      },
      openRouter,
    ),
  ],
]);

const executor = new DagExecutor({
  agents,
  classifier,
  context: new SharedContext(),
  concurrency: 3,
});
const orchestrator = new OrchestratorAgent({
  openRouter,
  model: "demo-orchestrator-model",
  planner,
  executor,
});

const result = await orchestrator.run({
  objective: "Explain how orchestra coordinates multiple LLM agents.",
});

console.log("orchestra demo");
console.log("");
console.log("Plan:");
for (const task of result.plan.tasks) {
  const dependencyText = task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "none";
  console.log(`- ${task.id} [${task.agentRole}] depends on: ${dependencyText}`);
}
console.log("");
console.log("Final answer:");
console.log(result.answer);
console.log("");
console.log("Cost summary:");
console.log(`- total tokens: ${result.tokens.totalTokens}`);
console.log(`- total cost: $${result.totalCostUsd.toFixed(6)}`);
