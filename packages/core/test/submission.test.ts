import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, prepareSubmission, submissionTool, validate, type JSONSchema } from "../src/index.ts";

const form = { op: "replace", surface: "criteria", data: { budget: 18 }, root: { type: "form", props: { submit: "apply" }, children: [{ type: "input", props: { label: "Budget", kind: "number", bind: "/budget" } }] } };
const report = { op: "replace", surface: "report", root: { type: "table", props: { columns: ["name", "value"], rows: [["One", 9]] } } };
const dataSchema: JSONSchema = { type: "object", additionalProperties: false, required: ["value"], properties: { value: { type: "number" } } };

test("caller data paths and types are enforced before publication without coercing facts", () => {
  // Retained primary-provider 2026-10-27T04-47-06.771Z used data['/']
  // instead of the required data.value; earlier receipts used numeric strings.
  const create = (data: unknown) => ({ surfaces: [{ op: "replace", surface: "one", root: { type: "text", props: { content: "3" } }, data }] });
  const schema = submissionTool(basicCatalog, [], {}, {}, dataSchema).inputSchema;
  for (const data of [{ "/": 3 }, { value: "3" }, {}, { value: 3, extra: 9 }]) {
    assert.ok(validate(schema, create(data)).length);
    const candidate = prepareSubmission(basicCatalog, [], create(data), { dataSchema });
    assert.ok(candidate.issues.length); assert.equal(candidate.store, undefined);
    assert.deepEqual(create(data).surfaces[0]!.data, data);
  }
  const accepted = prepareSubmission(basicCatalog, [], create({ value: 3 }), { dataSchema });
  assert.deepEqual(accepted.issues, []);
  assert.deepEqual(accepted.store!.snapshot("one")!.data, { value: 3 });
});

test("data contracts validate complete patched state and retain canonical state on failure", () => {
  const first = prepareSubmission(basicCatalog, [], { surfaces: [{ op: "replace", surface: "one", root: { type: "text", props: { content: "{/value}" } }, data: { value: 9 } }] }, { dataSchema }).store!;
  const before = first.snapshot("one")!;
  for (const data of [{ value: "12" }, [{ op: "remove", path: "/value" }]]) {
    const result = prepareSubmission(basicCatalog, [before], { surfaces: [{ op: "patch", surface: "one", data }] }, { dataSchema });
    assert.ok(result.issues.length); assert.equal(result.store, undefined);
    assert.deepEqual(first.snapshot("one"), before);
  }
  const result = prepareSubmission(basicCatalog, [before], { surfaces: [{ op: "patch", surface: "one", data: { value: 12 } }] }, { dataSchema });
  assert.deepEqual(result.issues, []);
  assert.equal(result.store!.resolve("one")!.root!.props.content, 12);
});

test("caller definitions cannot collide with recursive component definitions", () => {
  const caller: JSONSchema = { type: "object", required: ["value"], properties: { value: { $ref: "#/$defs/vak_node" } }, $defs: { vak_node: { type: "number" } } };
  const schema = submissionTool(basicCatalog, [], {}, {}, caller).inputSchema;
  const create = (value: unknown) => ({ surfaces: [{ op: "replace", root: { type: "text", props: { content: "Value" } }, data: { value } }] });
  assert.deepEqual(validate(schema, create(12)), []);
  assert.ok(validate(schema, create("12")).length);
  assert.deepEqual(prepareSubmission(basicCatalog, [], create(12), { dataSchema: caller }).issues, []);
  assert.throws(() => submissionTool(basicCatalog, [], {}, {}, { type: "array" }), /must describe an object/);
});
test("inline submission compiles identities without changing facts or canonical state", () => {
  const current = new SurfaceStore(basicCatalog);
  const candidate = prepareSubmission(basicCatalog, [], { surfaces: [form, report] });
  assert.deepEqual(candidate.issues, []);
  assert.equal(current.list().length, 0);
  const store = candidate.store!;
  assert.deepEqual(store.snapshot("criteria")!.nodes.map((node) => node.id), ["root", "__vak_0_0"]);
  assert.deepEqual(store.snapshot("criteria")!.data, { budget: 18 });
  assert.equal(store.submit("criteria", "root").action?.data.budget, 18);
  assert.deepEqual(store.resolve("report")!.root!.props.rows, [["One", 9]]);
  assert.deepEqual(validate(submissionTool(basicCatalog).inputSchema, { surfaces: [form, report] }), []);
});
test("submitted patches preserve unchanged surfaces and use canonical merge/deletion semantics", () => {
  const first = prepareSubmission(basicCatalog, [], { surfaces: [form, report] }).store!;
  const snapshots = first.list().map((surface) => first.snapshot(surface.id)!);
  const revised = prepareSubmission(basicCatalog, snapshots, { surfaces: [{ op: "patch", surface: "report", nodes: [{ id: "root", props: { rows: [["One", 12]] } }] }] }).store!;
  assert.deepEqual(revised.snapshot("criteria"), first.snapshot("criteria"));
  assert.equal((revised.resolve("report")!.root!.props.rows as unknown[][])[0]![1], 12);
  assert.equal((first.resolve("report")!.root!.props.rows as unknown[][])[0]![1], 9);
  assert.deepEqual(prepareSubmission(basicCatalog, snapshots, { surfaces: [{ op: "remove", surface: "report" }] }).store!.list().map((surface) => surface.id), ["criteria"]);
  assert.ok(prepareSubmission(basicCatalog, snapshots, { surfaces: [{ op: "remove", surface: "criteria", ids: ["__vak_0_0"] }] }).issues.length === 0);
});
test("inline collection templates and literal source survive compilation", () => {
  const code = 'const x = {a: "{unbound}"};';
  const candidate = prepareSubmission(basicCatalog, [], { surfaces: [{ op: "replace", surface: "collection", data: { items: ["One", "Two"] }, root: { type: "stack", children: [{ type: "stack", children: { each: "/items", template: { type: "text", props: { content: "{.}" } } } }, { type: "code", props: { code } }] } }] });
  assert.deepEqual(candidate.issues, []);
  const root = candidate.store!.resolve("collection")!.root!;
  assert.deepEqual(root.children[0]!.children.map((node) => node.props.content), ["One", "Two"]);
  assert.equal(root.children[1]!.props.code, code);
});
test("invalid documents, duplicate targets, references and missing bindings cannot yield a candidate", () => {
  for (const value of [
    { surfaces: [] }, { surfaces: [form, form] },
    { surfaces: [{ op: "patch", surface: "absent", nodes: [] }] },
    { surfaces: [{ ...report, root: { type: "stack", children: ["missing"] } }] },
    { surfaces: [{ ...report, root: { type: "stack", children: [{ id: "same", type: "text" }, { id: "same", type: "text" }] } }] },
    { surfaces: [{ ...report, root: { type: "stack", children: [{ id: "__vak_0_0", type: "text" }] } }] },
    { surfaces: [{ ...report, root: { type: "text", props: { content: "{/absent}" } } }] },
    { surfaces: [{ ...report, root: { type: "stack", children: [{ type: "unknown" }] } }] },
    { surfaces: [{ ...report, root: { type: "text", props: "serialized" } }] },
  ]) {
    const candidate = prepareSubmission(basicCatalog, [], value);
    assert.ok(candidate.issues.length, JSON.stringify(value)); assert.equal(candidate.store, undefined);
  }
  let root: unknown = { type: "text", props: { content: "Leaf" } };
  for (let i = 0; i < 34; i++) root = { type: "stack", children: [root] };
  assert.ok(prepareSubmission(basicCatalog, [], { surfaces: [{ ...report, root }] }).issues.some((issue) => /32 tree levels|128 levels/.test(issue)));
});

test("state-aware submission schemas never offer nonexistent patch/remove targets", () => {
  const fresh = submissionTool(basicCatalog, []).inputSchema;
  assert.ok(validate(fresh, { surfaces: [{ op: "patch", surface: "invented", data: {} }] }).length);
  const newReport = { op: "replace", root: { type: "table", props: { columns: ["name", "value"], rows: [["One", 9]] } } };
  assert.equal(validate(fresh, { surfaces: [{ ...newReport, data: {} }] }).length, 0);
  const existing = submissionTool(basicCatalog, ["report"]).inputSchema;
  assert.equal(validate(existing, { surfaces: [{ op: "patch", surface: "report", data: {} }] }).length, 0);
  assert.ok(validate(existing, { surfaces: [{ op: "remove", surface: "invented" }] }).length);
});

test("new surface documents receive distinct identities without model bookkeeping", () => {
  const first = { op: "replace", root: { type: "text", props: { content: "One" } } };
  const second = { op: "replace", root: { type: "text", props: { content: "Two" } } };
  const result = prepareSubmission(basicCatalog, [], { surfaces: [first, second] });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.store!.list().map((surface) => surface.id), ["__vak_surface_1", "__vak_surface_2"]);
  const current = result.store!.list().map((surface) => result.store!.snapshot(surface.id)!);
  const next = prepareSubmission(basicCatalog, current, { surfaces: [first] });
  assert.equal(next.store!.list().length, 3);
  assert.equal(next.store!.get("__vak_surface_3")!.nodes.get("root")!.props?.content, "One");
});

test("request schemas require a leaf's required props and a complete replacement data object", () => {
  const schema = submissionTool(basicCatalog, []).inputSchema;
  assert.ok(validate(schema, { surfaces: [{ op: "replace", root: { type: "text" }, data: {} }] }).length);
  assert.ok(validate(schema, { surfaces: [{ op: "replace", root: { type: "text", props: { content: "Visible" } } }] }).length);
  assert.equal(validate(schema, { surfaces: [{ op: "replace", root: { type: "text", props: { content: "Visible" } }, data: {} }] }).length, 0);
});


test("local schema references reject inherited names and remain depth bounded", () => {
  for (const name of ["constructor", "__proto__", "missing"]) assert.ok(validate({ $ref: `#/$defs/${name}`, $defs: {} }, "anything").length);
  assert.ok(validate({ $ref: "#/$defs/cycle", $defs: { cycle: { $ref: "#/$defs/cycle" } } }, {}).some((issue) => issue.message.includes("128 levels")));
});

test("table rows type their cells instead of admitting nested UI wrappers", () => {
  const schema = submissionTool(basicCatalog, []).inputSchema;
  const create = (rows: unknown[]) => ({ surfaces: [{ op: "replace", root: { type: "table", props: { columns: ["name", "cost"], rows } }, data: {} }] });
  assert.ok(validate(schema, create([{ name: "One", cost: 12 }])).length);
  assert.equal(validate(schema, create([["One", 12]])).length, 0);
  assert.ok(validate(schema, create([{ props: { name: "One", cost: 12 } }])).length);
});

test("retained complete report cannot encode row nodes in place of scalar cells", async () => {
  const { readFile } = await import("node:fs/promises");
  const value = JSON.parse(await readFile(new URL("./fixtures/transaction-row-wrappers-2026-10-27.json", import.meta.url), "utf8"));
  const issues = validate(submissionTool(basicCatalog, []).inputSchema, value);
  assert.ok(issues.some((issue) => issue.path.includes("rows")));
  const data = value.surfaces[1].data.inventory_report.table_data;
  assert.equal(data.items[0].line_total, 36);
  assert.equal(data.totals.remaining_budget, 30);
});

test("bound table data obeys the positional authoring contract after resolution", () => {
  const candidate = { surfaces: [{ op: "replace", root: { type: "table", props: { columns: ["name", "value"], rows: "{/rows}" } }, data: { rows: [{ data: '{"name":"One","value":12}' }] } }] };
  assert.ok(prepareSubmission(basicCatalog, [], candidate).issues.some((issue) => issue.includes("expected array")));
  const good = { ...candidate, surfaces: [{ ...candidate.surfaces[0], data: { rows: [["One", 12]] } }] };
  assert.deepEqual(prepareSubmission(basicCatalog, [], good).issues, []);
});
