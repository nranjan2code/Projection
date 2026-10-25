// Static files for a host that serves its own UI with no bundler: TypeScript
// is stripped on the fly with Node's built-in stripTypeScriptTypes.

import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const tsCache = new Map<string, { mtime: number; code: string }>();

/** Serve `rel` from inside `root` (never outside it). */
export async function serveFile(res: ServerResponse, root: string, rel: string): Promise<void> {
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
