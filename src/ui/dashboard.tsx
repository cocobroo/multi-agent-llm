import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { LiveTaskState, OrchestraEventEmitter, OrchestraLiveState } from "../events.js";

export interface DashboardProps {
  state: OrchestraLiveState;
}

export interface LiveDashboardProps {
  events: OrchestraEventEmitter;
}

const roleColors = new Map<string, string>([
  ["researcher", "cyan"],
  ["coder", "yellow"],
  ["analyst", "magenta"],
  ["writer", "green"],
]);

export function Dashboard({ state }: DashboardProps): React.ReactElement {
  const tasks = Array.from(state.tasks.values());

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text bold color="cyan">
          orchestra
        </Text>
        <Text>{state.objective.length > 0 ? state.objective : "Waiting for objective..."}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Execution plan</Text>
        {tasks.length === 0 ? <Text color="gray">No tasks yet.</Text> : null}
        {tasks.map((task) => (
          <TaskLine key={task.taskId} task={task} />
        ))}
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text>
          tokens <Text color="cyan">{state.totalTokens}</Text>  cost{" "}
          <Text color="green">${state.totalCostUsd.toFixed(6)}</Text>
        </Text>
      </Box>

      {state.finalAnswer !== undefined ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="green">
            Final answer
          </Text>
          <Text>{state.finalAnswer}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function LiveDashboard({ events }: LiveDashboardProps): React.ReactElement {
  const [state, setState] = useState<OrchestraLiveState>(() => events.snapshot());

  useEffect(() => {
    const refresh = (): void => {
      setState(events.snapshot());
    };

    events.on("plan:ready", refresh);
    events.on("task:pending", refresh);
    events.on("task:start", refresh);
    events.on("task:done", refresh);
    events.on("task:failed", refresh);
    events.on("cost:update", refresh);
    events.on("final:answer", refresh);

    return () => {
      events.off("plan:ready", refresh);
      events.off("task:pending", refresh);
      events.off("task:start", refresh);
      events.off("task:done", refresh);
      events.off("task:failed", refresh);
      events.off("cost:update", refresh);
      events.off("final:answer", refresh);
    };
  }, [events]);

  return <Dashboard state={state} />;
}

function TaskLine({ task }: { task: LiveTaskState }): React.ReactElement {
  const color = roleColors.get(task.agentRole) ?? "white";
  const status = renderStatus(task.status);
  const dependencies =
    task.dependsOn === undefined || task.dependsOn.length === 0 ? "" : ` <- ${task.dependsOn.join(", ")}`;
  const model = task.model === undefined ? "" : ` ${task.model}`;
  const duration = task.durationMs === undefined ? "" : ` (${formatDuration(task.durationMs)})`;
  const description = task.description === undefined ? "" : ` - ${task.description}`;

  return (
    <Text>
      <Text color={status.color}>{status.icon}</Text> {task.taskId}{" "}
      <Text color={color}>[{task.agentRole}]</Text>
      <Text color="gray">{dependencies}</Text>
      <Text color="gray">{model}</Text>
      <Text color="gray">{duration}</Text>
      <Text>{description}</Text>
      {task.error === undefined ? null : <Text color="red"> {task.error}</Text>}
    </Text>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function renderStatus(status: LiveTaskState["status"]): { icon: string; color: string } {
  if (status === "pending") {
    return { icon: "o", color: "gray" };
  }

  if (status === "running") {
    return { icon: "~", color: "yellow" };
  }

  if (status === "done") {
    return { icon: "+", color: "green" };
  }

  return { icon: "x", color: "red" };
}
