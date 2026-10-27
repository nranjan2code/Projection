import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, TOOL_SUBMIT, type AgentEvent } from "@vak/core";
import { runAgent, type Provider, type ProviderEvent } from "../src/index.ts";

const document = (surface: string, content: string) => ({ op: "replace", surface, root: { type: "text", props: { content } } });
async function* call(name: string, args: unknown, id = "call"): AsyncIterable<ProviderEvent> {
  yield { type: "tool_start", id, name }; yield { type: "tool_args", id, delta: JSON.stringify(args) }; yield { type: "tool_end", id };
}
const options = { model: "test", surfaceSubmission: true, completion: "response" as const, maxSteps: 6 };
test("one accepted submission validates a complete candidate and commits before emitting without another generation", async () => {
  const store = new SurfaceStore(basicCatalog), events: AgentEvent[] = [];
  let requests = 0, checks = 0;
  const provider: Provider = { id: "scripted", async *stream(req) {
    requests++; assert.deepEqual(req.tools!.map((tool) => tool.name), [TOOL_SUBMIT]);
    assert.ok(!req.system!.includes("need separate vak_render calls"));
    yield* call(TOOL_SUBMIT, { surfaces: [document("one", "First"), document("two", "Second")], reply: "Unsupported success claim" });
    yield { type: "done", stop: "tool_use" };
  } };
  const result = await runAgent({ ...options, provider, store, messages: [], validateCompletion: ({ surfaces }) => {
    checks++; assert.equal(surfaces.length, 2); assert.equal(store.list().length, 0);
    return { issues: [], response: "Ready for review." };
  }, emit: (event) => { if (event.type === "surface") assert.equal(store.list().length, 2); events.push(event); } });
  assert.equal(result.stop, "end"); assert.equal(requests, 1); assert.equal(checks, 1);
  assert.deepEqual(store.list().map((surface) => surface.id), ["one", "two"]);
  assert.equal(events.filter((event) => event.type === "text_delta").map((event) => event.delta).join(""), "Ready for review.");
  assert.equal(events.filter((event) => event.type === "surface").length, 2);
});
test("rejected candidates leave prior content intact and can be corrected inside the same bound", async () => {
  const store = new SurfaceStore(basicCatalog); store.apply("vak_render", { surface: "one", nodes: [{ id: "root", type: "text", props: { content: "Accepted" } }] });
  const before = store.snapshot("one"); let requests = 0;
  const provider: Provider = { id: "scripted", async *stream() {
    assert.deepEqual(store.snapshot("one"), before);
    yield* call(TOOL_SUBMIT, { surfaces: [document("one", ++requests === 1 ? "Wrong" : "Correct")] }); yield { type: "done", stop: "tool_use" };
  } };
  const events: AgentEvent[] = [];
  const result = await runAgent({ ...options, provider, store, messages: [], validateCompletion: ({ resolved }) => resolved[0]!.root!.props.content === "Correct" ? [] : ["Wrong content"], emit: (event) => events.push(event) });
  assert.equal(result.stop, "end"); assert.equal(requests, 2);
  assert.equal(store.resolve("one")!.root!.props.content, "Correct");
  assert.equal(events.filter((event) => event.type === "surface").length, 1);
});
test("submission mixed with external operations executes neither; external-only work keeps the existing dispatcher", async () => {
  let requests = 0, effects = 0; const store = new SurfaceStore(basicCatalog);
  const provider: Provider = { id: "scripted", async *stream(req) {
    if (++requests === 1) {
      yield* call(TOOL_SUBMIT, { surfaces: [document("one", "Result")] }, "submit"); yield* call("approved_write", {}, "write");
    } else if (requests === 2) { assert.equal(effects, 0); assert.equal(store.list().length, 0); yield* call("approved_write", {}); }
    else { assert.equal(effects, 1); assert.ok(req.messages.some((message) => message.role === "tool" && message.content === "receipt")); yield* call(TOOL_SUBMIT, { surfaces: [document("one", "Result")] }); }
    yield { type: "done", stop: "tool_use" };
  } };
  const result = await runAgent({ ...options, provider, store, messages: [], tools: [{ spec: { name: "approved_write", description: "Existing policy-controlled executor", inputSchema: { type: "object" } }, execute: () => { effects++; return "receipt"; } }], emit: () => {} });
  assert.equal(result.stop, "end"); assert.equal(requests, 3); assert.equal(effects, 1);
});
test("truncation, malformed JSON, cancellation and malformed checks never publish a candidate", async () => {
  for (const kind of ["truncated", "malformed", "abort", "bad-check"] as const) {
    const store = new SurfaceStore(basicCatalog), ctrl = new AbortController();
    const provider: Provider = { id: "scripted", async *stream() {
      if (kind === "malformed") { yield { type: "tool_start", id: "bad", name: TOOL_SUBMIT }; yield { type: "tool_args", id: "bad", delta: '{"surfaces":[' }; }
      else yield* call(TOOL_SUBMIT, { surfaces: [document("one", "Result")] });
      yield { type: "done", stop: kind === "truncated" ? "max_tokens" : "tool_use" };
    } };
    const events: AgentEvent[] = [];
    const result = await runAgent({ ...options, provider, store, messages: [], signal: ctrl.signal, validateCompletion: () => {
      if (kind === "abort") ctrl.abort();
      return kind === "bad-check" ? { issues: "invalid" } as never : [];
    }, emit: (event) => events.push(event) });
    assert.ok(["validation_stalled", "aborted", "error"].includes(result.stop), kind);
    assert.equal(store.list().length, 0); assert.equal(events.some((event) => event.type === "surface"), false);
  }
});
test("canonical edits during asynchronous checks survive and stale candidates are rejected", async () => {
  const store = new SurfaceStore(basicCatalog); store.apply("vak_render", { surface: "one", data: { value: 1 }, nodes: [{ id: "root", type: "text", props: { content: "{/value}" } }] });
  let requests = 0;
  const provider: Provider = { id: "scripted", async *stream() { requests++; yield* call(TOOL_SUBMIT, { surfaces: [document("one", "Stale replacement")] }); yield { type: "done", stop: "tool_use" }; } };
  const result = await runAgent({ ...options, provider, store, messages: [], maxSteps: 1, validateCompletion: async () => { await Promise.resolve(); store.setValue("one", "/value", 99); return []; }, emit: () => {} });
  assert.equal(result.stop, "max_steps"); assert.equal(requests, 1); assert.equal(store.get("one")!.data.value, 99);
  assert.equal(store.resolve("one")!.root!.props.content, 99);
});
test("identical rejected submissions stop after one correction opportunity", async () => {
  let requests = 0; const store = new SurfaceStore(basicCatalog);
  const provider: Provider = { id: "scripted", async *stream() { requests++; yield* call(TOOL_SUBMIT, { surfaces: [document("one", "Unchanged")] }); yield { type: "done", stop: "tool_use" }; } };
  const result = await runAgent({ ...options, provider, store, messages: [], validateCompletion: () => ["Unmet requirement"], emit: () => {} });
  assert.equal(result.stop, "validation_stalled"); assert.equal(requests, 2); assert.equal(store.list().length, 0);
});

test("an edit made during model generation cannot be overwritten by its stale submission", async () => {
  const store = new SurfaceStore(basicCatalog); store.apply("vak_render", { surface: "one", data: { value: 1 }, nodes: [{ id: "root", type: "text", props: { content: "{/value}" } }] });
  const provider: Provider = { id: "concurrent", async *stream() { store.setValue("one", "/value", 77); yield* call(TOOL_SUBMIT, { surfaces: [document("one", "Stale")] }); yield { type: "done", stop: "tool_use" }; } };
  const result = await runAgent({ ...options, provider, store, messages: [], maxSteps: 1, emit: () => {} });
  assert.equal(result.stop, "max_steps"); assert.equal(store.get("one")!.data.value, 77);
});
test("a complete-looking submission without a terminal done event is never committed", async () => {
  const store = new SurfaceStore(basicCatalog);
  const provider: Provider = { id: "incomplete", async *stream() { yield* call(TOOL_SUBMIT, { surfaces: [document("one", "Unconfirmed")] }); } };
  const result = await runAgent({ ...options, provider, store, messages: [], emit: () => {} });
  assert.equal(result.stop, "error"); assert.equal(store.list().length, 0);
});
test("canonical generated identities remain patchable after restoring snapshots", async () => {
  const store = new SurfaceStore(basicCatalog);
  const first: Provider = { id: "first", async *stream() { yield* call(TOOL_SUBMIT, { surfaces: [{ op: "replace", surface: "one", data: { name: "Original" }, root: { type: "stack", children: [{ type: "text", props: { content: "{/name}" } }] } }] }); yield { type: "done", stop: "tool_use" }; } };
  await runAgent({ ...options, provider: first, store, messages: [], emit: () => {} });
  const restored = new SurfaceStore(basicCatalog); restored.load(store.snapshot("one")!);
  const followup: Provider = { id: "second", async *stream(req) {
    assert.match(req.system!, /__vak_0_0/);
    yield* call(TOOL_SUBMIT, { surfaces: [{ op: "patch", surface: "one", nodes: [{ id: "__vak_0_0", props: { content: "Updated" } }] }] }); yield { type: "done", stop: "tool_use" };
  } };
  assert.equal((await runAgent({ ...options, provider: followup, store: restored, messages: [], emit: () => {} })).stop, "end");
  assert.equal(restored.resolve("one")!.root!.children[0]!.props.content, "Updated");
  assert.deepEqual(restored.get("one")!.data, { name: "Original" });
});

test("plain prose cannot bypass submission even when old canonical results pass completion checks", async () => {
  const store = new SurfaceStore(basicCatalog); store.apply("vak_render", { surface: "old", nodes: [{ id: "root", type: "text", props: { content: "Previous result" } }] });
  const before = store.snapshot("old"); let requests = 0;
  const provider: Provider = { id: "bypass", async *stream() { requests++; yield { type: "text", delta: "Done" }; yield { type: "done", stop: "end" }; } };
  const result = await runAgent({ ...options, provider, store, messages: [], validateCompletion: () => [], emit: () => {} });
  assert.equal(result.stop, "validation_stalled"); assert.equal(requests, 2); assert.deepEqual(store.snapshot("old"), before);
});

test("source tables use validated canonical control values instead of stale unused model data", async () => {
  const store = new SurfaceStore(basicCatalog);
  store.apply("vak_render", { surface: "criteria", data: { criteria: { budget: 50 } }, nodes: [{ id: "root", type: "form", props: { submit: "apply" }, children: [{ id: "budget", type: "input", props: { label: "Budget", bind: "/criteria/budget" } }] }] });
  store.apply("vak_render", { surface: "old", data: { criteria: { budget: 999 } }, nodes: [{ id: "root", type: "text", props: { content: "Old unrelated output" } }] });
  let requests = 0;
  const provider: Provider = { id: "source", async *stream() {
    if (++requests === 1) { yield* call("vak_derive_columns", { source: "selected", derive: [] }); yield { type: "done", stop: "tool_use" }; return; }
    if (requests === 2) { yield* call("vak_prepare_table", { source: "selected", summary: [{ key: "budget", expression: { parameter: "/criteria/budget" } }] }); yield { type: "done", stop: "tool_use" }; return; }
    yield* call(TOOL_SUBMIT, { surfaces: [{ op: "replace", surface: "report", root: { type: "table", props: { source: "selected" } }, data: {} }] }); yield { type: "done", stop: "tool_use" };
  } };
  const result = await runAgent({ ...options, provider, store, messages: [], tableSources: { selected: { filename: "selected.csv", sha256: "b".repeat(64), columns: ["value"], rows: [[12]] } }, tableParameters: { "/criteria/budget": 100 }, emit: () => {} });
  assert.equal(result.stop, "end");
  assert.deepEqual(store.get("report")!.data.sources, { selected: { filename: "selected.csv", sha256: "b".repeat(64), summary: { budget: 50 } } });
  assert.equal(store.get("criteria")!.data.criteria && (store.get("criteria")!.data.criteria as { budget: number }).budget, 50);
});
