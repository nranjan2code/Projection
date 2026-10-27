import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, SurfaceStore } from "@vak/core";
import { runAgent, type Provider } from "../src/index.ts";

const submission = { tool: "vak_submit", arguments: { surfaces: [{ op: "replace", root: { type: "text", props: { content: "Value 17" } }, data: { value: 17 } }] } };
test("schema-capable submission requests decode their real tool schema and finish through the canonical executor", async () => {
  let requests = 0; const store = new SurfaceStore(basicCatalog);
  const provider: Provider = { id: "typed", capabilities: { constrainedOutput: true }, async *stream(req) {
    requests++; assert.equal(req.tools, undefined); assert.ok(req.responseSchema);
    yield { type: "text", delta: JSON.stringify(submission) }; yield { type: "done", stop: "end", usage: { input: 10, output: 20 } };
  } };
  const result = await runAgent({ provider, model: "test", store, messages: [], surfaceSubmission: true, completion: "response", emit: () => {} });
  assert.equal(result.stop, "end"); assert.equal(requests, 1); assert.deepEqual(store.get("__vak_surface_1")!.data, { value: 17 });
});
test("decoded external operations retain the ordinary executor and wire history never contains native tool calls", async () => {
  let requests = 0, effects = 0;
  const provider: Provider = { id: "typed", capabilities: { constrainedOutput: true }, async *stream(req) {
    const response = ++requests === 1 ? { tool: "authorized_read", arguments: { key: "selected" } } : submission;
    if (requests === 2) { assert.ok(req.messages.every((message) => !message.toolCalls && message.role !== "tool")); assert.ok(JSON.stringify(req.messages).includes("actual receipt")); }
    yield { type: "text", delta: JSON.stringify(response) }; yield { type: "done", stop: "end" };
  } };
  const result = await runAgent({ provider, model: "test", store: new SurfaceStore(basicCatalog), messages: [], surfaceSubmission: true, completion: "response", tools: [{ spec: { name: "authorized_read", description: "Existing authorized tool", inputSchema: { type: "object", required: ["key"], properties: { key: { type: "string" } } } }, execute: (args) => { assert.deepEqual(args, { key: "selected" }); effects++; return "actual receipt"; } }], emit: () => {} });
  assert.equal(result.stop, "end"); assert.equal(effects, 1); assert.equal(requests, 2);
});
test("malformed, wrong-shape, unknown and truncated decoded operations dispatch no effects", async () => {
  for (const kind of ["malformed", "wrong-shape", "unknown", "truncated"] as const) {
    let effects = 0; const store = new SurfaceStore(basicCatalog);
    const provider: Provider = { id: "typed", capabilities: { constrainedOutput: true }, async *stream() {
      const value = kind === "unknown" ? { tool: "other", arguments: {} } : kind === "wrong-shape" ? { tool: "vak_submit", arguments: { surfaces: "[]" } } : submission;
      yield { type: "text", delta: kind === "malformed" ? '{"tool":' : JSON.stringify(value) }; yield { type: "done", stop: kind === "truncated" ? "max_tokens" : "end" };
    } };
    const result = await runAgent({ provider, model: "test", store, messages: [], surfaceSubmission: true, completion: "response", maxSteps: 2, tools: [{ spec: { name: "other_write", description: "Write", inputSchema: { type: "object" } }, execute: () => { effects++; return "effect"; } }], emit: () => {} });
    assert.equal(result.stop, "max_steps"); assert.equal(effects, 0); assert.equal(store.list().length, 0);
  }
});

test("recursive component schemas preserve source literals and reject invalid descendants", async () => {
  const { submissionTool, validate, toWireSchema } = await import("@vak/core");
  const schema = submissionTool(basicCatalog, []).inputSchema;
  assert.ok(toWireSchema(schema).$defs?.vak_node);
  const candidate = { surfaces: [{ op: "replace", data: {}, root: { type: "stack", children: [{ type: "code", props: { code: 'const a = {value: "{literal}"};' } }] } }] };
  assert.deepEqual(validate(schema, candidate), []);
  candidate.surfaces[0]!.root.children[0]!.type = "invalid-component";
  assert.ok(validate(schema, candidate).length);
});
