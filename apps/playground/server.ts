// vak playground server: zero dependencies.
// - Serves the UI and our TypeScript packages to the browser, stripping types
//   on the fly with Node's built-in stripTypeScriptTypes (no bundler).
// - Runs the agent loop server-side so API keys never reach the browser.
// - Streams AgentEvents to the client as Server-Sent Events.
//
// Usage: npm run playground   (env: PORT, OLLAMA_HOST, ANTHROPIC_API_KEY,
//        OPENAI_API_KEY, GEMINI_API_KEY, OPENAI_COMPAT_BASE_URL/_API_KEY; .env is read)

import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { basicCatalog, encodeSse, formatDiagnostics, SurfaceStore, type AgentEvent, type VpsAction } from "@vak/core";
import { actionMessage, loadEnvFile, type Message, providersFromEnv, runAgent } from "@vak/providers";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

loadEnvFile(path.join(repo, ".env"));
const PORT = Number(process.env.PORT ?? 5177);
const PROVIDERS = providersFromEnv();

// --- sessions ----------------------------------------------------------------
interface Session {
  messages: Message[];
  store: SurfaceStore;
  busy?: AbortController;
  /** Live viewers (GET /api/events) for projections pushed via /api/project. */
  viewers: Set<(e: AgentEvent) => void>;
  /** Surfaces owned by an external caller: their actions queue here instead of running the model. */
  external: Set<string>;
  inbox: VpsAction[];
  waiters: Set<() => void>;
}
const sessions = new Map<string, Session>();
function session(id: string): Session {
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = { messages: [], store: new SurfaceStore(basicCatalog), viewers: new Set(), external: new Set(), inbox: [], waiters: new Set() }));
  return s;
}

const INSTRUCTIONS = `You are the assistant inside the vak projection playground.
Today is ${new Date().toISOString().slice(0, 10)}.
Answer with rich UI whenever the answer has any structure; keep accompanying text to one short sentence, the UI carries the content.
When the user asks for examples or you lack real data, use realistic sample data and say it is sample data in a caption.
When you receive a "[ui action]" message, the user interacted with your UI: respond to it, usually by updating that surface (vak_update) or rendering a confirmation.`;

// --- static + TypeScript serving ---------------------------------------------
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const ROOTS: Record<string, string> = {
  app: path.join(here, "public"),
  core: path.join(repo, "packages/core/src"),
  web: path.join(repo, "packages/web/src"),
};
const tsCache = new Map<string, { mtime: number; code: string }>();

async function serveFile(res: ServerResponse, root: string, rel: string): Promise<void> {
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return void res.writeHead(403).end();
  let info;
  try {
    info = await stat(file);
  } catch {
    return void res.writeHead(404).end("not found");
  }
  const ext = path.extname(file);
  let body: string | Buffer;
  if (ext === ".ts") {
    const hit = tsCache.get(file);
    if (hit && hit.mtime === info.mtimeMs) body = hit.code;
    else {
      body = stripTypeScriptTypes(await readFile(file, "utf8"), { mode: "strip", sourceUrl: file });
      tsCache.set(file, { mtime: info.mtimeMs, code: body });
    }
  } else body = await readFile(file);
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": "no-cache" });
  res.end(body);
}

// --- API -----------------------------------------------------------------------
async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const entry = PROVIDERS.find((p) => p.id === body.provider);
  if (!entry?.available) return json(res, 400, { error: `provider ${body.provider} unavailable` });
  if (typeof body.model !== "string" || !body.model) return json(res, 400, { error: "model required" });
  const s = session(String(body.session ?? "default"));
  s.busy?.abort();
  const ctrl = new AbortController();
  s.busy = ctrl;
  res.on("close", () => {
    if (!res.writableFinished) ctrl.abort();
  });

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const emit = (e: AgentEvent) => res.write(encodeSse(e));

  if (body.action && typeof body.action === "object") {
    const { surface, source, data } = body.action;
    if (data && typeof data === "object") s.store.setData(String(surface), data);
    const result = s.store.submit(String(surface), String(source), "web");
    if (!result.action) {
      emit({ type: "error", message: `action rejected: ${JSON.stringify(result.errors)}` });
      emit({ type: "run_end", stop: "error" });
      return void res.end();
    }
    if (s.external.has(result.action.surface)) {
      // Projected by an outside agent: hand the action to it (GET /api/actions).
      s.inbox.push(result.action);
      for (const wake of s.waiters) wake();
      emit({ type: "text_delta", delta: "Sent to the agent that projected this surface." });
      emit({ type: "run_end", stop: "delivered" });
      return void res.end();
    }
    s.messages.push(actionMessage(result.action));
  } else {
    const text = String(body.message ?? "").trim();
    if (!text) {
      emit({ type: "error", message: "empty message" });
      return void res.end();
    }
    s.messages.push({ role: "user", content: text });
  }

  const started = Date.now();
  const result = await runAgent({
    provider: entry.make({ think: Boolean(body.think) }),
    model: body.model,
    store: s.store,
    messages: s.messages,
    emit,
    instructions: INSTRUCTIONS,
    schemaMode: body.schemaMode === "strict" ? "strict" : "compact",
    generation: ["tools", "constrained"].includes(body.generation) ? body.generation : "auto",
    effort: ["low", "medium", "high"].includes(body.effort) ? body.effort : undefined,
    signal: ctrl.signal,
  });
  console.log(`[chat] ${entry.id}/${body.model} → ${result.stop} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (s.busy === ctrl) s.busy = undefined;
  res.end();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;
    if (req.method === "GET" && (p === "/" || p === "/index.html")) return await serveFile(res, ROOTS.app!, "index.html");
    if (req.method === "GET" && p.startsWith("/app/")) return await serveFile(res, ROOTS.app!, decodeURIComponent(p.slice(5)));
    const pkg = /^\/pkg\/(core|web)\/(.+)$/.exec(p);
    if (req.method === "GET" && pkg) return await serveFile(res, ROOTS[pkg[1]!]!, decodeURIComponent(pkg[2]!));

    if (req.method === "GET" && p === "/api/providers") {
      return json(res, 200, PROVIDERS.map(({ id, label, available, reason, defaultModel }) => ({ id, label, available, reason: available ? undefined : reason, defaultModel })));
    }
    if (req.method === "GET" && p === "/api/models") {
      const entry = PROVIDERS.find((x) => x.id === url.searchParams.get("provider"));
      if (!entry?.available) return json(res, 400, { error: "provider unavailable" });
      try {
        const models = (await entry.make({}).listModels?.(AbortSignal.timeout(8000))) ?? [];
        // Only a declared default is suggested; the first listed model is arbitrary.
        const local = entry.id === "ollama";
        return json(res, 200, { models, default: entry.defaultModel ?? (local ? models[0] : undefined) });
      } catch (err) {
        return json(res, 502, { error: (err as Error).message, models: [], default: entry.defaultModel });
      }
    }
    if (req.method === "POST" && p === "/api/chat") return await handleChat(req, res);

    // Direct projection: any caller (a script, another agent, Claude) applies
    // a vak_* tool call to a session; open viewers update live.
    if (req.method === "POST" && p === "/api/project") {
      const body = await readJson(req);
      const s = session(String(body.session ?? "default"));
      const tool = String(body.tool ?? "vak_render");
      const diagnostics = s.store.apply(tool, body.args ?? {});
      const id = String((body.args as { surface?: unknown } | undefined)?.surface ?? "main");
      s.external.add(id);
      const snap = s.store.snapshot(id);
      const event: AgentEvent = snap ? { type: "surface", snapshot: snap } : { type: "surface_removed", id };
      for (const v of s.viewers) v(event);
      return json(res, 200, { result: formatDiagnostics(diagnostics), diagnostics, viewers: s.viewers.size });
    }
    // Long-poll for user actions on externally projected surfaces.
    if (req.method === "GET" && p === "/api/actions") {
      const s = session(url.searchParams.get("session") ?? "default");
      const timeout = Math.min(Number(url.searchParams.get("timeout") ?? 0), 600) * 1000;
      if (!s.inbox.length && timeout > 0) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(t);
            s.waiters.delete(done);
            resolve();
          };
          const t = setTimeout(done, timeout);
          s.waiters.add(done);
          req.on("close", done);
        });
      }
      return json(res, 200, { actions: s.inbox.splice(0) });
    }
    if (req.method === "GET" && p === "/api/events") {
      const s = session(url.searchParams.get("session") ?? "default");
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const send = (e: AgentEvent) => res.write(encodeSse(e));
      for (const st of s.store.list()) send({ type: "surface", snapshot: s.store.snapshot(st.id)! });
      s.viewers.add(send);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => {
        clearInterval(ping);
        s.viewers.delete(send);
      });
      return;
    }
    if (req.method === "POST" && p === "/api/reset") {
      const body = await readJson(req);
      sessions.get(String(body.session))?.busy?.abort();
      sessions.delete(String(body.session));
      return json(res, 200, { ok: true });
    }
    res.writeHead(404).end("not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: (err as Error).message });
    else res.end();
  }
});

// Bound to loopback only: the server holds API keys and runs model calls.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`vak playground → http://127.0.0.1:${PORT}`);
  console.log(`providers: ${PROVIDERS.map((p) => `${p.id}${p.available ? "" : " (off)"}`).join(", ")}`);
});
