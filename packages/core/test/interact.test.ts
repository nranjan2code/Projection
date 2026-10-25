import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, cellValue, filterRows, formatLike, pageRows, sortRows, SurfaceStore, tableInteraction, totalsRow } from "../src/index.ts";

test("cells read as numbers whatever the model wrote around them", () => {
  for (const [text, n] of [["$1,299", 1299], ["12.5%", 12.5], ["1.2k", 1200], ["(45)", -45], ["−3", -3], ["€ 12", 12], ["7 kg", 7], [42, 42]] as const) {
    assert.deepEqual(cellValue(text), { kind: "number", n }, String(text));
  }
  assert.equal(cellValue("2026-11-03").kind, "date");
  assert.equal(cellValue("Nov 3, 2026").kind, "date");
  assert.equal(cellValue("MacBook Air").kind, "text");
});

test("sorting: by value not by text, empty cells last, ties keep the model's order", () => {
  const cols = [{ key: "name" }, { key: "price" }];
  const rows = [
    { name: "B", price: "$999" },
    { name: "A", price: "$1,299" },
    { name: "C", price: "" },
    { name: "D", price: "$999" },
  ];
  assert.deepEqual(sortRows(rows, cols, "price", "asc").map((r) => r.name), ["B", "D", "A", "C"]);
  assert.deepEqual(sortRows(rows, cols, "price", "desc").map((r) => r.name), ["A", "B", "D", "C"]);
});

test("filtering matches every word across shown cells; paging clamps", () => {
  const cols = [{ key: "name" }, { key: "cpu" }];
  const rows = [{ name: "MacBook Air", cpu: "M2" }, { name: "ThinkPad", cpu: "Intel i5" }, { name: "Aspire", cpu: "Ryzen 5" }];
  assert.deepEqual(filterRows(rows, cols, "intel think").map((r) => r.name), ["ThinkPad"]);
  assert.deepEqual(pageRows([1, 2, 3, 4, 5], 9, 2), { rows: [5], page: 2, pages: 3 });
});

test("projectors offer sorting, a filter and paging by size unless the model says otherwise", () => {
  assert.deepEqual(tableInteraction({}, 3), { sortable: true, searchable: false, pageSize: 0 });
  assert.deepEqual(tableInteraction({}, 40), { sortable: true, searchable: true, pageSize: 20 });
  assert.deepEqual(tableInteraction({ sortable: false, pageSize: 0 }, 40), { sortable: false, searchable: true, pageSize: 0 });
});

test("totals keep each column's format; text and percentage columns are not summed", () => {
  const cols = [{ key: "item" }, { key: "cost" }, { key: "growth" }];
  const rows = [{ item: "Rent", cost: "$1,200.00", growth: "12%" }, { item: "Food", cost: "$800.50", growth: "-4%" }];
  assert.deepEqual(totalsRow(rows, cols), { item: "Total", cost: "$2,000.50" });
  assert.equal(formatLike("1.5k", 4200), "4.2k");
  // A numeric first column (years) is the label column, not a sum.
  assert.deepEqual(totalsRow([{ year: "2024", sales: "10" }, { year: "2025", sales: "15" }], [{ key: "year" }, { key: "sales" }]), { year: "Total", sales: "25" });
});

// A small model asked for a budget with a total often adds up wrong; with
// totals: true the engine's sum replaces the row it wrote.
test("a total row the model wrote itself is replaced by the computed one", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({
    surface: "b",
    nodes: [
      {
        id: "root",
        type: "table",
        props: {
          columns: ["Item", "Cost"],
          totals: true,
          rows: [
            { item: "Rent", cost: "$1,200" },
            { item: "Food", cost: "$800" },
            { item: "Total", cost: "$1,900" },
          ],
        },
      },
    ],
  });
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const props = store.resolve("b")!.root!.props;
  assert.equal(props.totalsRow, true);
  assert.deepEqual((props.rows as object[]).at(-1), { item: "Total", cost: "$2,000" });
  assert.equal((props.rows as object[]).length, 3);
});
