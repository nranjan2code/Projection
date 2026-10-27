import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, prepareSubmission, submissionTool, validate } from "../src/index.ts";

const form = { op: "replace", surface: "criteria", data: { budget: 18 }, root: { type: "form", props: { submit: "apply" }, children: [{ type: "input", props: { label: "Budget", kind: "number", bind: "/budget" } }] } };
const report = { op: "replace", surface: "report", root: { type: "table", props: { columns: ["name", "value"], rows: [{ name: "One", value: 9 }] } } };
test("inline submission compiles identities without changing facts or canonical state", () => {
  const current = new SurfaceStore(basicCatalog);
  const candidate = prepareSubmission(basicCatalog, [], { surfaces: [form, report] });
  assert.deepEqual(candidate.issues, []);
  assert.equal(current.list().length, 0);
  const store = candidate.store!;
  assert.deepEqual(store.snapshot("criteria")!.nodes.map((node) => node.id), ["root", "__vak_0_0"]);
  assert.deepEqual(store.snapshot("criteria")!.data, { budget: 18 });
  assert.equal(store.submit("criteria", "root").action?.data.budget, 18);
  assert.deepEqual(store.resolve("report")!.root!.props.rows, [{ name: "One", value: 9 }]);
  assert.deepEqual(validate(submissionTool(basicCatalog).inputSchema, { surfaces: [form, report] }), []);
});
test("submitted patches preserve unchanged surfaces and use canonical merge/deletion semantics", () => {
  const first = prepareSubmission(basicCatalog, [], { surfaces: [form, report] }).store!;
  const snapshots = first.list().map((surface) => first.snapshot(surface.id)!);
  const revised = prepareSubmission(basicCatalog, snapshots, { surfaces: [{ op: "patch", surface: "report", nodes: [{ id: "root", props: { rows: [{ name: "One", value: 12 }] } }] }] }).store!;
  assert.deepEqual(revised.snapshot("criteria"), first.snapshot("criteria"));
  assert.equal((revised.resolve("report")!.root!.props.rows as { value: number }[])[0]!.value, 12);
  assert.equal((first.resolve("report")!.root!.props.rows as { value: number }[])[0]!.value, 9);
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
  const { surface, ...newReport } = report;
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
