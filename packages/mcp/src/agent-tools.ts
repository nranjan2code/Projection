// MCP tools as agent tools, with the user's policy applied on every call:
// "off" tools are never offered to the model, "ask" tools wait for an
// approval, results come back wrapped as untrusted data. Type-only imports:
// this package stays free of a runtime dependency on the providers.

import { validate, type AgentEvent } from "@vak/core";
import type { AgentTool } from "@vak/providers";
import { type McpClient, type McpToolInfo, toolName, untrusted } from "./client.ts";

export type ToolPolicy = "allow" | "ask" | "off";

export interface ToolCallRecord {
  at: string;
  server: string;
  tool: string;
  args: unknown;
  decision: "allowed" | "approved" | "denied";
  ok?: boolean;
  ms?: number;
  /** First part of the result, for the call log. */
  preview?: string;
}

export interface ApprovalRequest {
  id: string;
  server: string;
  tool: string;
  title: string;
  args: Record<string, unknown>;
}

export interface McpToolsOptions {
  /** Successful transport result, before untrusted-text wrapping; never a permission grant. */
  observe?: (tool: string, args: Record<string, unknown>, result: { text: string; isError?: boolean }) => void;
  /** Id used in tool names and the call log (e.g. "files"). */
  server: string;
  label: string;
  policy: (tool: McpToolInfo) => ToolPolicy;
  /** Decide an "ask" call; the host shows the request and waits for the user. */
  approve: (req: ApprovalRequest, emit?: (e: AgentEvent) => void, signal?: AbortSignal) => Promise<"allow" | "deny">;
  record?: (r: ToolCallRecord) => void;
}

/** Any tool source (an MCP client, built-in tools) the adapter can drive. */
export interface ToolSource {
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; isError: boolean }>;
}

export function agentTools(source: ToolSource | McpClient, tools: McpToolInfo[], opts: McpToolsOptions): AgentTool[] {
  const names = tools.map(t => toolName(opts.server, t.name));
  if (new Set(names).size !== names.length) throw new Error(`Ambiguous tool names from ${opts.server}`);
  return tools
    .filter((t) => opts.policy(t) !== "off")
    .map((t) => ({
      spec: {
        name: toolName(opts.server, t.name),
        description: `${opts.label}: ${t.description ?? t.title ?? t.name}`.slice(0, 1024),
        inputSchema: (t.inputSchema ?? { type: "object" }) as AgentTool["spec"]["inputSchema"],
      },
      async execute(args, ctx) {
        ctx.signal?.throwIfAborted();
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Tool arguments must be an object");
        if (validate((t.inputSchema ?? {}) as AgentTool["spec"]["inputSchema"], args).length) throw new Error(`Invalid arguments for ${t.name}`);
        const at = new Date().toISOString();
        const started = Date.now();
        let decision: ToolCallRecord["decision"] = "allowed";
        // Read the policy at call time: the user may have changed it since the turn began.
        if (opts.policy(t) === "ask") {
          const answer = await opts.approve({ id: ctx.callId ?? crypto.randomUUID(), server: opts.server, tool: t.name, title: t.annotations?.title ?? t.title ?? t.name, args }, ctx.emit, ctx.signal);
          if (answer !== "allow") {
            opts.record?.({ at, server: opts.server, tool: t.name, args, decision: "denied" });
            return { text: `The user declined to let you run ${t.name}. Do not retry it; continue without it or ask the user.`, isError: true };
          }
          decision = "approved";
        } else if (opts.policy(t) === "off") {
          opts.record?.({ at, server: opts.server, tool: t.name, args, decision: "denied" });
          return { text: `${t.name} is turned off by the user.`, isError: true };
        }
        // Approval can wait while settings change. Recheck at the actual dispatch boundary.
        ctx.signal?.throwIfAborted();
        if (opts.policy(t) === "off") {
          opts.record?.({ at, server: opts.server, tool: t.name, args, decision: "denied" });
          return { text: `${t.name} is no longer authorized.`, isError: true };
        }
        try {
          const res = await source.callTool(t.name, args, ctx.signal);
          opts.observe?.(t.name, structuredClone(args), { text: res.text, isError: res.isError });
          opts.record?.({ at, server: opts.server, tool: t.name, args, decision, ok: !res.isError, ms: Date.now() - started, preview: res.text.slice(0, 300) });
          const text = untrusted(opts.label, res.isError ? `error: ${res.text}` : res.text);
          return res.isError ? { text, isError: true } : text;
        } catch (err) {
          opts.record?.({ at, server: opts.server, tool: t.name, args, decision, ok: false, ms: Date.now() - started, preview: (err as Error).message });
          throw err;
        }
      },
    }));
}
