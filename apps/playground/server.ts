// vak playground server: zero dependencies.
// - Serves the UI and our TypeScript packages to the browser, stripping types
//   on the fly (no bundler).
// - Mounts @vak/host, which runs the agent loop server-side so API keys never
//   reach the browser and streams AgentEvents as Server-Sent Events.
//
// Usage: npm run playground   (env: PORT, OLLAMA_HOST, ANTHROPIC_API_KEY,
//        OPENAI_API_KEY, GEMINI_API_KEY, OPENAI_COMPAT_BASE_URL/_API_KEY; .env is read)

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHost, serveFile } from "@vak/host";
import { hardenNetwork, loadEnvFile, ProfileCache, providersFromEnv } from "@vak/providers";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

loadEnvFile(path.join(repo, ".env"));
hardenNetwork();
const PORT = Number(process.env.PORT ?? 5177);
const PROVIDERS = providersFromEnv();

const INSTRUCTIONS = `You are the assistant inside the vak projection playground.
Today is ${new Date().toISOString().slice(0, 10)}.
Answer with rich UI whenever the answer has any structure; keep accompanying text to one short sentence, the UI carries the content.
When the user asks for examples or you lack real data, use realistic sample data and say it is sample data in a caption.
When you receive a "[ui action]" message, the user interacted with your UI: respond to it, usually by updating that surface (vak_update) or rendering a confirmation.`;

const host = createHost({
  providers: () => PROVIDERS,
  profiles: new ProfileCache(path.join(repo, ".vak/models.json")),
  instructions: INSTRUCTIONS,
  transcripts: path.join(repo, ".vak/playground"),
  viewerUrl: (session) => `http://127.0.0.1:${PORT}/?session=${encodeURIComponent(session)}`,
});

const ROOTS: Record<string, string> = {
  app: path.join(here, "public"),
  core: path.join(repo, "packages/core/src"),
  web: path.join(repo, "packages/web/src"),
};

const server = createServer(async (req, res) => {
  try {
    if (await host.handle(req, res)) return;
    const p = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && (p === "/" || p === "/index.html")) return await serveFile(res, ROOTS.app!, "index.html");
    if (req.method === "GET" && p.startsWith("/app/")) return await serveFile(res, ROOTS.app!, decodeURIComponent(p.slice(5)));
    const pkg = /^\/pkg\/(core|web)\/(.+)$/.exec(p);
    if (req.method === "GET" && pkg) return await serveFile(res, ROOTS[pkg[1]!]!, decodeURIComponent(pkg[2]!));
    res.writeHead(404).end("not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500).end((err as Error).message);
    else res.end();
  }
});

// Bound to loopback only: the server holds API keys and runs model calls.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`vak playground → http://127.0.0.1:${PORT}`);
  console.log(`providers: ${PROVIDERS.map((p) => `${p.id}${p.available ? "" : " (off)"}`).join(", ")}`);
});
