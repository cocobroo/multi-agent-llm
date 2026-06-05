import { loadConfig } from "../config.js";
import { OpenRouterClient } from "../providers/openrouter.js";

const config = await loadConfig(process.cwd());
const apiKey = config.openrouterApiKey;

if (apiKey === undefined || apiKey.trim().length === 0) {
  throw new Error("Set OPENROUTER_API_KEY or openrouterApiKey in orchestra.config.json.");
}

const model = process.env.ORCHESTRA_PING_MODEL ?? config.classifierModel ?? "openai/gpt-4.1-mini";
const client = new OpenRouterClient({
  apiKey,
  appName: "orchestra",
  siteUrl: "https://github.com/open-source/orchestra",
});

const result = await client.chat({
  model,
  messages: [
    {
      role: "user",
      content: "Reply with exactly: orchestra-ok",
    },
  ],
  temperature: 0,
  max_tokens: 16,
});

console.log(
  JSON.stringify(
    {
      model: result.model,
      text: result.text.trim(),
      usage: result.usage,
    },
    null,
    2,
  ),
);
