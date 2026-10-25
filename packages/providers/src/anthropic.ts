// Anthropic Messages API over raw fetch + SSE.
// API version 2026-10-21: sampling params (temperature/top_p/top_k) are rejected,
// so none are sent. Thinking is left at the model default (adaptive on current
// models) and assistant content is replayed verbatim so thinking blocks survive.

import type { Usage } from "@vak/core";
import { getJson, postJson, readSse } from "./http.ts";
import { type ChatRequest, type Message, type ModelFacts, type Provider, type ProviderEvent, ProviderError, type StopReason } from "./types.ts";

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  version?: string;
}

type Block = Record<string, unknown> & { type: string };

const STOP: Record<string, StopReason> = {
  end_turn: "end",
  stop_sequence: "end",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  refusal: "refusal",
};

export function anthropicMessages(messages: Message[]): { role: "user" | "assistant"; content: Block[] }[] {
  const out: { role: "user" | "assistant"; content: Block[] }[] = [];
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === "user") {
      if (m.content) push("user", [{ type: "text", text: m.content }]);
    } else if (m.role === "tool") {
      push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content || "ok", ...(m.isError ? { is_error: true } : {}) }]);
    } else if (m.native?.provider === "anthropic" && Array.isArray(m.native.value)) {
      push("assistant", m.native.value as Block[]);
    } else {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(c.arguments || "{}");
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input });
      }
      push("assistant", blocks);
    }
  }
  return out;
}

/** Mark the newest message as a cache breakpoint, so the next turn reads everything before it from cache. */
function cacheLast(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  const last = messages.at(-1);
  if (!last) return messages;
  const content = typeof last.content === "string" ? [{ type: "text", text: last.content }] : Array.isArray(last.content) ? [...(last.content as Record<string, unknown>[])] : [];
  if (!content.length) return messages;
  content[content.length - 1] = { ...content[content.length - 1]!, cache_control: { type: "ephemeral" } };
  return [...messages.slice(0, -1), { ...last, content }];
}

export function anthropic(opts: AnthropicOptions): Provider {
  const base = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const headers = { "x-api-key": opts.apiKey, "anthropic-version": opts.version ?? "2026-10-21" };

  return {
    id: "anthropic",

    async listModels(signal) {
      const body = (await getJson("anthropic", `${base}/v1/models?limit=100`, headers, signal)) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => m.id);
    },

    async describeModel(model, signal): Promise<ModelFacts> {
      const m = (await getJson("anthropic", `${base}/v1/models/${encodeURIComponent(model)}`, headers, signal)) as {
        id: string;
        created_at?: string;
        max_input_tokens?: number;
        max_tokens?: number;
      };
      return {
        // Client tools are part of the Messages API for every model it serves.
        tools: true,
        contextWindow: m.max_input_tokens,
        maxOutput: m.max_tokens,
        fingerprint: `${m.id}@${m.created_at ?? ""}`,
        source: "anthropic /v1/models",
      };
    },

    async *stream(req: ChatRequest): AsyncGenerator<ProviderEvent> {
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens ?? 32000,
        stream: true,
        messages: cacheLast(anthropicMessages(req.messages)),
        // The system prompt (catalog, rules, examples) is the same every turn:
        // cache it, the tools, and the conversation so far (3 of 4 breakpoints).
        ...(req.system ? { system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }] } : {}),
        ...(req.tools?.length
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
                // Stream tool input as generated so UI renders progressively;
                // our engine validates and repairs the arguments itself.
                eager_input_streaming: true,
              })).map((t, i, all) => (i === all.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t)),
            }
          : {}),
        ...(req.effort ? { output_config: { effort: req.effort } } : {}),
        ...req.extra,
      };
      const res = await postJson("anthropic", `${base}/v1/messages`, headers, body, req.signal);

      const blocks: Block[] = [];
      const partialJson = new Map<number, string>();
      let stop: StopReason = "other";
      const usage: Usage = {};

      for await (const msg of readSse(res.body!)) {
        if (msg.data === "[DONE]") break;
        const ev = JSON.parse(msg.data) as Record<string, any>;
        switch (ev.type) {
          case "message_start": {
            // Anthropic reports cached tokens separately from input_tokens.
            const u = ev.message?.usage ?? {};
            usage.cachedInput = u.cache_read_input_tokens;
            usage.input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
            break;
          }
          case "content_block_start": {
            const block = { ...(ev.content_block as Block) };
            blocks[ev.index] = block;
            if (block.type === "tool_use") {
              partialJson.set(ev.index, "");
              yield { type: "tool_start", id: String(block.id), name: String(block.name) };
            } else if (block.type === "text" && typeof block.text === "string" && block.text) {
              yield { type: "text", delta: block.text };
            }
            break;
          }
          case "content_block_delta": {
            const block = blocks[ev.index];
            const d = ev.delta as Record<string, any>;
            if (!block) break;
            if (d.type === "text_delta") {
              block.text = String(block.text ?? "") + d.text;
              yield { type: "text", delta: d.text };
            } else if (d.type === "input_json_delta") {
              partialJson.set(ev.index, (partialJson.get(ev.index) ?? "") + d.partial_json);
              yield { type: "tool_args", id: String(block.id), delta: d.partial_json };
            } else if (d.type === "thinking_delta") {
              block.thinking = String(block.thinking ?? "") + d.thinking;
            } else if (d.type === "signature_delta") {
              block.signature = d.signature;
            } else if (d.type === "citations_delta") {
              block.citations = [...((block.citations as unknown[] | undefined) ?? []), d.citation];
            }
            break;
          }
          case "content_block_stop": {
            const block = blocks[ev.index];
            if (block?.type === "tool_use") {
              const text = partialJson.get(ev.index) ?? "";
              try {
                block.input = text.trim() ? JSON.parse(text) : {};
              } catch {
                // Replay needs an object; the engine reads the raw text instead.
                block.input = {};
              }
              yield { type: "tool_end", id: String(block.id) };
            }
            break;
          }
          case "message_delta":
            if (ev.delta?.stop_reason) stop = STOP[ev.delta.stop_reason] ?? "other";
            if (ev.usage?.output_tokens !== undefined) usage.output = ev.usage.output_tokens;
            break;
          case "error":
            throw new ProviderError("anthropic", `${ev.error?.type ?? "error"}: ${ev.error?.message ?? msg.data}`);
        }
      }
      // Empty text blocks are rejected on replay.
      const native = blocks.filter((b) => b && !(b.type === "text" && !b.text));
      yield { type: "done", stop, native, usage };
    },
  };
}
