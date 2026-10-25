// Stands in for npm-cli.js in integration tests: records the arguments it was
// given, and "installs" the package by linking the echo server as its bin, so
// no network or registry is involved.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
const spec = args[1];
const pkg = spec.slice(0, spec.lastIndexOf("@"));
writeFileSync(path.join(prefix, "npm-args.json"), JSON.stringify(args));
const dir = path.join(prefix, "node_modules", pkg, "dist");
mkdirSync(dir, { recursive: true });
const echo = path.join(path.dirname(fileURLToPath(import.meta.url)), "echo-server.mjs");
writeFileSync(path.join(dir, "index.js"), `import ${JSON.stringify(echo)};\n`);
