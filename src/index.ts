#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import React from "react";
import { confirm, input, password } from "@inquirer/prompts";
import chalk from "chalk";
import { Command } from "commander";
import { render } from "ink";
import { createAgentRegistry } from "./agents/registry.js";
import { TaskClassifier } from "./classifier.js";
import {
  createConnectedConfig,
  loadConfig,
  writeConfigFile,
  type AgentConfig,
  type OrchestraConfig,
} from "./config.js";
import { OrchestraEventEmitter } from "./events.js";
import { DagExecutor } from "./executor.js";
import { OrchestratorAgent } from "./orchestrator.js";
import { Planner } from "./planner.js";
import { OpenRouterClient } from "./providers/openrouter.js";
import { createToolRegistryFromConfig } from "./tools/index.js";
import { LiveDashboard } from "./ui/dashboard.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("orchestra")
    .description("Interactive multi-agent LLM orchestrator CLI.")
    .version("0.1.0")
    .option("--once <objective>", "Run one objective and exit.")
    .option("--model <model>", "Override the orchestrator model for this run.");

  program
    .command("connect")
    .description("Connect an OpenRouter API key and create orchestra.config.json.")
    .option("--skip-verify", "Write config without making a verification request.")
    .option("--key-env <name>", "Store env:<name> instead of the raw key in orchestra.config.json.")
    .option("--force", "Overwrite orchestra.config.json without asking.")
    .action(async (options: { skipVerify?: boolean; keyEnv?: string; force?: boolean }) => {
      await connectOpenRouter(process.cwd(), options);
    });

  program
    .action(async (options: { once?: string; model?: string }) => {
      const config = await loadConfig(process.cwd());
      if (options.model !== undefined) {
        config.orchestratorModel = options.model;
      }
      if (options.once !== undefined) {
        await runObjective(options.once, config);
        return;
      }

      await runInteractive(config);
    });

  return program;
}

async function runInteractive(config: OrchestraConfig): Promise<void> {
  console.log(chalk.cyan("orchestra"));
  console.log(chalk.gray("Type an objective, /config, or /exit."));

  while (true) {
    const objective = await input({
      message: "objective",
      required: true,
    });
    const trimmed = objective.trim();

    if (trimmed === "/exit") {
      return;
    }

    if (trimmed === "/config") {
      printConfig(config);
      continue;
    }

    await runObjective(trimmed, config);
  }
}

async function runObjective(objective: string, config: OrchestraConfig): Promise<void> {
  if (config.openrouterApiKey === undefined || config.openrouterApiKey.trim().length === 0) {
    console.log(chalk.red("Missing OpenRouter API key."));
    console.log(chalk.gray("Run `orchestra connect` or set OPENROUTER_API_KEY."));
    return;
  }

  const openRouter = new OpenRouterClient({
    apiKey: config.openrouterApiKey,
    appName: "orchestra",
    siteUrl: "https://github.com/open-source/orchestra",
  });
  const events = new OrchestraEventEmitter();
  const webResearchModel = config.webResearchModel ?? config.agents.researcher?.webModel;
  const toolRegistryOptions = {
    rootDir: process.cwd(),
    openRouter,
  };
  const toolRegistry = createToolRegistryFromConfig(
    webResearchModel === undefined
      ? toolRegistryOptions
      : {
          ...toolRegistryOptions,
          webResearchModel,
        },
  );
  const agents = createAgentRegistry(config.agents, openRouter, toolRegistry);
  const tierModels = config.tierModels ?? {
    tier1: config.agents.writer?.model ?? config.classifierModel ?? config.orchestratorModel,
    tier2: config.agents.analyst?.model ?? config.orchestratorModel,
    tier3: config.orchestratorModel,
  };
  const planner = new Planner({
    openRouter,
    model: config.orchestratorModel,
    availableAgents: describeAgentsForPlanner(config.agents),
  });
  const classifier = new TaskClassifier({
    openRouter,
    model: config.classifierModel ?? tierModels.tier1,
    thresholds: config.tierThresholds,
    tierModels,
  });
  const executor = new DagExecutor({
    agents,
    classifier,
    events,
    concurrency: 4,
  });
  const orchestrator = new OrchestratorAgent({
    openRouter,
    model: config.orchestratorModel,
    planner,
    executor,
  });
  const ink = render(React.createElement(LiveDashboard, { events }));

  try {
    const result = await orchestrator.run({ objective });
    events.emitFinalAnswer({ answer: result.answer });
    events.emitCostUpdate({
      totalTokens: result.tokens.totalTokens,
      totalCostUsd: result.totalCostUsd,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown orchestration failure";
    console.log(chalk.red(`orchestra failed: ${message}`));
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 250));
    ink.unmount();
  }
}

async function connectOpenRouter(
  cwd: string,
  options: { skipVerify?: boolean; keyEnv?: string; force?: boolean },
): Promise<void> {
  const configPath = join(cwd, "orchestra.config.json");

  if ((await fileExists(configPath)) && options.force !== true) {
    const overwrite = await confirm({
      message: "orchestra.config.json already exists. Overwrite it?",
      default: false,
    });

    if (!overwrite) {
      console.log(chalk.yellow("Connection cancelled."));
      return;
    }
  }

  const key =
    options.keyEnv === undefined
      ? await password({
          message: "OpenRouter API key",
          mask: "*",
          validate: (value) => value.trim().length > 0 || "API key is required.",
        })
      : process.env[options.keyEnv];

  if (key === undefined || key.trim().length === 0) {
    throw new Error(
      options.keyEnv === undefined
        ? "OpenRouter API key is required."
        : `Environment variable ${options.keyEnv} is not set.`,
    );
  }

  if (options.skipVerify !== true) {
    await verifyOpenRouterKey(key);
  }

  const storedKey = options.keyEnv === undefined ? key : `env:${options.keyEnv}`;
  const savedPath = await writeConfigFile(cwd, createConnectedConfig(storedKey));
  console.log(chalk.green(`OpenRouter connected. Wrote ${savedPath}.`));
  console.log(chalk.gray("Now run `orchestra` or `orchestra --once \"your objective\"`."));
}

async function verifyOpenRouterKey(apiKey: string): Promise<void> {
  const openRouter = new OpenRouterClient({
    apiKey,
    appName: "orchestra",
    siteUrl: "https://github.com/open-source/orchestra",
    timeoutMs: 30_000,
  });

  const result = await openRouter.chat({
    model: "openai/gpt-4.1-mini",
    messages: [{ role: "user", content: "Reply with exactly: orchestra-ok" }],
    temperature: 0,
    max_tokens: 16,
  });

  if (!result.text.trim().toLowerCase().includes("orchestra-ok")) {
    throw new Error("OpenRouter verification returned an unexpected response.");
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function describeAgentsForPlanner(agents: Record<string, AgentConfig>): Array<{
  role: string;
  model: string;
  tools: string[];
}> {
  return Object.entries(agents).map(([role, agent]) => ({
    role,
    model: agent.model,
    tools: agent.tools ?? [],
  }));
}

function printConfig(config: OrchestraConfig): void {
  const agentLines = Object.entries(config.agents)
    .map(([role, agent]) => `${role}: ${agent.model}`)
    .join("\n");
  console.log(chalk.gray("Current config"));
  console.log(`orchestrator: ${config.orchestratorModel}`);
  console.log(`classifier: ${config.classifierModel ?? "(default tier1)"}`);
  console.log(`web research: ${config.webResearchModel ?? config.agents.researcher?.webModel ?? "(disabled)"}`);
  console.log(agentLines);
}

if (isCliEntrypoint()) {
  createCli().parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown CLI failure";
    console.error(chalk.red(message));
    process.exitCode = 1;
  });
}

function isCliEntrypoint(): boolean {
  return isCliEntrypointPath(import.meta.url, process.argv[1]);
}

export function isCliEntrypointPath(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) {
    return false;
  }

  try {
    const modulePath = normalizeEntrypointPath(realpathSync(fileURLToPath(moduleUrl)));
    const resolvedArgvPath = normalizeEntrypointPath(realpathSync(argvPath));
    return modulePath === resolvedArgvPath;
  } catch {
    return false;
  }
}

function normalizeEntrypointPath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
