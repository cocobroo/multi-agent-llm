import type { SharedContext } from "../bus.js";
import type { OpenRouterChatClient, OpenRouterToolDefinition } from "../providers/openrouter.js";
import { createFilesystemTools } from "./filesystem.js";
import { createShellTool } from "./shell.js";
import { createWebScrapeTool } from "./web-scrape.js";

export type ToolName = string;

export interface AgentTool {
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>, context: SharedContext): Promise<string>;
}

export interface ToolInvocation {
  name: ToolName;
  input: Record<string, unknown>;
}

export interface ToolResult {
  name: ToolName;
  output: string;
}

export interface ToolRegistryOptions {
  rootDir: string;
  confirmCommand?: (command: string) => Promise<boolean>;
  maxReadBytes?: number;
  shellTimeoutMs?: number;
  openRouter?: OpenRouterChatClient;
  webResearchModel?: string;
}

export function toOpenRouterToolDefinition(tool: AgentTool): OpenRouterToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  public constructor(tools: AgentTool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  public register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  public getMany(names: string[]): AgentTool[] {
    return names.map((name) => this.tools.get(name)).filter((tool): tool is AgentTool => tool !== undefined);
  }

  public all(): AgentTool[] {
    return Array.from(this.tools.values());
  }
}

export function createToolRegistryFromConfig(options: ToolRegistryOptions): ToolRegistry {
  const filesystemOptions = {
    rootDir: options.rootDir,
  };
  if (options.maxReadBytes !== undefined) {
    Object.assign(filesystemOptions, { maxReadBytes: options.maxReadBytes });
  }

  const shellOptions = {
    cwd: options.rootDir,
  };
  if (options.confirmCommand !== undefined) {
    Object.assign(shellOptions, { confirm: options.confirmCommand });
  }
  if (options.shellTimeoutMs !== undefined) {
    Object.assign(shellOptions, { timeoutMs: options.shellTimeoutMs });
  }

  const webOptions = {};
  if (options.openRouter !== undefined) {
    Object.assign(webOptions, { openRouter: options.openRouter });
  }
  if (options.webResearchModel !== undefined) {
    Object.assign(webOptions, { model: options.webResearchModel });
  }

  return new ToolRegistry([
    ...createFilesystemTools(filesystemOptions),
    createShellTool(shellOptions),
    createWebScrapeTool(webOptions),
  ]);
}

export function createDefaultToolRegistry(rootDir: string = process.cwd()): ToolRegistry {
  return createToolRegistryFromConfig({
    rootDir,
  });
}

export const availableTools = ["web_scrape", "read_file", "write_file", "list_dir", "run_command"] as const;
