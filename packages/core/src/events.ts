// Wire events between the agent loop and any client (AG-UI-style taxonomy).

import type { SurfaceSnapshot } from "./surface.ts";

/** Token usage; `cachedInput` is the part of `input` served from a prompt cache. */
export interface Usage {
  input?: number;
  output?: number;
  cachedInput?: number;
}

/** Sum usage reports (missing fields count as zero once any report has them). */
export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  return { input: sum(a.input, b.input), output: sum(a.output, b.output), cachedInput: sum(a.cachedInput, b.cachedInput) };
}

export type AgentEvent =
  | { type: "run_start"; runId: string; provider: string; model: string }
  /** How the engine will ask this model for UI, and why (from the capability policy). */
  | { type: "plan"; generation: string; tier: string; examples: boolean; authoring?: string; maxSteps: number; reasons: string[] }
  | { type: "text_delta"; delta: string }
  | { type: "tool_start"; id: string; name: string }
  | { type: "tool_end"; id: string; name: string; result: string; isError?: boolean }
  /** Full surface state; sent progressively while a render streams. */
  | { type: "surface"; snapshot: SurfaceSnapshot }
  | { type: "surface_removed"; id: string }
  /**
   * A tool that needs the user's yes before it runs (an integration's "ask"
   * policy). The client answers through its host; the run waits meanwhile.
   */
  | { type: "approval"; id: string; tool: string; server: string; title: string; args: unknown; reason?: string }
  | { type: "approval_done"; id: string; decision: "allow" | "deny" }
  | { type: "run_end"; stop: string; usage?: Usage }
  | { type: "error"; message: string };

/** Encode one event as a Server-Sent Events frame. */
export function encodeSse(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
