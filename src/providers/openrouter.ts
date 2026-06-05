import axios, { type AxiosInstance } from "axios";

export type OpenRouterChatRole = "system" | "user" | "assistant" | "tool";

interface BaseOpenRouterChatMessage {
  role: OpenRouterChatRole;
  content: string;
}

export interface OpenRouterToolChatMessage extends BaseOpenRouterChatMessage {
  role: "tool";
  tool_call_id: string;
  name?: string;
}

export interface OpenRouterAssistantChatMessage extends BaseOpenRouterChatMessage {
  role: "assistant";
  tool_calls?: OpenRouterToolCall[];
}

export type OpenRouterChatMessage =
  | BaseOpenRouterChatMessage
  | OpenRouterToolChatMessage
  | OpenRouterAssistantChatMessage;

export interface OpenRouterToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenRouterToolCallResult {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface OpenRouterChatRequest {
  model: string;
  messages: OpenRouterChatMessage[];
  temperature?: number;
  max_tokens?: number;
  tools?: OpenRouterToolDefinition[];
  tool_choice?: "auto" | "none";
  response_format?: {
    type: "json_object" | "text";
  };
}

interface OpenRouterUsageResponse {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  total_cost?: number;
}

interface OpenRouterChoiceResponse {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: OpenRouterToolCall[];
  };
}

interface OpenRouterChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: OpenRouterChoiceResponse[];
  usage?: OpenRouterUsageResponse;
}

export interface OpenRouterUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface OpenRouterChatResult {
  id: string;
  model: string;
  text: string;
  usage: OpenRouterUsage;
  toolCalls: OpenRouterToolCallResult[];
}

export interface OpenRouterChatClient {
  chat(request: OpenRouterChatRequest): Promise<OpenRouterChatResult>;
}

export interface OpenRouterHttpRequestOptions {
  headers: Record<string, string>;
}

export interface OpenRouterHttpResponse<TData> {
  data: TData;
}

export interface OpenRouterHttpClient {
  post(
    path: string,
    body: OpenRouterChatRequest,
    options: OpenRouterHttpRequestOptions,
  ): Promise<OpenRouterHttpResponse<OpenRouterChatCompletionResponse>>;
}

export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  httpClient?: OpenRouterHttpClient;
  appName?: string;
  siteUrl?: string;
  timeoutMs?: number;
}

export interface OpenRouterApiErrorDetails {
  apiMessage: string;
  providerName?: string;
  providerCode?: string | number;
}

export class OpenRouterApiError extends Error {
  public readonly status: number | undefined;

  public readonly details: OpenRouterApiErrorDetails;

  public constructor(
    message: string,
    status: number | undefined,
    details: OpenRouterApiErrorDetails,
  ) {
    super(message);
    this.name = "OpenRouterApiError";
    this.status = status;
    this.details = details;
  }
}

class AxiosOpenRouterHttpClient implements OpenRouterHttpClient {
  private readonly axiosClient: AxiosInstance;

  public constructor(baseUrl: string, timeoutMs: number) {
    this.axiosClient = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
    });
  }

  public async post(
    path: string,
    body: OpenRouterChatRequest,
    options: OpenRouterHttpRequestOptions,
  ): Promise<OpenRouterHttpResponse<OpenRouterChatCompletionResponse>> {
    const response = await this.axiosClient.post<OpenRouterChatCompletionResponse>(path, body, {
      headers: options.headers,
    });

    return { data: response.data };
  }
}

export class OpenRouterClient implements OpenRouterChatClient {
  private readonly apiKey: string;

  private readonly httpClient: OpenRouterHttpClient;

  private readonly appName: string | undefined;

  private readonly siteUrl: string | undefined;

  public constructor(options: OpenRouterClientOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new Error("OpenRouter API key is required.");
    }

    const baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";
    const timeoutMs = options.timeoutMs ?? 60_000;

    this.apiKey = options.apiKey;
    this.httpClient = options.httpClient ?? new AxiosOpenRouterHttpClient(baseUrl, timeoutMs);
    this.appName = options.appName;
    this.siteUrl = options.siteUrl;
  }

  public async chat(request: OpenRouterChatRequest): Promise<OpenRouterChatResult> {
    try {
      const response = await this.httpClient.post("/chat/completions", request, {
        headers: this.buildHeaders(),
      });

      return this.normalizeChatResponse(request.model, response.data);
    } catch (error) {
      throw toOpenRouterApiError(error);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    if (this.siteUrl !== undefined) {
      headers["HTTP-Referer"] = this.siteUrl;
    }

    if (this.appName !== undefined) {
      headers["X-Title"] = this.appName;
    }

    return headers;
  }

  private normalizeChatResponse(
    requestedModel: string,
    response: OpenRouterChatCompletionResponse,
  ): OpenRouterChatResult {
    const firstChoice = response.choices?.[0];
    const text = firstChoice?.message?.content ?? "";
    const usage = response.usage ?? {};
    const toolCalls = firstChoice?.message?.tool_calls ?? [];

    return {
      id: response.id ?? "",
      model: response.model ?? requestedModel,
      text,
      usage: {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
        costUsd: usage.cost ?? usage.total_cost ?? 0,
      },
      toolCalls: toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        argumentsJson: toolCall.function.arguments,
      })),
    };
  }
}

function toOpenRouterApiError(error: unknown): OpenRouterApiError {
  if (error instanceof OpenRouterApiError) {
    return error;
  }

  const status = extractStatus(error);
  const apiMessage = extractApiMessage(error);
  const details = extractErrorDetails(error, apiMessage);

  if (status !== undefined) {
    return new OpenRouterApiError(
      `OpenRouter request failed with status ${status}: ${apiMessage}`,
      status,
      details,
    );
  }

  const fallbackMessage = error instanceof Error ? error.message : "Unknown error";
  return new OpenRouterApiError(`OpenRouter request failed: ${fallbackMessage}`, undefined, details);
}

function extractStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const response = error.response;
  if (!isRecord(response)) {
    return undefined;
  }

  return typeof response.status === "number" ? response.status : undefined;
}

function extractApiMessage(error: unknown): string {
  const data = extractResponseData(error);

  const providerMessage = extractProviderRawMessage(data);
  if (providerMessage !== undefined) {
    return providerMessage;
  }

  if (!isRecord(data)) {
    return "Unknown error";
  }
  const nestedError = data.error;
  if (isRecord(nestedError) && typeof nestedError.message === "string") {
    return nestedError.message;
  }

  if (typeof data.message === "string") {
    return data.message;
  }

  return "Unknown error";
}

function extractErrorDetails(error: unknown, apiMessage: string): OpenRouterApiErrorDetails {
  const details: OpenRouterApiErrorDetails = {
    apiMessage,
  };

  const data = extractResponseData(error);
  if (!isRecord(data)) {
    return details;
  }

  const nestedError = data.error;
  if (!isRecord(nestedError)) {
    return details;
  }

  const metadata = nestedError.metadata;
  if (isRecord(metadata) && typeof metadata.provider_name === "string") {
    details.providerName = metadata.provider_name;
  }

  if (typeof nestedError.code === "string" || typeof nestedError.code === "number") {
    details.providerCode = nestedError.code;
  }

  return details;
}

function extractResponseData(error: unknown): unknown {
  if (!isRecord(error)) {
    return undefined;
  }

  const response = error.response;
  if (!isRecord(response)) {
    return undefined;
  }

  return response.data;
}

function extractProviderRawMessage(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  const nestedError = data.error;
  if (!isRecord(nestedError)) {
    return undefined;
  }

  const metadata = nestedError.metadata;
  if (!isRecord(metadata) || typeof metadata.raw !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(metadata.raw) as unknown;
    if (!isRecord(parsed)) {
      return undefined;
    }

    const parsedError = parsed.error;
    if (isRecord(parsedError) && typeof parsedError.message === "string") {
      return parsedError.message;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
