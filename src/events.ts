import { EventEmitter } from "node:events";

export type LiveTaskStatus = "pending" | "running" | "done" | "failed";

export interface LiveTaskState {
  taskId: string;
  agentRole: string;
  status: LiveTaskStatus;
  model?: string;
  description?: string;
  dependsOn?: string[];
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
}

export interface OrchestraLiveState {
  objective: string;
  tasks: Map<string, LiveTaskState>;
  totalTokens: number;
  totalCostUsd: number;
  finalAnswer?: string;
}

export interface TaskPendingEvent {
  taskId: string;
  agentRole: string;
  description: string;
  dependsOn: string[];
}

export interface TaskStartEvent {
  taskId: string;
  agentRole: string;
  model?: string;
}

export interface TaskDoneEvent {
  taskId: string;
  agentRole: string;
  model: string;
  output: string;
}

export interface TaskFailedEvent {
  taskId: string;
  agentRole: string;
  error: string;
}

export interface CostUpdateEvent {
  totalTokens: number;
  totalCostUsd: number;
}

export interface FinalAnswerEvent {
  answer: string;
}

export interface OrchestraEventMap {
  "plan:ready": [ExecutionPlanEvent];
  "task:pending": [TaskPendingEvent];
  "task:start": [TaskStartEvent];
  "task:done": [TaskDoneEvent];
  "task:failed": [TaskFailedEvent];
  "cost:update": [CostUpdateEvent];
  "final:answer": [FinalAnswerEvent];
}

export interface ExecutionPlanEvent {
  objective: string;
  tasks: TaskPendingEvent[];
}

export class OrchestraEventEmitter extends EventEmitter {
  private readonly state: OrchestraLiveState = {
    objective: "",
    tasks: new Map(),
    totalTokens: 0,
    totalCostUsd: 0,
  };

  public override on<TEvent extends keyof OrchestraEventMap>(
    eventName: TEvent,
    listener: (...args: OrchestraEventMap[TEvent]) => void,
  ): this {
    return super.on(eventName, listener);
  }

  public emitPlanReady(event: ExecutionPlanEvent): boolean {
    this.state.objective = event.objective;
    for (const task of event.tasks) {
      this.state.tasks.set(task.taskId, {
        taskId: task.taskId,
        agentRole: task.agentRole,
        description: task.description,
        dependsOn: task.dependsOn,
        status: "pending",
      });
    }
    return super.emit("plan:ready", event);
  }

  public emitTaskPending(event: TaskPendingEvent): boolean {
    this.state.tasks.set(event.taskId, {
      taskId: event.taskId,
      agentRole: event.agentRole,
      description: event.description,
      dependsOn: event.dependsOn,
      status: "pending",
    });
    return super.emit("task:pending", event);
  }

  public emitTaskStart(event: TaskStartEvent): boolean {
    const startedAt = new Date();
    const patch: Partial<LiveTaskState> & Pick<LiveTaskState, "agentRole" | "status"> = {
      agentRole: event.agentRole,
      status: "running",
      startedAt,
    };
    if (event.model !== undefined) {
      patch.model = event.model;
    }
    this.mergeTask(event.taskId, patch);
    return super.emit("task:start", event);
  }

  public emitTaskDone(event: TaskDoneEvent): boolean {
    const current = this.state.tasks.get(event.taskId);
    const finishedAt = new Date();
    const startedAt = current?.startedAt;
    const durationMs = startedAt === undefined ? undefined : finishedAt.getTime() - startedAt.getTime();
    const patch: Partial<LiveTaskState> & Pick<LiveTaskState, "agentRole" | "status"> = {
      agentRole: event.agentRole,
      status: "done",
      model: event.model,
      finishedAt,
    };
    if (startedAt !== undefined) {
      patch.startedAt = startedAt;
    }
    if (durationMs !== undefined) {
      patch.durationMs = durationMs;
    }
    this.mergeTask(event.taskId, patch);
    return super.emit("task:done", event);
  }

  public emitTaskFailed(event: TaskFailedEvent): boolean {
    this.mergeTask(event.taskId, {
      agentRole: event.agentRole,
      status: "failed",
      error: event.error,
    });
    return super.emit("task:failed", event);
  }

  public emitCostUpdate(event: CostUpdateEvent): boolean {
    this.state.totalTokens = event.totalTokens;
    this.state.totalCostUsd = event.totalCostUsd;
    return super.emit("cost:update", event);
  }

  public emitFinalAnswer(event: FinalAnswerEvent): boolean {
    this.state.finalAnswer = event.answer;
    return super.emit("final:answer", event);
  }

  public snapshot(): OrchestraLiveState {
    const snapshot: OrchestraLiveState = {
      objective: this.state.objective,
      tasks: new Map(this.state.tasks),
      totalTokens: this.state.totalTokens,
      totalCostUsd: this.state.totalCostUsd,
    };
    if (this.state.finalAnswer !== undefined) {
      snapshot.finalAnswer = this.state.finalAnswer;
    }
    return snapshot;
  }

  private mergeTask(taskId: string, patch: Partial<LiveTaskState> & Pick<LiveTaskState, "agentRole" | "status">): void {
    const current = this.state.tasks.get(taskId);
    const next: LiveTaskState = {
      taskId,
      agentRole: patch.agentRole,
      status: patch.status,
    };
    const description = current?.description;
    const dependsOn = current?.dependsOn;
    const model = patch.model ?? current?.model;
    const error = patch.error ?? current?.error;
    const startedAt = patch.startedAt ?? current?.startedAt;
    const finishedAt = patch.finishedAt ?? current?.finishedAt;
    const durationMs = patch.durationMs ?? current?.durationMs;
    if (description !== undefined) {
      next.description = description;
    }
    if (dependsOn !== undefined) {
      next.dependsOn = dependsOn;
    }
    if (model !== undefined) {
      next.model = model;
    }
    if (error !== undefined) {
      next.error = error;
    }
    if (startedAt !== undefined) {
      next.startedAt = startedAt;
    }
    if (finishedAt !== undefined) {
      next.finishedAt = finishedAt;
    }
    if (durationMs !== undefined) {
      next.durationMs = durationMs;
    }
    this.state.tasks.set(taskId, next);
  }
}
