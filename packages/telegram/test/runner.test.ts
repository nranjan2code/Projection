import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Provider } from "@vak/providers";
import { type ChannelState, runTelegram } from "../src/index.ts";

const provider: Provider = { id: "p", async *stream() {} };

/** A Bot API stand-in: getMe answers per `me`, getUpdates per `updates`. */
async function botApi(me: (n: number) => [number, object], updates: () => [number, object]): Promise<{ base: string; server: Server }> {
  let n = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const [status, body] = req.url!.endsWith("/getMe") ? me(n++) : updates();
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server };
}

function run(base: string, signal: AbortSignal, states: [ChannelState, string][]) {
  return runTelegram({ token: "t", provider, model: "m", dataDir: mkdtempSync(path.join(tmpdir(), "vak-tg-")), signal, baseUrl: base, onState: (s, d) => states.push([s, d]) });
}

test("runs until stopped: starting, running as the bot, stopped", async () => {
  const { base, server } = await botApi(() => [200, { ok: true, result: { username: "vakbot" } }], () => [200, { ok: true, result: [] }]);
  const ctrl = new AbortController();
  const states: [ChannelState, string][] = [];
  const done = run(base, ctrl.signal, states);
  await new Promise((r) => setTimeout(r, 150));
  ctrl.abort();
  await done;
  server.close();
  assert.equal(states[0]![0], "starting");
  assert.ok(states.some(([s, d]) => s === "running" && d.includes("@vakbot")));
  assert.equal(states.at(-1)![0], "stopped");
});

test("a rejected token ends the run with a reason to fix it in Settings", async () => {
  const { base, server } = await botApi(() => [401, { ok: false, error_code: 401, description: "Unauthorized" }], () => [200, { ok: true, result: [] }]);
  const states: [ChannelState, string][] = [];
  await run(base, new AbortController().signal, states);
  server.close();
  assert.deepEqual(states.at(-1)![0], "error");
  assert.match(states.at(-1)![1], /token/);
});

// Telegram allows one long-poller per bot: `npm run telegram` and the desktop app would fight.
test("another poller on the same bot is reported, not crashed on", async () => {
  const { base, server } = await botApi(
    () => [200, { ok: true, result: { username: "vakbot" } }],
    () => [409, { ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" }],
  );
  const ctrl = new AbortController();
  const states: [ChannelState, string][] = [];
  const done = run(base, ctrl.signal, states);
  await new Promise((r) => setTimeout(r, 150));
  ctrl.abort();
  await done;
  server.close();
  assert.ok(states.some(([s, d]) => s === "error" && /another program/.test(d)));
});
