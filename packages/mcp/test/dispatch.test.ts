import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, type AgentEvent } from "@vak/core";
import { runAgent, type AgentTool, type Provider } from "@vak/providers";
import { agentTools, Integrations, type CatalogEntry } from "../src/index-client.ts";

const info = { name: "write", inputSchema: { type: "object" as const, properties: { value: { type: "string" as const } }, required: ["value"] } };

test("captured integration tools cannot survive disable, reconfiguration, refresh or removal", async () => {
  for (const change of ["disable", "configure", "refresh", "uninstall"] as const) {
    const dir = mkdtempSync(path.join(tmpdir(), "vak-revoke-")); let effects = 0;
    const entry: CatalogEntry = { id: "demo", name: "Demo", publisher: "test", trust: "built-in", summary: "", description: "", homepage: "", icon: "", access: [], config: [], source: { kind: "builtin", server: () => ({ tools: [info], callTool: async () => { effects++; return { text: "ok", isError: false }; } }) } };
    const list = new Integrations({ dataDir: dir, catalog: [entry], secrets: { get() { return undefined; }, set() {}, delete() {} }, approve: async () => "allow-chat" });
    try {
      await list.configure("demo", { enabled: true });
      const [captured] = await list.toolsFor("chat");
      await captured!.execute({ value: "before" }, {});
      if (change === "disable") await list.configure("demo", { enabled: false });
      if (change === "configure") await list.configure("demo", { policies: { write: "ask" } });
      if (change === "refresh") await list.refresh("demo");
      if (change === "uninstall") await list.uninstall("demo");
      const result = await captured!.execute({ value: "after" }, {});
      assert.equal(effects, 1, change);
      assert.equal(typeof result === "object" && result.isError, true);
      if (change !== "uninstall") {
        await list.configure("demo", { enabled: true });
        await captured!.execute({ value: "still stale" }, {});
        assert.equal(effects, 1);
        await (await list.toolsFor("chat"))[0]!.execute({ value: "fresh" }, {});
        assert.equal(effects, 2);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("revocation or cancellation during approval prevents dispatch", async () => {
  for (const mode of ["off", "abort"] as const) {
    let policy: "ask" | "off" = "ask", effects = 0; const ctrl = new AbortController();
    const [tool] = agentTools({ callTool: async () => { effects++; return { text: "ok", isError: false }; } }, [info], { server: "s", label: "S", policy: () => policy, approve: async () => { if (mode === "off") policy = "off"; else ctrl.abort(); return "allow"; } });
    if (mode === "abort") await assert.rejects(async () => tool!.execute({ value: "x" }, { signal: ctrl.signal }));
    else assert.equal((await tool!.execute({ value: "x" }, {}) as { isError: boolean }).isError, true);
    assert.equal(effects, 0);
  }
});

function scripted(args: unknown, stop: "tool_use" | "max_tokens" = "tool_use"): Provider {
  let generation = 0;
  return { id: "fake", async *stream() {
    if (++generation <= 2) {
      yield { type: "tool_start", id: String(generation), name: "s__write" };
      yield { type: "tool_args", id: String(generation), delta: JSON.stringify(args) };
      yield { type: "tool_end", id: String(generation) };
      yield { type: "done", stop };
    } else { yield { type: "text", delta: "Ready" }; yield { type: "done", stop: "end" }; }
  } };
}
async function run(provider: Provider, tools: AgentTool[]) {
  const events: AgentEvent[] = [];
  const result = await runAgent({ provider, model: "fake", messages: [{ role: "user", content: "test" }], store: new SurfaceStore(basicCatalog), tools, emit: event => events.push(event) });
  return { result, events };
}

test("native arguments are validated before approval or external effects", async () => {
  for (const args of [{ value: 42 }, {}, [], null]) {
    let effects = 0, approvals = 0;
    const tools = agentTools({ callTool: async () => { effects++; return { text: "ok", isError: false }; } }, [info], { server: "s", label: "S", policy: () => "ask", approve: async () => { approvals++; return "allow"; } });
    const { events } = await run(scripted(args), tools);
    assert.equal(effects, 0); assert.equal(approvals, 0);
    assert.ok(events.some(e => e.type === "tool_end" && e.isError));
  }
});

test("MCP errors and declined calls remain failures through events and suppress exact repeats", async () => {
  for (const decision of ["allow", "deny"] as const) {
    let effects = 0, approvals = 0;
    const tools = agentTools({ callTool: async () => { effects++; return { text: "service refused", isError: true }; } }, [info], { server: "s", label: "S", policy: () => "ask", approve: async () => { approvals++; return decision; } });
    const { events } = await run(scripted({ value: "x" }), tools);
    const ends = events.filter(e => e.type === "tool_end");
    assert.equal(ends.length, 2); assert.ok(ends.every(e => e.isError));
    assert.equal(effects, decision === "allow" ? 1 : 0); assert.equal(approvals, 1);
  }
});

test("unfinished native generations and ambiguous names dispatch no effects", async () => {
  let effects = 0;
  const tool: AgentTool = { spec: { ...info, name: "s__write", description: "test" }, execute: () => { effects++; return "ok"; } };
  assert.equal((await run(scripted({ value: "x" }, "max_tokens"), [tool])).result.stop, "error");
  assert.equal((await run(scripted({ value: "x" }), [tool, tool])).result.stop, "error");
  assert.throws(() => agentTools({ callTool: async () => ({ text: "", isError: false }) }, [{ ...info, name: "read/file" }, { ...info, name: "read?file" }], { server: "s", label: "S", policy: () => "allow", approve: async () => "deny" }), /Ambiguous/);
  assert.equal(effects, 0);
});
