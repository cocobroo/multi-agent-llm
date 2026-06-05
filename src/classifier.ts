import { z } from "zod";
import type { OpenRouterChatClient, OpenRouterUsage } from "./providers/openrouter.js";
import type { Task, TaskClassification } from "./types.js";
import { addUsage, zeroUsage } from "./types.js";

export interface TierThresholds {
  tier1: number;
  tier2: number;
}

export interface TierModels {
  tier1: string;
  tier2: string;
  tier3: string;
}

export type ModelTier = 1 | 2 | 3;

export interface TaskClassifierOptions {
  openRouter: OpenRouterChatClient;
  model: string;
  thresholds: TierThresholds;
  tierModels: TierModels;
}

const classificationSchema = z.object({
  score: z.number().int().min(1).max(10),
  reasoning: z.string().min(1),
});

export class TaskClassifier {
  private readonly openRouter: OpenRouterChatClient;

  private readonly model: string;

  private readonly thresholds: TierThresholds;

  private readonly tierModels: TierModels;

  public constructor(options: TaskClassifierOptions) {
    this.openRouter = options.openRouter;
    this.model = options.model;
    this.thresholds = options.thresholds;
    this.tierModels = options.tierModels;
  }

  public async classify(task: Task): Promise<TaskClassification> {
    let usage: OpenRouterUsage = zeroUsage();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.openRouter.chat({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are a routing classifier for a multi-agent CLI. Return only valid JSON.",
          },
          {
            role: "user",
            content: buildClassificationPrompt(task, attempt),
          },
        ],
        temperature: 0,
        max_tokens: 512,
        response_format: { type: "json_object" },
      });

      usage = addUsage(usage, response.usage);

      try {
        const parsed = classificationSchema.parse(parseJsonObject(response.text));
        const tier = classifyComplexity(parsed.score, this.thresholds);
        return {
          score: parsed.score,
          tier,
          model: modelForTier(tier, this.tierModels),
          reasoning: parsed.reasoning,
          usage,
          costUsd: usage.costUsd,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown classifier parse error");
      }
    }

    throw new Error(`Classifier returned invalid JSON after retry: ${lastError?.message ?? "unknown"}`);
  }
}

export function classifyComplexity(score: number, thresholds: TierThresholds): ModelTier {
  if (score <= thresholds.tier1) {
    return 1;
  }

  if (score <= thresholds.tier2) {
    return 2;
  }

  return 3;
}

export function modelForTier(tier: ModelTier, tierModels: TierModels): string {
  if (tier === 1) {
    return tierModels.tier1;
  }

  if (tier === 2) {
    return tierModels.tier2;
  }

  return tierModels.tier3;
}

function buildClassificationPrompt(task: Task, attempt: number): string {
  const basePrompt = [
    "Classify this subtask complexity from 1 to 10.",
    "Use 1-3 for simple/cheap work, 4-6 for moderate reasoning, and 7-10 for difficult/high-stakes work.",
    "Return JSON with this exact shape:",
    "{\"score\": number, \"reasoning\": string}",
    "",
    `Task ID: ${task.id}`,
    `Agent role: ${task.agentRole}`,
    `Description: ${task.description}`,
  ].join("\n");

  if (attempt === 0) {
    return basePrompt;
  }

  return `${basePrompt}\n\nYour previous response was invalid. Return only valid JSON. Do not use markdown fences or prose.`;
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
