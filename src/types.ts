import type { OpenRouterUsage } from "./providers/openrouter.js";

export type AgentStatus = "done" | "failed";

export interface TaskClassification {
  score: number;
  tier: 1 | 2 | 3;
  model: string;
  reasoning: string;
  usage: OpenRouterUsage;
  costUsd: number;
}

export interface Task {
  id: string;
  description: string;
  agentRole: string;
  dependsOn: string[];
  classification?: TaskClassification;
}

export interface ExecutionPlan {
  objective: string;
  tasks: Task[];
  usage?: OpenRouterUsage;
  costUsd?: number;
}

export interface ToolExecutionRecord {
  toolCallId: string;
  toolName: string;
  output: string;
}

export interface AgentCallRecord {
  model: string;
  usage: OpenRouterUsage;
  toolCallNames: string[];
}

export interface AgentResult {
  taskId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  model: string;
  output: string;
  status: AgentStatus;
  tokens: OpenRouterUsage;
  costUsd: number;
  calls: AgentCallRecord[];
  toolResults: ToolExecutionRecord[];
  error?: string;
}

export function zeroUsage(): OpenRouterUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

export function addUsage(left: OpenRouterUsage, right: OpenRouterUsage): OpenRouterUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}
