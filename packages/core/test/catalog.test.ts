import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog } from "../src/basic-catalog.ts";
import { narrow, systemPrompt, toolDefinitions } from "../src/catalog.ts";
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
