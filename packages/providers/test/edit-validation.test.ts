import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, walk } from "@vak/core";
import { runAgent, type Provider } from "../src/index.ts";

// Raw local task eb3be4b1, 2026-10-26. The first evidence edit adds orphan
// checkboxes; component-only feedback subsequently induced a second form.
const calls: { name: string; arguments: string }[] = JSON.parse(readFileSync(new URL("./research-edit-calls.json", import.meta.url), "utf8"));
test("caller constraints accompany component diagnostics before the next authoring batch", async () => {
  const store = new SurfaceStore(basicCatalog);
  let requests = 0, checks = 0;
  const provider: Provider = { id: "scripted", async *stream(req) {
    if (requests++ === 0) {
      for (const [i, call] of calls.slice(0, 2).entries()) {
        yield { type: "tool_start", id: String(i), name: call.name };
        yield { type: "tool_args", id: String(i), delta: call.arguments };
        yield { type: "tool_end", id: String(i) };
      }
      yield { type: "done", stop: "tool_use" }; return;
    }
    assert.ok(req.messages.some((message) => message.role === "tool" && message.content.includes("nothing submits")));
    assert.ok(req.messages.at(-1)!.content.includes("The evidence output must contain no editable controls"));
    assert.ok(req.messages.at(-1)!.content.includes("grant no authority"));
    yield { type: "text", delta: "Review required" }; yield { type: "done", stop: "end" };
  } };
  const result = await runAgent({ provider, model: "test", store, messages: [{ role: "user", content: "Work" }], completion: "response", maxSteps: 2, validateEdits: ({ resolved }) => {
    checks++;
    assert.equal(resolved.length, 2);
    let controls = 0;
    walk(resolved.find((surface) => surface.id === "example-analysis-evidence")!.root!, (node) => { if (node.bindPath) controls++; });
    return controls ? ["The evidence output must contain no editable controls; keep controls in the separate criteria form."] : [];
  }, emit: () => {} });
  assert.equal(result.stop, "end"); assert.equal(requests, 2); assert.equal(checks, 1);
});

test("malformed edit decisions fail closed and cannot accept work", async () => {
  const provider: Provider = { id: "scripted", async *stream() {
    yield { type: "tool_start", id: "c", name: "vak_render" };
    yield { type: "tool_args", id: "c", delta: JSON.stringify({ surface: "one", nodes: [{ id: "root", type: "text", props: { content: "Ready" } }] }) };
    yield { type: "tool_end", id: "c" }; yield { type: "done", stop: "tool_use" };
  } };
  const result = await runAgent({ provider, model: "test", store: new SurfaceStore(basicCatalog), messages: [], completion: "response", maxSteps: 2, validateEdits: (() => ({ accepted: true })) as never, emit: () => {} });
  assert.equal(result.stop, "error");
});
