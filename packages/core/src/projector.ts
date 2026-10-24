// A projector turns a resolved surface into a target's native output
// (DOM, Block Kit JSON, Telegram message + keyboard, plain text, ...).

import type { CapabilityProfile } from "./catalog.ts";
import type { ResolvedNode, ResolvedSurface } from "./surface.ts";

export interface Projector<Output> {
  readonly capabilities: CapabilityProfile;
  project(surface: ResolvedSurface): Output;
}

const PRIORITY: Record<string, number> = { primary: 0, secondary: 1, tertiary: 2 };

/**
 * For linear targets (chat, text): children in order of `priority`, keeping
 * authored order among equals. Layout containers stay so projectors can
 * decide whether to flatten them.
 */
export function byPriority(children: readonly ResolvedNode[]): ResolvedNode[] {
  return children
    .map((c, i) => ({ c, i, p: PRIORITY[String(c.props.priority)] ?? 1 }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.c);
}

export const LAYOUT_TYPES = new Set(["stack", "grid", "split", "section", "tabs"]);
