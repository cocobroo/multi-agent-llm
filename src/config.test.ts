import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { createConnectedConfig, createDefaultConfig, writeConfigFile } from "./config.js";

describe("config helpers", () => {
  test("default config gives the planner a universal agent roster", () => {
    const config = createDefaultConfig({});

    expect(Object.keys(config.agents)).toEqual([
      "researcher",
      "coder",
      "analyst",
      "writer",
      "generalist",
    ]);
    expect(config.agents.generalist?.systemPrompt).toContain("general-purpose");
    expect(config.openrouterApiKey).toBeUndefined();
  });

  test("connected config stores an OpenRouter key and keeps models configurable", () => {
    const config = createConnectedConfig("test-openrouter-key", {
      orchestratorModel: "anthropic/claude-sonnet-4",
      classifierModel: "openai/gpt-4.1-mini",
    });

    expect(config.openrouterApiKey).toBe("test-openrouter-key");
    expect(config.orchestratorModel).toBe("anthropic/claude-sonnet-4");
    expect(config.classifierModel).toBe("openai/gpt-4.1-mini");
    expect(config.agents.coder?.tools).toContain("run_command");
  });

  test("writes a local gitignored config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchestra-config-"));

    try {
      const path = await writeConfigFile(dir, createConnectedConfig("test-openrouter-key"));
      const json = JSON.parse(await readFile(path, "utf8")) as { openrouterApiKey?: string };

      expect(path.endsWith("orchestra.config.json")).toBe(true);
      expect(json.openrouterApiKey).toBe("test-openrouter-key");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
