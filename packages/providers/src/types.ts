// Provider-neutral chat model. Every adapter maps to and from these shapes.

import type { JSONSchema, Usage } from "@vak/core";

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON text of the arguments, exactly as the model produced it. */
  arguments: string;
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  /** assistant: tool calls made in this turn. */
  toolCalls?: ToolCall[];
  /** tool: which call this answers. */
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  /**
   * Provider-native assistant content to replay verbatim on the next request
   * (Anthropic thinking blocks, Gemini thought signatures). Ignored by other
   * providers, which rebuild from `content` / `toolCalls`.
   */
  native?: { provider: string; value: unknown };
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface ChatRequest {
  model: string;
  system?: string;
  messages: Message[];
  tools?: ToolSpec[];
  maxTokens?: number;
  /** Reasoning effort hint, mapped per provider where supported. */
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  /** Extra provider-specific body fields (e.g. Ollama `think`, `options`). */
  extra?: Record<string, unknown>;
  /**
   * Constrain the whole response to this schema (grammar decoding). Only for
   * providers whose capabilities declare `constrainedOutput`; exclusive with tools.
   */
  responseSchema?: JSONSchema;
}

export interface ProviderCapabilities {
  /** The provider guarantees responses match `responseSchema`. */
  constrainedOutput: boolean;
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export type ProviderEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string }
  | { type: "tool_args"; id: string; delta: string }
  | { type: "tool_end"; id: string }
  | { type: "done"; stop: StopReason; native?: unknown; usage?: Usage };

/**
 * What a provider's API states about one model. A field left undefined means
 * the API does not say — never a guess. `false` means the API says no.
 */
export interface ModelFacts {
  tools?: boolean;
  thinking?: boolean;
  vision?: boolean;
  contextWindow?: number;
  maxOutput?: number;
  /** Parameter count, when published (local models). */
  parameters?: number;
  /** Changes when the model behind the id changes (weights digest, version). */
  fingerprint: string;
  /** Where the facts came from, for display. */
  source: string;
}

/** "852.88M" → 852880000, "4.2B" → 4200000000. */
export function parseParameterSize(text: unknown): number | undefined {
  const m = /^\s*([\d.]+)\s*([KMBT])\s*$/i.exec(String(text ?? ""));
  if (!m) return undefined;
  const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]!.toUpperCase() as "K" | "M" | "B" | "T"];
  return Math.round(Number(m[1]) * scale);
}

export interface Provider {
  readonly id: string;
  readonly capabilities?: ProviderCapabilities;
  /** Facts the provider's API publishes about a model. */
  describeModel?(model: string, signal?: AbortSignal): Promise<ModelFacts>;
  stream(req: ChatRequest): AsyncIterable<ProviderEvent>;
  listModels?(signal?: AbortSignal): Promise<string[]>;
}

export class ProviderError extends Error {
  readonly status?: number;
  readonly provider: string;
  constructor(provider: string, message: string, status?: number) {
    super(`${provider}: ${message}`);
    this.provider = provider;
    this.status = status;
  }
}
