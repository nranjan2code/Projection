import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readSse } from "@vak/core";
import { ProfileCache, type Provider, type ProviderEntry, type ProviderEvent } from "@vak/providers";
import { createHost, type HostOptions, type SessionView } from "@vak/host";

/** A provider that says one sentence and renders one surface (a clean projection ends the turn). */
function scripted(): Provider {
  return {
    id: "scripted",
    async describeModel() {
      return { tools: true, fingerprint: "test", source: "test" };
    },
    async *stream(): AsyncGenerator<ProviderEvent> {
      yield { type: "text", delta: "Here it is." };
      const args = JSON.stringify({ surface: "kpi", title: "Revenue", nodes: [{ id: "root", type: "stat", props: { label: "Revenue", value: "$1M" } }] });
      yield { type: "tool_start", id: "c1", name: "vak_render" };
      yield { type: "tool_args", id: "c1", delta: args };
      yield { type: "tool_end", id: "c1" };
      yield { type: "done", stop: "tool_use" };
    },
  };
}

async function serve(extra: Partial<HostOptions> = {}): Promise<{ base: string; server: Server; dir: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "vak-host-"));
  const provider = scripted();
  const entry: ProviderEntry = { id: "scripted", label: "Scripted", available: true, make: () => provider };
  const host = createHost({
    providers: () => [entry],
    profiles: new ProfileCache(path.join(dir, "models.json")),
    instructions: "test",
    sessionsDir: path.join(dir, "sessions"),
    log: () => {},
    ...extra,
  });
  const server = createServer(async (req, res) => {
    if (!(await host.handle(req, res))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  // fetch keeps connections alive; a test must not hang on them.
  const close = server.close.bind(server);
  server.close = (cb) => (server.closeAllConnections(), close(cb));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, server, dir };
}

async function chat(base: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<string[]> {
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const types: string[] = [];
  for await (const msg of readSse(res.body!)) types.push(msg.event ?? "");
  return types;
}

test("a conversation is saved with its timeline and surfaces, and reloads in a new host", async () => {
  const first = await serve();
  const events = await chat(first.base, { session: "s1", provider: "scripted", model: "m", message: "Show revenue" });
  assert.ok(events.includes("surface"));
  assert.equal(events.at(-1), "run_end");
  first.server.close();

  // A fresh host on the same directory: what a restarted app sees.
  const second = await serve({ sessionsDir: path.join(first.dir, "sessions"), profiles: new ProfileCache(path.join(first.dir, "models.json")) });
  const list = (await (await fetch(`${second.base}/api/sessions`)).json()) as { id: string; title: string }[];
  assert.deepEqual(list.map((s) => [s.id, s.title]), [["s1", "Show revenue"]]);
  const view = (await (await fetch(`${second.base}/api/sessions/s1`)).json()) as SessionView;
  assert.deepEqual(view.timeline.map((t) => t.kind), ["user", "assistant"]);
  const reply = view.timeline[1]!;
  assert.ok(reply.kind === "assistant" && reply.surfaces[0] === "kpi" && reply.text === "Here it is.");
  assert.equal(view.surfaces[0]?.title, "Revenue");

  await fetch(`${second.base}/api/sessions/s1`, { method: "DELETE" });
  assert.deepEqual(await (await fetch(`${second.base}/api/sessions`)).json(), []);
  second.server.close();
});

test("with a token, requests without it are refused; allowed origins get CORS", async () => {
  const { base, server } = await serve({ token: "t0k", origins: ["tauri://localhost"] });
  assert.equal((await fetch(`${base}/api/providers`)).status, 401);
  const ok = await fetch(`${base}/api/providers`, { headers: { authorization: "Bearer t0k", origin: "tauri://localhost" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), "tauri://localhost");
  const other = await fetch(`${base}/api/providers`, { headers: { authorization: "Bearer t0k", origin: "https://evil.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
  // Preflight carries no credentials and must pass so the real request can.
  const pre = await fetch(`${base}/api/chat`, { method: "OPTIONS", headers: { origin: "tauri://localhost" } });
  assert.equal(pre.status, 204);
  server.close();
});

test("paths outside /api are left to the app", async () => {
  const { base, server } = await serve();
  assert.equal((await fetch(`${base}/index.html`)).status, 404);
  server.close();
});
