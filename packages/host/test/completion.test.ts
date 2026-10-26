import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHost } from "../src/index.ts";
import { ProfileCache, type Provider } from "@vak/providers";

test("public host response completion preserves multiple publications in one canonical run", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vak-host-completion-"));
  let requests = 0;
  const provider: Provider = { id: "scripted", async describeModel() { return { tools: true, fingerprint: "test", source: "test" }; }, async *stream() {
    const step = requests++;
    if (step === 2) { yield { type: "text", delta: "Ready" }; yield { type: "done", stop: "end" }; return; }
    const id = `call-${step}`;
    yield { type: "tool_start", id, name: "vak_render" };
    yield { type: "tool_args", id, delta: JSON.stringify({ surface: id, nodes: [{ id: "root", type: "text", props: { content: "Result" } }] }) };
    yield { type: "tool_end", id }; yield { type: "done", stop: "tool_use" };
  } };
  const host = createHost({ providers: () => [{ id: "scripted", label: "Scripted", available: true, make: () => provider }], profiles: new ProfileCache(path.join(dir, "profiles.json")), sessionsDir: dir, instructions: "test", log: () => {} });
  try {
    assert.equal((await host.run({ session: "response", provider: "scripted", model: "m", message: "Work" }, { completion: "response", maxSteps: 4 })).stop, "end");
    assert.equal(requests, 3); assert.equal((await host.view("response")).surfaces.length, 2);
    requests = 0;
    assert.equal((await host.run({ session: "default", provider: "scripted", model: "m", message: "Work" })).stop, "projected");
    assert.equal(requests, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a turn ended by a budget is recorded as such and continues without a new user message", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vak-host-continue-"));
  const seen: string[] = [];
  const provider: Provider = { id: "scripted", async describeModel() { return { tools: true, fingerprint: "test", source: "test" }; }, async *stream(req) {
    seen.push(String(req.messages.at(-1)?.content ?? ""));
    yield { type: "tool_start", id: `v${seen.length}`, name: "vak_render" };
    yield { type: "tool_args", id: `v${seen.length}`, delta: "{" };
    yield { type: "done", stop: "tool_use" };
  } };
  const host = createHost({ providers: () => [{ id: "scripted", label: "Scripted", available: true, make: () => provider }], profiles: new ProfileCache(path.join(dir, "profiles.json")), sessionsDir: dir, instructions: "test", log: () => {} });
  try {
    assert.deepEqual(await host.run({ session: "c", provider: "scripted", model: "m", message: "Work" }, { maxSteps: 1 }), { stop: "max_steps", limit: "steps" });
    const first = (await host.view("c")).timeline.at(-1);
    assert.ok(first?.kind === "assistant" && first.stop === "max_steps" && first.limit === "steps");
    await host.run({ session: "c", provider: "scripted", model: "m", continue: true }, { maxSteps: 1 });
    const timeline = (await host.view("c")).timeline;
    assert.deepEqual(timeline.map((t) => t.kind), ["user", "assistant", "assistant"]);
    assert.match(seen.at(-1)!, /^\[engine\] The user asked to continue/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
