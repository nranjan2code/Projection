import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { McpClient, MAX_MCP_RESPONSE_BYTES } from "../src/index-client.ts";

async function fixture(run: (client: McpClient, state: { calls: number; closed: Promise<void> }) => Promise<void>, mode: "wait" | "json" | "sse" = "wait") {
  let closed!: () => void;
  const state = { calls: 0, closed: new Promise<void>(resolve => { closed = resolve; }) };
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    if (!("id" in message)) { res.writeHead(202).end(); return; }
    if (message.method === "initialize") {
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: {} } })); return;
    }
    state.calls++; res.on("close", closed);
    if (mode === "wait") return;
    res.writeHead(200, { "content-type": mode === "sse" ? "text/event-stream" : "application/json" });
    res.end("x".repeat(MAX_MCP_RESPONSE_BYTES + 1));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = new McpClient({ name: "fixture", timeoutMs: mode === "wait" ? 1000 : 5000, transport: { kind: "http", url: `http://127.0.0.1:${(server.address() as { port: number }).port}` } });
  try { await client.connect(); await run(client, state); }
  finally { client.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

test("an already cancelled MCP call is never sent", async () => {
  await fixture(async (client, state) => {
    const ctrl = new AbortController(); ctrl.abort();
    await assert.rejects(client.callTool("write", {}, ctrl.signal));
    assert.equal(state.calls, 0);
  });
});

test("MCP timeout, cancellation and close terminate the HTTP request", async () => {
  for (const mode of ["timeout", "abort", "close"] as const) await fixture(async (client, state) => {
    const ctrl = new AbortController();
    const pending = assert.rejects(client.callTool("write", {}, ctrl.signal), /timed out|stopped/);
    while (!state.calls) await delay(1);
    if (mode === "abort") ctrl.abort();
    if (mode === "close") client.close();
    await pending;
    await Promise.race([state.closed, delay(3000).then(() => { throw new Error("HTTP request remained open"); })]);
    assert.equal(state.calls, 1);
  });
});

test("JSON and unterminated SSE bodies are capped before parsing", async () => {
  for (const mode of ["json", "sse"] as const) await fixture(async client => {
    await assert.rejects(client.callTool("read", {}), /size limit/);
  }, mode);
});
