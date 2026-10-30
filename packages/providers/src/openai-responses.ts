// OpenAI Responses API (/v1/responses) over raw fetch + SSE.
// Stateless: `store: false`, with encrypted reasoning included so reasoning
// items replay verbatim across turns. Tool calls are keyed by `call_id`;
// results go back as `function_call_output` items.
//
// No constrained-output capability is claimed: strict json_schema needs every
// property required and closed objects, which the catalog schema is not.

import { createHash } from "node:crypto";
import type { Usage } from "@vak/core";
import { getJson, postJson, readSse, type ProviderTransport } from "./http.ts";
import { type ChatRequest, type Message, type ModelFacts, type Provider, ProviderError, type ProviderEvent, type StopReason } from "./types.ts";

export interface OpenAIResponsesOptions {
  transport?: ProviderTransport;
  apiKey: string;
  baseUrl?: string;
  id?: string;
}

type Item = Record<string, unknown>;

export function responsesInput(messages: Message[], provider: string): Item[] {
  const items: Item[] = [];
  for (const m of messages) {
    if (m.role === "user") items.push({ role: "user", content: m.content });
    else if (m.role === "tool") items.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content || "ok" });
    else if (m.native?.provider === provider && Array.isArray(m.native.value)) items.push(...(m.native.value as Item[]));
    else {
      if (m.content) items.push({ role: "assistant", content: m.content });
      for (const c of m.toolCalls ?? []) items.push({ type: "function_call", call_id: c.id, name: c.name, arguments: c.arguments || "{}" });
    }
  }
  return items;
}

export function openaiResponses(opts: OpenAIResponsesOptions): Provider {
  const id = opts.id ?? "openai";
  const base = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const headers = { authorization: `Bearer ${opts.apiKey}` };

  return {
    id,

    async listModels(signal) {
      const body = (await getJson(id, `${base}/models`, headers, signal, opts.transport)) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => m.id).sort();
    },

    async describeModel(model, signal): Promise<ModelFacts> {
      // The models endpoint confirms the id exists but publishes no capabilities.
      const m = (await getJson(id, `${base}/models/${encodeURIComponent(model)}`, headers, signal, opts.transport)) as { id: string; created?: number };
      return { fingerprint: `${m.id}@${m.created ?? ""}`, source: `${id} /v1/models (no capability data)` };
    },

    async *stream(req: ChatRequest): AsyncGenerator<ProviderEvent> {
      if (req.responseSchema) throw new ProviderError(id, "constrained output is not supported by this adapter");
      const body: Record<string, unknown> = {
        model: req.model,
        stream: true,
        store: false,
        include: ["reasoning.encrypted_content"],
        input: responsesInput(req.messages, id),
        ...(req.system ? { instructions: req.system } : {}),
        // Same instructions and tools → same key, so OpenAI routes turns to a warm prompt cache.
        prompt_cache_key: `vak-${createHash("sha256").update(req.system ?? "").update((req.tools ?? []).map((t) => t.name).join(",")).digest("hex").slice(0, 24)}`,
        ...(req.tools?.length
          ? { tools: req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.inputSchema })) }
          : {}),
        ...(req.maxTokens ? { max_output_tokens: req.maxTokens } : {}),
        ...(req.effort ? { reasoning: { effort: req.effort } } : {}),
        ...req.extra,
      };
      const res = await postJson(id, `${base}/responses`, headers, body, req.signal, 2, opts.transport, req.execution);

      // item id → call_id, for argument deltas (which carry item_id).
      const callIds = new Map<string, string>();
      let stop: StopReason = "end";
      let usage: Usage | undefined;
      let output: Item[] | undefined;
      let sawCall = false;

      for await (const msg of readSse(res.body!)) {
        if (msg.data === "[DONE]") break;
        const ev = JSON.parse(msg.data) as Record<string, any>;
        switch (ev.type) {
          case "response.output_item.added": {
            const item = ev.item ?? {};
            if (item.type === "function_call") {
              const callId = String(item.call_id ?? item.id);
              callIds.set(String(item.id), callId);
              sawCall = true;
              yield { type: "tool_start", id: callId, name: String(item.name) };
              if (item.arguments) yield { type: "tool_args", id: callId, delta: String(item.arguments) };
            }
            break;
          }
          case "response.function_call_arguments.delta": {
            const callId = callIds.get(String(ev.item_id));
            if (callId && ev.delta) yield { type: "tool_args", id: callId, delta: String(ev.delta) };
            break;
          }
          case "response.output_item.done": {
            const item = ev.item ?? {};
            if (item.type === "function_call") yield { type: "tool_end", id: callIds.get(String(item.id)) ?? String(item.call_id) };
            break;
          }
          case "response.output_text.delta":
            if (ev.delta) yield { type: "text", delta: String(ev.delta) };
            break;
          case "response.completed":
          case "response.incomplete": {
            const r = ev.response ?? {};
            output = Array.isArray(r.output) ? r.output : undefined;
            const u = r.usage;
            if (u) usage = { input: u.input_tokens, output: u.output_tokens, cachedInput: u.input_tokens_details?.cached_tokens };
            if (ev.type === "response.incomplete") {
              stop = r.incomplete_details?.reason === "content_filter" ? "refusal" : "max_tokens";
            } else if (sawCall) stop = "tool_use";
            break;
          }
          case "response.failed":
            throw new ProviderError(id, `response failed: ${ev.response?.error?.message ?? "unknown error"}`);
          case "error":
            throw new ProviderError(id, `${ev.code ?? "error"}: ${ev.message ?? msg.data}`);
        }
      }
      yield { type: "done", stop, native: output, usage };
    },
  };
}
