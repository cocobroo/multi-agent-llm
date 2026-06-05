import { describe, expect, test } from "vitest";
import { inspect } from "node:util";
import {
  OpenRouterApiError,
  OpenRouterClient,
  type OpenRouterChatRequest,
  type OpenRouterHttpClient,
} from "./openrouter.js";

describe("OpenRouterClient", () => {
  test("sends a chat completion request with authorization and returns text plus usage", async () => {
    const calls: Array<{
      path: string;
      body: OpenRouterChatRequest;
      headers: Record<string, string>;
    }> = [];

    const httpClient: OpenRouterHttpClient = {
      async post(path, body, options) {
        calls.push({ path, body, headers: options.headers });

        return {
          data: {
            id: "gen-123",
            model: body.model,
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "pong",
                },
              },
            ],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 2,
              total_tokens: 7,
              cost: 0.0014,
            },
          },
        };
      },
    };

    const client = new OpenRouterClient({
      apiKey: "test-key",
      httpClient,
      appName: "orchestra-test",
      siteUrl: "https://example.test",
    });

    const result = await client.chat({
      model: "openai/gpt-4.1-mini",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(result).toEqual({
      id: "gen-123",
      model: "openai/gpt-4.1-mini",
      text: "pong",
      usage: {
        promptTokens: 5,
        completionTokens: 2,
        totalTokens: 7,
        costUsd: 0.0014,
      },
      toolCalls: [],
    });

    expect(calls).toEqual([
      {
        path: "/chat/completions",
        body: {
          model: "openai/gpt-4.1-mini",
          messages: [{ role: "user", content: "ping" }],
        },
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
          "HTTP-Referer": "https://example.test",
          "X-Title": "orchestra-test",
        },
      },
    ]);
  });

  test("throws a typed OpenRouterApiError when the API rejects the request", async () => {
    const httpClient: OpenRouterHttpClient = {
      async post() {
        throw {
          response: {
            status: 401,
            data: {
              error: {
                message: "Invalid API key",
              },
            },
          },
        };
      },
    };

    const client = new OpenRouterClient({
      apiKey: "bad-key",
      httpClient,
    });

    await expect(
      client.chat({
        model: "openai/gpt-4.1-mini",
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toMatchObject({
      name: "OpenRouterApiError",
      message: "OpenRouter request failed with status 401: Invalid API key",
      status: 401,
    } satisfies Partial<OpenRouterApiError>);
  });

  test("does not retain sensitive request headers when the API rejects the request", async () => {
    const httpClient: OpenRouterHttpClient = {
      async post() {
        throw {
          response: {
            status: 400,
            data: {
              error: {
                message: "Provider returned error",
                metadata: {
                  raw: JSON.stringify({
                    error: {
                      message: "Invalid max_output_tokens",
                    },
                  }),
                },
              },
            },
          },
          config: {
            headers: {
              Authorization: "Bearer secret-token",
            },
          },
        };
      },
    };

    const client = new OpenRouterClient({
      apiKey: "secret-token",
      httpClient,
    });

    try {
      await client.chat({
        model: "openai/gpt-4.1-mini",
        messages: [{ role: "user", content: "ping" }],
      });
    } catch (error) {
      const rendered = inspect(error, { depth: 10 });

      expect(error).toBeInstanceOf(OpenRouterApiError);
      expect(rendered).toContain("Invalid max_output_tokens");
      expect(rendered).not.toContain("secret-token");
      return;
    }

    throw new Error("Expected OpenRouterClient.chat to reject.");
  });

  test("normalizes assistant tool calls from OpenRouter responses", async () => {
    const httpClient: OpenRouterHttpClient = {
      async post() {
        return {
          data: {
            id: "gen-tool",
            model: "openai/gpt-4.1-mini",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "read_file",
                        arguments: "{\"path\":\"README.md\"}",
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          },
        };
      },
    };

    const client = new OpenRouterClient({
      apiKey: "test-key",
      httpClient,
    });

    const result = await client.chat({
      model: "openai/gpt-4.1-mini",
      messages: [{ role: "user", content: "read" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a local file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
              required: ["path"],
            },
          },
        },
      ],
    });

    expect(result.toolCalls).toEqual([
      {
        id: "call-1",
        name: "read_file",
        argumentsJson: "{\"path\":\"README.md\"}",
      },
    ]);
  });
});
