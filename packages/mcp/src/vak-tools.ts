// vak as MCP tools: any MCP host's model can project UI into the vak
// playground viewer and receive what the user does with it.

import { basicCatalog, type Catalog, systemPrompt, TOOL_REMOVE, TOOL_RENDER, TOOL_UPDATE, toolDefinitions, toWireSchema } from "@vak/core";
import type { ToolDef, ToolResult } from "./server.ts";

export interface VakMcpOptions {
  /** Playground base URL (its /api/project and /api/actions endpoints). */
  url: string;
  /** Session the surfaces belong to; the viewer is `${url}/?session=${session}`. */
  session: string;
  catalog?: Catalog;
}

const text = (t: string, extra: Partial<ToolResult> = {}): ToolResult => ({ content: [{ type: "text", text: t }], ...extra });

async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`vak viewer not reachable at ${new URL(url).origin} (${(err as Error).message}). Start it with: npm run playground`);
  }
  if (!res.ok) throw new Error(`viewer ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Record<string, unknown>;
}

export function vakInstructions(opts: VakMcpOptions): string {
  return [
    `Show rich, interactive UI to the user with vak. Surfaces appear in the viewer at ${opts.url}/?session=${encodeURIComponent(opts.session)}.`,
    "After showing a form or buttons, call vak_wait_action to receive what the user submits, then respond (often with vak_update).",
    "Each result includes the surface as text: check it shows what you intended.",
    "",
    systemPrompt(opts.catalog ?? basicCatalog),
  ].join("\n");
}

export function vakTools(opts: VakMcpOptions): ToolDef[] {
  const defs = toolDefinitions(opts.catalog ?? basicCatalog, { mode: "compact" });
  const project = (tool: string) => async (args: Record<string, unknown>): Promise<ToolResult> => {
    const out = await call(`${opts.url}/api/project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: opts.session, tool, args }),
    });
    const diagnostics = (out.diagnostics as { severity: string }[] | undefined) ?? [];
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const body = [
      String(out.result ?? ""),
      out.text ? `\nThe user now sees (${String(out.url)}):\n${String(out.text)}` : "",
      out.viewers === 0 ? `\nNo viewer is open yet; ask the user to open ${String(out.url)}` : "",
    ].join("");
    return text(body, {
      structuredContent: { surface: out.surface, url: out.url, viewers: out.viewers, errors, diagnostics },
      ...(errors ? { isError: true } : {}),
    });
  };

  const byName = Object.fromEntries(defs.map((d) => [d.name, d]));
  return [
    { name: TOOL_RENDER, title: "Show UI", description: byName[TOOL_RENDER]!.description, inputSchema: toWireSchema(byName[TOOL_RENDER]!.inputSchema) as Record<string, unknown>, call: project(TOOL_RENDER) },
    { name: TOOL_UPDATE, title: "Update UI", description: byName[TOOL_UPDATE]!.description, inputSchema: toWireSchema(byName[TOOL_UPDATE]!.inputSchema) as Record<string, unknown>, call: project(TOOL_UPDATE) },
    { name: TOOL_REMOVE, title: "Remove UI", description: byName[TOOL_REMOVE]!.description, inputSchema: toWireSchema(byName[TOOL_REMOVE]!.inputSchema) as Record<string, unknown>, call: project(TOOL_REMOVE) },
    {
      name: "vak_wait_action",
      title: "Wait for the user",
      description: "Wait for the user to submit a form or press a button on a surface you showed. Returns the actions with their data, or reports that none arrived in time.",
      inputSchema: {
        type: "object",
        properties: {
          surface: { type: "string", description: "only actions from this surface; omit for any" },
          timeoutSeconds: { type: "integer", minimum: 1, maximum: 600, description: "how long to wait (default 50)" },
        },
      },
      call: async (args) => {
        const timeout = Math.min(Math.max(Number(args.timeoutSeconds ?? 50) || 50, 1), 600);
        const q = new URLSearchParams({ session: opts.session, timeout: String(timeout), ...(typeof args.surface === "string" ? { surface: args.surface } : {}) });
        const out = await call(`${opts.url}/api/actions?${q}`);
        const actions = (out.actions as unknown[] | undefined) ?? [];
        if (!actions.length) return text(`No user action within ${timeout}s. Call vak_wait_action again to keep waiting.`, { structuredContent: { actions } });
        return text(`The user acted:\n${JSON.stringify(actions, null, 2)}`, { structuredContent: { actions } });
      },
    },
  ];
}
