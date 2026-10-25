import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog } from "../src/basic-catalog.ts";
import { defineCatalog, toolDefinitions } from "../src/catalog.ts";
import { Normalizer } from "../src/normalize.ts";

const n = new Normalizer(basicCatalog);

test("alias collisions across components are a catalog error", () => {
  const bad = defineCatalog("bad", {
    a: { description: "", props: { type: "object" }, aliases: ["box"], children: true },
    b: { description: "", props: { type: "object" }, aliases: ["Box"] },
  });
  assert.throws(() => new Normalizer(bad), /"Box" names both "a" and "b"/);
});

test("an alias can never shadow a real component name", () => {
  const c = defineCatalog("c", {
    card: { description: "", props: { type: "object" }, children: true },
    tile: { description: "", props: { type: "object" }, aliases: ["card"] },
  });
  assert.throws(() => new Normalizer(c), /names both "card" and "tile"/);
});

test("type resolution: names, aliases with presets, namespaces, compound tokens", () => {
  assert.deepEqual(n.resolveType("Card"), { type: "card" });
  assert.deepEqual(n.resolveType("row"), { type: "stack", presets: { direction: "horizontal" } });
  assert.deepEqual(n.resolveType("ui/Card"), { type: "card" });
  assert.equal(n.resolveType("RevenueBarChart")?.type, "chart");
  assert.equal(n.resolveType("TextInputField")?.type, "input");
  assert.equal(n.resolveType("hologram"), undefined);
});

test("inference scores props against schemas, with the id as a hint", () => {
  assert.equal(n.inferType({ columns: [], rows: [] }, { hasChildren: false })?.type, "table");
  assert.equal(n.inferType({ label: "Users", value: 3 }, { hasChildren: false })?.type, "stat");
  assert.equal(n.inferType({ label: "Email", bind: "/e" }, { hasChildren: false })?.type, "input");
  assert.equal(n.inferType({ label: "Plan", bind: "/p", options: ["a"] }, { hasChildren: false })?.type, "select");
  assert.equal(n.inferType({}, { hasChildren: true })?.type, "stack");
  assert.equal(n.inferType({ title: "x" }, { id: "hotel_card", hasChildren: false })?.type, "card");
  assert.equal(n.inferType({ zzz: 1 }, { hasChildren: false }), undefined);
});

test("props: aliases renamed, enum spellings fixed, derived and schema defaults applied", () => {
  assert.deepEqual(n.prepareProps("input", { name: "/form/email" }, "x"), { bind: "/form/email", label: "Email" });
  assert.deepEqual(n.prepareProps("chart", { data: [3, 4] }, "c"), { series: [{ values: [3, 4] }], kind: "bar" });
  assert.equal(n.prepareProps("alert", { tone: "Error" }, "a").tone, "danger");
  assert.deepEqual(n.prepareProps("button", { text: "Book now" }, "b"), { label: "Book now", action: "book_now" });
  // No invented content: a stat without a value stays invalid for the model to fix.
  assert.equal(n.prepareProps("stat", { label: "Users" }, "s").value, undefined);
});

test("tool schemas sent to providers carry no extension keywords", () => {
  const wire = JSON.stringify(toolDefinitions(basicCatalog, { mode: "strict" }));
  assert.doesNotMatch(wire, /"aliases"|"enumAliases"|"namesComponent"|"literal"/);
});

test("an invalid declared type yields to the component its props describe", () => {
  assert.deepEqual(n.reinterpret({ type: "text" }, { bind: "/f/freq", placeholder: "Weekly?" }, { id: "f", hasChildren: false }), { type: "input" });
  // Presets from the alias that matched are not evidence; real prop names outweigh aliases.
  assert.deepEqual(n.reinterpret({ type: "text", presets: { variant: "caption" } }, { label: "X", bind: "/f/x" }, { id: "a", hasChildren: false }), { type: "input" });
  // Valid as declared: never second-guessed.
  assert.equal(n.reinterpret({ type: "text" }, { content: "hi", bind: "/x" }, { id: "t", hasChildren: false }), undefined);
});

test("alias renames only apply when the value fits the property", () => {
  // `kind` is an alias of text.variant, but "number" is not a variant.
  assert.equal(n.prepareProps("text", { content: "x", kind: "number" }, "t").variant, undefined);
  assert.equal(n.prepareProps("text", { content: "x", kind: "heading" }, "t").variant, "heading");
});

test("table columns accept plain keys", () => {
  const p = n.prepareProps("table", { columns: ["product", "revenue"], rows: [] }, "t");
  assert.deepEqual(p.columns, ["product", "revenue"]);
});
