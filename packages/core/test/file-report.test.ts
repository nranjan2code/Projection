import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, parseLenient, SurfacePublisher } from "../src/index.ts";

// Exact first three edits from local d335ae6a, 2026-10-26. A malformed nested
// correction moves all inputs out of the form; data remains correct.
const calls: { name: string; arguments: string }[] = JSON.parse(readFileSync(new URL("./fixtures/file-report-corrections-4b.json", import.meta.url), "utf8"));
function apply(store: SurfaceStore, index: number) {
  const call = calls[index]!;
  let args; try { args = JSON.parse(call.arguments); } catch { args = parseLenient(call.arguments); }
  return store.apply(call.name, args);
}
test("a sibling form cannot hide lost submission scope; a small ID patch restores exact payload", () => {
  const store = new SurfaceStore(basicCatalog);
  apply(store, 0); apply(store, 1);
  const before = store.snapshot("budget_form")!.data;
  const diagnostics = apply(store, 2);
  assert.ok(diagnostics.some((d) => d.severity === "error" && d.message.includes('"budget_total_input"') && d.message.includes("sibling form")));
  const patch = store.apply("vak_update", { surface: "budget_form", nodes: [{ id: "form_wrapper", children: ["budget_total_input", "per_item_cap_input", "priority_items_checkbox"] }] });
  assert.deepEqual(patch.filter((d) => d.severity === "error"), []);
  assert.deepEqual(store.snapshot("budget_form")!.data, before);
  const result = store.submit("budget_form", "form_wrapper");
  assert.ok(result.action);
  assert.deepEqual(result.action.data, { total: 100, per_item_cap: 50, priority_enabled: false });
});
test("publication holds a scope-breaking correction and restores the usable form at run end", () => {
  const store = new SurfaceStore(basicCatalog); apply(store, 1);
  const publisher = new SurfacePublisher(store);
  apply(store, 2);
  assert.equal(publisher.settle("budget_form").held, true);
  publisher.finish();
  assert.ok(store.submit("budget_form", "form_wrapper").action);
  assert.deepEqual(store.get("budget_form")!.nodes.get("form_wrapper")!.children, ["budget_total_input", "per_item_cap_input", "priority_items_checkbox"]);
});
test("only controls in the real form/action scope are covered; visibility toggles stay local", () => {
  const store = new SurfaceStore(basicCatalog);
  const nodes = [{ id: "root", type: "stack", children: ["a", "b"] }, { id: "a", type: "form", children: ["one"] }, { id: "one", type: "input", props: { label: "One", bind: "/one" } }, { id: "b", type: "stack", children: ["two"] }, { id: "two", type: "input", props: { label: "Two", bind: "/two" } }];
  assert.ok(store.apply("vak_render", { surface: "s", nodes }).some((d) => d.severity === "error" && d.message.includes('"two"')));
  assert.deepEqual(store.apply("vak_update", { surface: "s", nodes: [{ id: "b", children: ["two", "send"] }, { id: "send", type: "button", props: { label: "Send", action: "send" } }] }).filter((d) => d.severity === "error"), []);
});

test("referenced full-pointer data keys initialize canonical paths without changing values", () => {
  // Local eb039e48, 2026-10-26: literal pointer keys left both budget and
  // summary bindings empty, despite the model supplying their actual values.
  const store = new SurfaceStore(basicCatalog);
  const answer = "Total cost 70; budget 100; remaining 30. Missing delivery dates.";
  store.apply("vak_render", { surface: "s", data: { "/criteria/budget": 100, "/summary/answer": answer, "/unrelated/key": "literal" }, nodes: [{ id: "root", type: "form", children: ["budget", "summary"] }, { id: "budget", type: "input", props: { label: "Budget", bind: "/criteria/budget" } }, { id: "summary", type: "text", props: { content: "{/summary/answer}" } }] });
  assert.deepEqual(store.get("s")!.data, { criteria: { budget: 100 }, summary: { answer }, "/unrelated/key": "literal" });
  assert.ok(store.submit("s", "root").action);
  store.apply("vak_update", { surface: "s", data: { "/criteria/budget": 999, criteria: { budget: 80 } } });
  assert.equal((store.get("s")!.data.criteria as { budget: number }).budget, 80);
  assert.equal(store.get("s")!.data["/criteria/budget"], 999);
});

test("pointer-key repair keeps unsafe, conflicting and literal source paths untouched", () => {
  const store = new SurfaceStore(basicCatalog);
  const data = JSON.parse('{"/__proto__/polluted":true,"/a/b":1,"/a/b/c":2,"/literal/path":"source"}');
  store.apply("vak_render", { surface: "s", data, nodes: [{ id: "root", type: "stack", children: ["one", "two", "code", "unsafe"] }, { id: "one", type: "text", props: { content: "{/a/b}" } }, { id: "two", type: "text", props: { content: "{/a/b/c}" } }, { id: "code", type: "code", props: { language: "text", code: "/literal/path" } }, { id: "unsafe", type: "text", props: { content: "{/__proto__/polluted}" } }] });
  assert.deepEqual(store.get("s")!.data, data);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
