// Integrations: installing, configuring and running the MCP servers an app
// offers, with the framework's safety rules applied the same way for every
// app. The app decides WHAT to offer (its catalog: which servers, versions,
// descriptions) and where secrets live (a SecretStore it passes in); this
// module decides HOW they are installed and run. Security decisions, in order
// of how much they matter:
// - Third-party code is pinned: an exact version, and `npm --before` keeps
//   every dependency to releases at least PINNED_MIN_AGE_DAYS old (a
//   compromised release is usually caught within days). `--ignore-scripts`:
//   nothing runs at install.
// - Each server runs in its own folder as HOME/TMPDIR/cwd, with only the
//   variables it declares: the app's API keys never reach it (minimalEnv).
// - Folder settings are absolute, existing, and never a system root or the
//   whole home folder.
// - Every tool has a policy (allow / ask / off). Defaults: local reads are
//   allowed, writes and anything reaching the internet ask. "Allow for this
//   chat" lasts for one conversation only.
// - A server the user adds is marked unverified and every tool asks.
// - Calls are logged (<dataDir>/logs/tools.jsonl) and kept per integration.
//
// On disk, under the app's data folder: integrations.json (state),
// integrations/<id>/pkg (the npm install), integrations/<id>/home (the
// server's HOME), logs/tools.jsonl.

import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentEvent } from "@vak/core";
import type { AgentTool } from "@vak/providers";
import { agentTools, type ApprovalRequest, type ToolCallRecord, type ToolPolicy } from "./agent-tools.ts";
import type { BuiltinServer } from "./builtin.ts";
import { defaultDecision, McpClient, type McpToolInfo } from "./client.ts";

const run = promisify(execFile);

/** Every installed package and dependency must have been public at least this long. */
export const PINNED_MIN_AGE_DAYS = 14;

export type Trust = "built-in" | "official" | "vendor" | "custom";

export interface ConfigField {
  key: string;
  label: string;
  kind: "secret" | "folders" | "text";
  required?: boolean;
  help?: string;
  /** Passed to the server as this environment variable. */
  env?: string;
  /** Sent as an HTTP header (remote servers): "Authorization: Bearer {value}". */
  header?: { name: string; format: string };
}

export interface CatalogEntry {
  id: string;
  name: string;
  publisher: string;
  trust: Trust;
  /** One line for the card. */
  summary: string;
  description: string;
  homepage: string;
  /** Icon id the app's UI draws. */
  icon: string;
  /** What it can reach, in plain words, shown before install. */
  access: string[];
  source:
    | { kind: "builtin"; server: () => BuiltinServer }
    | { kind: "npm"; package: string; version: string; bin: string; args?: (config: Record<string, unknown>, dir: string) => string[]; env?: (dir: string) => Record<string, string> }
    | { kind: "http"; url: string }
    | { kind: "stdio"; command: string; args: string[] };
  config: ConfigField[];
}

/** Where integration secrets are kept; the app chooses (Keychain, a 0600 file). */
export interface SecretStore {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): void;
}

interface State {
  installed?: string;
  enabled: boolean;
  config: Record<string, unknown>;
  policies: Record<string, ToolPolicy>;
  tools?: McpToolInfo[];
}

interface Saved {
  integrations: Record<string, State>;
  custom: CatalogEntry[];
}

export interface IntegrationView {
  entry: Omit<CatalogEntry, "source"> & { sourceKind: CatalogEntry["source"]["kind"]; version?: string; package?: string; url?: string; command?: string };
  installed: boolean;
  version?: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secretsSet: Record<string, boolean>;
  missing: string[];
  status: "off" | "ready" | "error" | "needs-setup" | "not-installed";
  error?: string;
  tools: (McpToolInfo & { policy: ToolPolicy; defaultPolicy: ToolPolicy })[];
  calls: ToolCallRecord[];
}

export interface IntegrationsOptions {
  observe?: (request: { session: string; server: string; tool: string; args: Record<string, unknown> }, result: { text: string; isError?: boolean }) => void;
  /** The app's data folder; the layout under it is described at the top of this file. */
  dataDir: string;
  /** What the app offers. Servers the user adds are kept in the saved state. */
  catalog: CatalogEntry[];
  secrets: SecretStore;
  log?: (line: string) => void;
  /** The host's approval flow ("allow-chat" allows the tool for the rest of that session). */
  approve: (req: ApprovalRequest, emit?: (e: AgentEvent) => void, signal?: AbortSignal) => Promise<"allow" | "allow-chat" | "deny">;
  /** npm to install with: a command, or a path to a script (npm-cli.js) run with this Node. */
  npm?: string;
  /** Built-in entries switched on at first run (they run no outside code). */
  enabledAtFirstRun?: string[];
}

/** The npm arguments for a pinned, script-free install of `pkg@version` into `target`. */
export function pinnedInstallArgs(pkg: string, version: string, target: string, now = Date.now()): string[] {
  if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/.test(version)) throw new Error(`${pkg}: pin an exact version, not "${version}"`);
  const before = new Date(now - PINNED_MIN_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return ["install", `${pkg}@${version}`, "--prefix", target, "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", `--before=${before}`];
}

/** Folders a server may see: absolute, existing, and never a whole system root or the home folder. */
export function checkFolders(v: unknown, home = process.env.HOME ?? ""): string[] {
  const list = (Array.isArray(v) ? v : String(v ?? "").split("\n")).map((x) => String(x).trim()).filter(Boolean);
  for (const f of list) {
    if (!path.isAbsolute(f)) throw new Error(`${f}: use a full path`);
    const n = path.resolve(f);
    if (["/", "/Users", "/home", "/System", "/Library", "/etc", "/var", "/private", home].includes(n)) throw new Error(`${n}: too broad, choose a specific folder`);
    if (!existsSync(n)) throw new Error(`${n} doesn't exist`);
  }
  return [...new Set(list.map((f) => path.resolve(f)))];
}

export class Integrations {
  private file: string;
  private dir: string;
  private saved: Saved;
  private clients = new Map<string, McpClient>();
  private builtins = new Map<string, BuiltinServer>();
  private errors = new Map<string, string>();
  private calls = new Map<string, ToolCallRecord[]>();
  /** "Allow for this chat": session → server:tool. */
  private chatAllowed = new Map<string, Set<string>>();

  private opts: IntegrationsOptions;

  constructor(opts: IntegrationsOptions) {
    this.opts = opts;
    this.dir = path.join(opts.dataDir, "integrations");
    this.file = path.join(opts.dataDir, "integrations.json");
    mkdirSync(this.dir, { recursive: true });
    try {
      this.saved = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      const builtin = new Set(opts.catalog.filter((e) => e.source.kind === "builtin").map((e) => e.id));
      const on = (opts.enabledAtFirstRun ?? []).filter((id) => builtin.has(id));
      this.saved = { integrations: Object.fromEntries(on.map((id) => [id, { installed: "built-in", enabled: true, config: {}, policies: {} }])), custom: [] };
    }
  }

  private log(line: string): void {
    this.opts.log?.(line);
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.saved, null, 2));
  }

  entries(): CatalogEntry[] {
    return [...this.opts.catalog, ...this.saved.custom];
  }

  private entry(id: string): CatalogEntry {
    const e = this.entries().find((x) => x.id === id);
    if (!e) throw new Error(`unknown integration ${id}`);
    return e;
  }

  private state(id: string): State {
    return (this.saved.integrations[id] ??= { enabled: false, config: {}, policies: {} });
  }

  private secretName(id: string, key: string): string {
    return `INTEGRATION_${id.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_${key.toUpperCase()}`;
  }

  private missing(e: CatalogEntry, st: State): string[] {
    return e.config
      .filter((f) => f.required)
      .filter((f) => (f.kind === "secret" ? !this.opts.secrets.get(this.secretName(e.id, f.key)) : f.kind === "folders" ? !(Array.isArray(st.config[f.key]) && (st.config[f.key] as unknown[]).length) : !st.config[f.key]))
      .map((f) => f.label);
  }

  policyOf(id: string, tool: McpToolInfo): ToolPolicy {
    return this.state(id).policies[tool.name] ?? (defaultDecision(tool) === "allow" ? "allow" : "ask");
  }

  view(): IntegrationView[] {
    return this.entries().map((e) => {
      const st = this.saved.integrations[e.id] ?? { enabled: false, config: {}, policies: {} };
      const installed = e.source.kind === "builtin" || e.source.kind === "http" || e.source.kind === "stdio" ? true : Boolean(st.installed);
      const missing = this.missing(e, st);
      const error = this.errors.get(e.id);
      const { source, ...rest } = e;
      return {
        entry: { ...rest, sourceKind: source.kind, version: source.kind === "npm" ? source.version : undefined, package: source.kind === "npm" ? source.package : undefined, url: source.kind === "http" ? source.url : undefined, command: source.kind === "stdio" ? [source.command, ...source.args].join(" ") : undefined },
        installed,
        version: st.installed,
        enabled: st.enabled,
        config: st.config,
        secretsSet: Object.fromEntries(e.config.filter((f) => f.kind === "secret").map((f) => [f.key, Boolean(this.opts.secrets.get(this.secretName(e.id, f.key)))])),
        missing,
        status: !installed ? "not-installed" : missing.length ? "needs-setup" : !st.enabled ? "off" : error ? "error" : "ready",
        error,
        tools: (st.tools ?? []).map((t) => ({ ...t, policy: this.policyOf(e.id, t), defaultPolicy: defaultDecision(t) === "allow" ? "allow" : "ask" })),
        calls: (this.calls.get(e.id) ?? []).slice(-30).reverse(),
      };
    });
  }

  // --- install -------------------------------------------------------------------
  async install(id: string): Promise<void> {
    const e = this.entry(id);
    const st = this.state(id);
    if (e.source.kind !== "npm") {
      st.installed = e.source.kind === "builtin" ? "built-in" : "remote";
      this.persist();
      return;
    }
    const target = path.join(this.dir, id, "pkg");
    mkdirSync(target, { recursive: true });
    const npmArgs = pinnedInstallArgs(e.source.package, e.source.version, target);
    const npm = this.opts.npm ?? "npm";
    this.log(`integrations: installing ${e.source.package}@${e.source.version} (${npmArgs.at(-1)})`);
    try {
      if (/\.[cm]?js$/.test(npm)) await run(process.execPath, [npm, ...npmArgs], { cwd: target, timeout: 300_000 });
      else await run(npm, npmArgs, { cwd: target, timeout: 300_000 });
    } catch (err) {
      const msg = (err as { stderr?: string }).stderr?.split("\n").find((l) => /ERR!/.test(l)) ?? (err as Error).message;
      throw new Error(`install failed: ${msg}`);
    }
    st.installed = e.source.version;
    this.errors.delete(id);
    this.persist();
  }

  async uninstall(id: string): Promise<void> {
    await this.stop(id);
    const e = this.entry(id);
    rmSync(path.join(this.dir, id), { recursive: true, force: true });
    for (const f of e.config) if (f.kind === "secret") this.opts.secrets.delete(this.secretName(id, f.key));
    delete this.saved.integrations[id];
    if (e.trust === "custom") this.saved.custom = this.saved.custom.filter((c) => c.id !== id);
    this.calls.delete(id);
    this.errors.delete(id);
    this.persist();
  }

  /** A server the user adds: always shown as unverified; every tool asks until changed. */
  addCustom(input: { name: string; command?: string; args?: string[]; url?: string; token?: string }): string {
    const name = input.name.trim().slice(0, 60);
    if (!name) throw new Error("name required");
    const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 48);
    if (this.entries().some((e) => e.id === id)) throw new Error(`${name} already exists`);
    let source: CatalogEntry["source"];
    if (input.url) {
      const u = new URL(input.url);
      // A remote server gets your data and maybe a token: https only (or this machine).
      if (u.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new Error("remote servers must use https");
      source = { kind: "http", url: u.href };
    } else if (input.command?.trim()) source = { kind: "stdio", command: input.command.trim(), args: input.args ?? [] };
    else throw new Error("a command or a URL is required");
    const entry: CatalogEntry = {
      id,
      name,
      publisher: "Added by you",
      trust: "custom",
      summary: source.kind === "http" ? source.url : [source.command, ...source.args].join(" "),
      description: "A server you added. It has not been reviewed: it runs with the same limits as the others (its own folder, no access to your keys), and every tool asks before it runs until you change that.",
      homepage: source.kind === "http" ? source.url : "",
      icon: "plug",
      access: [source.kind === "http" ? `Data you approve is sent to ${new URL(source.url).host}` : "Runs a program on this computer"],
      source,
      config: source.kind === "http" ? [{ key: "token", label: "Bearer token (optional)", kind: "secret", header: { name: "authorization", format: "Bearer {value}" } }] : [],
    };
    this.saved.custom.push(entry);
    this.state(id).installed = source.kind === "http" ? "remote" : "local";
    if (input.token) this.opts.secrets.set(this.secretName(id, "token"), input.token);
    this.persist();
    return id;
  }

  // --- configure -------------------------------------------------------------------
  async configure(id: string, change: { enabled?: boolean; config?: Record<string, unknown>; secrets?: Record<string, string | null>; policies?: Record<string, ToolPolicy> }): Promise<void> {
    const e = this.entry(id);
    const st = this.state(id);
    let restart = false;
    if (change.config) {
      for (const f of e.config) {
        if (!(f.key in change.config)) continue;
        const v = change.config[f.key];
        if (f.kind === "folders") st.config[f.key] = checkFolders(v);
        else if (f.kind === "text") st.config[f.key] = String(v ?? "").trim();
      }
      restart = true;
    }
    for (const [key, value] of Object.entries(change.secrets ?? {})) {
      const f = e.config.find((x) => x.key === key && x.kind === "secret");
      if (!f) continue;
      if (value && /[\s"\\]/.test(value)) throw new Error(`${f.label} contains characters a key never has`);
      if (value) this.opts.secrets.set(this.secretName(id, key), value);
      else this.opts.secrets.delete(this.secretName(id, key));
      restart = true;
    }
    for (const [tool, p] of Object.entries(change.policies ?? {})) if (["allow", "ask", "off"].includes(p)) st.policies[tool] = p;
    if (typeof change.enabled === "boolean") {
      st.enabled = change.enabled;
      restart = true;
    }
    this.persist();
    if (restart) {
      await this.stop(id);
      if (st.enabled && !this.missing(e, st).length) await this.refresh(id);
    }
  }

  // --- running ------------------------------------------------------------------------
  private source(id: string): BuiltinServer | McpClient {
    const e = this.entry(id);
    const st = this.state(id);
    if (e.source.kind === "builtin") {
      let b = this.builtins.get(id);
      if (!b) this.builtins.set(id, (b = e.source.server()));
      return b;
    }
    let c = this.clients.get(id);
    if (c) return c;
    const home = path.join(this.dir, id, "home");
    const env: Record<string, string> = {};
    const headers: Record<string, string> = {};
    for (const f of e.config) {
      if (f.kind !== "secret") continue;
      const v = this.opts.secrets.get(this.secretName(id, f.key));
      if (!v) continue;
      if (f.env) env[f.env] = v;
      if (f.header) headers[f.header.name] = f.header.format.replace("{value}", v);
    }
    const log = (line: string) => this.log(line);
    if (e.source.kind === "npm") {
      const script = path.join(this.dir, id, "pkg", "node_modules", e.source.package, e.source.bin);
      if (!existsSync(script)) throw new Error("not installed");
      Object.assign(env, e.source.env?.(path.join(this.dir, id)) ?? {});
      c = new McpClient({ name: e.name, log, transport: { kind: "stdio", command: process.execPath, args: [script, ...(e.source.args?.(st.config, path.join(this.dir, id)) ?? [])], env, sandboxDir: home } });
    } else if (e.source.kind === "stdio") {
      c = new McpClient({ name: e.name, log, transport: { kind: "stdio", command: e.source.command, args: e.source.args, env, sandboxDir: home } });
    } else {
      c = new McpClient({ name: e.name, log, transport: { kind: "http", url: (e.source as { url: string }).url, headers } });
    }
    this.clients.set(id, c);
    return c;
  }

  /** Connect and read the tool list (kept, so a settings screen shows tools while a server is stopped). */
  async refresh(id: string): Promise<void> {
    try {
      const src = this.source(id);
      const tools = "tools" in src ? src.tools : await src.listTools();
      this.state(id).tools = tools;
      this.errors.delete(id);
      this.persist();
    } catch (err) {
      this.errors.set(id, (err as Error).message);
      await this.stop(id);
    }
  }

  async stop(id: string): Promise<void> {
    this.clients.get(id)?.close();
    this.clients.delete(id);
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.clients.keys()]) await this.stop(id);
  }

  private record(id: string, r: ToolCallRecord): void {
    const list = this.calls.get(id) ?? [];
    list.push(r);
    if (list.length > 100) list.shift();
    this.calls.set(id, list);
    try {
      appendFileSync(path.join(this.opts.dataDir, "logs", "tools.jsonl"), `${JSON.stringify({ ...r, preview: undefined })}\n`);
    } catch {
      /* the log is a convenience */
    }
  }

  /** The tools a turn in `session` may use, with the policy and approvals wired in. */
  async toolsFor(session: string): Promise<AgentTool[]> {
    const out: AgentTool[] = [];
    for (const e of this.entries()) {
      const st = this.saved.integrations[e.id];
      if (!st?.enabled || this.missing(e, st).length || (e.source.kind === "npm" && !st.installed)) continue;
      if (!st.tools) await this.refresh(e.id);
      if (!this.state(e.id).tools?.length || this.errors.has(e.id)) continue;
      const allowed = this.chatAllowed.get(session) ?? new Set<string>();
      out.push(
        ...agentTools(this.source(e.id), this.state(e.id).tools!, {
          server: e.id,
          observe: (tool, args, result) => this.opts.observe?.({ session, server: e.id, tool, args }, result),
          label: e.name,
          policy: (t) => (allowed.has(`${e.id}:${t.name}`) && this.policyOf(e.id, t) === "ask" ? "allow" : this.policyOf(e.id, t)),
          approve: async (req, emit, signal) => {
            const d = await this.opts.approve(req, emit, signal);
            if (d === "allow-chat") {
              allowed.add(`${e.id}:${req.tool}`);
              this.chatAllowed.set(session, allowed);
            }
            return d === "deny" ? "deny" : "allow";
          },
          record: (r) => this.record(e.id, r),
        }),
      );
    }
    return out;
  }

  /** Run one tool on the user's own request (a settings "Try it"): no approval. */
  async test(id: string, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; ms: number }> {
    const started = Date.now();
    const res = await this.source(id).callTool(tool, args, AbortSignal.timeout(60_000));
    this.record(id, { at: new Date().toISOString(), server: id, tool, args, decision: "allowed", ok: !res.isError, ms: Date.now() - started, preview: res.text.slice(0, 300) });
    return { ...res, text: res.text.slice(0, 20_000), ms: Date.now() - started };
  }
}
