import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, SurfaceStore } from "@vak/core";
import { runAgent, type Provider, type ProviderEvent } from "../src/index.ts";
import { schemaToolEvents } from "../src/schema-tools.ts";

const render = (surface: string) => ({ name: "vak_render", arguments: { surface, nodes: [{ id: "root", type: "text", props: { content: surface } }] } });
test("schema batches publish independent surfaces and dispatch declared external tools through the same executor", async () => {
  const store = new SurfaceStore(basicCatalog); let requests = 0, executions = 0;
  const provider: Provider = { id: "scripted", capabilities: { constrainedOutput: true }, async *stream(request) {
    assert.equal(request.tools, undefined); assert.ok(request.responseSchema);
    const batches = [ { reply: "", calls: [render("first")] }, { reply: "", calls: [render("second")] }, { reply: "", calls: [{ name: "approved_read", arguments: { name: "chosen" } }] }, { reply: "Ready for review", calls: [] } ];
    yield { type: "text", delta: JSON.stringify(batches[requests++]) }; yield { type: "done", stop: "end", usage: { input: 2, output: 3 } };
  } };
  const result = await runAgent({ provider, model: "test", store, messages: [], schemaMode: "strict", toolEncoding: "constrained", completion: "response", maxSteps: 3,
    tools: [{ spec: { name: "approved_read", description: "Read after existing authorization", inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } }, execute: (args) => { assert.deepEqual(args, { name: "chosen" }); executions++; return "read receipt"; } }], emit: () => {} });
  assert.equal(result.stop, "end"); assert.equal(requests, 4); assert.equal(executions, 1); assert.equal(store.list().length, 2);
});

test("a malformed or truncated batch dispatches no calls and retries within the existing step budget", async () => {
  for (const output of [JSON.stringify({ reply: "", calls: [render("valid"), { name: "not_offered", arguments: {} }] }), JSON.stringify({ reply: "", calls: [{ name: "vak_render", arguments: { surface: "s", nodes: "[]" } }] }), '{"reply":"","calls":[']) {
    let requests = 0;
    const provider: Provider = { id: "scripted", capabilities: { constrainedOutput: true }, async *stream() { requests++; yield { type: "text", delta: output }; yield { type: "done", stop: "end" }; } };
    const store = new SurfaceStore(basicCatalog);
    const result = await runAgent({ provider, model: "test", store, messages: [], schemaMode: "strict", toolEncoding: "constrained", maxSteps: 2, emit: () => {} });
    assert.equal(result.stop, "max_steps"); assert.equal(requests, 2); assert.equal(store.list().length, 0);
  }
});

test("token-truncated schema output cannot dispatch a syntactically complete batch", async () => {
  const provider: Provider = { id: "scripted", capabilities: { constrainedOutput: true }, async *stream() { yield { type: "text", delta: JSON.stringify({ reply: "", calls: [{ name: "write", arguments: {} }] }) }; yield { type: "done", stop: "max_tokens" }; } };
  const events: ProviderEvent[] = []; await assert.rejects(async () => { for await (const event of schemaToolEvents(provider, { model: "test", messages: [], tools: [{ name: "write", description: "write", inputSchema: { type: "object" } }] }, "test")) events.push(event); }, /Invalid schema call batch/);
  assert.ok(events.every((event) => event.type === "done"));
});

test("auto encoding keeps the native path for providers without grammar support", async () => {
  const provider: Provider = { id: "native", async *stream(request) { assert.ok(request.tools?.length); assert.equal(request.responseSchema, undefined); yield { type: "text", delta: "Plain answer" }; yield { type: "done", stop: "end" }; } };
  const result = await runAgent({ provider, model: "test", store: new SurfaceStore(basicCatalog), messages: [], toolEncoding: "auto", emit: () => {} });
  assert.equal(result.stop, "end");
});

test("cancellation after decoding cannot dispatch an otherwise valid call", async () => {
  const ctrl = new AbortController();
  const provider: Provider = { id: "scripted", capabilities: { constrainedOutput: true }, async *stream() { yield { type: "text", delta: JSON.stringify({ reply: "", calls: [{ name: "write", arguments: {} }] }) }; ctrl.abort(); yield { type: "done", stop: "end" }; } };
  const events: ProviderEvent[] = [];
  await assert.rejects(async () => { for await (const event of schemaToolEvents(provider, { model: "test", messages: [], signal: ctrl.signal, tools: [{ name: "write", description: "write", inputSchema: { type: "object" } }] }, "test")) events.push(event); });
  assert.ok(events.every((event) => event.type === "done"));
});
