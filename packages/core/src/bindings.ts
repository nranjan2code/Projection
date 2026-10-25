// `{/path}` interpolation. A string that is exactly one binding yields the raw
// value (so numbers and arrays survive); otherwise values are stringified in place.
// Relative paths (`{name}`) bind inside a template scope, or at the top level
// to the surface's own data of that name; `\{` escapes.

import type { JSONSchema } from "./schema.ts";
import { getAt, resolvePath } from "./pointer.ts";

const BINDING = /\\\{|\{(\/?[A-Za-z0-9_~.\-][A-Za-z0-9_~.\-/]*|\/)\}/g;
const WHOLE = /^\{(\/?[A-Za-z0-9_~.\-][A-Za-z0-9_~.\-/]*|\/)\}$/;

export interface Scope {
  data: unknown;
  /** Absolute pointer of the current template item, "" at top level. */
  base: string;
}

/**
 * Absolute paths always bind; relative ones inside a list item. At the top
 * level, "{name}" binds to the surface's own "name" when it has one: that is
 * the only thing it can mean.
 */
function binds(path: string, scope: Scope): boolean {
  return path.startsWith("/") || scope.base !== "" || getAt(scope.data, `/${path}`) !== undefined;
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
  const pointer = scope.base === "" && !path.startsWith("/") ? `/${path}` : resolvePath(path, scope.base);
  return getLenient(scope.data, pointer);
}

/**
 * A pointer's value, with the path habits models bring from elsewhere, tried
 * only when the exact pointer finds nothing:
 * - "{/data/revenue}" with data {revenue}: the call's "data" field counted as
 *   the first step (4B, bench sales-q3 and web-analytics)
 * - "{/data.visitors}": dots as separators, as in JavaScript (4B, bench gate
 *   web-analytics)
 * - "{/stats/daily-activity}" with data {daily-activity}: the same extra first
 *   step under another name (4B, bench running-week: an empty chart and list).
 *   Only when the data has nothing at that first step, so it means nothing else.
 */
function getLenient(data: unknown, pointer: string): unknown {
  const v = getAt(data, pointer);
  if (v !== undefined) return v;
  if (pointer.includes(".") && pointer !== "/.") {
    const dotted = getLenient(data, pointer.replace(/\./g, "/"));
    if (dotted !== undefined) return dotted;
  }
  const first = /^\/[^/]+(?=\/.)/.exec(pointer);
  if (first && getAt(data, first[0]) === undefined) return getAt(data, pointer.slice(first[0].length));
  return undefined;
}

/** What an absolute binding ("/budget.total") shows, read as interpolation reads it. */
export function boundValue(data: unknown, path: string): unknown {
  return getLenient(data, path);
}

/** A JSON pointer into the data model: "/items", "/a/b/0". */
const POINTER = /^\/[A-Za-z0-9_~.\-]+(?:\/[A-Za-z0-9_~.\-]+)*$/;

export function interpolate(text: string, scope: Scope): unknown {
  // A stat's value "/data/visitors" (4B, bench web-analytics): a bare pointer
  // that names data the surface has is that data, not text to show.
  if (POINTER.test(text)) {
    const v = lookup(text, { data: scope.data, base: "" });
    if (v !== undefined) return v;
  }
  const whole = WHOLE.exec(text);
  if (whole && binds(whole[1]!, scope)) return lookup(whole[1]!, scope);
  return text.replace(BINDING, (match, path: string | undefined, offset: number) => {
    if (path === undefined) return "{";
    if (!binds(path, scope)) return match;
    const v = lookup(path, scope);
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return withoutRepeat(withoutCurrencyRepeat(v, text.slice(0, offset)), text.slice(offset + match.length));
    // A list of plain values inside text reads as a list, not as JSON.
    if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return v.filter((x) => x !== null && x !== "").join(", ");
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

/** Deeply resolve bindings in a props value. */
export function resolveValue(value: unknown, scope: Scope, schema?: JSONSchema): unknown {
  if (schema?.literal && !isBinding(value)) return value;
  if (typeof value === "string") return interpolate(value, scope);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, scope, schema?.items));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, scope, schema?.properties?.[k]);
    return out;
  }
  return value;
}

/**
 * "${/aov}" with aov "$438.50" would read "$$438.50": a currency sign written
 * before a placeholder whose value already starts with it is not repeated.
 */
function withoutCurrencyRepeat(value: string, before: string): string {
  const sign = before.at(-1);
  return sign && /\p{Sc}/u.test(sign) && value.startsWith(sign) ? value.slice(sign.length) : value;
}

/**
 * "{price}/night" with price "$800/night" would read "$800/night/night": when
 * the text right after a placeholder repeats how the value already ends, the
 * value gives up that ending (at least 3 characters).
 */
function withoutRepeat(value: string, after: string): string {
  for (let k = Math.min(value.length, after.length); k >= 3; k--) {
    if (value.endsWith(after.slice(0, k))) return value.slice(0, value.length - k);
  }
  return value;
}
