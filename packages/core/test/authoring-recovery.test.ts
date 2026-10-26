import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { basicCatalog, parseLenient, projectText, SurfaceStore, ToolCallStream } from "../src/index.ts";

// Verbatim calls from the retained 2026-10-26 local comparison (44866792).
const calls: { sequence: number; name: string; arguments: string }[] = JSON.parse(readFileSync(new URL("./fixtures/local-authoring-4b-2026-10-26.json", import.meta.url), "utf8"));

test("keyless property fragments stay on their node instead of becoming additional inputs", () => {
  for (const call of calls.filter((c) => [6, 8, 10].includes(c.sequence))) {
    const store = new SurfaceStore(basicCatalog), args = JSON.parse(call.arguments);
    const diags = store.apply(call.name, args);
    assert.equal(diags.some((d) => d.severity === "error"), false, JSON.stringify(diags));
    const inputs = [...store.get(args.surface)!.nodes.values()].filter((node) => node.type === "input");
    assert.equal(inputs.length, 2);
    assert.ok(inputs.every((input) => typeof input.props?.placeholder === "string"));
    assert.doesNotMatch(projectText(store.resolve(args.surface)!), /Input \d/);
  }
});

test("keyless fragments need an extra closer, noncolliding keys and an object-valued previous member", () => {
  assert.deepEqual(parseLenient('[{"id":"a","props":{"label":"A"},{"placeholder":"hint"}}, {"id":"b","type":"text"}]'), [{ id: "a", props: { label: "A" }, placeholder: "hint" }, { id: "b", type: "text" }]);
  assert.deepEqual(parseLenient('[{"id":"a","props":{}, {"id":"b","type":"text"}}]'), [{ id: "a", props: {} }, { id: "b", type: "text" }]);
  assert.deepEqual(parseLenient('[{"id":"a","props":{}}, {"placeholder":"standalone"}]'), [{ id: "a", props: {} }, { placeholder: "standalone" }]);
  assert.deepEqual(parseLenient('[{"id":"a","props":{}, {"name":"b"}]'), [{ id: "a", props: {} }, { name: "b" }]);
});

test("a stringified list-wrapped binding retains real rows and follows subsequent data updates", () => {
  const call = calls.find((c) => c.sequence === 2)!, args = JSON.parse(call.arguments), store = new SurfaceStore(basicCatalog);
  store.apply(call.name, args);
  assert.equal(store.get(args.surface)!.nodes.get("root")!.props?.rows, "{/data/options}");
  const rows = store.resolve(args.surface)!.root!.props.rows;
  assert.deepEqual(rows, args.nodes[0].data.options);
  // The recorded wrong values must remain wrong, not be silently rewritten.
  assert.equal((rows as Record<string, unknown>[])[0]!.monthly_cost, "1200");
  store.apply("vak_update", { surface: args.surface, data: { options: [{ name: "Changed", monthly_cost: 7 }] } });
  assert.deepEqual(store.resolve(args.surface)!.root!.props.rows, [{ name: "Changed", monthly_cost: 7 }]);
});

test("wrapped explicit bindings diagnose missing/scalar data and leave literal source/cell arrays alone", () => {
  const table = (rows: unknown) => ({ id: "root", type: "table", props: { columns: ["Value"], rows } });
  for (const data of [{}, { missing: 3 }]) {
    const store = new SurfaceStore(basicCatalog);
    const diags = store.apply("vak_render", { surface: "t", nodes: [table("[{/missing}]")], data });
    assert.ok(diags.some((d) => d.severity === "error"));
  }
  const store = new SurfaceStore(basicCatalog);
  store.apply("vak_render", { surface: "t", nodes: [table([["/missing"]])], data: { missing: ["x"] } });
  assert.deepEqual(store.get("t")!.nodes.get("root")!.props?.rows, [["/missing"]]);
  store.apply("vak_render", { surface: "code", nodes: [{ id: "root", type: "code", props: { code: "[{/missing}]" } }], data: { missing: ["x"] } });
  assert.equal(store.resolve("code")!.root!.props.code, "[{/missing}]");
});

test("streamed malformed property fragments converge to the same canonical inputs", () => {
  const call = calls.find((c) => c.sequence === 8)!, store = new SurfaceStore(basicCatalog);
  const stream = new ToolCallStream(store, call.name);
  for (let i = 0; i < call.arguments.length; i += 13) stream.push(call.arguments.slice(i, i + 13));
  stream.end();
  assert.equal([...store.get("criteria-form-surf")!.nodes.values()].filter((node) => node.type === "input").length, 2);
});

test("correction updates retain initialized data while explicit render replacements keep replacement semantics", () => {
  const call = calls.find((c) => c.sequence === 7)!, args = JSON.parse(call.arguments), store = new SurfaceStore(basicCatalog);
  store.apply(call.name, args);
  const rows = structuredClone(store.resolve(args.surface)!.root!.props.rows);
  store.apply("vak_update", { surface: args.surface, nodes: [{ id: "root", props: { searchable: true } }] });
  assert.deepEqual(store.resolve(args.surface)!.root!.props.rows, rows);
  store.apply("vak_render", { ...args, data: { options_data: [] } });
  assert.deepEqual(store.resolve(args.surface)!.root!.props.rows, []);
});
