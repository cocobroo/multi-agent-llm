import PQueue from "p-queue";
import { SharedContext } from "./bus.js";
import type { OrchestraEventEmitter } from "./events.js";
import type { AgentResult, ExecutionPlan, Task, TaskClassification } from "./types.js";
import { addUsage, zeroUsage } from "./types.js";

export interface RunnableAgent {
  run(task: Task, context: SharedContext): Promise<AgentResult>;
}

export interface TaskClassifierLike {
  classify(task: Task): Promise<TaskClassification>;
}

export interface DagExecutorOptions {
  agents: Map<string, RunnableAgent>;
  classifier?: TaskClassifierLike;
  context?: SharedContext;
  concurrency?: number;
  events?: OrchestraEventEmitter;
}

export interface ExecutionResult {
  plan: ExecutionPlan;
  results: AgentResult[];
  completedTaskIds: string[];
  failedTaskIds: string[];
  tokens: AgentResult["tokens"];
  totalCostUsd: number;
  context: SharedContext;
}

export class DagExecutor {
  private readonly agents: Map<string, RunnableAgent>;

  private readonly classifier: TaskClassifierLike | undefined;

  private readonly context: SharedContext;

  private readonly queue: PQueue;

  private readonly events: OrchestraEventEmitter | undefined;

  public constructor(options: DagExecutorOptions) {
    this.agents = options.agents;
    this.classifier = options.classifier;
    this.context = options.context ?? new SharedContext();
    this.queue = new PQueue({ concurrency: options.concurrency ?? 4 });
    this.events = options.events;
  }

  public async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    const pending = new Set(plan.tasks.map((task) => task.id));
    const completed = new Set<string>();
    const failed = new Set<string>();
    const results: AgentResult[] = [];
    let aggregateUsage = zeroUsage();

    this.events?.emitPlanReady({
      objective: plan.objective,
      tasks: plan.tasks.map((task) => ({
        taskId: task.id,
        agentRole: task.agentRole,
        description: task.description,
        dependsOn: task.dependsOn,
      })),
    });

    while (pending.size > 0) {
      const blockedTasks = plan.tasks.filter(
        (task) =>
          pending.has(task.id) && task.dependsOn.some((dependency) => failed.has(dependency)),
      );

      for (const task of blockedTasks) {
        pending.delete(task.id);
        failed.add(task.id);
        const result = createFailedResult(
          task,
          `Task '${task.id}' has a failed dependency and cannot run.`,
        );
        results.push(result);
        this.events?.emitTaskFailed({
          taskId: task.id,
          agentRole: task.agentRole,
          error: result.error ?? "failed dependency",
        });
        await this.writeResult(result);
      }

      const runnableTasks = plan.tasks.filter(
        (task) =>
          pending.has(task.id) && task.dependsOn.every((dependency) => completed.has(dependency)),
      );

      if (runnableTasks.length === 0) {
        for (const taskId of Array.from(pending)) {
          const task = plan.tasks.find((candidate) => candidate.id === taskId);
          if (task === undefined) {
            continue;
          }

          pending.delete(task.id);
          failed.add(task.id);
          const result = createFailedResult(
            task,
            `Task '${task.id}' could not run because the DAG is cyclic or unsatisfied.`,
          );
          results.push(result);
          this.events?.emitTaskFailed({
            taskId: task.id,
            agentRole: task.agentRole,
            error: result.error ?? "unsatisfied DAG",
          });
          await this.writeResult(result);
        }
        break;
      }

      const batchResults = await Promise.all(
        runnableTasks.map((task) =>
          this.queue.add(async () => this.runTaskWithRetry(task)) as Promise<AgentResult>,
        ),
      );

      for (const result of batchResults) {
        pending.delete(result.taskId);
        results.push(result);

        if (result.status === "done") {
          completed.add(result.taskId);
          this.events?.emitTaskDone({
            taskId: result.taskId,
            agentRole: result.agentRole,
            model: result.model,
            output: result.output,
          });
        } else {
          failed.add(result.taskId);
          this.events?.emitTaskFailed({
            taskId: result.taskId,
            agentRole: result.agentRole,
            error: result.error ?? "task failed",
          });
        }

        await this.writeResult(result);
        aggregateUsage = addUsage(aggregateUsage, result.tokens);
        this.events?.emitCostUpdate({
          totalTokens: aggregateUsage.totalTokens,
          totalCostUsd: aggregateUsage.costUsd,
        });
      }
    }

    const tokens = results.reduce((usage, result) => addUsage(usage, result.tokens), zeroUsage());

    return {
      plan,
      results,
      completedTaskIds: Array.from(completed),
      failedTaskIds: Array.from(failed),
      tokens,
      totalCostUsd: tokens.costUsd,
      context: this.context,
    };
  }

  private async runTaskWithRetry(task: Task): Promise<AgentResult> {
    let classifiedTask = task;
    let classificationUsage = zeroUsage();

    if (this.classifier !== undefined) {
      const classification = await this.classifier.classify(task);
      classificationUsage = classification.usage;
      classifiedTask = {
        ...task,
        classification,
      };
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const startEvent = {
          taskId: classifiedTask.id,
          agentRole: classifiedTask.agentRole,
        };
        const model = classifiedTask.classification?.model;
        this.events?.emitTaskStart(
          model === undefined
            ? startEvent
            : {
                ...startEvent,
                model,
              },
        );
        const result = await this.runTask(classifiedTask);
        return {
          ...result,
          tokens: addUsage(classificationUsage, result.tokens),
          costUsd: classificationUsage.costUsd + result.costUsd,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown agent failure");
      }
    }

    const failedResult = createFailedResult(
      classifiedTask,
      lastError?.message ?? "Agent failed after retry.",
    );

    return {
      ...failedResult,
      tokens: classificationUsage,
      costUsd: classificationUsage.costUsd,
    };
  }

  private async runTask(task: Task): Promise<AgentResult> {
    const agent = this.agents.get(task.agentRole);

    if (agent === undefined) {
      throw new Error(`No agent registered for role '${task.agentRole}'.`);
    }

    return agent.run(task, this.context);
  }

  private async writeResult(result: AgentResult): Promise<void> {
    const write = {
      taskId: result.taskId,
      agentRole: result.agentRole,
      output: result.output,
      status: result.status,
      tokens: result.tokens,
      costUsd: result.costUsd,
    };

    await this.context.writeResult(
      result.error === undefined
        ? write
        : {
            ...write,
            error: result.error,
          },
    );
  }
}

function createFailedResult(task: Task, error: string): AgentResult {
  return {
    taskId: task.id,
    agentId: task.agentRole,
    agentName: task.agentRole,
    agentRole: task.agentRole,
    model: task.classification?.model ?? "",
    output: "",
    status: "failed",
    tokens: zeroUsage(),
    costUsd: 0,
    calls: [],
    toolResults: [],
    error,
  };
}
