import type { AgentResult, AgentStatus } from "./types.js";

export interface SharedContextEntry {
  taskId: string;
  agentRole: string;
  output: string;
  status: AgentStatus;
  tokens: AgentResult["tokens"];
  costUsd: number;
  error?: string;
  createdAt: Date;
}

export type SharedContextWrite = Omit<SharedContextEntry, "createdAt">;

export class SharedContext {
  private readonly entries = new Map<string, SharedContextEntry>();

  private writeQueue: Promise<void> = Promise.resolve();

  public async writeResult(entry: SharedContextWrite): Promise<SharedContextEntry> {
    const writeOperation = this.writeQueue.then(() => {
      const stored: SharedContextEntry = {
        ...entry,
        createdAt: new Date(),
      };
      this.entries.set(entry.taskId, stored);
      return stored;
    });

    this.writeQueue = writeOperation.then(
      () => undefined,
      () => undefined,
    );

    return writeOperation;
  }

  public readResult(taskId: string): SharedContextEntry | undefined {
    return this.entries.get(taskId);
  }

  public allResults(): SharedContextEntry[] {
    return Array.from(this.entries.values()).sort((left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime(),
    );
  }

  public getDependencyContext(taskIds: string[]): string {
    return taskIds
      .map((taskId) => this.entries.get(taskId))
      .filter((entry): entry is SharedContextEntry => entry !== undefined)
      .map((entry) => renderEntry(entry))
      .join("\n\n");
  }

  public snapshot(): string {
    return this.allResults().map((entry) => renderEntry(entry)).join("\n\n");
  }
}

export class MessageBus extends SharedContext {}

function renderEntry(entry: SharedContextEntry): string {
  const errorText = entry.error === undefined ? "" : `\nError: ${entry.error}`;
  return `Task ${entry.taskId} (${entry.agentRole}, ${entry.status}):\n${entry.output}${errorText}`;
}
