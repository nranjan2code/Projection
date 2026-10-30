import assert from "node:assert/strict";
import { test } from "node:test";

// Model-written props are loose JSON: series arrive as arrays or objects,
// numbers as strings, edges name nodes that do not exist. These normalizers
// are what the drawing code trusts, and they used to have no tests at all.
import { normalizeChart } from "../src/chart.ts";
import { normalizeDiagram, renderDiagram, normalizeGraph } from "../src/diagram.ts";
import { texToMathML } from "../src/math.ts";
import { fakeDoc, findAll } from "./dom.ts";

test("chart: an unknown kind falls back to bar and values become numbers", () => {
  const spec = normalizeChart({ kind: "hologram", series: [[1, "2", null], { name: "B", values: [3, Number.NaN] }] });
  assert.equal(spec.kind, "bar");
  assert.deepEqual(spec.series[0]!.values, [1, 2, 0]);
  assert.deepEqual(spec.series[1]!.values, [3, 0]);
  assert.equal(spec.series[1]!.name, "B");
});

test("chart: labels are padded to the longest series, and a pie keeps one series", () => {
  const spec = normalizeChart({ kind: "pie", labels: ["a"], series: [{ values: [1, 2, 3] }] });
  assert.deepEqual(spec.labels, ["a", "2", "3"]);
  assert.equal(spec.kind, "pie");
});

test("diagram: edges to unknown nodes are dropped, subgraphs normalized, and shapes preserved", () => {
  const spec = normalizeDiagram({
    nodes: [{ id: "a", shape: "pill" }, { id: "b", label: "Bee", shape: "diamond" }, "nonsense"],
    edges: [{ from: "a", to: "b" }, { from: "a", to: "missing" }, { from: "b", to: "b", label: "self" }],
    subgraphs: [{ id: "sg1", label: "Tier 1", nodes: ["a", "b"] }],
  });
  assert.deepEqual(spec.nodes.map((n) => n.label), ["a", "Bee"]);
  assert.deepEqual(spec.nodes.map((n) => n.shape), ["pill", "diamond"]);
  assert.deepEqual(spec.edges.map((e) => `${e.from}->${e.to}`), ["a->b", "b->b"]);
  assert.equal(spec.directed, true);
  assert.equal(spec.subgraphs?.length, 1);
  assert.deepEqual(spec.subgraphs[0]!.nodes, ["a", "b"]);
});

test("diagram: renders directed feedback loops without crashing into force layout", () => {
  const doc = fakeDoc();
  const spec = normalizeDiagram({
    nodes: [{ id: "goal" }, { id: "model" }, { id: "monitor" }],
    edges: [
      { from: "goal", to: "model" },
      { from: "model", to: "monitor" },
      { from: "monitor", to: "goal", label: "feedback loop" },
    ],
  });
  const el = renderDiagram(spec, doc as never);
  assert.ok(el);
  assert.ok(el.className.includes("diagram"));
});

test("math: a fraction becomes MathML with the source kept as alttext", () => {
  const doc = fakeDoc();
  const el = texToMathML("\\frac{1}{2}", true, doc);
  assert.equal(findAll(el, "mfrac").length, 1);
  assert.equal((el as unknown as { getAttribute(n: string): string | null }).getAttribute("alttext"), "\\frac{1}{2}");
});
