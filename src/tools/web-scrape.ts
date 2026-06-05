import type { OpenRouterChatClient, OpenRouterUsage } from "../providers/openrouter.js";
import type { AgentTool } from "./index.js";

export interface WebScrapeInput {
  url?: string;
  query?: string;
}

export interface WebScrapeOutput {
  source: string;
  text: string;
  usage: OpenRouterUsage;
}

export interface WebScrapeToolOptions {
  openRouter?: OpenRouterChatClient;
  model?: string;
}

export function createWebScrapeTool(options: WebScrapeToolOptions = {}): AgentTool {
  return {
    name: "web_scrape",
    description:
      options.openRouter === undefined || options.model === undefined
        ? "OpenRouter web research is disabled because no OpenRouter client/model is configured."
        : "Research a URL or query using an OpenRouter model configured for web-capable research.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        query: { type: "string" },
      },
    },
    execute: async (input) => {
      if (options.openRouter === undefined || options.model === undefined) {
        return "web_scrape disabled: configure an OpenRouter web-capable research model to enable it.";
      }

      const scrapeInput: WebScrapeInput = {};
      const url = readOptionalString(input, "url");
      const query = readOptionalString(input, "query");
      if (url !== undefined) {
        scrapeInput.url = url;
      }
      if (query !== undefined) {
        scrapeInput.query = query;
      }

      const result = await webScrape(
        scrapeInput,
        {
          openRouter: options.openRouter,
          model: options.model,
        },
      );
      return result.text;
    },
  };
}

export async function webScrape(
  input: WebScrapeInput,
  options: Required<WebScrapeToolOptions>,
): Promise<WebScrapeOutput> {
  const source = input.url ?? input.query;
  if (source === undefined || source.trim().length === 0) {
    throw new Error("web_scrape requires either url or query.");
  }

  const response = await options.openRouter.chat({
    model: options.model,
    messages: [
      {
        role: "system",
        content:
          "You are the web research tool inside orchestra. Use the model's available web/retrieval capability when present. Return concise, source-aware text. If live access is unavailable, say so clearly.",
      },
      {
        role: "user",
        content:
          input.url === undefined
            ? `Research this query and return useful text:\n${source}`
            : `Research this URL and return useful text:\n${source}`,
      },
    ],
    temperature: 0,
  });

  return {
    source,
    text: response.text,
    usage: response.usage,
  };
}

function readOptionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Tool argument '${key}' must be a string.`);
  }

  return value;
}
