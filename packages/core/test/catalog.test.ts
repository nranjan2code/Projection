import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog } from "../src/basic-catalog.ts";
import { CONSTRAINED_INSTRUCTIONS, narrow, systemPrompt, toInline, toolDefinitions } from "../src/catalog.ts";
import { SurfaceStore } from "../src/surface.ts";
import { validate } from "../src/schema.ts";

test("strict tool schema accepts a valid render and rejects bad props", () => {
  const [render] = toolDefinitions(basicCatalog, { mode: "strict" });
  const good = { surface: "s", nodes: [{ id: "root", type: "grid", props: { columns: 3, span: "full" }, children: ["a"] }, { id: "a", type: "stat", props: { label: "x", value: 1 } }] };
  assert.deepEqual(validate(render!.inputSchema, good), []);
  const bad = { surface: "s", nodes: [{ id: "root", type: "stat", props: { label: "x" } }] };
  assert.ok(validate(render!.inputSchema, bad).length > 0);
});

test("narrowing removes unsupported components from tools and prompt", () => {
  const telegram = narrow(basicCatalog, { target: "telegram", layout: "linear", streaming: "edit", markup: "html", components: { chart: "none" } });
  const names = (toolDefinitions(telegram)[0]!.inputSchema.properties!.nodes!.items!.anyOf ?? []).map((b) => b.properties!.type!.const);
  assert.ok(!names.includes("chart"));
  assert.ok(names.includes("card"));
  const prompt = systemPrompt(telegram, { target: "telegram", layout: "linear", streaming: "edit", markup: "html", maxFormFields: 5 });
  assert.match(prompt, /flattened in priority order/);
  assert.doesNotMatch(prompt, /- chart:/);
});

test("prompt lists props with required markers", () => {
  const prompt = systemPrompt(basicCatalog);
  assert.match(prompt, /- stat: Single KPI\. props: label\*: string, value\*: string\|number/);
  assert.match(prompt, /Common props on every node: span/);
});

test("every catalog example renders with no diagnostics at all", async () => {
  const { SurfaceStore } = await import("../src/surface.ts");
  assert.ok(basicCatalog.examples.length >= 3);
  for (const ex of basicCatalog.examples) {
    const store = new SurfaceStore(basicCatalog);
    assert.deepEqual(store.render(structuredClone(ex.render)), [], ex.request);
  }
});

test("core tier drops extended components but keeps the container and fitting examples", async () => {
  const { withTier } = await import("../src/catalog.ts");
  const core = withTier(basicCatalog, "core");
  assert.ok(!("split" in core.components) && !("image" in core.components));
  assert.ok("stack" in core.components && "chart" in core.components);
  assert.equal(core.examples.length, basicCatalog.examples.length);
  const prompt = systemPrompt(core, undefined, { examples: true });
  assert.match(prompt, /Examples of good vak_render arguments/);
  assert.doesNotMatch(systemPrompt(core), /Examples of good/);
});

test("inline authoring: schema accepts nested children, prompt and examples teach it", () => {
  const [flat] = toolDefinitions(basicCatalog, { mode: "strict" });
  const [inline] = toolDefinitions(basicCatalog, { mode: "strict", authoring: "inline" });
  const nested = { surface: "s", nodes: [{ id: "root", type: "stack", children: [{ id: "a", type: "text", props: { text: "hi" } }] }] };
  assert.ok(validate(flat!.inputSchema, nested).length > 0);
  assert.deepEqual(validate(inline!.inputSchema, nested), []);
  const prompt = systemPrompt(basicCatalog, undefined, { examples: true, authoring: "inline" });
  assert.match(prompt, /directly inside its parent/);
  assert.doesNotMatch(prompt, /FLAT list/);
});

test("toInline nests every non-template child and renders the same surface as flat", () => {
  for (const ex of basicCatalog.examples) {
    const inline = toInline(ex.render);
    const templates = new Set(ex.render.nodes.flatMap((n) => (n.children && !Array.isArray(n.children) ? [n.children.template] : [])));
    assert.equal(inline.nodes.length, 1 + templates.size, ex.request);
    const a = new SurfaceStore(basicCatalog);
    const b = new SurfaceStore(basicCatalog);
    a.render(ex.render);
    b.render(inline);
    assert.deepEqual(b.snapshot(ex.render.surface), a.snapshot(ex.render.surface), ex.request);
  }
});

// The 4B component recordings put step states in children, omitted places,
// double-escaped source and dropped table units. The compact tool path relies
// on this prompt: nested field names alone hid the actual item contract.
test("compact prompt exposes rich item contracts and literal source fidelity", () => {
  const prompt = systemPrompt(basicCatalog, undefined, { authoring: "inline" });
  const steps = prompt.split("\n").find((s) => s.startsWith("- steps:"))!;
  assert.match(steps, /title\*: string/);
  assert.match(steps, /status: done\|current\|todo\|skipped\|failed/);
  assert.match(prompt, /Formatting displayed currency or percentages must not change the numeric values stored in data/);
  assert.match(prompt, /literal source, copy exactly; no ANSI, fences or extra escaping/);
  assert.match(prompt, /Preserve all user-supplied items, labels, order and values exactly/);
  assert.match(toolDefinitions(basicCatalog, { mode: "compact", authoring: "inline" })[0]!.description, /child node objects directly/);
  assert.doesNotMatch(toolDefinitions(basicCatalog, { authoring: "inline" })[0]!.description, /flat list/);
});

test("presentation choice belongs to the caller rather than a forced layout recipe", () => {
  // Vakyartha, 2026-10-26: qwen3.5:4b-mlx rendered a "greeting" surface for "hello" and
  // ignored "Plain text only" once the chat held surfaces; the prompt only said when to prefer UI.
  const prompt = systemPrompt(basicCatalog);
  assert.match(prompt, /Choose whether to use UI from the user's request and caller instructions/);
  assert.doesNotMatch(prompt, /Layout: compose real layouts|Prefer UI over long prose/);
  assert.match(prompt, /Existing surfaces do not require another render/);
  assert.match(CONSTRAINED_INSTRUCTIONS, /null when the reply is conversation or a short plain answer/);
});

test("inline child objects declare identity; correction children use existing IDs", () => {
  const [render, update] = toolDefinitions(basicCatalog, { mode: "strict", authoring: "inline" });
  const child = { id: "field", type: "input", props: { label: "Amount", bind: "/amount" } };
  const call = { surface: "s", nodes: [{ id: "root", type: "form", children: [child] }] };
  assert.deepEqual(validate(render!.inputSchema, call), []);
  assert.ok(validate(render!.inputSchema, { ...call, nodes: [{ ...call.nodes[0], children: [{ children: [child] }] }] }).length);
  assert.ok(validate(render!.inputSchema, { ...call, nodes: [{ ...call.nodes[0], children: JSON.stringify([child]) }] }).length);
  assert.deepEqual(validate(update!.inputSchema, { surface: "s", nodes: [{ id: "root", children: ["field"] }] }), []);
  assert.ok(validate(update!.inputSchema, { surface: "s", nodes: [{ id: "root", children: [child] }] }).length);
});

test("table authoring distinguishes automatic column sums from custom summary rows", () => {
  assert.match(systemPrompt(basicCatalog), /custom summary row.*totals: false/);
});

test("input guidance leaves unknown facts blank instead of inventing initial values", () => {
  assert.match(systemPrompt(basicCatalog), /Leave unspecified input values blank/);
});

test("correction guidance distinguishes omission, node removal and data deletion", () => {
  const prompt = systemPrompt(basicCatalog);
  assert.match(prompt, /delete a node use vak_remove/);
  assert.match(prompt, /delete stored values use data JSON Patch remove ops/);
  assert.match(prompt, /Omitting a field from merged data never deletes it/);
});
