import assert from "node:assert/strict";
import { test } from "node:test";
import { postJson } from "../src/http.ts";

test("Retry-After consumes the finite HTTP retry allowance", async () => {
  const original = globalThis.fetch; let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response("busy", { status: 429, headers: { "retry-after": "0.001" } }); };
  try {
    await assert.rejects(postJson("fake", "https://unused.invalid", {}, {}, undefined, 2), /429/);
    assert.equal(attempts, 3);
  } finally { globalThis.fetch = original; }
});

test("aborting Retry-After does not start another request", async () => {
  const original = globalThis.fetch; const ctrl = new AbortController(); let attempts = 0;
  globalThis.fetch = async () => { attempts++; ctrl.abort(new Error("stopped")); return new Response("busy", { status: 429, headers: { "retry-after": "30" } }); };
  try {
    await assert.rejects(postJson("fake", "https://unused.invalid", {}, {}, ctrl.signal), /stopped/);
    assert.equal(attempts, 1);
  } finally { globalThis.fetch = original; }
});

test("an explicit host transport receives provider identity and preserves the response stream", async () => {
  const calls: string[] = [];
  const transport = async (provider: string, input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(provider, "fake");
    calls.push(String(input));
    assert.equal(init?.method, "POST");
    return new Response("event: done\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  };
  const response = await postJson("fake", "https://provider.example/v1", {}, { prompt: "fixture" }, undefined, 0, transport);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://provider.example/v1");
  assert.equal(await response.text(), "event: done\ndata: [DONE]\n\n");
});

test("retry attempts share one operation identity and expose the attempt number", async () => {
  const calls: { operationId: string; attempt: number }[] = [];
  const transport = async (_provider: string, _input: RequestInfo | URL, _init?: RequestInit, context?: { operationId: string; attempt: number }) => {
    assert.ok(context);
    calls.push(context);
    return calls.length === 1
      ? new Response("busy", { status: 429, headers: { "retry-after": "0.001" } })
      : new Response("ok");
  };
  const response = await postJson("fake", "https://unused.invalid", {}, {}, undefined, 1, transport);
  assert.equal(await response.text(), "ok");
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(calls[1]!.operationId, calls[0]!.operationId);
  assert.deepEqual(calls.map((call) => call.attempt), [0, 1]);
});

test("provider retries carry the originating host session and run identity", async () => {
  const calls: { operationId: string; attempt: number; sessionId?: string; runId?: string }[] = [];
  const transport = async (_provider: string, _input: RequestInfo | URL, _init?: RequestInit, context?: typeof calls[number]) => {
    assert.ok(context);
    calls.push(context);
    return calls.length === 1
      ? new Response("busy", { status: 429, headers: { "retry-after": "0.001" } })
      : new Response("ok");
  };
  const response = await postJson("fake", "https://unused.invalid", {}, {}, undefined, 1, transport, { sessionId: "session-17", runId: "run-4" });
  assert.equal(await response.text(), "ok");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ sessionId, runId, attempt }) => ({ sessionId, runId, attempt })), [
    { sessionId: "session-17", runId: "run-4", attempt: 0 },
    { sessionId: "session-17", runId: "run-4", attempt: 1 },
  ]);
  assert.equal(calls[0]!.operationId, calls[1]!.operationId);
});
