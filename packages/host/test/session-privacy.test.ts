import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readSse } from "@vak/core";
import { ProfileCache, type Provider, type ProviderEntry } from "@vak/providers";
import { createHost, type HostOptions, type SessionView, type TimelineEntry } from "@vak/host";

/** A provider that calls one tool, then answers. */
function toolCaller(tool: string): Provider {
  let step = 0;
  return {
    id: "scripted",
    async describeModel() {
      return { tools: true, fingerprint: "t", source: "t" };
    },
    async *stream() {
      if (step++ === 0) {
        yield { type: "tool_start", id: "c1", name: tool };
        yield { type: "tool_args", id: "c1", delta: "{}" };
        yield { type: "tool_end", id: "c1" };
        yield { type: "done", stop: "tool_use" };
        return;
      }
      yield { type: "text", delta: "Done." };
      yield { type: "done", stop: "end" };
    },
  };
}

interface Served {
  base: string;
  server: Server;
  sessions: string;
}

async function serve(t: { after: (fn: () => void) => void }, extra: Partial<HostOptions>, provider: Provider = toolCaller("webfetch")): Promise<Served> {
  const dir = mkdtempSync(path.join(tmpdir(), "vak-privacy-"));
  const sessions = (extra.sessionsDir as string | undefined) ?? path.join(dir, "sessions");
  const entry: ProviderEntry = { id: "scripted", label: "Scripted", available: true, make: () => provider };
  const host = createHost({
    providers: () => [entry],
    profiles: new ProfileCache(path.join(dir, "models.json")),
    instructions: "test",
    sessionsDir: sessions,
    log: () => {},
    ...extra,
  });
  const server = createServer(async (req, res) => {
    if (!(await host.handle(req, res))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  // An SSE connection stays open after the response ends; without closing the
  // sockets too, node --test never exits.
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, server, sessions };
}

async function chat(base: string, body: Record<string, unknown>): Promise<string[]> {
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const types: string[] = [];
  for await (const msg of readSse(res.body!)) types.push(msg.event ?? "");
  return types;
}

const view = async (base: string, id: string): Promise<SessionView> =>
  (await (await fetch(`${base}/api/sessions/${encodeURIComponent(id)}`)).json()) as SessionView;

/** The words of a timeline entry the user or assistant wrote. */
const said = (v: SessionView, i: number): string | undefined => {
  const entry = v.timeline[i];
  return entry && "text" in entry ? entry.text : undefined;
};

test("tool output is kept out of the saved chat, and the timeline keeps only its name", async (t) => {
  const { base, sessions } = await serve(t, {
    tools: () => [{ spec: { name: "webfetch", description: "fetch a page", inputSchema: { type: "object" } }, execute: async () => "PRIVATE-TOOL-OUTPUT-42" }],
  });
  const events = await chat(base, { session: "s1", provider: "scripted", model: "m", message: "go" });
  // The turn still streams the tool call and its result, in that order.
  assert.deepEqual(events.filter((e) => ["tool_start", "tool_end", "run_end"].includes(e)), ["tool_start", "tool_end", "run_end"]);

  // SECURITY.md promises this: a saved chat keeps that the tool ran, not what
  // it returned (a page or file may hold a token or someone's details).
  const file = path.join(sessions, "s1.json");
  assert.equal(readFileSync(file, "utf8").includes("PRIVATE-TOOL-OUTPUT-42"), false);
  const saved = JSON.parse(readFileSync(file, "utf8")) as { messages: { role: string; content: string }[] };
  const tool = saved.messages.find((m) => m.role === "tool");
  assert.equal(tool?.content, "[tool output not saved]");

  // The live session still has the real output for the rest of the turn, and
  // the timeline records the call by name.
  const reply = (await view(base, "s1")).timeline.at(-1) as Extract<TimelineEntry, { kind: "assistant" }>;
  assert.deepEqual(reply.used, [{ name: "webfetch", ok: true }]);
});

test("x/y and x_y are separate chats: they do not share a file, a reload or a delete", async (t) => {
  const first = await serve(t, {});
  await chat(first.base, { session: "x/y", provider: "scripted", model: "m", message: "first chat" });
  await chat(first.base, { session: "x_y", provider: "scripted", model: "m", message: "second chat" });
  const files = () => readdirSync(first.sessions).filter((f) => f.endsWith(".json"));
  assert.equal(files().length, 2);
  // The safe id keeps its plain name; the unsafe one gets a hash suffix.
  assert.ok(files().includes("x_y.json"));
  assert.match(files().find((f) => f !== "x_y.json")!, /^x_y-[0-9a-f]{12}\.json$/);

  // A restart reads each id back as its own conversation.
  const second = await serve(t, { sessionsDir: first.sessions });
  const slash = await view(second.base, "x/y");
  const underscore = await view(second.base, "x_y");
  assert.equal(said(slash, 0), "first chat");
  assert.equal(said(underscore, 0), "second chat");

  // Deleting one leaves the other alone.
  await fetch(`${second.base}/api/sessions/${encodeURIComponent("x/y")}`, { method: "DELETE" });
  assert.equal(said(await view(second.base, "x_y"), 0), "second chat");
  assert.equal(files().length, 1);
});

test("a chat saved under the old sanitized name is adopted, not shown as empty", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "vak-legacy-"));
  const sessions = path.join(dir, "sessions");
  // Before ids got a hash, "x/y" was saved as "x_y.json".
  writeFileSync(path.join(dir, "models.json"), "{}");
  const legacy = {
    id: "x/y", title: "Old chat", created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z",
    messages: [{ role: "user", content: "hi" }],
    timeline: [{ kind: "user", text: "hi", at: "2026-01-01T00:00:00.000Z" }, { kind: "assistant", text: "Hello", surfaces: [], notes: [], status: "ok", at: "2026-01-01T00:00:01.000Z" }],
    surfaces: [], external: [],
  };
  mkdirSync(sessions, { recursive: true });
  writeFileSync(path.join(sessions, "x_y.json"), JSON.stringify(legacy));

  const { base } = await serve(t, { sessionsDir: sessions });
  const adopted = await view(base, "x/y");
  assert.equal(said(adopted, 1), "Hello");
  // It moved to the collision-free name, so another id cannot claim it.
  assert.equal(existsSync(path.join(sessions, "x_y.json")), false);
  assert.equal(readdirSync(sessions).filter((f) => f.endsWith(".json")).length, 1);
  // The other id is still its own, empty chat.
  assert.deepEqual((await view(base, "x_y")).timeline, []);
});

test("a turn whose tools cannot be loaded ends with error and run_end, never a silent close", async (t) => {
  const { base } = await serve(t, {
    // Integrations.toolsFor no longer throws, but an app's own callback can,
    // and the client must not be left waiting for a run_end that never comes.
    tools: async () => {
      throw new Error("integration folder is gone");
    },
  });
  const events = await chat(base, { session: "s1", provider: "scripted", model: "m", message: "go" });
  assert.equal(events.at(-1), "run_end");
  assert.ok(events.includes("error"));
  const reply = (await view(base, "s1")).timeline.at(-1) as Extract<TimelineEntry, { kind: "assistant" }>;
  assert.equal(reply.error, true);
  assert.match(reply.status, /integration folder is gone/);
});
