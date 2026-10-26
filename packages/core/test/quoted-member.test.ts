import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { basicCatalog, parseLenient, parsePartial, projectText, SurfaceStore, ToolCallStream } from "../src/index.ts";

// Verbatim calls 11/15 from local typed-comparison transcript 87cbf088 (2026-10-26).
const calls: { name: string; arguments: string }[] = JSON.parse(readFileSync(new URL("./fixtures/quoted-primitive-key-4b-2026-10-26.json", import.meta.url), "utf8"));

test("a missing key quote before a primitive preserves both recorded comparison rows", () => {
  for (const call of calls) {
    const store = new SurfaceStore(basicCatalog);
    store.apply("vak_render", { surface: "comparison_table", nodes: [{ id: "root", type: "table", props: { columns: ["option"], rows: [] } }] });
    store.apply(call.name, JSON.parse(call.arguments));
    const rows = store.resolve("comparison_table")!.root!.props.rows as Record<string, unknown>[];
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => [row.option, row.monthly_cost, row.seats, row.cost_per_seat, row.within_budget, row.enough_seats, row.meets_both]), [
      ["Atlas", 12, 4, 3, false, false, false], ["Birch", 18, 8, 2.25, true, true, true],
    ]);
    // Atlas's false budget claim is retained; repairing syntax does not verify facts.
    assert.match(projectText(store.resolve("comparison_table")!), /Atlas/);
  }
});

test("primitive key-quote recovery supports literals without accepting partial values", () => {
  assert.deepEqual(parseLenient('{"ok:true,"n:-1.25e2,"none:null,"next":7}'), { ok: true, n: -125, none: null, next: 7 });
  for (const malformed of ['{"ok:False}', '{"n:+.5}', '{"none:None}', '{"n:01}', '{"n:1e999}', '{"value:[1,2]}']) {
    const parsed = parseLenient(malformed) as Record<string, unknown>;
    assert.equal(Object.hasOwn(parsed, "ok") || Object.hasOwn(parsed, "n") || Object.hasOwn(parsed, "none") || Object.hasOwn(parsed, "value"), false);
  }
  assert.deepEqual(parsePartial('{"ok:fal').value, {});
  assert.deepEqual(parsePartial('{"n:12').value, {});
  assert.deepEqual(parsePartial('{"ok:false}').value, { ok: false });
});

test("valid quoted keys, source strings and ambiguous nonliteral values retain their reading", () => {
  const valid = { "flag:false, note": 7, "count:12}": 3, source: '{"flag:false}', "true": "false" };
  assert.deepEqual(parseLenient(JSON.stringify(valid)), valid);
  assert.equal(Object.hasOwn(parseLenient('{"note:tomorrow}') as object, "note"), false);
});

test("streaming the recorded call converges without losing a row", () => {
  const store = new SurfaceStore(basicCatalog), call = calls[1]!;
  const stream = new ToolCallStream(store, call.name);
  for (let i = 0; i < call.arguments.length; i += 11) stream.push(call.arguments.slice(i, i + 11));
  stream.end();
  const rows = store.resolve("comparison_table")!.root!.props.rows as Record<string, unknown>[];
  assert.deepEqual(rows.map((row) => row.option), ["Atlas", "Birch"]);
});
