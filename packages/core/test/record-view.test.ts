import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, prepareSubmission } from "../src/index.ts";

const nodes = [
  { id: "root", type: "stack", children: ["edit", "table", "chart", "metric"] },
  { id: "edit", type: "form", props: { submit: "review" }, children: ["value"] },
  { id: "value", type: "input", props: { label: "Reading", kind: "number", bind: "/records/0/value" } },
  { id: "table", type: "table", props: { columns: ["Label", "Reading"], rows: { records: "{/records}", fields: ["label", "value"] } } },
  { id: "chart", type: "chart", props: { kind: "bar", series: { records: "{/records}", label: "label", fields: ["value"] } } },
  { id: "metric", type: "stat", props: { label: "Total", value: { records: "{/records}", field: "value", aggregate: "sum" } } },
];
const data = { records: [{ label: "East", value: 9 }, { label: "West", value: 14 }] };
test("one authoritative collection drives form, table, chart and metric without copied values", () => {
  const store = new SurfaceStore(basicCatalog);
  const diagnostics = store.apply("vak_render", { surface: "one", nodes, data });
  assert.deepEqual(diagnostics.filter(d => d.severity === "error"), []);
  const check = (value: number) => {
    const children = store.resolve("one")!.root!.children;
    assert.deepEqual(children.find(n => n.id === "table")!.props.rows, [["East", value], ["West", 14]]);
    assert.deepEqual(children.find(n => n.id === "chart")!.props.series, [{ name: "value", values: [value, 14] }]);
    assert.deepEqual(children.find(n => n.id === "chart")!.props.labels, ["East", "West"]);
    assert.equal(children.find(n => n.id === "metric")!.props.value, value + 14);
  };
  check(9); store.setValue("one", "/records/0/value", 20); check(20);
  assert.equal(store.submit("one", "edit").action!.data.value, 20);
  const snapshot = store.snapshot("one")!;
  assert.deepEqual(snapshot.nodes.find(n => n.id === "chart")!.props!.series, nodes[4]!.props!.series);
  const restored = new SurfaceStore(basicCatalog); restored.load(snapshot);
  assert.deepEqual(restored.resolve("one"), store.resolve("one"));
  assert.deepEqual(data.records[0], { label: "East", value: 9 }, "resolution does not mutate caller facts");
});

test("record projections validate missing and nonnumeric values instead of inventing zero", () => {
  for (const value of [null, "14", "missing", Infinity]) {
    const store = new SurfaceStore(basicCatalog);
    const issues = store.apply("vak_render", { surface: "one", nodes, data: { records: [{ label: "East", value }, { label: "West", value: 14 }] } });
    assert.ok(issues.some(d => d.severity === "error" && d.message.includes("finite")), String(value));
  }
  const store = new SurfaceStore(basicCatalog);
  const issues = store.apply("vak_render", { surface: "one", nodes, data: { records: [{ label: "East" }] } });
  assert.ok(issues.some(d => d.severity === "error" && d.message.includes("no field")));
});

test("multiple series and scatter x values map declared fields without inference", () => {
  const store = new SurfaceStore(basicCatalog);
  const records = [{ name: "A", x: 1, first: 2, second: 3 }, { name: "B", x: 4, first: 5, second: 6 }];
  const issues = store.apply("vak_render", { surface: "plot", data: { records }, nodes: [{ id: "root", type: "chart", props: { kind: "scatter", series: { records: "{/records}", label: "name", fields: ["first", "second"], x: "x" } } }] });
  assert.deepEqual(issues.filter(d => d.severity === "error"), []);
  assert.deepEqual(store.resolve("plot")!.root!.props.series, [{ name: "first", values: [2, 5], x: [1, 4] }, { name: "second", values: [3, 6], x: [1, 4] }]);
});

test("transactional data edits update shared record views while independent surfaces stay unchanged", () => {
  const candidate = prepareSubmission(basicCatalog, [], { surfaces: [{ op: "replace", surface: "one", root: { type: "stack", children: [
    { type: "table", props: nodes[3]!.props }, { type: "chart", props: nodes[4]!.props }, { type: "stat", props: nodes[5]!.props },
  ] }, data }, { op: "replace", surface: "other", root: { type: "text", props: { content: "Independent" } }, data: {} }] });
  assert.deepEqual(candidate.issues, []);
  const store = candidate.store!, before = store.snapshot("other")!;
  const revised = prepareSubmission(basicCatalog, store.list().map(s => store.snapshot(s.id)!), { surfaces: [{ op: "patch", surface: "one", data: [{ op: "replace", path: "/records/1/value", value: 30 }] }] });
  assert.deepEqual(revised.issues, []);
  assert.equal(revised.store!.resolve("one")!.root!.children[2]!.props.value, 39);
  assert.deepEqual(revised.store!.snapshot("other"), before);
});

test("declared records exclude copied or empty view arrays before admission", () => {
  const dataSchema = { type: "object", additionalProperties: false, required: ["records"], properties: { records: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "number" } } } } } } as const;
  const create = (rows: unknown) => ({ surfaces: [{ op: "replace", root: { type: "table", props: { columns: ["Label", "Value"], rows } }, data }] });
  for (const rows of [[], [[9, 14]], [["East", 9], ["West", 14]]]) {
    assert.ok(prepareSubmission(basicCatalog, [], create(rows), { dataSchema }).issues.length, "retained copied/empty arrays must not be accepted");
  }
  assert.deepEqual(prepareSubmission(basicCatalog, [], create({ records: "{/records}", fields: ["label", "value"] }), { dataSchema }).issues, []);
  assert.ok(prepareSubmission(basicCatalog, [], create({ records: "{/records}", fields: ["label", "invented"] }), { dataSchema }).issues.length);
});

test("mapped tables retain ordinary explicitly requested totals semantics", () => {
  const store = new SurfaceStore(basicCatalog);
  const table = { ...nodes[3]!, id: "root", props: { ...nodes[3]!.props, totals: true } };
  const issues = store.apply("vak_render", { surface: "totals", nodes: [table], data });
  assert.deepEqual(issues.filter(d => d.severity === "error"), []);
  assert.deepEqual(store.resolve("totals")!.root!.props.rows, [["East", 9], ["West", 14], { Label: "Total", Reading: 23 }]);
});
