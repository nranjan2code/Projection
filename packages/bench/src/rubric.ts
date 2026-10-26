// Structural rubric: declarative checks over what the user would see.
// Checks are plain data (patterns are strings) so scenarios, cassettes and
// baselines stay JSON.

import { isDeepStrictEqual } from "node:util";
import type { ResolvedNode, ResolvedSurface } from "@vak/core";

export type Check =
  /** Between min and max nodes whose type is one of `types`. */
  | { kind: "count"; types: string[]; min?: number; max?: number }
  /** A resolved component has this exact property value (including nested array entries). */
  | { kind: "prop"; type: string; path: string[]; value: unknown }
  /** A regular expression matches the surface's text projection. */
  | { kind: "text"; pattern: string; flags?: string }
  /** Every input-like node writes to the data model (has a bind path). */
  | { kind: "bound" }
  /** The user can act: a form, or a button with an action. */
  | { kind: "actionable" }
  /** The turn changed what the user sees (new surface, or a newer version of one). */
  | { kind: "changed" }
  | { kind: "anyOf"; checks: Check[] }
  | { kind: "allOf"; checks: Check[] };

export interface CheckContext {
  surface?: ResolvedSurface;
  /** Text projection of `surface`. */
  text: string;
  /** What the user saw before this turn, for "changed". */
  before?: { surface?: string; version?: number; text: string };
}

export interface CheckResult {
  check: string;
  pass: boolean;
}

const INPUTS = new Set(["input", "textarea", "select", "checkbox", "date"]);

export function walkTree(node: ResolvedNode | null | undefined, fn: (n: ResolvedNode) => void): void {
  if (!node) return;
  fn(node);
  for (const c of node.children) walkTree(c, fn);
}

export function describe(check: Check): string {
  switch (check.kind) {
    case "count": {
      const range = check.max !== undefined ? `${check.min ?? 0}-${check.max}` : `≥${check.min ?? 1}`;
      return `${range} ${check.types.join("/")}`;
    }
    case "prop":
      return `${check.type}.${check.path.join(".")} = ${JSON.stringify(check.value)}`;
    case "text":
      return `text /${check.pattern}/${check.flags ?? ""}`;
    case "bound":
      return "inputs are bound";
    case "actionable":
      return "user can act";
    case "changed":
      return "view changed";
    case "anyOf":
      return `any of (${check.checks.map(describe).join("; ")})`;
    case "allOf":
      return `all of (${check.checks.map(describe).join("; ")})`;
  }
}

function passes(check: Check, ctx: CheckContext): boolean {
  const root = ctx.surface?.root;
  switch (check.kind) {
    case "count": {
      let n = 0;
      walkTree(root, (node) => {
        if (check.types.includes(node.type)) n++;
      });
      return n >= (check.min ?? 1) && (check.max === undefined || n <= check.max);
    }
    case "prop": {
      let found = false;
      walkTree(root, (node) => {
        if (node.type !== check.type) return;
        let value: unknown = node.props;
        for (const key of check.path) {
          if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) {
            value = undefined;
            break;
          }
          value = (value as Record<string, unknown>)[key];
        }
        if (isDeepStrictEqual(value, check.value)) found = true;
      });
      return found;
    }
    case "text":
      return new RegExp(check.pattern, check.flags ?? "i").test(ctx.text);
    case "bound": {
      let ok = true, any = false;
      walkTree(root, (node) => {
        if (!INPUTS.has(node.type)) return;
        any = true;
        if (!node.bindPath) ok = false;
      });
      return any && ok;
    }
    case "actionable": {
      let ok = false;
      walkTree(root, (node) => {
        // A comparison with an action has a pick button on each option.
        if (node.type === "form" || ((node.type === "button" || node.type === "compare") && typeof node.props.action === "string" && node.props.action)) ok = true;
      });
      return ok;
    }
    case "changed": {
      const b = ctx.before;
      if (!ctx.surface) return false;
      if (!b) return true;
      return ctx.surface.id !== b.surface || ((ctx.surface.version ?? 0) > (b.version ?? 0) && ctx.text !== b.text);
    }
    case "anyOf":
      return check.checks.some((c) => passes(c, ctx));
    case "allOf":
      return check.checks.every((c) => passes(c, ctx));
  }
}

export function evaluate(checks: Check[], ctx: CheckContext): CheckResult[] {
  return checks.map((check) => ({ check: describe(check), pass: passes(check, ctx) }));
}
