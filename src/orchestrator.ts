import type { DagExecutor, ExecutionResult } from "./executor.js";
import type { Planner } from "./planner.js";
import type { OpenRouterChatClient, OpenRouterUsage } from "./providers/openrouter.js";
import type { ExecutionPlan } from "./types.js";
import { addUsage, zeroUsage } from "./types.js";

export interface OrchestratorInput {
  objective: string;
}

export interface OrchestratorOutput {
  answer: string;
  plan: ExecutionPlan;
  execution: ExecutionResult;
  tokens: OpenRouterUsage;
  totalCostUsd: number;
}

export interface OrchestratorAgentOptions {
  openRouter: OpenRouterChatClient;
  model: string;
  planner: Planner;
  executor: DagExecutor;
}

export class OrchestratorAgent {
  private readonly openRouter: OpenRouterChatClient;

  private readonly model: string;

  private readonly planner: Planner;

  private readonly executor: DagExecutor;

  public constructor(options: OrchestratorAgentOptions) {
    this.openRouter = options.openRouter;
    this.model = options.model;
    this.planner = options.planner;
    this.executor = options.executor;
  }

  public async run(input: OrchestratorInput): Promise<OrchestratorOutput> {
    const plan = await this.planner.createPlan(input.objective);
    const execution = await this.executor.execute(plan);
    const synthesis = await this.openRouter.chat({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You are the final orchestrator. Synthesize worker outputs into one concise final answer.",
        },
        {
          role: "user",
          content: [
            `Objective: ${input.objective}`,
            `Completed tasks: ${execution.completedTaskIds.join(", ") || "none"}`,
            `Failed tasks: ${execution.failedTaskIds.join(", ") || "none"}`,
            "Shared context:",
            execution.context.snapshot(),
            "Return the final response for the user.",
          ].join("\n\n"),
        },
      ],
      temperature: 0,
      max_tokens: 1600,
    });

    const tokens = addUsage(addUsage(plan.usage ?? zeroUsage(), execution.tokens), synthesis.usage);

    return {
      answer: synthesis.text,
      plan,
      execution,
      tokens,
      totalCostUsd: tokens.costUsd,
    };
  }
}
