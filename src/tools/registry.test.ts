import { describe, expect, test } from "vitest";
import { createToolRegistryFromConfig } from "./index.js";

describe("tool registry", () => {
  test("creates role tools and disables web research when no OpenRouter client is provided", async () => {
    const registry = createToolRegistryFromConfig({
      rootDir: process.cwd(),
      confirmCommand: async () => false,
    });

    expect(registry.getMany(["read_file", "write_file", "list_dir", "run_command"])).toHaveLength(4);

    const webScrape = registry.get("web_scrape");
    await expect(webScrape?.execute({ url: "https://example.com" }, {} as never)).resolves.toContain(
      "disabled",
    );
  });
});
