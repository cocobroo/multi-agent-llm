import type {
  OpenRouterAssistantChatMessage,
  OpenRouterChatClient,
  OpenRouterChatMessage,
  OpenRouterChatRequest,
} from "../providers/openrouter.js";
import type { AgentTool } from "../tools/index.js";
import { toOpenRouterToolDefinition } from "../tools/index.js";
import type { SharedContext } from "../bus.js";
import type { AgentCallRecord, AgentResult, Task, ToolExecutionRecord } from "../types.js";
import { addUsage, zeroUsage } from "../types.js";

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  model: string;
  systemPrompt: string;
  tools: AgentTool[];
}

export abstract class BaseAgent {
  public readonly id: string;

  public readonly name: string;

  public readonly role: string;

  public readonly model: string;

  public readonly systemPrompt: string;

  public readonly tools: AgentTool[];

  protected readonly openRouter: OpenRouterChatClient;

  private readonly maxToolRounds = 4;

  protected constructor(definition: AgentDefinition, openRouter: OpenRouterChatClient) {
    this.id = definition.id;
    this.name = definition.name;
    this.role = definition.role;
    this.model = definition.model;
    this.systemPrompt = definition.systemPrompt;
    this.tools = definition.tools;
    this.openRouter = openRouter;
  }

  public async run(task: Task, context: SharedContext): Promise<AgentResult> {
    const model = task.classification?.model ?? this.model;
    const messages: OpenRouterChatMessage[] = [
      {
        role: "system",
        content: this.systemPrompt,
      },
      {
        role: "user",
        content: this.renderTaskPrompt(task, context),
      },
    ];

    let aggregateUsage = zeroUsage();
    const calls: AgentCallRecord[] = [];
    const toolResults: ToolExecutionRecord[] = [];
    let lastText = "";

    for (let round = 0; round <= this.maxToolRounds; round += 1) {
      const request: OpenRouterChatRequest = {
        model,
        messages,
        max_tokens: 2000,
        tool_choice: this.tools.length > 0 ? "auto" : "none",
      };

      if (this.tools.length > 0) {
        request.tools = this.tools.map((tool) => toOpenRouterToolDefinition(tool));
      }

      const response = await this.openRouter.chat(request);

      aggregateUsage = addUsage(aggregateUsage, response.usage);
      lastText = response.text;
      calls.push({
        model: response.model,
        usage: response.usage,
        toolCallNames: response.toolCalls.map((toolCall) => toolCall.name),
      });

      if (response.toolCalls.length === 0) {
        return {
          taskId: task.id,
          agentId: this.id,
          agentName: this.name,
          agentRole: this.role,
          model,
          output: response.text,
          status: "done",
          tokens: aggregateUsage,
          costUsd: aggregateUsage.costUsd,
          calls,
          toolResults,
        };
      }

      messages.push({
        role: "assistant",
        content: response.text,
        tool_calls: response.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: toolCall.argumentsJson,
          },
        })),
      } satisfies OpenRouterAssistantChatMessage);

      const roundToolResults = await Promise.all(
        response.toolCalls.map(async (toolCall) => this.executeToolCall(toolCall, context)),
      );

      for (const toolResult of roundToolResults) {
        toolResults.push(toolResult);
        messages.push({
          role: "tool",
          tool_call_id: toolResult.toolCallId,
          name: toolResult.toolName,
          content: toolResult.output,
        });
      }
    }

    return {
      taskId: task.id,
      agentId: this.id,
      agentName: this.name,
      agentRole: this.role,
      model,
      output: lastText.length > 0 ? lastText : "Tool-calling loop ended without a final response.",
      status: "done",
      tokens: aggregateUsage,
      costUsd: aggregateUsage.costUsd,
      calls,
      toolResults,
    };
  }

  private async executeToolCall(
    toolCall: { id: string; name: string; argumentsJson: string },
    context: SharedContext,
  ): Promise<ToolExecutionRecord> {
    const tool = this.tools.find((candidate) => candidate.name === toolCall.name);

    if (tool === undefined) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        output: `Tool '${toolCall.name}' is not available to agent '${this.name}'.`,
      };
    }

    const input = parseToolArguments(toolCall.argumentsJson);
    const output = await tool.execute(input, context);

    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      output,
    };
  }

  private renderTaskPrompt(task: Task, context: SharedContext): string {
    const dependencyContext = context.getDependencyContext(task.dependsOn);
    const sharedContext = context.snapshot();
    const contextText =
      dependencyContext.length > 0
        ? `Dependency results:\n${dependencyContext}`
        : `Shared context:\n${sharedContext.length > 0 ? sharedContext : "No prior results."}`;

    return [
      `Task ID: ${task.id}`,
      `Task description: ${task.description}`,
      `Assigned role: ${task.agentRole}`,
      task.classification === undefined
        ? "Classification: not provided"
        : `Classification: tier ${task.classification.tier}, score ${task.classification.score}, ${task.classification.reasoning}`,
      contextText,
      "Return the best possible result for this task. Use tools only when needed.",
    ].join("\n\n");
  }
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    throw new Error(`Tool arguments must be valid JSON: ${argumentsJson}`);
  }

  throw new Error("Tool arguments must be a JSON object.");
}
