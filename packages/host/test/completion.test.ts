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
