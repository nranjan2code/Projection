// A dual-era MCP server over stdio, written from the spec (no SDK).
//
// Modern (2026-07-28+): stateless; every request carries
//   _meta["io.modelcontextprotocol/protocolVersion"] and clientCapabilities;
//   `server/discover` reports versions, capabilities, identity.
// Legacy (2025-11-25 and earlier): an `initialize` handshake selects legacy
//   semantics for the rest of the stdio process.
//
// stdio framing: one JSON-RPC message per line on stdin/stdout; stdout carries
// nothing else (logs go to stderr).

import { createInterface } from "node:readline";

export const MODERN_VERSIONS = ["2026-07-28"];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

const META = {
  version: "io.modelcontextprotocol/protocolVersion",
  capabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
};

const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unsupportedVersion: -32022,
};

export interface ToolContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ServerInfo {
  name: string;
  version: string;
}

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Reply = Record<string, unknown>;

class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export class McpServer {
  readonly info: ServerInfo;
  readonly instructions: string;
  private tools = new Map<string, ToolDef>();
  /** Set once a legacy client sends `initialize`; scoped to this process. */
  private legacyVersion?: string;

  constructor(info: ServerInfo, instructions: string, tools: ToolDef[]) {
    this.info = info;
    this.instructions = instructions;
    for (const t of tools) this.tools.set(t.name, t);
  }

  /** Handle one parsed message; returns the reply, or undefined for notifications. */
  async handle(msg: Message): Promise<Reply | undefined> {
    const isNotification = msg.id === undefined || msg.id === null;
    try {
      if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") throw new RpcError(ERR.invalidRequest, "invalid JSON-RPC request");
      const result = await this.dispatch(msg.method, msg.params ?? {});
      if (isNotification) return undefined;
      return { jsonrpc: "2.0", id: msg.id, result };
    } catch (err) {
      if (isNotification) return undefined;
      const e = err instanceof RpcError ? err : new RpcError(ERR.internal, (err as Error).message);
      return { jsonrpc: "2.0", id: msg.id ?? null, error: { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) } };
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "initialize") return this.initialize(params);
    if (method.startsWith("notifications/")) return undefined;

    const modern = this.requireEra(params);
    const wrap = (result: Record<string, unknown>) =>
      modern ? { resultType: "complete", ...result, _meta: { [META.serverInfo]: this.info } } : result;

    switch (method) {
      case "server/discover":
        return wrap({ supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], capabilities: { tools: {} }, instructions: this.instructions });
      case "ping":
        return wrap({});
      case "tools/list":
        return wrap({
          tools: [...this.tools.values()].map(({ name, title, description, inputSchema }) => ({ name, ...(title ? { title } : {}), description, inputSchema })),
        });
      case "tools/call": {
        const name = params.name;
        const tool = typeof name === "string" ? this.tools.get(name) : undefined;
        if (!tool) throw new RpcError(ERR.invalidParams, `unknown tool: ${String(name)}`);
        const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
        let result: ToolResult;
        try {
          result = await tool.call(args);
        } catch (err) {
          // Tool failures are results the model can read, not protocol errors.
          result = { content: [{ type: "text", text: `error: ${(err as Error).message}` }], isError: true };
        }
        return wrap({ ...result });
      }
      default:
        throw new RpcError(ERR.methodNotFound, `method not found: ${method}`);
    }
  }

  /** Legacy session, or a modern request carrying the required per-request fields. Returns true when modern. */
  private requireEra(params: Record<string, unknown>): boolean {
    const meta = (params._meta ?? {}) as Record<string, unknown>;
    const version = meta[META.version];
    if (version === undefined && this.legacyVersion) return false;
    if (typeof version !== "string" || meta[META.capabilities] === undefined) {
      throw new RpcError(ERR.invalidParams, `missing _meta["${META.version}"] or _meta["${META.capabilities}"]`);
    }
    if (!MODERN_VERSIONS.includes(version)) {
      throw new RpcError(ERR.unsupportedVersion, "Unsupported protocol version", { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested: version });
    }
    return true;
  }

  private initialize(params: Record<string, unknown>): unknown {
    const requested = String(params.protocolVersion ?? "");
    // Legacy negotiation: echo a supported version, else offer our newest legacy one.
    this.legacyVersion = LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
    return {
      protocolVersion: this.legacyVersion,
      capabilities: { tools: {} },
      serverInfo: this.info,
      instructions: this.instructions,
    };
  }

  /** Serve on stdin/stdout until stdin closes. */
  serveStdio(log: (line: string) => void = (l) => process.stderr.write(`${l}\n`)): void {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on("line", async (line) => {
      if (!line.trim()) return;
      let msg: Message;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: ERR.parse, message: "parse error" } }) + "\n");
        return;
      }
      const reply = await this.handle(msg);
      if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
    });
    rl.on("close", () => process.exit(0));
    log(`${this.info.name} ${this.info.version} ready on stdio (modern ${MODERN_VERSIONS.join(", ")}; legacy ${LEGACY_VERSIONS.join(", ")})`);
  }
}
