import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { basicCatalog, projectText, SurfaceStore, walk } from "../src/index.ts";

// Verbatim authoring calls from local task 1c82b092, 2026-10-26. A nested
// wrapper refers to root again; its table was valid but the branch was not.
const calls: { name: string; arguments: string }[] = JSON.parse(readFileSync(new URL("./fixtures/surface-cycle-4b-2026-10-26.json", import.meta.url), "utf8"));
test("a recorded ancestor cycle drops only the back edge without losing its table", () => {
  const store = new SurfaceStore(basicCatalog);
  const diagnostics = calls.flatMap((call) => store.apply(call.name, JSON.parse(call.arguments)));
  assert.ok(diagnostics.some((d) => d.severity === "warning" && d.message.includes("cyclic child")));
  assert.match(projectText(store.resolve("comparison_table")!), /Atlas/);
  walk(store.resolve("comparison_table")!.root!, (node) => assert.notEqual(node.error, "cycle"));
  assert.match(projectText(store.resolve("comparison_table")!), /Birch/);
});

test("shared sibling nodes are not ancestor cycles, while self references are removed", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply("vak_render", { surface: "shared", nodes: [{ id: "root", type: "stack", children: ["first", "second"] }, { id: "first", type: "stack", children: ["text"] }, { id: "second", type: "stack", children: ["text"] }, { id: "text", type: "text", props: { content: "Shared" } }] });
  assert.ok(!diags.some((d) => d.message.includes("cycle")));
  const invalid = store.apply("vak_update", { surface: "shared", nodes: [{ id: "root", children: ["root", "first", "second"] }] });
  assert.ok(invalid.some((d) => d.severity === "warning" && d.node === "root" && d.message.includes("cyclic child")));
  walk(store.resolve("shared")!.root!, (node) => assert.notEqual(node.error, "cycle"));
});
