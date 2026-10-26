// vak playground: the framework's own viewer and test bench, with no app on
// top. @vak/host runs the model and one page draws a session's surfaces with
// <vak-surface>. Outside agents project into it through /api/project (the MCP
// server, `bench report`), and buttons on their surfaces go back to them
// through /api/actions. Apps built on the framework (Vakyartha) have their own UI.
//
// Usage: npm run playground   →  http://127.0.0.1:5177/?session=<id>[&model=provider:model]
// Env: PORT; keys from .env

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHost, serveFile } from "@vak/host";
import { loadEnvFile, ProfileCache, providersFromEnv } from "@vak/providers";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
loadEnvFile(path.join(repo, ".env"));
const port = Number(process.env.PORT ?? 5177);

const host = createHost({
  providers: () => providersFromEnv(),
  // Shared with the bench and scripts, so a calibration is paid for once.
  profiles: new ProfileCache(path.join(repo, ".vak/models.json")),
  // AGENTS.md: raw model output per session lives in .vak/playground/<session>.jsonl.
  transcripts: path.join(repo, ".vak/playground"),
  sessionsDir: path.join(repo, ".vak/playground/sessions"),
  viewerUrl: (session) => `http://127.0.0.1:${port}/?session=${encodeURIComponent(session)}`,
  instructions: "Answer with rich UI; keep text to one sentence.",
});

createServer(async (req, res) => {
  if (await host.handle(req, res)) return;
  const p = new URL(req.url ?? "/", "http://x").pathname;
  if (p === "/") return serveFile(res, here, "index.html");
  if (p === "/styles") return serveFile(res, here, "styles.html");
  if (p === "/style-examples.ts") return serveFile(res, here, "style-examples.ts");
  // The browser loads the packages' TypeScript, types stripped on the fly.
  const m = /^\/pkg\/(core|web)\/(.+)$/.exec(p);
  if (m) return serveFile(res, path.join(repo, "packages", m[1]!, "src"), m[2]!);
  res.writeHead(404).end();
}).listen(port, "127.0.0.1", () => console.log(`vak playground → http://127.0.0.1:${port}/?session=mcp`));
