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

test("an explicit host fetch boundary receives provider requests and preserves the response stream", async () => {
  const calls: string[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    assert.equal(init?.method, "POST");
    return new Response("event: done\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  };
  const response = await postJson("fake", "https://provider.example/v1", {}, { prompt: "fixture" }, undefined, 0, fetcher);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://provider.example/v1");
  assert.equal(await response.text(), "event: done\ndata: [DONE]\n\n");
});
