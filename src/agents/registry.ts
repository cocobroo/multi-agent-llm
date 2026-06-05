import type { AgentConfig } from "../config.js";
import type { OpenRouterChatClient } from "../providers/openrouter.js";
import type { ToolRegistry } from "../tools/index.js";
import { WorkerAgent } from "./worker.js";

export function createAgentRegistry(
  agents: Record<string, AgentConfig>,
  openRouter: OpenRouterChatClient,
  toolRegistry: ToolRegistry,
): Map<string, WorkerAgent> {
  const registry = new Map<string, WorkerAgent>();

  for (const [name, config] of Object.entries(agents)) {
    const toolNames = config.tools ?? [];
    registry.set(
      name,
      new WorkerAgent(
        {
          id: name,
          name,
          role: name,
          model: config.model,
          systemPrompt: config.systemPrompt ?? defaultSystemPrompt(name),
          tools: toolRegistry.getMany(toolNames),
        },
        openRouter,
      ),
    );
  }

  return registry;
}

function defaultSystemPrompt(role: string): string {
  return `You are the ${role} worker in a multi-agent CLI orchestrator. Complete your assigned task and return a concise result.`;
}
