import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { createFetchHandler } from "../src/transport.ts";
import { json, readJson } from "../src/host.ts";

test("private fetch adapter preserves admission inputs, JSON, status, headers and binary streams", async () => {
  const request = createFetchHandler(async (req, res) => {
    assert.equal(req.headers.host, "localhost");
    assert.equal(req.headers.authorization, "Bearer test");
    assert.equal(req.url, "/api/example?q=1");
    const data = await readJson(req);
    json(res, 201, { value: data.value });
  });
  const response = await request(new Request("http://localhost/api/example?q=1", { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: '{"value":42}' }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { value: 42 });
  const bytes = Buffer.alloc(200_000, 213);
  const binary = createFetchHandler((_req, res) => { res.writeHead(206, { "content-type": "video/mp4" }); Readable.from([bytes]).pipe(res); });
  const asset = await binary(new Request("http://localhost/api/asset"));
  assert.equal(asset.status, 206);
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()), bytes);
});

test("private streaming headers arrive before completion and cancellation closes the producer", async () => {
  let closed = false;
  const request = createFetchHandler((_req, res) => {
    res.on("close", () => { closed = true; });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: first\n\n");
  });
  const response = await request(new Request("http://localhost/api/events"));
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
  await reader.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, true);
  const ctrl = new AbortController();
  const aborted = await request(new Request("http://localhost/api/events", { signal: ctrl.signal }));
  ctrl.abort();
  await assert.rejects(aborted.text());
});

test("private adapter propagates failures and supports empty responses", async () => {
  await assert.rejects(createFetchHandler(() => { throw new Error("failed"); })(new Request("http://localhost/api/test")), /failed/);
  const result = await createFetchHandler((_req, res) => { res.writeHead(204).end(); })(new Request("http://localhost/api/test"));
  assert.equal(result.status, 204);
  assert.equal(await result.text(), "");
});


test("large final writes respect consumer flow control instead of enqueueing one giant copy", async () => {
  const request = createFetchHandler((_req, res) => { res.writeHead(200); res.end(Buffer.alloc(2_000_000, 7)); });
  const response = await request(new Request("http://localhost/api/large"));
  const reader = response.body!.getReader();
  let bytes = 0;
  while (true) { const next = await reader.read(); if (next.done) break; assert.ok(next.value.length <= 65536); bytes += next.value.length; }
  assert.equal(bytes, 2_000_000);
});
