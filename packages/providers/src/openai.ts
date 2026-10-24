// OpenAI Chat Completions over raw fetch + SSE. Also serves every
// OpenAI-compatible endpoint (OpenRouter, vLLM, LM Studio, Ollama's /v1, ...).

import { getJson, postJson, readSse } from "./http.ts";
import type { Usage } from "@vak/core";
import type { ChatRequest, Message, ModelFacts, Provider, ProviderEvent, StopReason } from "./types.ts";

export interface OpenAIOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Provider id reported in events, e.g. "openai" or "openrouter". */
  id?: string;
  headers?: Record<string, string>;
}

const STOP: Record<string, StopReason> = { stop: "end", tool_calls: "tool_use", function_call: "tool_use", length: "max_tokens", content_filter: "refusal" };

export function openaiMessages(system: string | undefined, messages: Message[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content || "ok" });
    else {
      const msg: Record<string, unknown> = { role: "assistant", content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } }));
      }
      out.push(msg);
    }
  }
  return out;
}

export function openai(opts: OpenAIOptions = {}): Provider {
  const id = opts.id ?? "openai";
  const base = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const headers: Record<string, string> = { ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}), ...opts.headers };

  return {
    id,

    async listModels(signal) {
      const body = (await getJson(id, `${base}/models`, headers, signal)) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => m.id).sort();
    },

    async describeModel(model): Promise<ModelFacts> {
      // OpenAI-compatible servers publish no capability data in a standard shape.
      return { fingerprint: model, source: `${id} (no capability data)` };
    },

    async *stream(req: ChatRequest): AsyncGenerator<ProviderEvent> {
      const body: Record<string, unknown> = {
        model: req.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: openaiMessages(req.system, req.messages),
        ...(req.tools?.length
          ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
          : {}),
        ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
        ...(req.effort ? { reasoning_effort: req.effort } : {}),
        ...req.extra,
      };
      const res = await postJson(id, `${base}/chat/completions`, headers, body, req.signal);

      // Tool-call deltas are keyed by index; the id arrives only on the first.
      const calls = new Map<number, { id: string; name: string; started: boolean; pending: string }>();
      let stop: StopReason = "other";
      let usage: Usage | undefined;
      let n = 0;

      for await (const msg of readSse(res.body!)) {
        if (msg.data === "[DONE]") break;
        const chunk = JSON.parse(msg.data) as Record<string, any>;
        if (chunk.error) throw new Error(`${id}: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
        if (chunk.usage) {
          usage = {
            input: chunk.usage.prompt_tokens,
            output: chunk.usage.completion_tokens,
            cachedInput: chunk.usage.prompt_tokens_details?.cached_tokens,
          };
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string" && delta.content) yield { type: "text", delta: delta.content };
        for (const tc of delta.tool_calls ?? []) {
          const index = typeof tc.index === "number" ? tc.index : n;
          let call = calls.get(index);
          if (!call) {
            call = { id: tc.id ?? `call_${index}_${Date.now().toString(36)}`, name: "", started: false, pending: "" };
            calls.set(index, call);
            n = Math.max(n, index + 1);
          }
          if (tc.function?.name) call.name += tc.function.name;
          const args = tc.function?.arguments;
          if (!call.started && call.name) {
            call.started = true;
            yield { type: "tool_start", id: call.id, name: call.name };
          }
          if (typeof args === "string" && args) {
            if (call.started) yield { type: "tool_args", id: call.id, delta: args };
            else call.pending += args;
          }
          if (call.started && call.pending) {
            yield { type: "tool_args", id: call.id, delta: call.pending };
            call.pending = "";
          }
        }
        if (choice.finish_reason) stop = STOP[choice.finish_reason] ?? "other";
      }
      for (const call of calls.values()) if (call.started) yield { type: "tool_end", id: call.id };
      if (calls.size && stop === "other") stop = "tool_use";
      yield { type: "done", stop, usage };
    },
  };
}
