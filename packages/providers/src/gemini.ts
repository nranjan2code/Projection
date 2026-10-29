// Google Gemini (Generative Language API) over raw fetch + SSE.
// Model parts are replayed verbatim: function-call parts can carry thought
// signatures that must be echoed back for multi-turn tool use.

import { getJson, postJson, readSse, type ProviderFetch } from "./http.ts";
import type { Usage } from "@vak/core";
import type { ChatRequest, Message, ModelFacts, Provider, ProviderEvent, StopReason } from "./types.ts";

export interface GeminiOptions {
  fetcher?: ProviderFetch;
  apiKey: string;
  baseUrl?: string;
}

type Part = Record<string, any>;
type Content = { role: "user" | "model"; parts: Part[] };

const STOP: Record<string, StopReason> = { STOP: "end", MAX_TOKENS: "max_tokens", SAFETY: "refusal", PROHIBITED_CONTENT: "refusal" };

export function geminiContents(messages: Message[]): Content[] {
  const out: Content[] = [];
  const push = (role: "user" | "model", parts: Part[]) => {
    if (parts.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };
  for (const m of messages) {
    if (m.role === "user") push("user", [{ text: m.content }]);
    else if (m.role === "tool") {
      push("user", [{ functionResponse: { name: m.toolName, ...(m.toolCallId?.startsWith("gemini_") ? {} : { id: m.toolCallId }), response: { result: m.content } } }]);
    } else if (m.native?.provider === "gemini" && Array.isArray(m.native.value)) {
      push("model", m.native.value as Part[]);
    } else {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) {
        let args: unknown = {};
        try {
          args = JSON.parse(c.arguments || "{}");
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: c.name, args } });
      }
      push("model", parts);
    }
  }
  return out;
}

export function gemini(opts: GeminiOptions): Provider {
  const base = (opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const headers = { "x-goog-api-key": opts.apiKey };

  return {
    id: "gemini",

    async listModels(signal) {
      const body = (await getJson("gemini", `${base}/models?pageSize=200`, headers, signal, opts.fetcher)) as {
        models?: { name: string; supportedGenerationMethods?: string[] }[];
      };
      return (body.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""));
    },

    async describeModel(model, signal): Promise<ModelFacts> {
      const m = (await getJson("gemini", `${base}/models/${encodeURIComponent(model.replace(/^models\//, ""))}`, headers, signal, opts.fetcher)) as {
        name: string;
        version?: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
        thinking?: boolean;
      };
      return {
        // Function calling is part of generateContent for the Gemini models it lists.
        tools: true,
        thinking: m.thinking,
        contextWindow: m.inputTokenLimit,
        maxOutput: m.outputTokenLimit,
        fingerprint: `${m.name}@${m.version ?? ""}`,
        source: "gemini models API",
      };
    },

    async *stream(req: ChatRequest): AsyncGenerator<ProviderEvent> {
      const body: Record<string, unknown> = {
        contents: geminiContents(req.messages),
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        ...(req.tools?.length
          ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }] }
          : {}),
        generationConfig: { ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}) },
        ...req.extra,
      };
      const model = encodeURIComponent(req.model.replace(/^models\//, ""));
      const res = await postJson("gemini", `${base}/models/${model}:streamGenerateContent?alt=sse`, headers, body, req.signal, 2, opts.fetcher);

      const parts: Part[] = [];
      let stop: StopReason = "other";
      let usage: Usage | undefined;
      let n = 0;
      let sawTools = false;

      for await (const msg of readSse(res.body!)) {
        const chunk = JSON.parse(msg.data) as Record<string, any>;
        if (chunk.error) throw new Error(`gemini: ${chunk.error.message}`);
        if (chunk.usageMetadata) {
          const m = chunk.usageMetadata;
          usage = { input: m.promptTokenCount, output: m.candidatesTokenCount, cachedInput: m.cachedContentTokenCount };
        }
        const cand = chunk.candidates?.[0];
        if (!cand) continue;
        for (const part of (cand.content?.parts ?? []) as Part[]) {
          parts.push(part);
          if (part.thought) continue;
          if (typeof part.text === "string" && part.text) yield { type: "text", delta: part.text };
          if (part.functionCall) {
            const id = part.functionCall.id ?? `gemini_${n++}`;
            sawTools = true;
            yield { type: "tool_start", id, name: String(part.functionCall.name) };
            yield { type: "tool_args", id, delta: JSON.stringify(part.functionCall.args ?? {}) };
            yield { type: "tool_end", id };
          }
        }
        if (cand.finishReason) stop = STOP[cand.finishReason] ?? "other";
      }
      if (sawTools && stop !== "refusal") stop = "tool_use";
      yield { type: "done", stop, native: parts, usage };
    },
  };
}
