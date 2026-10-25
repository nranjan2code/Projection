import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
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
  assert.equal(other.status, 403);
  assert.equal(other.headers.get("access-control-allow-origin"), null);
  assert.equal((await fetch(`${base}/api/providers`, { headers: { authorization: "Bearer t0k0" } })).status, 401);
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

// A web page can POST to a loopback port without a preflight when the body is
// text/plain, and a rebinding DNS name makes a page "same-origin" with it.
test("an open host refuses cross-site requests, non-JSON bodies and rebinding host names", async () => {
  const { base, server } = await serve();
  const body = JSON.stringify({ session: "x", provider: "scripted", model: "m", message: "hi" });
  const plain = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "text/plain" }, body });
  assert.equal(plain.status, 415);
  const site = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body });
  assert.equal(site.status, 403);
  // Its own page (same origin) is fine.
  const own = await fetch(`${base}/api/providers`, { headers: { origin: base } });
  assert.equal(own.status, 200);
  const rebound = await new Promise<number>((resolve, reject) => {
    const req = request(`${base}/api/providers`, { headers: { host: "attacker.example:80" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(rebound, 403);
  server.close();
});

test("many saved sessions: the list stays complete while only recent ones stay loaded", async () => {
  const { base, server } = await serve();
  for (let i = 0; i < 30; i++) await chat(base, { session: `s${i}`, provider: "scripted", model: "m", message: `chat ${i}` });
  const list = (await (await fetch(`${base}/api/sessions`)).json()) as { id: string }[];
  assert.equal(list.length, 30);
  // The first one was evicted from memory and reloads from disk intact.
  const view = (await (await fetch(`${base}/api/sessions/s0`)).json()) as SessionView;
  assert.equal(view.title, "chat 0");
  assert.equal(view.surfaces[0]?.id, "kpi");
  await fetch(`${base}/api/sessions/s0`, { method: "DELETE" });
  assert.equal(((await (await fetch(`${base}/api/sessions`)).json()) as unknown[]).length, 29);
  server.close();
});

test("a chat can be renamed; an empty title is refused", async () => {
  const { base, server } = await serve();
  await chat(base, { session: "r1", provider: "scripted", model: "m", message: "first message" });
  const put = (title: unknown) => fetch(`${base}/api/sessions/r1`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
  assert.equal((await put("  ")).status, 400);
  assert.equal((await put("Trip plans")).status, 200);
  const list = (await (await fetch(`${base}/api/sessions`)).json()) as { title: string }[];
  assert.equal(list[0]?.title, "Trip plans");
  server.close();
});
