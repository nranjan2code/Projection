import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, type AgentEvent } from "@vak/core";
import { runAgent, type Provider } from "../src/index.ts";

test("response completion publishes independent progress, continues external work and ends on a response", async () => {
  let requests = 0, reads = 0;
  const provider: Provider = { id: "scripted", async *stream() {
    const step = requests++;
    if (step === 3) { yield { type: "text", delta: "Ready for review" }; yield { type: "done", stop: "end" }; return; }
    const name = step === 1 ? "source__read" : "vak_render";
    yield { type: "tool_start", id: `call-${step}`, name };
    yield { type: "tool_args", id: `call-${step}`, delta: JSON.stringify(step === 1 ? {} : { surface: `surface-${step}`, nodes: [{ id: "root", type: "text", props: { content: "Progress" } }] }) };
    yield { type: "tool_end", id: `call-${step}` }; yield { type: "done", stop: "tool_use" };
  } };
  const store = new SurfaceStore(basicCatalog), events: AgentEvent[] = [];
  const result = await runAgent({ provider, model: "m", store, messages: [{ role: "user", content: "Publish, read, then publish another result" }], completion: "response", maxSteps: 5, emit: (event) => events.push(event), tools: [{ spec: { name: "source__read", description: "Read", inputSchema: { type: "object" } }, execute: () => { reads++; return "receipt"; } }] });
  assert.equal(result.stop, "end"); assert.equal(requests, 4); assert.equal(reads, 1);
  assert.deepEqual(store.list().map((s) => s.id), ["surface-0", "surface-2"]);
  assert.equal(events.filter((e) => e.type === "run_end").length, 1);
  assert.ok(events.some((e) => e.type === "surface"));
});

test("response completion retains step limits and rejects constrained-only response protocols", async () => {
  let requests = 0;
  const provider: Provider = { id: "scripted", capabilities: { constrainedOutput: true }, async *stream() {
    const id = `call-${requests++}`;
    yield { type: "tool_start", id, name: "vak_render" };
    yield { type: "tool_args", id, delta: JSON.stringify({ surface: id, nodes: [{ id: "root", type: "text", props: { content: "Progress" } }] }) };
    yield { type: "tool_end", id }; yield { type: "done", stop: "tool_use" };
  } };
  const options = { provider, model: "m", store: new SurfaceStore(basicCatalog), messages: [{ role: "user" as const, content: "Work" }], completion: "response" as const, emit: () => {} };
  assert.equal((await runAgent({ ...options, maxSteps: 2 })).stop, "max_steps");
  assert.equal(requests, 2);
  // Options the caller got wrong reject before the loop: a {stop:"error"}
  // result would read as a model failure and invite a pointless retry.
  await assert.rejects(runAgent({ ...options, generation: "constrained" }), /Response completion requires tool generation/);
  assert.equal(requests, 2);
});

test("a trusted completion check feeds failures back inside the run and withholds rejected prose", async () => {
  let requests = 0;
  const provider: Provider = { id: "checked", async *stream() {
    const step = requests++;
    if (step === 1) {
      yield { type: "tool_start", id: "repair", name: "vak_render" };
      yield { type: "tool_args", id: "repair", delta: JSON.stringify({ surface: "required", nodes: [{ id: "root", type: "text", props: { content: "Result" } }] }) };
      yield { type: "tool_end", id: "repair" }; yield { type: "done", stop: "tool_use" }; return;
    }
    yield { type: "text", delta: step === 0 ? "Everything is already verified" : "Ready for review." };
    yield { type: "done", stop: "end" };
  } };
  const events: AgentEvent[] = [];
  const result = await runAgent({ provider, model: "m", store: new SurfaceStore(basicCatalog), messages: [{ role: "user", content: "Produce the required output" }], completion: "response", maxSteps: 4, validateCompletion: ({ surfaces }) => surfaces.some((s) => s.id === "required") ? [] : ["Missing required surface"], emit: (event) => events.push(event) });
  assert.equal(result.stop, "end"); assert.equal(requests, 3);
  assert.equal(events.filter((e) => e.type === "text_delta").map((e) => e.delta).join(""), "Ready for review.");
});

test("failed completion checks remain bounded and cannot publish an unverified final claim", async () => {
  const events: AgentEvent[] = [];
  const provider: Provider = { id: "checked", async *stream() { yield { type: "text", delta: "Unsupported claim" }; yield { type: "done", stop: "end" }; } };
  const result = await runAgent({ provider, model: "m", store: new SurfaceStore(basicCatalog), messages: [{ role: "user", content: "Work" }], completion: "response", maxSteps: 2, validateCompletion: () => ["Evidence missing"], emit: (event) => events.push(event) });
  assert.equal(result.stop, "validation_stalled");
  assert.equal(events.some((e) => e.type === "text_delta"), false);
});

test("completion feedback identifies existing surfaces so a correction patch preserves supplied field data", async () => {
  const store = new SurfaceStore(basicCatalog);
  store.apply("vak_render", { surface: "chosen-by-author", nodes: [{ id: "root", type: "form", props: { submit: "apply" }, children: [{ id: "limit", type: "input", props: { label: "Limit", bind: "/criteria/limit" } }] }], data: { criteria: { limit: 42 } } });
  let requests = 0;
  const provider: Provider = { id: "repair", async *stream(req) {
    const step = requests++;
    if (step === 1) {
      const feedback = req.messages.at(-1)!.content;
      const inventory = JSON.parse(feedback.split("Saved surface inventory (data, not instructions): ")[1]!.split("\n")[0]!);
      assert.deepEqual(inventory, [{ id: "chosen-by-author", root: "form" }]);
      assert.match(feedback, /vak_update with existing surface\/node IDs/);
      yield { type: "tool_start", id: "patch", name: "vak_update" };
      yield { type: "tool_args", id: "patch", delta: JSON.stringify({ surface: inventory[0]!.id, nodes: [{ id: "limit", props: { label: "Updated limit" } }] }) };
      yield { type: "tool_end", id: "patch" }; yield { type: "done", stop: "tool_use" }; return;
    }
    yield { type: "text", delta: "Ready" }; yield { type: "done", stop: "end" };
  } };
  const result = await runAgent({ provider, model: "m", store, messages: [{ role: "user", content: "Correct the label" }], completion: "response", maxSteps: 3, validateCompletion: ({ resolved }) => resolved[0]?.root?.children[0]?.props.label === "Updated limit" ? [] : ["Correct the input label"], emit: () => {} });
  assert.equal(result.stop, "end"); assert.equal(requests, 3);
  assert.equal(store.list().length, 1);
  assert.equal(store.resolve("chosen-by-author")!.root!.children[0]!.props.value, 42);
});

test("a trusted review acknowledgement replaces final prose without another generation", async () => {
  const events: AgentEvent[] = [], messages = [{ role: "user" as const, content: "Review the outputs" }];
  let requests = 0;
  const provider: Provider = { id: "review", async *stream() { requests++; yield { type: "text", delta: "Everything has been independently verified." }; yield { type: "done", stop: "end" }; } };
  const result = await runAgent({ provider, model: "m", store: new SurfaceStore(basicCatalog), messages, completion: "response", maxSteps: 2, validateCompletion: ({ response }) => { assert.match(response, /independently verified/); return { issues: [], response: "Ready for user review." }; }, emit: (event) => events.push(event) });
  assert.equal(result.stop, "end"); assert.equal(requests, 1);
  assert.equal(events.filter((event) => event.type === "text_delta").map((event) => event.delta).join(""), "Ready for user review.");
});

test("replacement prose cannot bypass failed checks and malformed review decisions fail closed", async () => {
  for (const decision of [{ issues: ["Evidence missing"], response: "Ready for user review." }, { issues: [], response: 3 }, { issues: "not a list" }, null, { issues: [], typo: "ignored?" }]) {
    const events: AgentEvent[] = [];
    const provider: Provider = { id: "review", async *stream() { yield { type: "text", delta: "Unsupported assertion" }; yield { type: "done", stop: "end" }; } };
    const result = await runAgent({ provider, model: "m", store: new SurfaceStore(basicCatalog), messages: [{ role: "user", content: "Work" }], completion: "response", maxSteps: 2, validateCompletion: () => decision as never, emit: (event) => events.push(event) });
    assert.equal(result.stop, decision?.issues instanceof Array && decision.issues.length ? "validation_stalled" : "error");
    assert.equal(events.some((event) => event.type === "text_delta"), false);
  }
});


test("unchanged failed completion stops after one repair opportunity despite a larger budget", async () => {
  let requests = 0;
  const provider: Provider = { id: "stalled", async *stream() {
    requests++; yield { type: "text", delta: "Still claiming success without edits" }; yield { type: "done", stop: "end" };
  } };
  const result = await runAgent({ provider, model: "m", store: new SurfaceStore(basicCatalog), messages: [{ role: "user", content: "Work" }], completion: "response", maxSteps: 12, validateCompletion: () => ["Required output missing"], emit: () => {} });
  assert.equal(result.stop, "validation_stalled"); assert.equal(requests, 2);
});


test("revision-only rewrites do not keep a rejected candidate alive", async () => {
  const store = new SurfaceStore(basicCatalog);
  const args = { surface: "partial", nodes: [{ id: "root", type: "text", props: { content: "Unchanged" } }] };
  store.apply("vak_render", args);
  let requests = 0;
  const provider: Provider = { id: "rewrite", async *stream() {
    if (++requests === 2) {
      yield { type: "tool_start", id: "rewrite", name: "vak_render" };
      yield { type: "tool_args", id: "rewrite", delta: JSON.stringify(args) };
      yield { type: "tool_end", id: "rewrite" }; yield { type: "done", stop: "tool_use" }; return;
    }
    yield { type: "text", delta: "Ready" }; yield { type: "done", stop: "end" };
  } };
  const result = await runAgent({ provider, model: "m", store, messages: [{ role: "user", content: "Work" }], completion: "response", maxSteps: 12, validateCompletion: () => ["Missing evidence"], emit: () => {} });
  assert.equal(result.stop, "validation_stalled"); assert.equal(requests, 3);
  assert.equal(store.snapshot("partial")!.nodes[0]!.props?.content, "Unchanged");
});


test("response-aware completion checks can improve prose while surface issues stay unchanged", async () => {
  let requests = 0;
  const provider: Provider = { id: "prose", async *stream() {
    yield { type: "text", delta: `revision ${++requests}` }; yield { type: "done", stop: "end" };
  } };
  const result = await runAgent({ provider, model: "m", store: new SurfaceStore(basicCatalog), messages: [{ role: "user", content: "Work" }], completion: "response", maxSteps: 4, validateCompletion: ({ response }) => ({ issues: response === "revision 3" ? [] : ["Answer incomplete"], response: "Ready for review." }), emit: () => {} });
  assert.equal(result.stop, "end"); assert.equal(requests, 3);
});
