import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { basicCatalog, SurfaceStore, type AgentEvent } from "@vak/core";
import { anthropic, gemini, ollama, openai, runAgent, type Message, type Provider, type ProviderEvent } from "../src/index.ts";

// A local server that replays canned provider streams and records requests.
let server: Server;
let base = "";
const seen: { url: string; headers: Record<string, unknown>; body: any }[] = [];
const routes: Record<string, string> = {};

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      const key = Object.keys(routes).find((k) => req.url!.startsWith(k));
      if (!key) return res.writeHead(404).end("nope");
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Split into small chunks to exercise the line buffering.
      const body = routes[key]!;
      let i = 0;
      const tick = () => {
        if (i >= body.length) return res.end();
        res.write(body.slice(i, (i += 17)));
        setImmediate(tick);
      };
      tick();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

const sse = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
async function collect(p: Provider, messages: Message[] = [{ role: "user", content: "hi" }]): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const ev of p.stream({ model: "m", system: "sys", messages, tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }] })) out.push(ev);
  return out;
}

test("anthropic: text, streamed tool input, thinking kept for replay", async () => {
  routes["/a/v1/messages"] = [
    { type: "message_start", message: { usage: { input_tokens: 5, cache_read_input_tokens: 40 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tu1", name: "t", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"a":' } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "1}" } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  ].map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const evs = await collect(anthropic({ apiKey: "k", baseUrl: `${base}/a` }), [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", toolCalls: [{ id: "x", name: "t", arguments: "{}" }] },
    { role: "tool", content: "ok", toolCallId: "x", toolName: "t" },
  ]);
  const req = seen.at(-1)!;
  assert.equal(req.headers["anthropic-version"], "2026-10-21");
  assert.equal(req.body.temperature, undefined);
  assert.equal(req.body.tools[0].eager_input_streaming, true);
  assert.deepEqual(req.body.messages[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] });
  assert.deepEqual(evs.filter((e) => e.type !== "done"), [
    { type: "text", delta: "Hello" },
    { type: "tool_start", id: "tu1", name: "t" },
    { type: "tool_args", id: "tu1", delta: '{"a":' },
    { type: "tool_args", id: "tu1", delta: "1}" },
    { type: "tool_end", id: "tu1" },
  ]);
  const done = evs.at(-1) as Extract<ProviderEvent, { type: "done" }>;
  assert.equal(done.stop, "tool_use");
  assert.deepEqual(done.usage, { input: 45, cachedInput: 40, output: 9 });
  assert.deepEqual((done.native as any[]).map((b) => [b.type, b.thinking ?? b.text ?? b.input]), [["thinking", "hmm"], ["text", "Hello"], ["tool_use", { a: 1 }]]);
});

test("openai: indexed tool-call deltas", async () => {
  routes["/o/chat/completions"] = sse([
    { choices: [{ delta: { content: "Hi" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "t", arguments: "" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a"' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":2}" } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 2 } } },
  ]) + "data: [DONE]\n\n";
  const evs = await collect(openai({ apiKey: "k", baseUrl: `${base}/o` }));
  assert.equal(seen.at(-1)!.headers.authorization, "Bearer k");
  assert.equal(seen.at(-1)!.body.messages[0].role, "system");
  assert.deepEqual(evs, [
    { type: "text", delta: "Hi" },
    { type: "tool_start", id: "c1", name: "t" },
    { type: "tool_args", id: "c1", delta: '{"a"' },
    { type: "tool_args", id: "c1", delta: ":2}" },
    { type: "tool_end", id: "c1" },
    { type: "done", stop: "tool_use", usage: { input: 3, output: 4, cachedInput: 2 } },
  ]);
});

test("ollama: NDJSON with whole tool calls", async () => {
  routes["/l/api/chat"] = [
    { message: { content: "Sure" } },
    { message: { content: "", tool_calls: [{ function: { name: "t", arguments: { a: 3 } } }] } },
    { done: true, done_reason: "stop", prompt_eval_count: 1, eval_count: 2 },
  ].map((e) => JSON.stringify(e) + "\n").join("");
  const evs = await collect(ollama({ host: `${base}/l` }));
  assert.equal(seen.at(-1)!.body.think, false);
  assert.deepEqual(evs.map((e) => e.type), ["text", "tool_start", "tool_args", "tool_end", "done"]);
  assert.equal((evs[2] as { delta: string }).delta, '{"a":3}');
  assert.equal((evs.at(-1) as { stop: string }).stop, "tool_use");
});

test("gemini: function calls with signatures replayed verbatim", async () => {
  routes["/g/models/m:streamGenerateContent"] = sse([
    { candidates: [{ content: { role: "model", parts: [{ text: "Ok" }] } }] },
    { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "t", args: { a: 4 } }, thoughtSignature: "S" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } },
  ]);
  const evs = await collect(gemini({ apiKey: "k", baseUrl: `${base}/g` }));
  const req = seen.at(-1)!;
  assert.equal(req.headers["x-goog-api-key"], "k");
  assert.ok(req.url.endsWith("alt=sse"));
  assert.deepEqual(req.body.tools[0].functionDeclarations[0].parametersJsonSchema, { type: "object" });
  const done = evs.at(-1) as Extract<ProviderEvent, { type: "done" }>;
  assert.equal(done.stop, "tool_use");
  assert.equal((done.native as any[])[1].thoughtSignature, "S");
});

test("agent loop projects a streamed render and stops on a clean projection", async () => {
  const args = JSON.stringify({ surface: "s", nodes: [{ id: "root", type: "stack", children: ["t"] }, { id: "t", type: "text", props: { content: "hi" } }] });
  const fake: Provider = {
    id: "fake",
    async *stream() {
      yield { type: "text", delta: "Here:" };
      yield { type: "tool_start", id: "1", name: "vak_render" };
      for (let i = 0; i < args.length; i += 9) yield { type: "tool_args", id: "1", delta: args.slice(i, i + 9) };
      yield { type: "tool_end", id: "1" };
      yield { type: "done", stop: "tool_use" };
    },
  };
  const events: AgentEvent[] = [];
  const messages: Message[] = [{ role: "user", content: "show" }];
  const store = new SurfaceStore(basicCatalog);
  const r = await runAgent({ provider: fake, model: "m", store, messages, emit: (e) => events.push(e) });
  assert.equal(r.stop, "projected");
  const surfaces = events.filter((e) => e.type === "surface");
  assert.ok(surfaces.length >= 2, "progressive snapshots");
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "tool"]);
  assert.equal(messages[2]!.content, "ok");
  assert.equal(store.resolve("s")!.root!.children[0]!.props.content, "hi");
});

test("constrained generation: render streams from the JSON answer, reply streams as text", async () => {
  const answer = JSON.stringify({
    render: { surface: "c", nodes: [{ id: "root", type: "stack", children: ["t"] }, { id: "t", type: "text", props: { content: "hi" } }] },
    reply: "Here you go.",
  });
  let request: any;
  const fake: Provider = {
    id: "fake",
    capabilities: { constrainedOutput: true },
    async *stream(req) {
      request = req;
      for (let i = 0; i < answer.length; i += 11) yield { type: "text", delta: answer.slice(i, i + 11) };
      yield { type: "done", stop: "end" };
    },
  };
  const events: AgentEvent[] = [];
  const store = new SurfaceStore(basicCatalog);
  const messages: Message[] = [{ role: "user", content: "show" }];
  const r = await runAgent({ provider: fake, model: "m", store, messages, generation: "constrained", emit: (e) => events.push(e) });
  assert.equal(r.stop, "projected");
  assert.equal(request.tools, undefined);
  assert.ok(request.responseSchema.properties.render);
  assert.equal(events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join(""), "Here you go.");
  assert.ok(events.filter((e) => e.type === "surface").length >= 2, "progressive");
  assert.equal(store.resolve("c")!.root!.children[0]!.props.content, "hi");
});

test("generation mode: auto means tools; constrained only on request and when guaranteed", async () => {
  const { generationMode } = await import("../src/agent.ts");
  const plain: Provider = { id: "p", async *stream() {} };
  const able: Provider = { id: "a", capabilities: { constrainedOutput: true }, async *stream() {} };
  const tool = { spec: { name: "x", description: "", inputSchema: {} }, execute: () => "" };
  assert.equal(generationMode({ provider: able }), "tools");
  assert.equal(generationMode({ provider: able, generation: "constrained" }), "constrained");
  assert.throws(() => generationMode({ provider: plain, generation: "constrained" }), /cannot guarantee/);
  assert.throws(() => generationMode({ provider: able, generation: "constrained", tools: [tool] }), /user tools/);
});
