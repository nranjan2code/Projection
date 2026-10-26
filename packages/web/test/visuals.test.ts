import assert from "node:assert/strict";
import { test } from "node:test";

// Model-written props are loose JSON: series arrive as arrays or objects,
// numbers as strings, edges name nodes that do not exist. These normalizers
// are what the drawing code trusts, and they used to have no tests at all.
import { normalizeChart } from "../src/chart.ts";
import { normalizeGraph } from "../src/graph.ts";
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

test("graph: edges to unknown nodes are dropped and labels fall back to ids", () => {
  const spec = normalizeGraph({
    nodes: [{ id: "a" }, { id: "b", label: "Bee" }, "nonsense"],
    edges: [{ from: "a", to: "b" }, { from: "a", to: "missing" }, { from: "b", to: "b", label: "self" }],
  });
  assert.deepEqual(spec.nodes.map((n) => n.label), ["a", "Bee"]);
  assert.deepEqual(spec.edges.map((e) => `${e.from}->${e.to}`), ["a->b", "b->b"]);
  assert.equal(spec.directed, true);
});

test("math: a fraction becomes MathML with the source kept as alttext", () => {
  const doc = fakeDoc();
  const el = texToMathML("\\frac{1}{2}", true, doc);
  assert.equal(findAll(el, "mfrac").length, 1);
  assert.equal((el as unknown as { getAttribute(n: string): string | null }).getAttribute("alttext"), "\\frac{1}{2}");
});
