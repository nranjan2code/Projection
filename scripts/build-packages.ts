// Build the framework packages for publishing: JavaScript + type definitions
// in packages/<name>/dist, each with its own package.json (exports, sibling
// dependencies found from its imports, engines). The repo itself keeps
// running the TypeScript sources directly; only `dist` is published:
//
//   node scripts/build-packages.ts            build every package
//   npm publish packages/core/dist            (when you decide to publish)
//
// Nothing is published by this script.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(repo, "build");

const DESCRIPTION: Record<string, string> = {
  core: "Projection engine for LLM-generated UI: spec, catalog, lenient streaming parser, repair, surface store, text/Markdown/terminal projectors.",
  web: "<vak-surface>: a Web Component that renders vak surfaces with adaptive layout, charts, forms and local sorting/filtering.",
  providers: "Model providers over fetch (Anthropic, OpenAI, Gemini, Ollama, OpenAI-compatible labs), the agent loop and the capability policy.",
  host: "HTTP + SSE host for the vak agent loop: sessions, persistence, approvals, token auth, CORS and Host checks.",
  mcp: "MCP server exposing vak tools, and an MCP client with per-tool policy, approvals and untrusted-output handling.",
  telegram: "Telegram projector, form flow and bot runner for vak surfaces.",
  slack: "Slack Block Kit projector and modal forms for vak surfaces.",
  discord: "Discord Components V2 projector and paged modal forms for vak surfaces.",
  email: "HTML email projector for vak surfaces: table layout, inline styles, escaped content.",
  kit: "createVak(): the vak engine, a model and a projector in one call.",
};

const NODE_ONLY = /from "node:/;

rmSync(build, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(repo, "node_modules/typescript/bin/tsc"), "-p", path.join(repo, "tsconfig.build.json")], { stdio: "inherit" });

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

for (const name of readdirSync(build)) {
  const src = path.join(build, name, "src");
  if (!existsSync(src)) continue;
  const pkgDir = path.join(repo, "packages", name);
  const source = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as { name: string; version: string; exports: Record<string, string> | string; bin?: Record<string, string> };
  const dist = path.join(pkgDir, "dist");
  rmSync(dist, { recursive: true, force: true });
  cpSync(src, dist, { recursive: true });

  const deps = new Set<string>();
  let nodeOnly = false;
  for (const f of files(dist)) {
    let text = readFileSync(f, "utf8");
    // Declarations keep the sources' ".ts" specifiers; consumers resolve ".js".
    if (f.endsWith(".d.ts")) {
      text = text.replace(/(from\s+["']|import\(["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
      writeFileSync(f, text);
    }
    for (const m of text.matchAll(/from\s+["'](@vak\/[a-z-]+)/g)) if (m[1] !== source.name) deps.add(m[1]!);
    if (f.endsWith(".js") && NODE_ONLY.test(text)) nodeOnly = true;
  }

  const exportsMap = typeof source.exports === "string" ? { ".": source.exports } : source.exports;
  const exportsOut: Record<string, { types: string; default: string }> = {};
  for (const [key, file] of Object.entries(exportsMap)) {
    const rel = file.replace(/^\.\/src\//, "./").replace(/\.ts$/, "");
    exportsOut[key] = { types: `${rel}.d.ts`, default: `${rel}.js` };
  }
  const versions = Object.fromEntries([...deps].sort().map((d) => [d, `^${JSON.parse(readFileSync(path.join(repo, "packages", d.slice(5), "package.json"), "utf8")).version}`]));
  const out = {
    name: source.name,
    version: source.version,
    description: DESCRIPTION[name] ?? "",
    type: "module",
    exports: exportsOut,
    ...(source.bin ? { bin: Object.fromEntries(Object.entries(source.bin).map(([k, v]) => [k, v.replace(/^\.\/src\//, "./").replace(/\.ts$/, ".js")])) } : {}),
    sideEffects: false,
    ...(nodeOnly ? { engines: { node: ">=24" } } : {}),
    ...(Object.keys(versions).length ? { dependencies: versions } : {}),
    repository: { type: "git", url: "git+https://github.com/nranjan2code/Projection.git", directory: `packages/${name}` },
    keywords: ["llm", "generative-ui", "projection", "mcp", "agents"],
  };
  writeFileSync(path.join(dist, "package.json"), `${JSON.stringify(out, null, 2)}\n`);
  writeFileSync(path.join(dist, "README.md"), `# ${source.name}\n\n${out.description}\n\nPart of [vak Projection](https://github.com/nranjan2code/Projection). No runtime dependencies beyond other @vak packages${nodeOnly ? "; Node 24 or newer" : ""}.\n`);
  console.log(`${source.name.padEnd(16)} → packages/${name}/dist${Object.keys(versions).length ? `  (needs ${Object.keys(versions).join(", ")})` : ""}${nodeOnly ? "  [node]" : ""}`);
}
rmSync(build, { recursive: true, force: true });
