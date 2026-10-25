// vak playground: the desktop app's interface in a browser, for development.
// Runs the same app server as the desktop sidecar (engine, settings, channels)
// open on loopback :5177, serving the same built UI (apps/desktop/dist), so
// the playground and the desktop app are one interface. Outside agents
// project into it through /api/project (the MCP server, the bench).
//
// Usage: npm run playground   (builds the UI first; env: PORT; keys from .env)

import path from "node:path";
import { fileURLToPath } from "node:url";
import { startAppServer } from "../desktop/sidecar/server.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = await startAppServer({
  dataDir: path.join(repo, ".vak/playground"),
  envFiles: [path.join(repo, ".env")],
  keychainService: "com.vakprojection.playground",
  // Shared with the bench and scripts, so a calibration is paid for once.
  profilesPath: path.join(repo, ".vak/models.json"),
  // AGENTS.md: raw model output per session lives in .vak/playground/<session>.jsonl.
  transcriptsDir: path.join(repo, ".vak/playground"),
  port: Number(process.env.PORT ?? 5177),
  access: "open",
  uiDir: path.join(repo, "apps/desktop/dist"),
  appName: "the vak playground",
});
console.log(`vak playground → ${app.url}`);
