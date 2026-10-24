// Ollama native /api/chat over raw fetch + NDJSON.
// Tool calls arrive whole (not streamed); we emit them as start/args/end so
// the agent loop treats every provider the same.

import { toWireSchema, type Usage } from "@vak/core";
import { getJson, postJson, readNdjson } from "./http.ts";
import { type ChatRequest, type Message, type ModelFacts, parseParameterSize, type Provider, ProviderError, type ProviderEvent, type StopReason } from "./types.ts";

export interface OllamaOptions {
  host?: string;
  /** Model thinking (`think`); off by default for UI latency, overridable per request via `extra.think`. */
  think?: boolean;
}

export function ollamaMessages(system: string | undefined, messages: Message[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "tool") out.push({ role: "tool", content: m.content || "ok", tool_name: m.toolName });
    else {
      const msg: Record<string, unknown> = { role: "assistant", content: m.content };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => {
          let args: unknown = {};
          try {
            args = JSON.parse(c.arguments || "{}");
          } catch {
            args = {};
          }
          return { function: { name: c.name, arguments: args } };
        });
      }
      out.push(msg);
    }
  }
  return out;
}

export function ollama(opts: OllamaOptions = {}): Provider {
  const host = (opts.host ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  return {
    id: "ollama",
    // Ollama compiles `format` JSON Schemas into a decoding grammar.
    capabilities: { constrainedOutput: true },

    async listModels(signal) {
      const body = (await getJson("ollama", `${host}/api/tags`, {}, signal)) as { models?: { name: string }[] };
      return (body.models ?? []).map((m) => m.name);
    },

    async describeModel(model, signal): Promise<ModelFacts> {
      const res = await postJson("ollama", `${host}/api/show`, {}, { model }, signal, 0);
      const show = (await res.json()) as { capabilities?: string[]; details?: { parameter_size?: string }; model_info?: Record<string, unknown> };
      const tags = (await getJson("ollama", `${host}/api/tags`, {}, signal)) as { models?: { name: string; digest?: string }[] };
      const caps = new Set(show.capabilities ?? []);
      const ctxKey = Object.keys(show.model_info ?? {}).find((k) => k.endsWith(".context_length"));
      return {
        // Ollama lists every capability a model has, so absence means no.
        tools: caps.has("tools"),
        thinking: caps.has("thinking"),
        vision: caps.has("vision"),
        contextWindow: ctxKey ? Number(show.model_info![ctxKey]) : undefined,
        parameters: parseParameterSize(show.details?.parameter_size),
        fingerprint: tags.models?.find((m) => m.name === model)?.digest ?? model,
        source: "ollama /api/show",
      };
    },

    async *stream(req: ChatRequest): AsyncGenerator<ProviderEvent> {
      const { options, ...extra } = req.extra ?? {};
      if (req.responseSchema && req.tools?.length) throw new ProviderError("ollama", "responseSchema and tools are exclusive");
      const body: Record<string, unknown> = {
        model: req.model,
        stream: true,
        think: opts.think ?? false,
        messages: ollamaMessages(req.system, req.messages),
        ...(req.tools?.length
          ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
          : {}),
        ...(req.responseSchema ? { format: toWireSchema(req.responseSchema) } : {}),
        options: { ...(req.maxTokens ? { num_predict: req.maxTokens } : {}), ...(options as object | undefined) },
        ...extra,
      };
      const res = await postJson("ollama", `${host}/api/chat`, {}, body, req.signal, 0);

      let stop: StopReason = "end";
      let usage: Usage | undefined;
      let sawTools = false;
      let n = 0;
      for await (const raw of readNdjson(res.body!)) {
        const chunk = raw as Record<string, any>;
        if (chunk.error) throw new Error(`ollama: ${chunk.error}`);
        const m = chunk.message ?? {};
        if (typeof m.content === "string" && m.content) yield { type: "text", delta: m.content };
        for (const tc of m.tool_calls ?? []) {
          const fn = tc.function ?? {};
          const id = tc.id ?? `ollama_${Date.now().toString(36)}_${n++}`;
          const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
          sawTools = true;
          yield { type: "tool_start", id, name: String(fn.name) };
          yield { type: "tool_args", id, delta: args };
          yield { type: "tool_end", id };
        }
        if (chunk.done) {
          stop = chunk.done_reason === "length" ? "max_tokens" : sawTools ? "tool_use" : "end";
          usage = { input: chunk.prompt_eval_count, output: chunk.eval_count };
        }
      }
      yield { type: "done", stop, usage };
    },
  };
}
