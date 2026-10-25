// The smallest web app on vak: @vak/host runs the model, one HTML page shows
// the interfaces with <vak-surface>. No framework, no bundler:
//   node examples/web-page/server.ts   →  http://127.0.0.1:5180

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHost, serveFile } from "@vak/host";
import { loadEnvFile, ProfileCache, providersFromEnv } from "@vak/providers";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
loadEnvFile(path.join(repo, ".env"));

const host = createHost({
  providers: () => providersFromEnv(),
  profiles: new ProfileCache(path.join(repo, ".vak/models.json")),
  instructions: "Answer with rich UI; keep text to one sentence.",
});

createServer(async (req, res) => {
  if (await host.handle(req, res)) return;
  const p = new URL(req.url ?? "/", "http://x").pathname;
  if (p === "/") return serveFile(res, here, "index.html");
  // The browser loads the packages' TypeScript, types stripped on the fly.
  const m = /^\/pkg\/(core|web)\/(.+)$/.exec(p);
  if (m) return serveFile(res, path.join(repo, "packages", m[1]!, "src"), m[2]!);
  res.writeHead(404).end();
}).listen(5180, "127.0.0.1", () => console.log("http://127.0.0.1:5180"));
