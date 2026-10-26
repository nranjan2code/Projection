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
