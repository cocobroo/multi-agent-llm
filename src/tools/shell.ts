import { exec } from "node:child_process";
import { promisify } from "node:util";
import { confirm as promptConfirm } from "@inquirer/prompts";
import type { AgentTool } from "./index.js";

const execAsync = promisify(exec);

export interface CommandConfirmation {
  confirm(command: string): Promise<boolean>;
}

export interface ShellToolOptions {
  confirm?: (command: string) => Promise<boolean>;
  timeoutMs?: number;
  cwd?: string;
}

export function createShellTool(options: ShellToolOptions = {}): AgentTool {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const cwd = options.cwd ?? process.cwd();
  const confirmCommand = options.confirm ?? defaultConfirm;

  return {
    name: "run_command",
    description: "Run a shell command after explicit interactive user confirmation.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
    },
    execute: async (input) => runConfirmedCommand(readString(input, "command"), {
      confirm: confirmCommand,
      timeoutMs,
      cwd,
    }),
  };
}

export async function runConfirmedCommand(
  command: string,
  options: CommandConfirmation & { timeoutMs?: number; cwd?: string },
): Promise<string> {
  const confirmed = await options.confirm(command);

  if (!confirmed) {
    return "Command cancelled by user.";
  }

  const { stdout, stderr } = await execAsync(command, {
    timeout: options.timeoutMs ?? 120_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    cwd: options.cwd,
  });

  const output = [stdout.trim(), stderr.trim()].filter((part) => part.length > 0).join("\n");
  return output.length > 0 ? output : "Command completed with no output.";
}

async function defaultConfirm(command: string): Promise<boolean> {
  return promptConfirm({
    message: `Run command? ${command}`,
    default: false,
  });
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Tool argument '${key}' must be a non-empty string.`);
  }

  return value;
}
