import { z } from "zod";
import type { OpenRouterChatClient, OpenRouterUsage } from "./providers/openrouter.js";
import type { ExecutionPlan, Task } from "./types.js";
import { addUsage, zeroUsage } from "./types.js";

export type SubtaskStatus = "pending" | "running" | "done" | "failed";

export interface PlannerOptions {
  openRouter: OpenRouterChatClient;
  model: string;
  availableAgents?: PlannerAgentDescriptor[];
}

export interface PlannerAgentDescriptor {
  role: string;
  model: string;
  tools: string[];
}

const taskSchema = z.object({
  id: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().min(1),
  agentRole: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).default([]),
});

const planSchema = z.object({
  tasks: z.array(taskSchema).min(1),
});

export class Planner {
  private readonly openRouter: OpenRouterChatClient;

  private readonly model: string;

  private readonly availableAgents: PlannerAgentDescriptor[];

  public constructor(options: PlannerOptions) {
    this.openRouter = options.openRouter;
    this.model = options.model;
    this.availableAgents = options.availableAgents ?? [];
  }

  public async createPlan(objective: string): Promise<ExecutionPlan> {
    let usage: OpenRouterUsage = zeroUsage();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.openRouter.chat({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are the Orchestrator planner. Decompose objectives into a valid JSON DAG before execution.",
          },
          {
            role: "user",
            content: buildPlannerPrompt(objective, attempt, this.availableAgents),
          },
        ],
        temperature: 0,
        max_tokens: 1200,
        response_format: { type: "json_object" },
      });

      usage = addUsage(usage, response.usage);

      try {
        const parsed = planSchema.parse(parseJsonObject(response.text));
        const tasks = validateDag(parsed.tasks, this.availableAgents);
        return {
          objective,
          tasks,
          usage,
          costUsd: usage.costUsd,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown planner parse error");
      }
    }

    throw new Error(`Planner returned invalid JSON after retry: ${lastError?.message ?? "unknown"}`);
  }
}

export function createEmptyPlan(objective: string): ExecutionPlan {
  return {
    objective,
    tasks: [],
  };
}

function validateDag(tasks: Task[], availableAgents: PlannerAgentDescriptor[] = []): Task[] {
  const ids = new Set<string>();
  const allowedRoles = new Set(availableAgents.map((agent) => agent.role));

  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw new Error(`Planner produced duplicate task id '${task.id}'.`);
    }

    if (allowedRoles.size > 0 && !allowedRoles.has(task.agentRole)) {
      throw new Error(`Task '${task.id}' uses unknown agent role '${task.agentRole}'.`);
    }
    ids.add(task.id);
  }

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) {
        throw new Error(`Task '${task.id}' has unknown dependency '${dependency}'.`);
      }

      if (dependency === task.id) {
        throw new Error(`Task '${task.id}' cannot depend on itself.`);
      }
    }
  }

  assertNoCycles(tasks);
  return tasks;
}

function assertNoCycles(tasks: Task[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (taskId: string): void => {
    if (visited.has(taskId)) {
      return;
    }

    if (visiting.has(taskId)) {
      throw new Error(`Planner produced a dependency cycle involving '${taskId}'.`);
    }

    const task = byId.get(taskId);
    if (task === undefined) {
      throw new Error(`Task '${taskId}' has unknown dependency.`);
    }

    visiting.add(taskId);
    for (const dependency of task.dependsOn) {
      visit(dependency);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of tasks) {
    visit(task.id);
  }
}

function buildPlannerPrompt(
  objective: string,
  attempt: number,
  availableAgents: PlannerAgentDescriptor[],
): string {
  const roleList =
    availableAgents.length > 0
      ? availableAgents.map((agent) => agent.role).join("|")
      : "researcher|coder|analyst|writer|generalist|custom-role";
  const agentText =
    availableAgents.length > 0
      ? [
          "Available agents:",
          ...availableAgents.map((agent) => {
            const tools = agent.tools.length > 0 ? agent.tools.join(", ") : "none";
            return `- ${agent.role}: model ${agent.model}; tools ${tools}`;
          }),
        ].join("\n")
      : [
          "Available agents:",
          "- researcher: facts, web-capable research, evidence gathering.",
          "- coder: code, local files, command execution with confirmation.",
          "- analyst: reasoning, tradeoffs, decisions, risk analysis.",
          "- writer: synthesis, editing, final prose.",
          "- generalist: broad or ambiguous tasks that do not fit a specialist.",
        ].join("\n");
  const basePrompt = [
    "Create a JSON DAG execution plan for this objective.",
    "Route every subtask to the best available agent for the work. Use generalist only when no specialist fits.",
    "Return JSON with this exact shape:",
    `{"tasks":[{"id":"short-id","description":"specific subtask","agentRole":"${roleList}","dependsOn":["task-id"]}]}`,
    agentText,
    "Rules:",
    "- Every task id must be unique and contain only letters, numbers, underscore, or hyphen.",
    "- dependsOn must reference existing task ids only.",
    "- Independent tasks must have an empty dependsOn array.",
    '- When the objective mentions orchestra, treat "orchestra" as this CLI project: a multi-agent LLM orchestrator, not a musical ensemble, unless the user explicitly says otherwise.',
    "",
    `Objective: ${objective}`,
  ].join("\n");

  if (attempt === 0) {
    return basePrompt;
  }

  return `${basePrompt}\n\nYour previous response was invalid. Return only valid JSON. Do not use markdown fences, comments, or prose.`;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(withoutFence) as unknown;
}
