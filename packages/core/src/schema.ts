// A JSON Schema subset: just enough to describe tool inputs portably across
// providers and to validate what models send back.
//
// Extension keywords carry repair knowledge next to the property they
// describe (catalog stays the single source of truth); `toWireSchema` strips
// them before a schema is sent to any provider:
//   aliases:        other names a model may use for this property
//   enumAliases:    other spellings for enum values ({"left": "start"})
//   namesComponent: a value outside the enum may name the component meant
//                   (an input's kind "date" is the date component)
//   literal:        preserve embedded braces in source code instead of binding them

import { parseLenient } from "./partial-json.ts";

export type SchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export interface JSONSchema {
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  type?: SchemaType | SchemaType[];
  description?: string;
  enum?: readonly unknown[];
  const?: unknown;
  properties?: Record<string, JSONSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JSONSchema;
  items?: JSONSchema;
  anyOf?: readonly JSONSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  /** Regular expression a string must match. */
  pattern?: string;
  /** Annotation; "markdown" marks prose the engine normalizes (see Normalizer). */
  format?: string;
  /** Extension: embedded braces are literal text; a whole-value binding still works. */
  literal?: boolean;
  default?: unknown;
  /** Extension: alternative property names models use for this property. */
  aliases?: readonly string[];
  /** Extension: alternative spellings mapped to enum values. */
  enumAliases?: Readonly<Record<string, string>>;
  /** Extension: a value outside the enum may name another component; the node is that one (see Normalizer.retypeByValue). */
  namesComponent?: boolean;
}

const EXTENSION_KEYS = new Set(["aliases", "enumAliases", "namesComponent", "literal"]);

/** Deep copy without extension keywords, for provider tool definitions. */
export function toWireSchema(schema: JSONSchema): JSONSchema {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (EXTENSION_KEYS.has(k)) continue;
    if ((k === "properties" || k === "$defs") && v) {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, JSONSchema>).map(([pk, pv]) => [pk, toWireSchema(pv)]));
    } else if ((k === "items" || k === "additionalProperties") && v && typeof v === "object") {
      out[k] = toWireSchema(v as JSONSchema);
    } else if (k === "anyOf" && Array.isArray(v)) {
      out.anyOf = v.map((b) => toWireSchema(b as JSONSchema));
    } else out[k] = v;
  }
  return out as JSONSchema;
}

export interface SchemaError {
  path: string;
  message: string;
}

export interface ValidateOptions {
  /** Internal root for local definition references, preserved through recursive validation. */
  root?: JSONSchema;
  depth?: number;
  /** Return true to accept a value without checking it (e.g. a `{/path}` binding). */
  skip?: (value: unknown, schema: JSONSchema) => boolean;
}

export function typeOf(value: unknown): SchemaType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value as SchemaType;
}

function matchesType(value: unknown, type: SchemaType): boolean {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

export function validate(
  schema: JSONSchema,
  value: unknown,
  opts: ValidateOptions = {},
  path = "",
): SchemaError[] {
  if ((opts.depth ?? 0) > 128) return [{ path: path || "/", message: "schema validation exceeds 128 levels" }];
  opts = { ...opts, root: opts.root ?? schema, depth: (opts.depth ?? 0) + 1 };
  if (schema.$ref) {
    const name = schema.$ref.startsWith("#/$defs/") ? schema.$ref.slice(8) : undefined;
    const definitions = opts.root?.$defs;
    const target = name && definitions && Object.hasOwn(definitions, name) ? definitions[name] : undefined;
    if (!target) return [{ path: path || "/", message: "unsupported or unresolved schema reference" }];
    return validate(target, value, opts, path);
  }
  if (opts.skip?.(value, schema)) return [];
  const errors: SchemaError[] = [];
  const fail = (message: string) => errors.push({ path: path || "/", message });

  if (schema.anyOf) {
    // Tagged unions select their declared branch before descending. Without
    // this, recursive node schemas explore every component at every level.
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const first = schema.anyOf[0];
      const key = Object.keys(first?.properties ?? {}).find((name) => schema.anyOf!.every((branch) => branch.properties?.[name]?.const !== undefined));
      if (key) {
        const matching = schema.anyOf.filter((branch) => branch.properties![key]!.const === record[key]);
        if (matching.length === 1) return validate(matching[0]!, value, opts, path);
      }
    }
    // The branch the value matched furthest (its first error deepest) is the
    // one meant; fewest errors breaks ties. By count alone, chart series of
    // [{name, values}] with five gaps lost to "a list of numbers" (one error,
    // "series/0 expected number, got object"), and the model was told the
    // wrong shape (4B, running stats).
    const depth = (errs: SchemaError[]) => Math.min(...errs.map((e) => e.path.split("/").length));
    let best: SchemaError[] | undefined;
    for (const branch of schema.anyOf) {
      const errs = validate(branch, value, opts, path);
      if (errs.length === 0) return [];
      if (!best || depth(errs) > depth(best) || (depth(errs) === depth(best) && errs.length < best.length)) best = errs;
    }
    return best ?? [];
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      fail(`expected ${types.join(" or ")}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.const !== undefined && value !== schema.const) {
    fail(`must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    fail(`must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`);
  } else if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`less than ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`greater than ${schema.maximum}`);
  } else if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validate(schema.items!, item, opts, `${path}/${i}`)));
    }
  } else if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined) errors.push({ path: `${path}/${key}`, message: "is required" });
    }
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validate(sub, v, opts, `${path}/${key}`));
      else if (schema.additionalProperties === false) errors.push({ path: `${path}/${key}`, message: "is not allowed" });
      else if (typeof schema.additionalProperties === "object") {
        errors.push(...validate(schema.additionalProperties, v, opts, `${path}/${key}`));
      }
    }
  }
  return errors;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Rename alias keys to their declared property when the declared one is
 * absent — only if the value is valid for that property (after coercion), so
 * an alias never turns an unrelated prop into an invalid one.
 */
function applyAliases(schema: JSONSchema, obj: Record<string, unknown>, skip?: (v: unknown) => boolean): Record<string, unknown> {
  const props = schema.properties ?? {};
  const out = { ...obj };
  for (const [name, sub] of Object.entries(props)) {
    if (out[name] !== undefined || !sub.aliases) continue;
    for (const alt of sub.aliases) {
      if (out[alt] === undefined || alt in props) continue;
      const value = coerce(sub, out[alt], skip);
      if (!skip?.(value) && validate(sub, value).length) continue;
      out[name] = value;
      delete out[alt];
      break;
    }
  }
  return out;
}

/**
 * Repair a value toward its schema where intent is unambiguous. General rules,
 * applied recursively:
 * - declared property aliases are renamed; enum values match case-insensitively
 *   or through `enumAliases`
 * - string expected: numbers/booleans stringify, a list of scalars joins with
 *   newlines, an object yields its first scalar field
 * - number/boolean expected: numeric strings and "true"/"false" convert
 * - object/array expected: a JSON string is parsed; a lone value becomes [value]
 * Returns the value unchanged when no rule applies; validation reports the rest.
 */
export function coerce(schema: JSONSchema, value: unknown, skip?: (v: unknown) => boolean): unknown {
  if (skip?.(value)) return value;
  if (schema.anyOf) {
    // A JSON-looking list value can also match a permissive binding-string
    // branch. Prefer a fully validated record array (4B map: "{...},{...}").
    // Do not force ambiguous strings into a different, lossy interpretation.
    if (typeof value === "string" && /^\s*[[{]/.test(value)) {
      for (const branch of schema.anyOf) {
        if (branch.type !== "array" || !branch.items?.properties) continue;
        try {
          const parsed = parseLenient(value.trimStart().startsWith("{") ? `[${value}]` : value);
          if (Array.isArray(parsed)) {
            const repaired = coerce(branch, parsed, skip);
            if (validate(branch, repaired).length === 0) return repaired;
          }
        } catch { /* ordinary coercion below handles incomplete structures */ }
      }
    }
    // A value valid for a branch still gets that branch's aliases renamed, as a
    // plain object schema would: {name, entityType} items are valid graph nodes
    // with every prop optional, and were kept with keys no projector reads.
    for (const b of schema.anyOf) {
      if (validate(b, value).length) continue;
      const c = coerce(b, value, skip);
      return validate(b, c).length === 0 ? c : value;
    }
    // Repair within a branch of the value's own type before converting across
    // types, so {key, align: "Right"} is fixed as an object, not flattened to "key".
    const sameType = (b: JSONSchema) => {
      const ts = b.type === undefined ? [] : Array.isArray(b.type) ? b.type : [b.type];
      return ts.some((t) => matchesType(value, t));
    };
    const ordered = [...schema.anyOf.filter(sameType), ...schema.anyOf.filter((b) => !sameType(b))];
    for (const b of ordered) {
      const c = coerce(b, value, skip);
      if (validate(b, c).length === 0) return c;
    }
    return value;
  }
  if (schema.enum && typeof value === "string" && !schema.enum.includes(value)) {
    const lower = value.trim().toLowerCase();
    const hit = schema.enum.find((e) => typeof e === "string" && e.toLowerCase() === lower) ?? schema.enumAliases?.[lower];
    if (hit !== undefined && schema.enum.includes(hit)) return hit;
  }
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length === 0 || types.some((t) => matchesType(value, t))) {
    if (Array.isArray(value) && schema.items) return value.map((v) => coerce(schema.items!, v, skip));
    if (isPlainObject(value) && schema.properties) {
      const out = applyAliases(schema, value, skip);
      for (const [k, sub] of Object.entries(schema.properties)) if (k in out) out[k] = coerce(sub, out[k], skip);
      return out;
    }
    return value;
  }
  for (const t of types) {
    if (t === "string") {
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      if (Array.isArray(value) && value.every((v) => v === null || typeof v !== "object")) return value.join("\n");
      if (isPlainObject(value)) {
        const first = Object.values(value).find((v) => typeof v === "string" || typeof v === "number");
        if (first !== undefined) return String(first);
      }
    } else if ((t === "number" || t === "integer") && typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    } else if (t === "boolean" && (value === "true" || value === "false")) {
      return value === "true";
    } else if ((t === "object" || t === "array") && typeof value === "string" && /^\s*[[{]/.test(value)) {
      try {
        // 4B map recording: places was "{...},{...}" without array
        // brackets. Parse the whole sequence, not just its first object.
        if (t === "array" && schema.items && value.trimStart().startsWith("{")) {
          const sequence = parseLenient(`[${value}]`);
          if (Array.isArray(sequence)) {
            const repaired = coerce(schema, sequence, skip);
            if (validate(schema, repaired).length === 0) return repaired;
          }
        }
        const parsed = parseLenient(value);
        if (matchesType(parsed, t)) return coerce(schema, parsed, skip);
      } catch {
        /* not JSON; fall through */
      }
    }
  }
  if (types.includes("array") && value !== undefined && !Array.isArray(value)) {
    return schema.items ? [coerce(schema.items, value, skip)] : [value];
  }
  return value;
}
