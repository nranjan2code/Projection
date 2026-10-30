import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readSse, type SurfaceSnapshot } from "@vak/core";
import { ProfileCache, type Provider, type ProviderEntry, type ProviderEvent } from "@vak/providers";
import { createHost, keepVersions, type HostOptions, type SessionSummary, type SessionView, type VakHost } from "@vak/host";

test("trusted projection uses canonical persistence and respects execution ownership without a model", async () => {
  const { host, server, dir } = await serve({ allowSessionMutation: (id) => id !== "owned" });
  try {
    const input = { session: "media", external: false, args: { surface: "clip", nodes: [{ id: "root", type: "media", props: { kind: "audio", src: "media:asset", title: "Narration" } }] } };
    const result = await host.project(input);
    assert.deepEqual(result.diagnostics, []);
    assert.match(result.text, /Narration/);
    assert.equal((await host.view("media")).surfaces[0]!.id, "clip");
    const reloaded = createHost({ providers: () => [], profiles: new ProfileCache(path.join(dir, "models.json")), instructions: "", sessionsDir: path.join(dir, "sessions") });
    assert.equal((await reloaded.view("media")).surfaces[0]!.nodes[0]!.props!.src, "media:asset");
    await assert.rejects(host.project({ ...input, session: "owned" }), /execution owner/);
    await assert.rejects(host.project({ ...input, tool: "run_command" }), /unknown projection tool/);
  } finally { server.close(); }
});

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

function candidateScripted(): Provider {
  return {
    id: "scripted",
    async describeModel() { return { tools: true, fingerprint: "candidate-test", source: "test" }; },
    async *stream(): AsyncGenerator<ProviderEvent> {
      const args = JSON.stringify({ reply: "Candidate ready.", surfaces: [{ op: "replace", surface: "owned", title: "Candidate title", root: { type: "stat", props: { label: "Candidate metric", value: 42 } }, data: {} }] });
      yield { type: "tool_start", id: "candidate-1", name: "vak_submit" };
      yield { type: "tool_args", id: "candidate-1", delta: args };
      yield { type: "tool_end", id: "candidate-1" };
      yield { type: "done", stop: "tool_use" };
    },
  };
}

async function serve(extra: Partial<HostOptions> = {}, provider: Provider = scripted()): Promise<{ base: string; server: Server; dir: string; host: VakHost }> {
  const dir = mkdtempSync(path.join(tmpdir(), "vak-host-"));
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
  return { base: `http://127.0.0.1:${port}`, server, dir, host };
}

async function chat(base: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<string[]> {
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const types: string[] = [];
  for await (const msg of readSse(res.body!)) types.push(msg.event ?? "");
  return types;
}

test("isolated candidate runs return versioned proposals without canonical history or surface writes", async () => {
  let externalCalls = 0;
  const app = await serve({ tools: () => [{ spec: { name: "external_write", description: "external effect", inputSchema: { type: "object" } }, execute: () => { externalCalls++; return "written"; } }] }, candidateScripted());
  try {
    await app.host.project({ session: "root-session", tool: "vak_render", args: { surface: "owned", title: "Original title", data: {}, nodes: [{ id: "root", type: "stat", props: { label: "Original metric", value: 7 } }] } });
    const before = await app.host.view("root-session");
    await assert.rejects(app.host.runCandidate({ session: "root-session", provider: "scripted", model: "m", message: "Too much context", initialSurfaces: [{ id: "oversized", version: 1, nodes: [], data: { value: "x".repeat(8 * 1024 * 1024 + 1) } }] }), /8 MiB/);
    const candidate = await app.host.runCandidate({ session: "root-session", provider: "scripted", model: "m", message: "Prepare an updated metric.", initialSurfaces: before.surfaces });

    assert.equal(candidate.result.stop, "end");
    assert.equal(candidate.reply, "Candidate ready.");
    assert.deepEqual(candidate.baseVersions, [{ id: "owned", version: before.surfaces[0]!.version }]);
    assert.equal(candidate.surfaces[0]?.title, "Candidate title");
    assert.equal(candidate.surfaces[0]?.nodes[0]?.props?.value, 42);
    assert.equal(externalCalls, 0);
    assert.deepEqual(await app.host.view("root-session"), before);

    const reloaded = createHost({ providers: () => [], profiles: new ProfileCache(path.join(app.dir, "models.json")), instructions: "test", sessionsDir: path.join(app.dir, "sessions") });
    assert.deepEqual(await reloaded.view("root-session"), before);
  } finally { app.server.close(); }
});

test("candidate commit hands the exact one-use result to the canonical owner and binds retries", async () => {
  const calls: unknown[] = [];
  let failOnce = true;
  const app = await serve({ commitCandidate: async (request) => {
    calls.push(request);
    if (failOnce) { failOnce = false; throw new Error("acknowledgement lost"); }
    return { canonicalRevision: 9, rootRevision: 12 };
  } }, candidateScripted());
  try {
    const base = [{ id: "owned", version: 4, nodes: [], data: {} }];
    const candidate = await app.host.runCandidate({ session: "session-1", provider: "scripted", model: "m", message: "Prepare the surface.", initialSurfaces: base });
    const input = {
      candidateId: candidate.candidateId,
      commitId: "commit-77",
      fence: { rootId: "task-1", rootRevision: 11, contractRevision: 3, cancellationEpoch: 5 },
      expectedCanonicalRevision: 4,
    };
    const returned = structuredClone(candidate);
    returned.surfaces[0]!.title = "caller tampering";
    await assert.rejects(app.host.commitCandidate(input), /acknowledgement lost/);
    assert.deepEqual(await app.host.commitCandidate(input), { canonicalRevision: 9, rootRevision: 12 });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    const request = calls[1] as { candidateId: string; commitId: string; fence: unknown; expectedCanonicalRevision: number; session: string; reply: string; baseVersions: unknown; surfaces: { title?: string }[] };
    assert.equal(request.candidateId, candidate.candidateId);
    assert.equal(request.commitId, "commit-77");
    assert.deepEqual(request.fence, input.fence);
    assert.equal(request.expectedCanonicalRevision, 4);
    assert.equal(request.session, "session-1");
    assert.equal(request.reply, "Candidate ready.");
    assert.deepEqual(request.baseVersions, [{ id: "owned", version: 4 }]);
    assert.equal(request.surfaces[0]?.title, "Candidate title");
    await assert.rejects(app.host.commitCandidate(input), /missing, expired or still running/);
  } finally { app.server.close(); }
});

test("candidate commit rejects changed fence or identity and discarding releases a slot", async () => {
  let calls = 0;
  let failOnce = true;
  const app = await serve({ commitCandidate: async () => { calls++; if (failOnce) { failOnce = false; throw new Error("acknowledgement lost"); } return { canonicalRevision: 1, rootRevision: 2 }; } }, candidateScripted());
  try {
    const candidate = await app.host.runCandidate({ session: "session-2", provider: "scripted", model: "m", message: "Prepare the surface." });
    const input = { candidateId: candidate.candidateId, commitId: "commit-a", fence: { rootId: "task-2", rootRevision: 1, contractRevision: 1, cancellationEpoch: 0 }, expectedCanonicalRevision: 0 };
    await assert.rejects(app.host.commitCandidate(input), /acknowledgement lost/);
    await assert.rejects(app.host.commitCandidate({ ...input, fence: { ...input.fence, cancellationEpoch: 1 } }), /different commit identity or fence/);
    await assert.rejects(app.host.commitCandidate({ ...input, expectedCanonicalRevision: 1 }), /different commit identity or fence/);
    assert.equal(calls, 1);
    assert.equal(app.host.discardCandidate(candidate.candidateId), false);
    await app.host.commitCandidate(input);
    const discarded = await app.host.runCandidate({ session: "session-2", provider: "scripted", model: "m", message: "Prepare another surface." });
    assert.equal(app.host.discardCandidate(discarded.candidateId), true);
    assert.equal(app.host.discardCandidate(discarded.candidateId), false);
    await assert.rejects(app.host.commitCandidate({ ...input, candidateId: discarded.candidateId, commitId: "commit-b" }), /missing, expired or still running/);
  } finally { app.server.close(); }
});

test("candidate retention has a fixed pending-count bound and discard restores capacity", async () => {
  const app = await serve({}, candidateScripted());
  try {
    const pending = [];
    for (let index = 0; index < 4; index++) {
      pending.push(await app.host.runCandidate({ session: `session-${index}`, provider: "scripted", model: "m", message: "Prepare the surface." }));
    }
    await assert.rejects(app.host.runCandidate({ session: "session-over-limit", provider: "scripted", model: "m", message: "Prepare the surface." }), /queue is full/);
    assert.equal(app.host.discardCandidate(pending[0]!.candidateId), true);
    const next = await app.host.runCandidate({ session: "session-after-discard", provider: "scripted", model: "m", message: "Prepare the surface." });
    assert.equal(typeof next.candidateId, "string");
  } finally { app.server.close(); }
});

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

test("session discovery indexes surfaces across restart without exposing form values, and tracks removal", async () => {
  const first = await serve({ token: "library-test" });
  const headers = { authorization: "Bearer library-test", "content-type": "application/json" };
  const project = async (base: string, session: string, tool: string, args: unknown) => {
    const res = await fetch(`${base}/api/project`, { method: "POST", headers, body: JSON.stringify({ session, tool, args }) });
    assert.equal(res.status, 200);
  };
  try {
    for (const id of ["first", "second"]) await project(first.base, id, "vak_render", {
      surface: "same-id", title: `${id} signup`, data: { email: "private@example.com" },
      nodes: [{ id: "root", type: "form", props: { submit: "save" }, children: [{ id: "email", type: "input", props: { label: "Email", bind: "/email" } }] }],
    });
    const list = await (await fetch(`${first.base}/api/sessions`, { headers })).json() as SessionSummary[];
    assert.equal(list.length, 2);
    assert.equal(JSON.stringify(list).includes("private@example.com"), false);
    assert.deepEqual(list.find(s => s.id === "first")?.surfaceSummaries, [{ id: "same-id", title: "first signup", types: ["form", "input"] }]);
    assert.equal((await fetch(`${first.base}/api/sessions`)).status, 401);
    const second = await serve({ token: "library-test", sessionsDir: path.join(first.dir, "sessions") });
    try {
      const restored = await (await fetch(`${second.base}/api/sessions`, { headers })).json() as SessionSummary[];
      assert.deepEqual(restored.find(s => s.id === "second")?.surfaceSummaries, [{ id: "same-id", title: "second signup", types: ["form", "input"] }]);
      await project(second.base, "first", "vak_remove", { surface: "same-id" });
      let current = await (await fetch(`${second.base}/api/sessions`, { headers })).json() as SessionSummary[];
      assert.deepEqual(current.find(s => s.id === "first")?.surfaceSummaries, []);
      await fetch(`${second.base}/api/sessions/second`, { method: "DELETE", headers });
      current = await (await fetch(`${second.base}/api/sessions`, { headers })).json() as SessionSummary[];
      assert.deepEqual(current.map(s => s.id), ["first"]);
    } finally { second.server.close(); }
  } finally { first.server.close(); }
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

test("an integration tool on Ask waits for the user; the timeline keeps its name, not its output", async () => {
  let step = 0;
  const caller: Provider = {
    id: "caller",
    async describeModel() {
      return { tools: true, fingerprint: "t", source: "t" };
    },
    async *stream(): AsyncGenerator<ProviderEvent> {
      if (step++ === 0) {
        yield { type: "tool_start", id: "c1", name: "web__fetch_page" };
        yield { type: "tool_args", id: "c1", delta: '{"url":"https://example.com"}' };
        yield { type: "tool_end", id: "c1" };
        yield { type: "done", stop: "tool_use" };
      } else {
        yield { type: "text", delta: "Read it." };
        yield { type: "done", stop: "end" };
      }
    },
  };
  let hostRef: VakHost | undefined;
  const { base, server, host } = await serve(
    {
      tools: () => [
        {
          spec: { name: "web__fetch_page", description: "fetch", inputSchema: { type: "object" } },
          async execute(_args, ctx) {
            const d = await hostRef!.approve({ id: ctx.callId!, server: "web", tool: "fetch_page", title: "Read", args: {} }, ctx.emit, ctx.signal);
            return d === "deny" ? "declined" : "PRIVATE PAGE TEXT";
          },
        },
      ],
    },
    caller,
  );
  hostRef = host;
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: "t1", provider: "scripted", model: "m", message: "read example.com" }) });
  const seen: string[] = [];
  for await (const msg of readSse(res.body!)) {
    seen.push(msg.event ?? "");
    if (msg.event === "approval") {
      const id = (JSON.parse(msg.data) as { id: string }).id;
      const ok = await fetch(`${base}/api/approvals/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "allow" }) });
      assert.equal(ok.status, 200);
    }
  }
  assert.ok(seen.indexOf("approval") < seen.indexOf("approval_done"));
  const view = (await (await fetch(`${base}/api/sessions/t1`)).json()) as SessionView;
  const reply = view.timeline.find((t) => t.kind === "assistant")!;
  assert.ok(reply.kind === "assistant");
  assert.deepEqual(reply.used, [{ name: "web__fetch_page", ok: true }]);
  assert.doesNotMatch(JSON.stringify(view.timeline), /PRIVATE PAGE TEXT/);
  server.close();
});

test("in-process runs survive viewer disconnects, reject takeover, and share canonical session state", async () => {
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((r) => { started = r; });
  const wait = new Promise<void>((r) => { release = r; });
  const p: Provider = { ...scripted(), async *stream(req) {
    started();
    await wait;
    assert.equal(req.signal?.aborted, false);
    yield* scripted().stream(req);
  } };
  const { host, server, base } = await serve({}, p);
  try {
    const watching = new AbortController();
    const events = await fetch(`${base}/api/events?session=background`, { signal: watching.signal });
    const running = host.run({ session: "background", provider: "scripted", model: "m", message: "Show revenue" });
    await ready;
    watching.abort();
    await events.body?.cancel().catch(() => {});
    await assert.rejects(host.run({ session: "background", provider: "scripted", model: "m", message: "Take over" }), /already running/);
    const takeover = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: "background", provider: "scripted", model: "m", message: "Take over" }) });
    assert.equal(takeover.status, 409);
    for (const [route, method, body] of [
      ["/api/project", "POST", { session: "background", args: { surface: "injected", nodes: [] } }],
      ["/api/reset", "POST", { session: "background" }],
      ["/api/sessions/background", "DELETE", undefined],
    ] as const) {
      const response = await fetch(base + route, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      assert.equal(response.status, 409);
    }
    release();
    assert.equal((await running).stop, "projected");
    const view = await host.view("background");
    assert.equal(view.surfaces[0]?.id, "kpi");
    view.surfaces.length = 0;
    assert.equal((await host.view("background")).surfaces.length, 1);
    assert.equal((await (await fetch(`${base}/api/sessions/background`)).json() as SessionView).surfaces.length, 1);
  } finally { release(); server.close(); }
});

test("in-process actions validate and preserve multiple canonical surfaces", async () => {
  const p: Provider = { ...scripted(), async *stream() {
    for (const id of ["first", "second"]) {
      yield { type: "tool_start", id, name: "vak_render" };
      yield { type: "tool_args", id, delta: JSON.stringify({ surface: id, nodes: [{ id: "root", type: "form", props: { submit: "save" }, children: [{ id: "name", type: "input", props: { bind: "/name", checks: ["required"] } }] }] }) };
      yield { type: "tool_end", id };
    }
    yield { type: "done", stop: "tool_use" };
  } };
  const { host, server } = await serve({}, p);
  const input = { session: "forms", provider: "scripted", model: "m" };
  try {
    await host.run({ ...input, message: "Two forms" });
    assert.equal((await host.view("forms")).surfaces.length, 2);
    const result = await host.run({ ...input, action: { surface: "first", source: "root", data: { name: "" } } });
    assert.equal(result.stop, "error");
    assert.equal((await host.view("forms")).surfaces.length, 2);
    const ctrl = new AbortController(); ctrl.abort();
    await assert.rejects(host.run({ ...input, message: "Do not run" }, { signal: ctrl.signal }), /cancelled/);
    await assert.rejects(host.run({ ...input, message: "Unavailable", provider: "absent" }), /unavailable/);
    // A failed admission must release the session for its next legitimate request.
    assert.equal((await host.run({ ...input, message: "Again" })).stop, "projected");
  } finally { server.close(); }
});


test("application session ownership blocks HTTP mutations between in-process runs", async () => {
  const { host, base, server } = await serve({ allowSessionMutation: (id) => id !== "owned" });
  try {
    await host.run({ session: "owned", provider: "scripted", model: "m", message: "Show revenue" });
    for (const [route, method, body] of [
      ["/api/chat", "POST", { session: "owned", provider: "scripted", model: "m", message: "Bypass" }],
      ["/api/project", "POST", { session: "owned", args: { surface: "other", nodes: [] } }],
      ["/api/reset", "POST", { session: "owned" }],
      ["/api/sessions/owned", "DELETE", undefined],
      ["/api/sessions/owned", "PUT", { title: "Bypass" }],
    ] as const) {
      assert.equal((await fetch(base + route, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).status, 409);
    }
    assert.equal((await fetch(base + "/api/sessions/owned")).status, 200);
    assert.equal((await host.view("owned")).surfaces.length, 1);
  } finally { server.close(); }
});


test("trusted session removal deletes its transcript without deleting other sessions", async () => {
  const transcripts = mkdtempSync(path.join(tmpdir(), "vak-transcripts-"));
  const { host, server, dir } = await serve({ transcripts });
  try {
    await host.run({ session: "remove-me", provider: "scripted", model: "m", message: "Synthetic input" });
    await host.run({ session: "keep-me", provider: "scripted", model: "m", message: "Keep" });
    assert.equal(existsSync(path.join(transcripts, "remove-me.jsonl")), true);
    const temporary = path.join(dir, "sessions", "remove-me.json.tmp");
    writeFileSync(temporary, "abandoned session content");
    await host.remove("remove-me");
    assert.equal(existsSync(temporary), false);
    assert.equal(existsSync(path.join(transcripts, "remove-me.jsonl")), false);
    assert.equal(existsSync(path.join(transcripts, "keep-me.jsonl")), true);
    assert.equal((await host.view("keep-me")).surfaces.length, 1);
  } finally { server.close(); }
});

/** Says a word, waits for `gate`, then renders: a turn the test can hold open. */
function gated(gate: Promise<void>, signals: AbortSignal[] = []): Provider {
  return {
    id: "scripted",
    async describeModel() {
      return { tools: true, fingerprint: "test", source: "test" };
    },
    async *stream(req): AsyncGenerator<ProviderEvent> {
      if (req.signal) signals.push(req.signal);
      yield { type: "text", delta: "Working " };
      await Promise.race([gate, new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))]);
      const args = JSON.stringify({ surface: "kpi", nodes: [{ id: "root", type: "stat", props: { label: "Revenue", value: "$1M" } }] });
      yield { type: "tool_start", id: "c1", name: "vak_render" };
      yield { type: "tool_args", id: "c1", delta: args };
      yield { type: "tool_end", id: "c1" };
      yield { type: "done", stop: "tool_use" };
    },
  };
}

test("a chat turn outlives the window that started it; viewers follow it; stop is explicit", async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const { base, server } = await serve({}, gated(gate));
  try {
    // The window starts a turn, reads the first words, then leaves (switches chat).
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: "bg", provider: "scripted", model: "m", message: "Show revenue" }), signal: ctrl.signal });
    const reader = readSse(res.body!)[Symbol.asyncIterator]();
    while ((await reader.next()).value?.event !== "text_delta");
    ctrl.abort();
    await new Promise((r) => setTimeout(r, 50));
    const mid = (await (await fetch(`${base}/api/sessions/bg`)).json()) as SessionView;
    assert.equal(mid.running, true);
    assert.equal(mid.pending?.text, "Working ");
    assert.equal(((await (await fetch(`${base}/api/sessions`)).json()) as SessionSummary[]).find((s) => s.id === "bg")?.running, true);
    // Coming back: a viewer sees the rest of the turn.
    const events = await fetch(`${base}/api/events?session=bg`);
    const seen: string[] = [];
    const follow = (async () => { for await (const m of readSse(events.body!)) { seen.push(m.event ?? ""); if (m.event === "run_end") return; } })();
    await new Promise((r) => setTimeout(r, 50));
    open();
    await follow;
    assert.ok(seen.includes("surface") && seen.includes("run_end"), seen.join(","));
    // run_end is sent just before the turn is saved and released.
    let done = (await (await fetch(`${base}/api/sessions/bg`)).json()) as SessionView;
    for (let i = 0; done.running && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 10));
      done = (await (await fetch(`${base}/api/sessions/bg`)).json()) as SessionView;
    }
    assert.equal(done.running, undefined);
    assert.equal(done.surfaces.length, 1);
    assert.match((done.timeline.at(-1) as { text: string }).text, /Working/);
  } finally {
    server.close();
  }
});

test("POST /api/sessions/:id/stop cancels a running turn", async () => {
  const signals: AbortSignal[] = [];
  const { base, server } = await serve({}, gated(new Promise(() => {}), signals));
  try {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: "st", provider: "scripted", model: "m", message: "Hi" }) });
    const reader = readSse(res.body!)[Symbol.asyncIterator]();
    while ((await reader.next()).value?.event !== "text_delta");
    assert.deepEqual(await (await fetch(`${base}/api/sessions/st/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json(), { stopped: true });
    for (let r = await reader.next(); !r.done; r = await reader.next());
    assert.equal(signals[0]?.aborted, true);
    let view = (await (await fetch(`${base}/api/sessions/st`)).json()) as SessionView;
    for (let i = 0; view.running && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 10));
      view = (await (await fetch(`${base}/api/sessions/st`)).json()) as SessionView;
    }
    assert.equal(view.running, undefined);
    assert.deepEqual(await (await fetch(`${base}/api/sessions/st/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json(), { stopped: false });
  } finally {
    server.close();
  }
});

test("each reply keeps its surfaces as it left them, so a rewrite in place has a way back", async () => {
  let title = "Search";
  const p: Provider = { ...scripted(), async *stream() {
    yield { type: "tool_start", id: title, name: "vak_render" };
    yield { type: "tool_args", id: title, delta: JSON.stringify({ surface: "flow", title, nodes: [{ id: "root", type: "text", props: { text: title } }] }) };
    yield { type: "tool_end", id: title };
    yield { type: "done", stop: "tool_use" };
  } };
  const { host, server } = await serve({}, p);
  const input = { session: "versions", provider: "scripted", model: "m" };
  try {
    await host.run({ ...input, message: "Find" });
    title = "Results";
    await host.run({ ...input, message: "Show results" });
    const view = await host.view("versions");
    const versions = view.timeline.flatMap((t) => (t.kind === "assistant" ? t.versions ?? [] : []));
    assert.deepEqual(versions.map((v) => [v.id, v.title]), [["flow", "Search"], ["flow", "Results"]]);
    assert.equal(view.surfaces[0]!.title, "Results");
  } finally { server.close(); }
});

test("only the newest ten versions of a surface keep their copy", () => {
  const snap = (n: number) => ({ id: "s", title: String(n), version: n, nodes: [], data: {} }) as unknown as SurfaceSnapshot;
  const timeline = Array.from({ length: 12 }, (_, i) => ({ kind: "assistant" as const, text: "", surfaces: ["s"], notes: [], status: "", at: "", versions: [snap(i)] }));
  keepVersions(timeline);
  assert.deepEqual(timeline.map((t) => t.versions?.[0]?.version), [undefined, undefined, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("instructions function receives per-turn session context", async () => {
  let seenSession: string | undefined;
  const p: Provider = { ...scripted(), async *stream(req) {
    if (req.callerInstructions?.includes("session:test-session-123")) {
      yield { type: "text", delta: "Session matched." };
    }
    yield { type: "done", stop: "end" };
  } };
  const { host, server } = await serve({
    instructions: (ctx) => {
      seenSession = ctx?.session;
      return `Instruction for session:${ctx?.session ?? "unknown"}`;
    },
  }, p);
  try {
    const res = await host.run({ session: "test-session-123", provider: "scripted", model: "m", message: "Hi" });
    assert.equal(seenSession, "test-session-123");
    assert.equal(res.stop, "end");
  } finally { server.close(); }
});
