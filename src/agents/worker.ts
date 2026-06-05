import { BaseAgent, type AgentDefinition } from "./base-agent.js";
import type { OpenRouterChatClient } from "../providers/openrouter.js";

export class WorkerAgent extends BaseAgent {
  public constructor(definition: AgentDefinition, openRouter: OpenRouterChatClient) {
    super(definition, openRouter);
  }
}
