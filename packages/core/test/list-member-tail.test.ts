import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Normalizer } from "../src/normalize.ts";
import { basicCatalog, SurfaceStore } from "../src/index.ts";

test("recorded encoded table rows retain records and move declared settings out of the list", () => {
  const call = JSON.parse(readFileSync(new URL("./fixtures/list-member-tail-4b-2026-10-26.json", import.meta.url), "utf8"));
  const store = new SurfaceStore(basicCatalog);
  store.apply("vak_render", { surface: "example_domain_evidence", nodes: [{ id: "root", type: "stack" }] });
  store.apply(call.name, JSON.parse(call.arguments));
  const table = store.get("example_domain_evidence")!.nodes.get("evidence_table")!;
  assert.equal((table.props!.rows as unknown[]).length, 2);
  assert.equal(table.props!.sortable, false);
  assert.equal(table.props!.searchable, false);
  assert.equal(table.props!.pageSize, 0);
  assert.equal((table.props!.rows as Record<string, unknown>[])[0]!.retrieved_at, "2026-10-26T07:58:50.456Z");
});

test("list-member repair is schema-scoped and preserves explicit settings and literal row values", () => {
  const normalizer = new Normalizer(basicCatalog);
  const prepared = normalizer.prepareProps("table", { columns: ["name"], rows: '[{"name":"One"}], "sortable":false', sortable: true }, "t");
  assert.deepEqual(prepared.rows, [{ name: "One" }]); assert.equal(prepared.sortable, true);
  assert.deepEqual(normalizer.prepareProps("table", { columns: ["name"], rows: '["sortable"]' }, "t").rows, ["sortable"]);
  const unknown = normalizer.prepareProps("table", { rows: '[{"name":"One"}], "unknown":false' }, "t");
  assert.equal(unknown.unknown, undefined);
  const invalid = normalizer.prepareProps("table", { rows: '[{"name":"One"}], "sortable":{}' }, "t");
  assert.equal(invalid.sortable, undefined);
  const code = '[{"name":"One"}], "sortable":false';
  assert.equal(normalizer.prepareProps("code", { code, language: "json" }, "c").code, code);
});
