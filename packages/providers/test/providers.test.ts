import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { basicCatalog, projectText, SurfaceStore, type AgentEvent } from "@vak/core";
import { anthropic, COMPATIBLE_PRESETS, gemini, ollama, openai, PROVIDER_SETTINGS, providersFromEnv, runAgent, type Message, type Provider, type ProviderEvent } from "../src/index.ts";

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
  // The newest message, the system prompt and the last tool are cache breakpoints.
  assert.deepEqual(req.body.messages[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok", cache_control: { type: "ephemeral" } }] });
  assert.deepEqual(req.body.system, [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(req.body.tools.at(-1).cache_control, { type: "ephemeral" });
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

/** A provider that makes one vak_render call per step, from a script. */
function scripted(calls: string[]): Provider {
  let step = 0;
  return {
    id: "scripted",
    async *stream() {
      const args = calls[step++];
      if (args === undefined) return void (yield { type: "done", stop: "end" });
      yield { type: "tool_start", id: `c${step}`, name: "vak_render" };
      for (let i = 0; i < args.length; i += 40) yield { type: "tool_args", id: `c${step}`, delta: args.slice(i, i + 40) };
      yield { type: "tool_end", id: `c${step}` };
      yield { type: "done", stop: "tool_use" };
    },
  };
}

test("the Kyoto hotels run (real 4B calls) ends on its second render, with every hotel and the form shown", async () => {
  const { calls } = JSON.parse(readFileSync(new URL("../../core/test/fixtures/vakyartha-kyoto-4b-2026-10-25.json", import.meta.url), "utf8")) as { calls: { args: string }[] };
  const store = new SurfaceStore(basicCatalog);
  const r = await runAgent({ provider: scripted(calls.map((c) => c.args)), model: "m", store, messages: [{ role: "user", content: "hotels" }], maxSteps: 4, emit: () => {} });
  assert.equal(r.stop, "projected");
  const text = projectText(store.resolve("kyoto_hotels")!);
  assert.equal(text.match(/\[Card\]/g)?.length, 3);
  assert.ok(text.includes("[Form → book_hotel]") && text.includes("[Input (email)] Email*"));
});

test("a worse retry is never shown, and the step limit leaves the better version in the store", async () => {
  const node = (n: number, extra: string[] = []) => JSON.stringify({ surface: "s", nodes: [{ id: "root", type: "stack", children: [...Array.from({ length: n }, (_, i) => `t${i}`), ...extra] }, ...Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: "text", props: { content: `line ${i}` } }))] });
  const store = new SurfaceStore(basicCatalog);
  const events: AgentEvent[] = [];
  const messages: Message[] = [{ role: "user", content: "show" }];
  const r = await runAgent({ provider: scripted([node(3, ["gone"]), node(1, ["gone"])]), model: "m", store, messages, maxSteps: 2, emit: (e) => events.push(e) });
  assert.equal(r.stop, "max_steps");
  const shown = events.filter((e): e is Extract<AgentEvent, { type: "surface" }> => e.type === "surface");
  for (const e of shown) assert.ok(!e.snapshot.nodes.length || e.snapshot.nodes.length >= 4 || e.snapshot.partial, "the one-line retry never reaches the client");
  const last = shown.at(-1)!.snapshot;
  assert.equal(last.nodes.length, 4);
  assert.equal(store.assess("s")!.content, 3);
  assert.equal(events.at(-1)!.type, "run_end");
  assert.match(messages.at(-1)!.content, /Not shown: .*vak_update/);
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

// A long Telegram chat (.vak/telegram, 2026-10-25), condensed: the hotel
// request asked again and again, a booking tap with retries, then "hi" three
// times. Sent whole, every reply took about a minute on the 4B model and the
// model copied its earlier hotel cards.
const hotelsRender = {
  surface: "kyoto_hotels",
  title: "Kyoto Hotels: Compare & Book",
  nodes: [
    { id: "root", type: "stack", children: [{ id: "intro", type: "text", props: { content: "Three Kyoto hotels compared below. Review and select to book." } }, { id: "grid", type: "grid", children: [{ each: "/hotels", template: "hotel_card" }] }] },
    { id: "hotel_card", type: "card", props: { title: "{name}", subtitle: "{price}" } },
  ],
  data: { hotels: [{ name: "Kyoto Ryokan Zen", price: "$800/night" }, { name: "Northern Hills Villa", price: "$1,200/night" }] },
};
const call = (id: string, name: string): Message => ({ role: "assistant", content: "", toolCalls: [{ id, name, arguments: "{}" }] });
const result = (id: string, content: string): Message => ({ role: "tool", content, toolCallId: id, toolName: "vak_render" });
const longChat = (): Message[] => [
  { role: "user", content: "Compare three hotels in Kyoto and let me book one" },
  call("c1", "vak_render"),
  result("c1", "rendered"),
  { role: "user", content: '[ui action] {"action":"book_hotel","surface":"kyoto_hotels","source":"btn2","target":"telegram"}' },
  call("c2", "vak_render"),
  result("c2", "rendered with 1 error(s); fix with vak_update"),
  call("c3", "vak_update"),
  result("c3", "rendered"),
  { role: "user", content: "hi" },
  call("c4", "vak_render"),
  result("c4", "rendered"),
  { role: "user", content: "hi" },
  { role: "assistant", content: "Hello! How can I help you?" },
  { role: "user", content: "hi" },
  { role: "assistant", content: "Hi there! How can I assist you today?" },
  { role: "user", content: "Compare three hotels in Kyoto and let me book one" },
];
function recorder(): Provider & { requests: Message[][] } {
  const requests: Message[][] = [];
  return {
    id: "rec",
    requests,
    async *stream(req) {
      requests.push(structuredClone(req.messages));
      yield { type: "done", stop: "end" };
    },
  };
}

test("history: the model sees the recent turns, starting at a user message, with the shown surfaces described", async () => {
  const store = new SurfaceStore(basicCatalog);
  store.apply("vak_render", structuredClone(hotelsRender)); // apply: the real call was inline-authored
  const messages = longChat();
  const provider = recorder();
  await runAgent({ provider, model: "m", store, messages, history: 3, emit: () => {} });
  const sent = provider.requests[0]!;
  assert.equal(sent.length, 5, "the last three turns: hi, hi, hotels");
  assert.equal(sent[0]!.role, "user");
  assert.match(sent[0]!.content, /^\[earlier conversation omitted\]/);
  assert.match(sent[0]!.content, /Surface "kyoto_hotels" \(Kyoto Hotels: Compare & Book\) shows:/);
  assert.match(sent[0]!.content, /\[Card\] Kyoto Ryokan Zen — \$800\/night/, "the text view, not flat nodes");
  assert.doesNotMatch(sent[0]!.content, /"template"/);
  assert.match(sent[0]!.content, /Its data: \{"hotels":\[\{"name":"Kyoto Ryokan Zen"/);
  assert.match(sent[0]!.content, /\n\nhi$/, "the note goes into the first message, not a second user message");
  assert.equal(sent.at(-1)!.content, "Compare three hotels in Kyoto and let me book one");
  assert.equal(messages[11]!.content, "hi", "the saved history is unchanged");
  assert.equal(messages.length, 17, "and still gets the new reply");
});

test("history: a window never splits a tool call from its result", async () => {
  const store = new SurfaceStore(basicCatalog);
  const provider = recorder();
  await runAgent({ provider, model: "m", store, messages: longChat(), history: 4, emit: () => {} });
  const sent = provider.requests[0]!;
  assert.equal(sent[0]!.content, "hi", "no surfaces shown, so no note");
  for (const [i, m] of sent.entries()) {
    if (m.role === "tool") assert.ok(sent.slice(0, i).some((a) => a.toolCalls?.some((c) => c.id === m.toolCallId)), `result ${m.toolCallId} has its call`);
  }
  const fromAction = recorder();
  await runAgent({ provider: fromAction, model: "m", store, messages: longChat(), history: 5, emit: () => {} });
  assert.match(fromAction.requests[0]![0]!.content, /^\[ui action\]/, "a [ui action] starts a turn too");
});

test("history: default sends everything; a retry within the turn sees its own new messages", async () => {
  const everything = recorder();
  await runAgent({ provider: everything, model: "m", store: new SurfaceStore(basicCatalog), messages: longChat(), emit: () => {} });
  assert.equal(everything.requests[0]!.length, 16);

  // First step: a render with a missing child (an error), so the loop runs a second step.
  const broken = JSON.stringify({ surface: "s", nodes: [{ id: "root", type: "stack", children: ["missing"] }] });
  const requests: Message[][] = [];
  let step = 0;
  const retrying: Provider = {
    id: "retry",
    async *stream(req) {
      requests.push(structuredClone(req.messages));
      if (step++ > 0) return void (yield { type: "done", stop: "end" });
      yield { type: "tool_start", id: "r1", name: "vak_render" };
      yield { type: "tool_args", id: "r1", delta: broken };
      yield { type: "tool_end", id: "r1" };
      yield { type: "done", stop: "tool_use" };
    },
  };
  await runAgent({ provider: retrying, model: "m", store: new SurfaceStore(basicCatalog), messages: longChat(), history: 1, emit: () => {} });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.length, 1);
  assert.deepEqual(requests[1]!.map((m) => m.role), ["user", "assistant", "tool"]);
  assert.equal(requests[1]![2]!.isError, true);
});

test("compatible servers: the output-limit name and stream_options follow the declaration", async () => {
  routes["/c1/chat/completions"] = sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]) + "data: [DONE]\n\n";
  const p = openai({ id: "x", baseUrl: `${base}/c1`, maxTokensParam: "max_tokens", streamUsage: false });
  for await (const _ of p.stream({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 50 })) void _;
  const body = seen.findLast((r) => r.url === "/c1/chat/completions")!.body;
  assert.equal(body.max_tokens, 50);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.stream_options, undefined);
  // OpenAI's own defaults stay as they were.
  const q = openai({ id: "y", baseUrl: `${base}/c1` });
  for await (const _ of q.stream({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 50 })) void _;
  const plain = seen.findLast((r) => r.url === "/c1/chat/completions")!.body;
  assert.equal(plain.max_completion_tokens, 50);
  assert.deepEqual(plain.stream_options, { include_usage: true });
});

test("compatible servers: /models as {data} or as a bare list (Together)", async () => {
  routes["/m1/models"] = JSON.stringify({ data: [{ id: "b" }, { id: "a" }] });
  routes["/m2/models"] = JSON.stringify([{ id: "z" }, { id: "y" }]);
  assert.deepEqual(await openai({ baseUrl: `${base}/m1` }).listModels!(), ["a", "b"]);
  assert.deepEqual(await openai({ baseUrl: `${base}/m2` }).listModels!(), ["y", "z"]);
});

test("lab presets: a key makes the provider available; local servers need none; settings list every variable", () => {
  const off = providersFromEnv({});
  for (const preset of COMPATIBLE_PRESETS) {
    const entry = off.find((e) => e.id === preset.id)!;
    assert.equal(entry.available, Boolean(preset.local), preset.id);
    if (preset.keyVar) assert.ok(PROVIDER_SETTINGS.some((s) => s.name === preset.keyVar && s.secret), preset.keyVar);
  }
  const on = providersFromEnv({ MISTRAL_API_KEY: "k", GROQ_API_KEY: "k" });
  assert.ok(on.find((e) => e.id === "mistral")!.available);
  assert.ok(on.find((e) => e.id === "groq")!.available);
  assert.equal(new Set(PROVIDER_SETTINGS.map((s) => s.name)).size, PROVIDER_SETTINGS.length);
});

// Rich component runs ignored requested types when all catalog contracts were
// equally distant in the system prompt. Focus only explicit requests using the
// available catalog, and never treat tool results/engine feedback as requests.
test("explicit component requests focus their catalog contract after the examples", async () => {
  const { buildSystem } = await import("../src/agent.ts");
  const provider: Provider = { id: "stub", async *stream() {} };
  const options = {
    provider, model: "m", store: new SurfaceStore(basicCatalog), emit: () => {},
    plan: { generation: "tools" as const, tier: "extended" as const, examples: true, authoring: "inline" as const, maxSteps: 3, reasons: [] },
    messages: [{ role: "user" as const, content: "Use the steps component to show the process" }, { role: "user" as const, content: "[engine] table component had an error" }],
  };
  const focused = buildSystem(options).split("Requested components:")[1]!;
  assert.match(focused, /type: steps/);
  assert.match(focused, /"status"/);
  assert.doesNotMatch(focused, /type: table/);
  const table = buildSystem({ ...options, messages: [{ role: "user", content: "Show an expense table with totals" }] }).split("Requested components:")[1]!;
  assert.match(table, /type: table/);
  assert.match(table, /props.totals: true/);
  const core = buildSystem({ ...options, plan: { ...options.plan, tier: "core" }, messages: [{ role: "user", content: "Use the steps component" }] });
  assert.doesNotMatch(core, /Requested components:/);
  const plain = buildSystem({ ...options, messages: [{ role: "user", content: "Hello" }] });
  assert.doesNotMatch(plain, /Requested components:/);
});
