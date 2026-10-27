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
