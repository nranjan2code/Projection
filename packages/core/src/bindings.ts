// `{/path}` interpolation. A string that is exactly one binding yields the raw
// value (so numbers and arrays survive); otherwise values are stringified in place.
// Relative paths (`{name}`) only bind inside a template scope; `\{` escapes.

import { getAt, resolvePath } from "./pointer.ts";

const BINDING = /\\\{|\{(\/?[A-Za-z0-9_~.\-][A-Za-z0-9_~.\-/]*|\/)\}/g;
const WHOLE = /^\{(\/?[A-Za-z0-9_~.\-][A-Za-z0-9_~.\-/]*|\/)\}$/;

export interface Scope {
  data: unknown;
  /** Absolute pointer of the current template item, "" at top level. */
  base: string;
}

function binds(path: string, scope: Scope): boolean {
  return path.startsWith("/") || scope.base !== "";
}

export function isBinding(value: unknown): boolean {
  return typeof value === "string" && WHOLE.test(value);
}

/**
 * A path's value in scope. In a list of plain values (strings, numbers) the
 * item has no fields: "{.}" is the item, and so is any other relative name
 * ("{item}", "{value}"), since nothing else could be meant.
 */
function lookup(path: string, scope: Scope): unknown {
  if (!path.startsWith("/") && scope.base) {
    const item = getAt(scope.data, scope.base);
    if (path === "." || (item !== null && typeof item !== "object" && item !== undefined && !path.includes("/"))) return item;
  }
  return getAt(scope.data, resolvePath(path, scope.base));
}

export function interpolate(text: string, scope: Scope): unknown {
  const whole = WHOLE.exec(text);
  if (whole && binds(whole[1]!, scope)) return lookup(whole[1]!, scope);
  return text.replace(BINDING, (match, path: string | undefined) => {
    if (path === undefined) return "{";
    if (!binds(path, scope)) return match;
    const v = lookup(path, scope);
    if (v === undefined || v === null) return "";
    // A list of plain values inside text reads as a list, not as JSON.
    if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return v.filter((x) => x !== null && x !== "").join(", ");
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

/** Deeply resolve bindings in a props value. */
export function resolveValue(value: unknown, scope: Scope): unknown {
  if (typeof value === "string") return interpolate(value, scope);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, scope));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, scope);
    return out;
  }
  return value;
}
