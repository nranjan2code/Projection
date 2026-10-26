import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, ToolCallStream } from "../src/index.ts";

// A local model streams tool arguments in tiny pieces (often a few characters
// per delta). Applying each one rebuilt and revalidated the whole surface —
// and reparsed the whole document — so cost grew with the square of the
// render: a 400-node, 36 KB render took 7.3 s at 8-character deltas. These
// tests hold the batching in place without pinning the exact counts.

function rows(n: number): string {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: "text", props: { content: `row ${i} lorem ipsum dolor sit amet` } }));
  return JSON.stringify({ surface: "big", nodes: [{ id: "root", type: "stack", children: nodes.map((x) => x.id) }, ...nodes] });
}

function stream(json: string, chunk: number): { store: SurfaceStore; applies: number; ms: number } {
  const store = new SurfaceStore(basicCatalog);
  const s = new ToolCallStream(store, "vak_render");
  let applies = 0;
  const started = performance.now();
  for (let i = 0; i < json.length; i += chunk) if (s.push(json.slice(i, i + chunk)).changed) applies++;
  s.end();
  return { store, applies, ms: performance.now() - started };
}

test("a large render is applied in batches, not once per delta", () => {
  const json = rows(400);
  assert.ok(json.length > 30_000, "the render is big enough to matter");
  const { store, applies, ms } = stream(json, 8);
  assert.equal(store.get("big")?.nodes.size, 401);
  // Thousands of deltas, but on the order of tens of applies.
  assert.ok(applies < 120, `${applies} applies for ${json.length} characters`);
  // The measured cost was 44 ms; anything near the old 7 s would fail here.
  assert.ok(ms < 2000, `${Math.round(ms)} ms`);
});

test("a single long text node still types as it streams", () => {
  const json = JSON.stringify({ surface: "p", nodes: [{ id: "t", type: "text", props: { content: "word ".repeat(400) } }] });
  const { store, applies } = stream(json, 8);
  assert.ok((store.get("p")?.nodes.size ?? 0) >= 1);
  // One node, so node growth cannot drive the updates: the text chunk must.
  assert.ok(applies > 1, `${applies} updates for ${json.length} characters`);
});
