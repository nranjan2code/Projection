import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, type AgentEvent } from "@vak/core";
import { ollama, ProviderError, runAgent, ToolGenerationError, type Message, type Provider } from "../src/index.ts";

// Exact provider error from the retained 2026-10-26 local comparison run.
const rejected = { error: "XML syntax error on line 3: element <function> closed by </parameter>" };
async function serve(reply: (step: number) => { status: number; body: unknown }, fn: (provider: Provider, seen: any[]) => Promise<void>) {
  const seen: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    seen.push(JSON.parse(raw));
    const response = reply(seen.length - 1);
    res.writeHead(response.status, { "content-type": "application/json" });
    res.end(JSON.stringify(response.body) + "\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await fn(ollama({ host: `http://127.0.0.1:${(server.address() as { port: number }).port}` }), seen); }
  finally { await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); }
}
const done = { done: true, message: { content: "Ready for review" }, prompt_eval_count: 2, eval_count: 3 };
const request = { model: "m", messages: [{ role: "user" as const, content: "Work" }], tools: [{ name: "read", description: "Read", inputSchema: { type: "object" as const } }] };

test("Ollama classifies only a generated-tool XML rejection and never retries inside the adapter", async () => {
  for (const response of [
    { status: 500, body: rejected, kind: ToolGenerationError },
    { status: 400, body: rejected, kind: ProviderError },
    { status: 500, body: { error: "model runner crashed" }, kind: ProviderError },
    { status: 500, body: { error: "unrelated XML error" }, kind: ProviderError },
  ]) await serve(() => response, async (provider, seen) => {
    await assert.rejects(async () => { for await (const _ of provider.stream(request)) {} }, (err: unknown) => {
      assert.equal((err as Error).constructor, response.kind);
      return true;
    });
    assert.equal(seen.length, 1);
  });
});

test("rejected generations consume run steps, preserve completed tool receipts and re-enter provider admission", async () => {
  await serve((step) => step === 0 || step === 2 ? { status: 500, body: rejected } : step === 1 ? { status: 200, body: { done: true, message: { tool_calls: [{ id: "read-once", function: { name: "read", arguments: {} } }] } } } : { status: 200, body: done }, async (provider, seen) => {
    let admissions = 0, reads = 0;
    const counted: Provider = { id: provider.id, async *stream(req) { admissions++; yield* provider.stream(req); } };
    const messages: Message[] = [{ role: "user", content: "Read once" }], events: AgentEvent[] = [];
    const result = await runAgent({ provider: counted, model: "m", messages, store: new SurfaceStore(basicCatalog), completion: "response", maxSteps: 4, emit: (event) => events.push(event), tools: [{ spec: request.tools[0]!, execute: () => { reads++; return "saved receipt"; } }] });
    assert.equal(result.stop, "end");
    assert.equal(admissions, 4); assert.equal(seen.length, 4); assert.equal(reads, 1);
    assert.ok(seen[1].messages.at(-1).content.includes("No tool was executed"));
    assert.ok(seen[3].messages.some((m: any) => m.role === "tool" && m.content === "saved receipt"));
    assert.equal(messages.filter((m) => m.toolCalls?.length).length, 1);
    assert.equal(events.filter((e) => e.type === "tool_start").length, 1);
    assert.equal(events.filter((e) => e.type === "run_end").length, 1);
  });
});

test("persistent tool syntax rejection stops at the existing step budget", async () => {
  await serve(() => ({ status: 500, body: rejected }), async (provider, seen) => {
    const result = await runAgent({ provider, model: "m", messages: [...request.messages], store: new SurfaceStore(basicCatalog), maxSteps: 2, emit: () => {} });
    assert.equal(result.stop, "max_steps"); assert.equal(seen.length, 2);
  });
});

test("ordinary HTTP failures do not trigger a generation repair", async () => {
  await serve(() => ({ status: 500, body: { error: "runner unavailable" } }), async (provider, seen) => {
    const result = await runAgent({ provider, model: "m", messages: [...request.messages], store: new SurfaceStore(basicCatalog), maxSteps: 4, emit: () => {} });
    assert.equal(result.stop, "error"); assert.equal(seen.length, 1);
  });
});

test("partial calls, visible prose and cancellation prevent generation replay", async () => {
  for (const partial of ["call", "text", "abort"]) {
    const ctrl = new AbortController(); let requests = 0, effects = 0;
    const provider: Provider = { id: "rejecting", async *stream() {
      requests++;
      if (partial === "call") { yield { type: "tool_start", id: "partial", name: "read" }; yield { type: "tool_args", id: "partial", delta: "{}" }; }
      if (partial === "text") yield { type: "text", delta: "Partial response" };
      if (partial === "abort") ctrl.abort();
      throw new ToolGenerationError("rejecting", "invalid generated syntax");
    } };
    const result = await runAgent({ provider, model: "m", messages: [...request.messages], store: new SurfaceStore(basicCatalog), signal: ctrl.signal, maxSteps: 4, emit: () => {}, tools: [{ spec: request.tools[0]!, execute: () => { effects++; return "receipt"; } }] });
    assert.equal(result.stop, partial === "abort" ? "aborted" : "error"); assert.equal(requests, 1); assert.equal(effects, 0);
  }
});
