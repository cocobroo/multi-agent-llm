import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cosmiconfig } from "cosmiconfig";
import { z } from "zod";

const agentConfigSchema = z.object({
  model: z.string().min(1),
  webModel: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)).optional(),
});

const orchestraConfigSchema = z.object({
  openrouterApiKey: z.string().min(1).optional(),
  orchestratorModel: z.string().min(1),
  classifierModel: z.string().min(1).optional(),
  webResearchModel: z.string().min(1).optional(),
  agents: z.record(agentConfigSchema),
  tierThresholds: z.object({
    tier1: z.number().int().nonnegative(),
    tier2: z.number().int().nonnegative(),
  }),
  tierModels: z
    .object({
      tier1: z.string().min(1),
      tier2: z.string().min(1),
      tier3: z.string().min(1),
    })
    .optional(),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type OrchestraConfig = z.infer<typeof orchestraConfigSchema>;

export interface ConnectedConfigOptions {
  orchestratorModel?: string;
  classifierModel?: string;
  webResearchModel?: string;
}

export async function loadConfig(cwd: string = process.cwd()): Promise<OrchestraConfig> {
  const explorer = cosmiconfig("orchestra", {
    searchPlaces: ["orchestra.config.json", ".orchestrarc", ".orchestrarc.json"],
  });
  const result = await explorer.search(cwd);

  const rawConfig = result?.config ?? createDefaultConfig(process.env);
  const parsed = orchestraConfigSchema.parse(rawConfig);

  return {
    ...parsed,
    openrouterApiKey: resolveSecret(parsed.openrouterApiKey, "OPENROUTER_API_KEY"),
  };
}

export function createDefaultConfig(env: NodeJS.ProcessEnv = process.env): OrchestraConfig {
  return {
    openrouterApiKey: env.OPENROUTER_API_KEY,
    orchestratorModel: env.ORCHESTRA_ORCHESTRATOR_MODEL ?? "anthropic/claude-opus-4",
    classifierModel: env.ORCHESTRA_CLASSIFIER_MODEL ?? "openai/gpt-4.1-mini",
    webResearchModel: env.ORCHESTRA_WEB_RESEARCH_MODEL,
    agents: {
      researcher: {
        model: env.ORCHESTRA_RESEARCHER_MODEL ?? "perplexity/sonar",
        webModel: env.ORCHESTRA_WEB_RESEARCH_MODEL,
        systemPrompt:
          "You are the Researcher agent. Gather facts, cite uncertainty, and produce concise evidence.",
        tools: ["web_scrape"],
      },
      coder: {
        model: env.ORCHESTRA_CODER_MODEL ?? "anthropic/claude-sonnet-4",
        systemPrompt:
          "You are the Coder agent. Produce practical implementation details and use local tools carefully.",
        tools: ["read_file", "write_file", "list_dir", "run_command"],
      },
      analyst: {
        model: env.ORCHESTRA_ANALYST_MODEL ?? "openai/gpt-4.1",
        systemPrompt:
          "You are the Analyst agent. Reason step by step internally and return clear conclusions.",
      },
      writer: {
        model: env.ORCHESTRA_WRITER_MODEL ?? "openai/gpt-4.1-mini",
        systemPrompt:
          "You are the Writer agent. Synthesize results into polished, concise prose.",
      },
      generalist: {
        model: env.ORCHESTRA_GENERALIST_MODEL ?? env.ORCHESTRA_WRITER_MODEL ?? "openai/gpt-4.1-mini",
        systemPrompt:
          "You are the Generalist agent. Handle general-purpose, miscellaneous, or ambiguous user requests and coordinate a practical next step when no specialist fits.",
      },
    },
    tierThresholds: {
      tier1: 3,
      tier2: 6,
    },
    tierModels: {
      tier1: env.ORCHESTRA_TIER1_MODEL ?? env.ORCHESTRA_WRITER_MODEL ?? "openai/gpt-4.1-mini",
      tier2: env.ORCHESTRA_TIER2_MODEL ?? env.ORCHESTRA_ANALYST_MODEL ?? "openai/gpt-4.1",
      tier3:
        env.ORCHESTRA_TIER3_MODEL ??
        env.ORCHESTRA_ORCHESTRATOR_MODEL ??
        "anthropic/claude-opus-4",
    },
  };
}

export function createConnectedConfig(
  openrouterApiKey: string,
  options: ConnectedConfigOptions = {},
): OrchestraConfig {
  return {
    ...createDefaultConfig({}),
    openrouterApiKey,
    orchestratorModel: options.orchestratorModel ?? "anthropic/claude-opus-4",
    classifierModel: options.classifierModel ?? "openai/gpt-4.1-mini",
    webResearchModel: options.webResearchModel ?? "perplexity/sonar",
  };
}

export async function writeConfigFile(cwd: string, config: OrchestraConfig): Promise<string> {
  const configPath = join(cwd, "orchestra.config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

function resolveSecret(value: string | undefined, fallbackEnvName: string): string | undefined {
  if (value === undefined) {
    return process.env[fallbackEnvName];
  }

  if (!value.startsWith("env:")) {
    return value;
  }

  const envName = value.slice("env:".length);
  return process.env[envName] ?? process.env[fallbackEnvName];
}
