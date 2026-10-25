// MCP tools as agent tools, with the user's policy applied on every call:
// "off" tools are never offered to the model, "ask" tools wait for an
// approval, results come back wrapped as untrusted data. Type-only imports:
// this package stays free of a runtime dependency on the providers.

import type { AgentEvent } from "@vak/core";
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
  return tools
    .filter((t) => opts.policy(t) !== "off")
    .map((t) => ({
      spec: {
        name: toolName(opts.server, t.name),
        description: `${opts.label}: ${t.description ?? t.title ?? t.name}`.slice(0, 1024),
        inputSchema: (t.inputSchema ?? { type: "object" }) as AgentTool["spec"]["inputSchema"],
      },
      async execute(args, ctx) {
        const at = new Date().toISOString();
        const started = Date.now();
        let decision: ToolCallRecord["decision"] = "allowed";
        // Read the policy at call time: the user may have changed it since the turn began.
        if (opts.policy(t) === "ask") {
          const answer = await opts.approve({ id: ctx.callId ?? crypto.randomUUID(), server: opts.server, tool: t.name, title: t.annotations?.title ?? t.title ?? t.name, args }, ctx.emit, ctx.signal);
          if (answer !== "allow") {
            opts.record?.({ at, server: opts.server, tool: t.name, args, decision: "denied" });
            return `The user declined to let you run ${t.name}. Do not retry it; continue without it or ask the user.`;
          }
          decision = "approved";
        } else if (opts.policy(t) === "off") {
          return `${t.name} is turned off by the user.`;
        }
        try {
          const res = await source.callTool(t.name, args, ctx.signal);
          opts.record?.({ at, server: opts.server, tool: t.name, args, decision, ok: !res.isError, ms: Date.now() - started, preview: res.text.slice(0, 300) });
          return untrusted(opts.label, res.isError ? `error: ${res.text}` : res.text);
        } catch (err) {
          opts.record?.({ at, server: opts.server, tool: t.name, args, decision, ok: false, ms: Date.now() - started, preview: (err as Error).message });
          throw err;
        }
      },
    }));
}
