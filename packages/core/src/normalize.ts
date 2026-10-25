// The repair pipeline: turns whatever a model sent into well-formed VPS nodes.
//
// Every rule here is generic. Vocabulary (component and prop aliases, enum
// spellings, defaults) comes from the catalog, so supporting a new catalog
// never means editing this file.
//
// Node pipeline (per node):
//   1. type    — exact name → declared alias → namespaced ("ui/Card") → name tokens
//   2. infer   — no type given: score props (and id tokens) against every component schema
//      reinterpret — declared type is invalid for its props, and another component
//      explains every prop sent and validates: the props say what was meant
//      retype by value — a `namesComponent` prop names another component ("kind": "date")
//   3. props   — alias presets → schema coercion → component normalize → coercion
//                → derived defaults → schema defaults for missing required props
//                → markdown-format prose: inline HTML converted to markdown
// Structure pipeline (per surface, after a complete render/update):
//   4. prose in children becomes text; ids never sent stay (pending, reported as errors)
//   5. children on components that can't hold them move beside their parent
//   6. no "root": a single container is promoted, otherwise top-level nodes are wrapped
//   7. unreferenced subtrees attach to the root

import { isBinding } from "./bindings.ts";
import { type Catalog, type ComponentDef, propsSchema } from "./catalog.ts";
import { htmlToMarkdown } from "./markdown.ts";
import { coerce, type JSONSchema, validate } from "./schema.ts";

/** Keys starting with "_" or "$" are metadata (e.g. "__v__", "$error"), never props. */
export const isMetaKey = (k: string) => k.startsWith("_") || k.startsWith("$");
import type { VpsNode } from "./vps.ts";

export interface Repair {
  node?: string;
  message: string;
}

export interface TypeMatch {
  type: string;
  /** Props implied by the alias that matched ("row" → direction: horizontal). */
  presets?: Record<string, unknown>;
}

const key = (name: string) => name.toLowerCase().replace(/[-_\s]/g, "");

/** Split "revenueChart", "email_input", "ui/Card" into word tokens. */
export function nameTokens(name: string): string[] {
  return name.split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
}

export class Normalizer {
  readonly catalog: Catalog;
  private index = new Map<string, TypeMatch>();
  /**
   * Per component: how strongly each prop name points at it. A declared name
   * is strong evidence (2); an alias is weak evidence (1). Common props excluded.
   */
  private vocab = new Map<string, Map<string, number>>();

  constructor(catalog: Catalog) {
    this.catalog = catalog;
    const claim = (alias: string, match: TypeMatch) => {
      const k = key(alias);
      const prev = this.index.get(k);
      if (prev && prev.type !== match.type) {
        throw new Error(`catalog ${catalog.id}: "${alias}" names both "${prev.type}" and "${match.type}"`);
      }
      if (!prev) this.index.set(k, match);
    };
    // Component names first so an alias can never shadow a real component.
    for (const name of Object.keys(catalog.components)) claim(name, { type: name });
    for (const [name, def] of Object.entries(catalog.components)) {
      for (const alias of def.aliases ?? []) {
        if (typeof alias === "string") claim(alias, { type: name });
        else claim(alias.name, { type: name, presets: alias.props });
      }
      const words = new Map<string, number>();
      for (const [prop, schema] of Object.entries(def.props.properties ?? {})) {
        for (const a of schema.aliases ?? []) if (!words.has(a)) words.set(a, 1);
        words.set(prop, 2);
      }
      this.vocab.set(name, words);
    }
  }

  // --- 1. type resolution ----------------------------------------------------

  resolveType(value: unknown): TypeMatch | undefined {
    // The type field is a string; repair it like any other string-typed field.
    const name = coerce({ type: "string" }, value);
    if (typeof name !== "string" || !name.trim()) return undefined;
    const direct = this.index.get(key(name));
    if (direct) return direct;
    // Namespaced or compound names: the most specific (last) token that names a component.
    const tokens = nameTokens(name);
    if (tokens.length > 1) {
      for (let i = tokens.length - 1; i >= 0; i--) {
        const hit = this.index.get(key(tokens.slice(i).join(""))) ?? this.index.get(key(tokens[i]!));
        if (hit) return hit;
      }
    }
    return undefined;
  }

  // --- 2. inference ------------------------------------------------------------

  /**
   * Pick the component whose schema best explains the props that were sent.
   * Score: +2 per sent prop it declares by name, +1 per sent prop matching an
   * alias, -1 per sent prop it doesn't know, +1 per required prop satisfied, -1 per required
   * prop missing that has no default, ±1 for children fit, +3 when the node id
   * names the component. Ties keep catalog order. Nothing positive: a node
   * with children is the catalog's container, otherwise undefined.
   */
  inferType(props: Record<string, unknown>, ctx: { id?: string; hasChildren: boolean }): TypeMatch | undefined {
    const common = new Set(Object.keys(this.catalog.common));
    const sent = Object.keys(props).filter((k) => !common.has(k) && !isMetaKey(k));
    const fromId = ctx.id ? this.resolveType(ctx.id) : undefined;
    let best: { match: TypeMatch; score: number } | undefined;
    for (const [name, def] of Object.entries(this.catalog.components)) {
      const words = this.vocab.get(name)!;
      let score = 0;
      for (const p of sent) score += words.get(p) ?? -1;
      for (const req of def.props.required ?? []) {
        const schema = def.props.properties?.[req];
        const satisfied = props[req] !== undefined || (schema?.aliases ?? []).some((a) => props[a] !== undefined);
        if (satisfied) score += 1;
        else if (schema?.default === undefined && !def.defaults) score -= 1;
      }
      if (ctx.hasChildren) score += def.children ? 1 : -1;
      if (fromId?.type === name) score += 3;
      if (score > 0 && (!best || score > best.score)) best = { match: fromId?.type === name ? fromId : { type: name }, score };
    }
    // Nothing explains the props, but the node has children: it is a container.
    if (!best && ctx.hasChildren) return { type: this.catalog.container };
    return best?.match;
  }

  /**
   * The declared `type` fails validation with the props sent. If another
   * component validates cleanly and explains the sent props better (declared
   * names weigh more than aliases), return the best one. Alias presets are not
   * evidence. A valid declared type is never second-guessed.
   */
  reinterpret(
    match: TypeMatch,
    sentProps: Record<string, unknown>,
    ctx: { id: string; hasChildren: boolean },
  ): TypeMatch | undefined {
    const skip = (v: unknown) => isBinding(v);
    const invalid = (t: string, presets?: Record<string, unknown>) =>
      validate(propsSchema(this.catalog, t)!, this.prepareProps(t, sentProps, ctx.id, presets), { skip }).length > 0;
    if (!invalid(match.type, match.presets)) return undefined;
    const common = new Set(Object.keys(this.catalog.common));
    const sent = Object.keys(sentProps).filter((k) => !common.has(k) && !isMetaKey(k));
    const evidence = (t: string) => sent.reduce((sum, k) => sum + (this.vocab.get(t)!.get(k) ?? 0), 0);
    const declared = evidence(match.type);
    let best: { type: string; score: number } | undefined;
    for (const [name, def] of Object.entries(this.catalog.components)) {
      if (name === match.type || (ctx.hasChildren && !def.children)) continue;
      const score = evidence(name);
      if (score <= declared || (best && score <= best.score)) continue;
      if (!invalid(name)) best = { type: name, score };
    }
    return best ? { type: best.type } : undefined;
  }

  /**
   * A prop declared `namesComponent` holds a value outside its enum that names
   * another component (by name or alias): the model wrote the HTML idiom
   * `<input type="date">` as `{type: "input", kind: "date"}`. The node is that
   * component; the prop that named it is dropped. Only when the result
   * validates, so a mistyped value still reaches the model as an error.
   */
  retypeByValue(
    match: TypeMatch,
    sentProps: Record<string, unknown>,
    ctx: { id: string; hasChildren: boolean },
  ): { match: TypeMatch; key: string; value: string } | undefined {
    const skip = (v: unknown) => isBinding(v);
    for (const [prop, sub] of Object.entries(this.catalog.components[match.type]?.props.properties ?? {})) {
      if (!sub.namesComponent) continue;
      const key = [prop, ...(sub.aliases ?? [])].find((k) => typeof sentProps[k] === "string");
      if (!key) continue;
      const value = sentProps[key] as string;
      if (validate(sub, coerce(sub, value)).length === 0) continue;
      const named = this.resolveType(value);
      if (!named || named.type === match.type || (ctx.hasChildren && !this.canHoldChildren(named.type))) continue;
      const rest = { ...sentProps };
      delete rest[key];
      const prepared = this.prepareProps(named.type, rest, ctx.id, named.presets);
      if (validate(propsSchema(this.catalog, named.type)!, prepared, { skip }).length === 0) return { match: named, key, value };
    }
    return undefined;
  }

  // --- 3. props ------------------------------------------------------------------

  prepareProps(type: string, raw: Record<string, unknown>, id: string, presets?: Record<string, unknown>): Record<string, unknown> {
    const def: ComponentDef | undefined = this.catalog.components[type];
    const schema = propsSchema(this.catalog, type);
    if (!def || !schema) return raw;
    let p: Record<string, unknown> = { ...raw };
    for (const [k, v] of Object.entries(presets ?? {})) if (p[k] === undefined) p[k] = v;
    p = coerce(schema, p, isBinding) as Record<string, unknown>;
    if (def.normalize) p = coerce(schema, def.normalize(p), isBinding) as Record<string, unknown>;
    if (def.defaults) {
      for (const [k, v] of Object.entries(def.defaults(p, { id }))) if (p[k] === undefined || p[k] === "") p[k] = v;
    }
    for (const req of schema.required ?? []) {
      const d = (schema.properties?.[req] as JSONSchema | undefined)?.default;
      if (p[req] === undefined && d !== undefined) p[req] = structuredClone(d);
    }
    // Prose declared as markdown: inline HTML becomes markdown.
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (sub.format === "markdown" && typeof p[k] === "string") p[k] = htmlToMarkdown(unescapeNewlines(p[k] as string));
    }
    return p;
  }

  canHoldChildren(type: string): boolean {
    return Boolean(this.catalog.components[type]?.children);
  }
}

// --- structure (4-7) -------------------------------------------------------------

const ID_LIKE = /^[A-Za-z0-9_\-.:#]+$/;

/**
 * Make the node graph renderable: every child exists, only containers hold
 * children, there is one "root", and nothing is unreachable. Returns the new
 * node map (insertion order matters: the root comes first).
 */
export function repairStructure(
  nodes: Map<string, VpsNode>,
  normalizer: Normalizer,
  nextId: (type: string) => string,
): { nodes: Map<string, VpsNode>; repairs: Repair[] } {
  const repairs: Repair[] = [];
  const canHold = (n: VpsNode) => normalizer.canHoldChildren(n.type);

  // 4. Child refs that are prose, not ids, become text. Ids that were never
  //    sent stay referenced: they render as pending, lint reports them as
  //    errors so the model sends them, and a later update slots them in.
  for (const node of [...nodes.values()]) {
    if (!Array.isArray(node.children)) continue;
    node.children = node.children.map((ref) => {
      if (nodes.has(ref) || ID_LIKE.test(ref) || !/\p{L}{2}/u.test(ref)) return ref;
      const id = nextId("text");
      nodes.set(id, { id, type: "text", props: { content: ref } });
      repairs.push({ node: node.id, message: `child "${ref}" is prose, not a node id; shown as text` });
      return id;
    });
  }

  // 5. Children on leaf components.
  for (const node of [...nodes.values()]) {
    if (!Array.isArray(node.children) || node.children.length === 0 || canHold(node) || node.type === "$invalid") continue;
    const kids = node.children;
    delete node.children;
    const parent = [...nodes.values()].find((p) => Array.isArray(p.children) && p.children.includes(node.id));
    if (parent && Array.isArray(parent.children)) {
      const siblings = parent.children;
      siblings.splice(siblings.indexOf(node.id) + 1, 0, ...kids.filter((k) => !siblings.includes(k)));
    }
    repairs.push({ node: node.id, message: `${node.type} cannot have children; they were placed after it` });
  }

  // A template node renders once per list item, never as a plain child:
  // listed among children too, it would show once more with its
  // placeholders unfilled.
  const templates = new Set<string>();
  for (const node of nodes.values()) if (node.children && !Array.isArray(node.children)) templates.add(node.children.template);
  for (const node of nodes.values()) {
    if (!Array.isArray(node.children) || !node.children.some((c) => templates.has(c))) continue;
    for (const c of node.children.filter((c) => templates.has(c))) repairs.push({ node: c, message: `is a list template, so it renders once per item; removed from the children of "${node.id}"` });
    node.children = node.children.filter((c) => !templates.has(c));
  }

  // A node listed by two parents would show twice: it stays with the first
  // parent in document order.
  const parentOf = new Map<string, string>();
  for (const node of nodes.values()) {
    if (!Array.isArray(node.children)) continue;
    node.children = node.children.filter((c) => {
      const first = parentOf.get(c);
      if (first === undefined) return parentOf.set(c, node.id), true;
      if (first === node.id) return false;
      repairs.push({ node: c, message: `listed in the children of both "${first}" and "${node.id}"; kept under "${first}" only (give a second copy its own id)` });
      return false;
    });
  }

  const referenced = new Set<string>();
  for (const node of nodes.values()) {
    if (Array.isArray(node.children)) node.children.forEach((c) => referenced.add(c));
    else if (node.children) referenced.add(node.children.template);
  }

  // 6. Root.
  if (!nodes.has("root")) {
    const tops = [...nodes.keys()].filter((id) => !referenced.has(id));
    if (tops.length === 1 && canHold(nodes.get(tops[0]!)!)) {
      const only = nodes.get(tops[0]!)!;
      nodes.delete(only.id);
      repairs.push({ node: only.id, message: `used as "root" (no node had id "root")` });
      only.id = "root";
      return { nodes: new Map([["root", only], ...nodes]), repairs };
    }
    if (tops.length) {
      repairs.push({ message: `no node with id "root"; ${tops.length} top-level node(s) wrapped in a ${normalizer.catalog.container}` });
      const root: VpsNode = { id: "root", type: normalizer.catalog.container, props: {}, children: tops };
      return { nodes: new Map([["root", root], ...nodes]), repairs };
    }
    return { nodes, repairs };
  }

  // 7. Unreachable subtrees.
  const orphans = [...nodes.keys()].filter((id) => id !== "root" && !referenced.has(id));
  if (orphans.length === 0) return { nodes, repairs };
  let root = nodes.get("root")!;
  if (!canHold(root) || !Array.isArray(root.children ?? [])) {
    const leaf = root;
    nodes.delete("root");
    leaf.id = nextId(leaf.type);
    root = { id: "root", type: normalizer.catalog.container, props: {}, children: [leaf.id] };
    nodes = new Map([["root", root], [leaf.id, leaf], ...nodes]);
  }
  root.children = [...((root.children as string[] | undefined) ?? []), ...orphans];
  for (const id of orphans) repairs.push({ node: id, message: `not referenced by any parent; attached to "root"` });
  return { nodes, repairs };
}

/**
 * Prose whose newlines were escaped twice arrives with literal "\\n" and no
 * real line breaks; it was meant as line breaks. Text that already has real
 * newlines is left alone (a literal "\\n" there is likely meant, e.g. in code).
 */
function unescapeNewlines(s: string): string {
  return s.includes("\n") || !s.includes("\\n") ? s : s.replace(/(?:\\r)?\\n/g, "\n").replace(/\\t/g, "\t");
}
