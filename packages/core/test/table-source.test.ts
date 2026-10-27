import { test } from "node:test";
import assert from "node:assert/strict";
import { basicCatalog, compileSourceTable, prepareSubmission, validateTableSources, type TableSources } from "../src/index.ts";
const sources: TableSources = { selected: { filename: "items.csv", sha256: "a".repeat(64), columns: ["item", "quantity", "cost"], rows: [["A", 3, 12], ["B", 2, 17]] } };
const plan = { source: "selected", derive: [{ key: "line_total", expression: { op: "multiply", args: [{ column: "quantity" }, { column: "cost" }] } }], summary: [
  { key: "total", expression: { sum: "line_total" } },
  { key: "budget", expression: { parameter: "/criteria/budget" } },
  { key: "remaining", expression: { op: "subtract", args: [{ parameter: "/criteria/budget" }, { sum: "line_total" }] } },
  { key: "within", expression: { op: "lte", args: [{ sum: "line_total" }, { parameter: "/criteria/budget" }] } },
], total: { label: "Total", sumColumns: ["line_total"], otherCells: "Not applicable" }, searchable: true, sortable: true };
test("source references compile exact facts and arithmetic independently of model-authored cells", () => {
  const before = structuredClone(sources);
  const table = compileSourceTable(plan, sources, { "/criteria/budget": 100 });
  assert.deepEqual(table.props.columns, ["item", "quantity", "cost", "line_total"]);
  assert.deepEqual(table.props.rows, [["A", 3, 12, 36], ["B", 2, 17, 34], ["Total", "Not applicable", "Not applicable", 70]]);
  assert.deepEqual(table.data.summary, { total: 70, budget: 100, remaining: 30, within: true });
  assert.deepEqual(sources, before);
  const changed = compileSourceTable(plan, sources, { "/criteria/budget": 50 });
  assert.deepEqual(changed.data.summary, { total: 70, budget: 50, remaining: -20, within: false });
});
test("source-backed tables and visible summary bindings share one canonical candidate", () => {
  const candidate = prepareSubmission(basicCatalog, [], { surfaces: [{ op: "replace", root: { type: "stack", children: [
    { type: "text", props: { content: "Total {/sources/selected/summary/total}; remaining {/sources/selected/summary/remaining}. Source {/sources/selected/filename}" } },
    { type: "table", props: plan },
  ] }, data: {} }] }, { sources, parameters: { "/criteria/budget": 100 } });
  assert.deepEqual(candidate.issues, []);
  const root = candidate.store!.resolve("__vak_surface_1")!.root!;
  assert.equal(root.children[0]!.props.content, "Total 70; remaining 30. Source items.csv");
  assert.deepEqual(root.children[1]!.children.at(-1)!.props.rows, [["A", 3, 12, 36], ["B", 2, 17, 34], ["Total", "Not applicable", "Not applicable", 70]]);
});
test("source-backed facts cannot be replaced by authored values, source-column redefinitions or unsafe arithmetic", () => {
  for (const props of [
    { ...plan, source: "unknown" }, { ...plan, derive: [{ key: "cost", expression: { column: "cost" } }] },
    { ...plan, derive: [{ key: "new", expression: { op: "divide", args: [{ column: "quantity" }, { parameter: "zero" }] } }] },
    { ...plan, derive: [{ key: "new", expression: { column: "unknown" } }] },
  ]) assert.throws(() => compileSourceTable(props, sources, { zero: 0, "/criteria/budget": 100 }));
  const candidate = prepareSubmission(basicCatalog, [], { surfaces: [{ op: "replace", root: { type: "table", props: plan }, data: { sources: { selected: { summary: { total: 999 } } } } }] }, { sources, parameters: { "/criteria/budget": 100 } });
  assert.ok(candidate.issues.some((issue) => issue.includes("immutable"))); assert.equal(candidate.store, undefined);
  assert.throws(() => validateTableSources({ bad: { ...sources.selected!, rows: [["short"]] } }));
});

test("caller parameters cannot be revised by model-authored control defaults", () => {
  const value = { surfaces: [{ op: "replace", root: { type: "form", props: { submit: "apply", parameters: ["/criteria/budget"] } }, data: { criteria: { budget: 999 } } }] };
  const result = prepareSubmission(basicCatalog, [], value, { sources, parameters: { "/criteria/budget": 100 } });
  assert.ok(result.issues.some((issue) => /cannot override|cannot revise/.test(issue))); assert.equal(result.store, undefined);
});

test("numeric caller parameters produce numeric controls without changing their values", () => {
  const result = prepareSubmission(basicCatalog, [], { surfaces: [{ op: "replace", root: { type: "form", props: { submit: "apply", parameters: ["/criteria/budget"] } }, data: { criteria: { budget: 100 } } }] }, { sources, parameters: { "/criteria/budget": 100 } });
  assert.deepEqual(result.issues, []);
  assert.equal(result.store!.resolve("__vak_surface_1")!.root!.children[0]!.props.kind, "number");
});

test("one selected total drives a factual budget explanation without another authored formula", () => {
  const compiled = compileSourceTable({ ...plan, summary: [], comparisons: [{ parameter: "/criteria/budget", relation: "at_most", label: "Total cost" }] }, sources, { "/criteria/budget": 100 });
  assert.match(compiled.data.explanation, /Total cost: 70/);
  assert.match(compiled.data.explanation, /Available budget: 100/);
  assert.match(compiled.data.explanation, /Remaining budget: 30/);
  assert.match(compiled.data.explanation, /Within budget: yes/);
  assert.throws(() => compileSourceTable({ ...plan, comparisons: [{ column: "cost", parameter: "/criteria/budget", relation: "at_most" }] }, sources, { "/criteria/budget": 100 }));
});
