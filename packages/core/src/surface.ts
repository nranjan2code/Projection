// Surface state: applies vak_render / vak_update / vak_remove, repairs common
// model mistakes instead of rejecting them, resolves bindings into a tree that
// projectors render, and turns user interactions into VpsAction results.

import { boundValue, isBinding, resolveValue, type Scope } from "./bindings.ts";
import { type Catalog, type ItemField, propsSchema } from "./catalog.ts";
import { runChecks } from "./checks.ts";
import { isMetaKey, Normalizer, repairStructure, type TypeMatch } from "./normalize.ts";
import { parseLenient } from "./partial-json.ts";
import { getAt, parsePointer, resolvePath, setAt } from "./pointer.ts";
import { coerce, type JSONSchema, validate } from "./schema.ts";
import { LAYOUT_TYPES } from "./projector.ts";
import {
  type Children,
  NODE_LIST_KEYS,
  NODE_PROPS_KEYS,
  NODE_TYPE_KEYS,
  type NodePatch,
  type RemoveArgs,
  type RenderArgs,
  TOOL_REMOVE,
  TOOL_RENDER,
  TOOL_UPDATE,
  type UpdateArgs,
  type VpsAction,
  type VpsNode,
} from "./vps.ts";

export interface Diagnostic {
  severity: "error" | "warning";
  surface: string;
  node?: string;
  message: string;
}

export interface SurfaceState {
  id: string;
  title?: string;
  /** Insertion-ordered; the first node is the root unless one is named "root". */
  nodes: Map<string, VpsNode>;
  data: Record<string, unknown>;
  version: number;
  /**
   * The model is still writing this surface (a streamed render): a child it
   * names but hasn't sent yet is on its way. Otherwise such a child never
   * comes, and the user would wait on a placeholder forever.
   */
  partial?: boolean;
}

/** How much a surface shows, and what is still wrong with it (see SurfaceStore.assess). */
export interface SurfaceQuality {
  errors: number;
  /** Rendered nodes with something of their own to show. */
  content: number;
}

export interface ResolvedNode {
  /** Unique per instance; template copies get `tpl#index`. */
  key: string;
  id: string;
  /** Component type, or "$pending" (child not arrived yet, streaming only) / "$invalid". */
  type: string;
  props: Record<string, unknown>;
  children: ResolvedNode[];
  /** Absolute data path for `bind` props. */
  bindPath?: string;
  error?: string;
}

export interface ResolvedSurface {
  id: string;
  title?: string;
  version: number;
  root: ResolvedNode | null;
  data: Record<string, unknown>;
}

/** Serializable surface state, sent over the wire to renderers. */
export interface SurfaceSnapshot {
  id: string;
  title?: string;
  nodes: VpsNode[];
  data: Record<string, unknown>;
  version: number;
  partial?: boolean;
}

export interface SubmitResult {
  action?: VpsAction;
  /** Field errors keyed by node id. */
  errors: Record<string, string[]>;
}

export interface ApplyOptions {
  /** Streaming: don't complain about children that may still arrive. */
  partial?: boolean;
}

/** Keys that are node structure rather than props. */
const NODE_KEYS = new Set<string>(["id", "children", ...NODE_TYPE_KEYS, ...NODE_PROPS_KEYS]);

/** A node's props, under whichever props key it used (see NODE_PROPS_KEYS); the first one that holds an object. */
function propsOf(raw: Record<string, unknown>): Record<string, unknown> {
  for (const k of NODE_PROPS_KEYS) if (isObject(raw[k])) return raw[k] as Record<string, unknown>;
  return {};
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Deep merge: objects recursively, everything else (arrays included) replaced by `src`. */
function mergeDeep(target: Record<string, unknown>, src: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(src)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const cur = target[k];
    target[k] = isObject(cur) && isObject(v) ? mergeDeep({ ...cur }, v) : structuredClone(v);
  }
  return target;
}

/** Models sometimes double-encode structured args as a JSON string; unwrap it. */
function unwrapJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t.startsWith("[") && !t.startsWith("{")) return v;
  try {
    return parseLenient(t);
  } catch {
    return v;
  }
}

/**
 * `nodes: "[ ...nodes ], \"data\": {...}"`: the model wrote the call's other
 * members inside the nodes string, after the list. Read the string as the
 * members of the call it was meant to be and return those extra members.
 */
function membersAfterList(key: string, v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t.startsWith("[") || !/\]\s*,\s*["']?[A-Za-z_]\w*["']?\s*:/.test(t)) return undefined;
  try {
    const whole = parseLenient(`{"${key}":${t}}`);
    if (!isObject(whole)) return undefined;
    const { [key]: _list, ...rest } = whole;
    return Object.keys(rest).length ? rest : undefined;
  } catch {
    return undefined;
  }
}

/** Call members with a meaning of their own; anything else may be misplaced nodes. */
const CALL_KEYS = new Set<string>(["surface", "title", "data", "ids", "ops", "id", "children", ...NODE_LIST_KEYS, ...NODE_TYPE_KEYS, ...NODE_PROPS_KEYS]);

/** Read an argument's value as a list of node-shaped objects (each has an id or a type), or undefined. */
function asNodeList(v: unknown): Record<string, unknown>[] | undefined {
  let list: unknown = v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
    try {
      // `{...}, {...}]`: the rest of the nodes list, so read it as one.
      list = parseLenient(t.startsWith("{") ? `[${t}` : t);
    } catch {
      return undefined;
    }
  }
  const items = Array.isArray(list) ? list : [list];
  const nodeLike = (x: unknown) => isObject(x) && (typeof x.id === "string" || NODE_TYPE_KEYS.some((k) => typeof x[k] === "string"));
  return items.length > 0 && items.every(nodeLike) ? (items as Record<string, unknown>[]) : undefined;
}

export class SurfaceStore {
  readonly catalog: Catalog;
  readonly normalizer: Normalizer;
  private surfaces = new Map<string, SurfaceState>();
  private autoId = 0;
  /** Data models wrote inside nodes during the current ingest, merged into the surface after. */
  private nodeData: Record<string, unknown> | undefined;

  constructor(catalog: Catalog) {
    this.catalog = catalog;
    this.normalizer = new Normalizer(catalog);
  }

  get(id: string): SurfaceState | undefined {
    return this.surfaces.get(id);
  }

  list(): SurfaceState[] {
    return [...this.surfaces.values()];
  }

  snapshot(id: string): SurfaceSnapshot | undefined {
    const s = this.surfaces.get(id);
    if (!s) return undefined;
    return structuredClone({ id: s.id, title: s.title, nodes: [...s.nodes.values()], data: s.data, version: s.version, ...(s.partial ? { partial: true } : {}) });
  }

  /** Replace local state with a snapshot (client mirrors of server state). */
  load(snap: SurfaceSnapshot): void {
    const copy = structuredClone(snap);
    this.surfaces.set(copy.id, {
      id: copy.id,
      title: copy.title,
      nodes: new Map(copy.nodes.map((n) => [n.id, n])),
      data: copy.data ?? {},
      version: copy.version,
      ...(copy.partial ? { partial: true } : {}),
    });
  }

  /** Replace a surface's whole data model (client sync before an action). */
  setData(surfaceId: string, data: Record<string, unknown>): boolean {
    const state = this.surfaces.get(surfaceId);
    if (!state || !isObject(data)) return false;
    state.data = structuredClone(data);
    state.version++;
    return true;
  }

  /** Write several values at once (e.g. a form submitted from a client). */
  setValues(surfaceId: string, values: Record<string, unknown>): void {
    for (const [path, value] of Object.entries(values)) this.setValue(surfaceId, path, value);
  }

  /** Dispatch a tool call by name. */
  apply(tool: string, args: unknown, opts: ApplyOptions = {}): Diagnostic[] {
    const parsed = unwrapJson(args);
    let a: Record<string, unknown> = isObject(parsed) ? { ...parsed } : {};
    const notes: Diagnostic[] = [];
    for (const key of NODE_LIST_KEYS) {
      const extra = membersAfterList(key, a[key]);
      if (!extra) continue;
      // Members the call itself already has win; the rest were meant for it.
      a = { ...extra, ...a, [key]: a[key] };
      notes.push({ severity: "warning", surface: String(a.surface ?? ""), message: `${Object.keys(extra).map((k) => `"${k}"`).join(", ")} was written inside "${key}" after the list; read as part of the call` });
    }
    for (const key of ["nodes", "data", "ids"]) if (key in a) a[key] = unwrapJson(a[key]);
    notes.push(...this.nodesInOtherArgs(a));
    switch (tool) {
      case TOOL_RENDER: return [...notes, ...this.render(a as unknown as RenderArgs, opts)];
      case TOOL_UPDATE: return [...notes, ...this.update(a as unknown as UpdateArgs)];
      case TOOL_REMOVE: return this.remove(a as unknown as RemoveArgs);
      default: return [{ severity: "error", surface: String(a.surface ?? ""), message: `unknown tool ${tool}` }];
    }
  }

  render(args: RenderArgs, opts: ApplyOptions = {}): Diagnostic[] {
    const surfaceId = typeof args.surface === "string" && args.surface ? args.surface : "main";
    const diags: Diagnostic[] = [];
    const nodes = new Map<string, VpsNode>();
    const a = args as unknown as Record<string, unknown>;
    const listKey = NODE_LIST_KEYS.find((k) => a[k] !== undefined);
    let rawNodes = listKey ? unwrapJson(a[listKey]) : undefined;
    if (isObject(rawNodes)) {
      const obj = rawNodes;
      if (!NODE_TYPE_KEYS.some((k) => k in obj) && !("id" in obj)) {
        // Map form: { id: node, ... }.
        rawNodes = Object.entries(obj).filter(([, v]) => isObject(v)).map(([id, v]) => ({ id, ...(v as object) }));
      }
    }
    if (rawNodes === undefined && NODE_TYPE_KEYS.some((k) => typeof a[k] === "string")) {
      // The arguments themselves are a single node.
      const { surface: _s, title: _t, data: _d, ...node } = a;
      rawNodes = [node];
    }
    const raw = Array.isArray(rawNodes) ? rawNodes : isObject(rawNodes) ? [rawNodes] : [];
    this.nodeData = undefined;
    this.callIds.clear();
    for (const n of raw) this.ingest(n, nodes, surfaceId, diags);
    const nodeData = this.nodeData as Record<string, unknown> | undefined;
    this.nodeData = undefined;
    if (nodes.size === 0 && !opts.partial) {
      return [{ severity: "error", surface: surfaceId, message: "nodes is empty: send a JSON array of node objects, root first" }];
    }
    const prev = this.surfaces.get(surfaceId);
    const state: SurfaceState = {
      id: surfaceId,
      title: typeof args.title === "string" ? args.title : undefined,
      nodes,
      data: (() => {
        // Data written inside nodes, overridden by the surface's own data on conflict.
        const d = unwrapJson(args.data);
        return mergeDeep(mergeDeep({}, nodeData ?? {}), isObject(d) ? d : {});
      })(),
      version: (prev?.version ?? 0) + 1,
      ...(opts.partial ? { partial: true } : {}),
    };
    this.surfaces.set(surfaceId, state);
    if (nodeData && !opts.partial) diags.push({ severity: "warning", surface: surfaceId, message: "data written inside nodes was merged into the surface data model" });
    if (!opts.partial) {
      diags.push(...this.repair(state));
      diags.push(...this.lint(state));
    }
    return diags;
  }

  update(args: UpdateArgs): Diagnostic[] {
    const surfaceId = String(args.surface ?? "");
    const state = this.surfaces.get(surfaceId);
    if (!state) return [{ severity: "error", surface: surfaceId, message: `no surface "${surfaceId}"; call vak_render first` }];
    const diags: Diagnostic[] = [];
    if (typeof args.title === "string") state.title = args.title;
    delete state.partial;
    const shownBefore = reachable(state.nodes);
    const sent = new Set<string>();
    collectIds(args.nodes, sent);
    this.nodeData = undefined;
    this.callIds.clear();
    for (const patch of Array.isArray(args.nodes) ? args.nodes : []) {
      if (!isObject(patch)) continue;
      // Known ids are patched, unknown ids become new nodes.
      this.ingest(patch, state.nodes, surfaceId, diags, true);
    }
    const nodeData = this.nodeData as Record<string, unknown> | undefined;
    this.nodeData = undefined;
    if (nodeData) {
      state.data = mergeDeep(state.data, nodeData);
      diags.push({ severity: "warning", surface: surfaceId, message: "data written inside nodes was merged into the surface data model" });
    }
    // An object instead of ops: merge it into the data model.
    if (isObject(args.data)) state.data = mergeDeep(state.data, args.data);
    for (const op of Array.isArray(args.data) ? args.data : []) {
      if (!isObject(op) || typeof op.path !== "string") continue;
      const mode = op.op === "add" ? "add" : "replace";
      const value = op.op === "remove" ? undefined : op.value;
      if (op.path === "" || op.path === "/") {
        if (isObject(value)) state.data = structuredClone(value);
        continue;
      }
      if (!setAt(state.data, op.path, structuredClone(value), mode)) {
        diags.push({ severity: "error", surface: surfaceId, message: `cannot ${op.op} data at ${op.path}` });
      }
    }
    // Nodes a patch cut out of the tree (a parent's children replaced
    // without them) are gone, as the patch says, not re-attached elsewhere.
    // The model is told, so a cut it did not mean can be undone.
    const shownNow = reachable(state.nodes);
    const released = [...shownBefore].filter((id) => !shownNow.has(id) && !sent.has(id) && state.nodes.has(id));
    for (const id of released) state.nodes.delete(id);
    if (released.length) {
      diags.push({ severity: "warning", surface: surfaceId, message: `no longer in any parent's children, so removed: ${released.map((id) => `"${id}"`).join(", ")}; to keep them, list them in children again` });
    }
    state.version++;
    diags.push(...this.repair(state));
    diags.push(...this.lint(state));
    return diags;
  }

  remove(args: RemoveArgs): Diagnostic[] {
    const surfaceId = String(args.surface ?? "");
    const state = this.surfaces.get(surfaceId);
    if (!state) return [];
    if (!Array.isArray(args.ids) || args.ids.length === 0) {
      this.surfaces.delete(surfaceId);
      return [];
    }
    for (const id of args.ids) state.nodes.delete(id);
    for (const node of state.nodes.values()) {
      if (Array.isArray(node.children)) node.children = node.children.filter((c) => !args.ids!.includes(c));
    }
    state.version++;
    return [];
  }

  /** Two-way binding: UI writes a value into the data model. */
  setValue(surfaceId: string, path: string, value: unknown): boolean {
    const state = this.surfaces.get(surfaceId);
    if (!state) return false;
    const ok = setAt(state.data, path, value);
    if (ok) state.version++;
    return ok;
  }

  // -------------------------------------------------------------------------
  // Ingest (see normalize.ts for the pipeline)

  /**
   * `{"nodes": "[...]", "chart": "{...}, {...}]"}`: the 4B model wrote the rest
   * of its nodes list as an argument of its own, named after the first node's
   * component (bench sales-q3: the chart and table were lost). Node-shaped
   * values of unknown arguments join the nodes list; the argument's name is
   * the type of a node that has none.
   */
  private nodesInOtherArgs(a: Record<string, unknown>): Diagnostic[] {
    const listKey = NODE_LIST_KEYS.find((k) => Array.isArray(a[k]));
    if (!listKey) return [];
    const moved: string[] = [];
    for (const [key, value] of Object.entries(a)) {
      // Another node-list key after the list (`"nodes": "[...]", "children": [...]`,
      // 0.8B, playground workout plan) holds more nodes, not a call setting.
      if (CALL_KEYS.has(key) && !((NODE_LIST_KEYS as readonly string[]).includes(key) && key !== listKey)) continue;
      const nodes = asNodeList(value);
      if (!nodes) continue;
      const named = this.normalizer.resolveType(key);
      for (const n of nodes) if (named && !NODE_TYPE_KEYS.some((k) => n[k] !== undefined)) n.type = named.type;
      a[listKey] = [...(a[listKey] as unknown[]), ...nodes];
      delete a[key];
      moved.push(key);
    }
    return moved.length
      ? [{ severity: "warning", surface: String(a.surface ?? ""), message: `nodes written in ${moved.map((k) => `"${k}"`).join(", ")} were read as part of "${listKey}"` }]
      : [];
  }

  /** Ids written so far in the current render/update call; true when written inside a parent. */
  private callIds = new Map<string, boolean>();

  private nextId(type: string): string {
    return `${type}_${++this.autoId}`;
  }

  private repair(state: SurfaceState): Diagnostic[] {
    const { nodes, repairs } = repairStructure(state.nodes, this.normalizer, (t) => this.nextId(t));
    state.nodes = nodes;
    return [
      ...repairs.map((r) => ({ severity: "warning" as const, surface: state.id, node: r.node, message: r.message })),
      ...this.dropSelfTemplates(state),
      ...this.fillMissingTemplates(state),
      ...this.bindInputNames(state),
      ...this.bindWrappedLists(state),
      ...this.dropEmptyContainers(state),
    ];
  }

  /**
   * Real local-agent research wrote rows: ["data/evidence"] instead of a
   * whole-list binding. Only unwrap a schema-declared list reference when its
   * existing data target is an array; ordinary rows, paths and source stay literal.
   */
  private bindWrappedLists(state: SurfaceState): Diagnostic[] {
    const diags: Diagnostic[] = [];
    const walk = (value: unknown, schema: JSONSchema | undefined, node: string, at: string): unknown => {
      if (!schema || schema.literal) return value;
      if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
        const raw = value[0];
        const reference = isBinding(raw) && raw.startsWith("{/") ? raw : /^(?:\/|data\/)[A-Za-z0-9_~.\-/]+$/.test(raw) ? `{${raw.startsWith("/") ? raw : "/" + raw}}` : undefined;
        const list = schema.anyOf?.some((branch) => branch.type === "array");
        const binding = reference && schema.anyOf?.some((branch) => branch.type === "string" && branch.pattern && validate(branch, reference).length === 0);
        if (list && binding && Array.isArray(resolveValue(reference, { data: state.data, base: "" }))) {
          diags.push({ severity: "warning", surface: state.id, node, message: `${at}: read a wrapped list reference as ${reference}` });
          return reference;
        }
      }
      const branch = schema.anyOf?.find((part) => Array.isArray(value) ? part.type === "array" : part.type === "object" || part.properties !== undefined) ?? schema;
      if (Array.isArray(value)) return branch.items ? value.map((item, i) => walk(item, branch.items, node, `${at}/${i}`)) : value;
      if (value && typeof value === "object" && branch.properties) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, branch.properties?.[key], node, `${at}/${key}`)]));
      return value;
    };
    for (const node of state.nodes.values()) node.props = walk(node.props ?? {}, propsSchema(this.catalog, node.type), node.id, "props") as Record<string, unknown>;
    return diags;
  }

  /**
   * A template whose children repeat itself: `{"id":"tpl","type":"card",
   * "children":[{"each":"/hotels","template":"tpl"}]}` (4B, Vakyartha Kyoto
   * hotels) copied the grid's list spec into the item layout. It can only
   * render as a cycle (three "invalid: cycle" boxes in every card), and no
   * error told the model; the item's own props are the layout it meant.
   */
  private dropSelfTemplates(state: SurfaceState): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const node of state.nodes.values()) {
      const ch = node.children;
      if (!ch || Array.isArray(ch) || ch.template !== node.id) continue;
      delete node.children;
      diags.push({ severity: "warning", surface: state.id, node: node.id, message: `children repeated ${ch.each} with this node as its own template; removed (a template lays out one item)` });
    }
    return diags;
  }

  /**
   * children {each, template} naming a template that was never sent (4B,
   * Vakyartha "compare three hotels in Kyoto": "hotel_tpl" was missing from
   * all four renders, and each retry dropped more of the surface trying to fix
   * it, until only the title was left). The items are data the model did
   * send, so they are shown with the catalog's item template instead of not
   * at all. A warning, not an error: nothing the user sees is broken, and
   * small models lose content on retries. The model can still send its own
   * template with vak_update.
   */
  private fillMissingTemplates(state: SurfaceState): Diagnostic[] {
    const make = this.catalog.itemTemplate;
    if (!make) return [];
    const diags: Diagnostic[] = [];
    for (const node of [...state.nodes.values()]) {
      const ch = node.children;
      if (!ch || Array.isArray(ch) || state.nodes.has(ch.template)) continue;
      // Lists inside another template's items differ per item; only a list in
      // the surface data has one set of fields to lay out.
      const list = getAt(state.data, resolvePath(ch.each.replace(/^\{|\}$/g, ""), ""));
      const fields = Array.isArray(list) ? itemFields(list) : [];
      const raw = fields.length ? make(fields) : undefined;
      if (!raw) continue;
      const made = new Map<string, VpsNode>();
      const id = this.ingest({ ...raw, id: ch.template }, made, state.id, [], false, true);
      // A catalog narrowed for a target may lack what the item template uses.
      if (id !== ch.template || [...made.values()].some((n) => !(n.type in this.catalog.components))) continue;
      for (const [k, v] of made) state.nodes.set(k, v);
      diags.push({
        severity: "warning",
        surface: state.id,
        node: ch.template,
        message: `template "${ch.template}" was never sent; each item of ${ch.each} is shown as a ${made.get(id)!.type} of its fields (${fields.map((f) => f.name).join(", ")}). To lay out the items yourself, send a node with id "${ch.template}" with vak_update`,
      });
    }
    return diags;
  }

  /**
   * Errors left and content shown. A host compares these to decide whether a
   * new version of a surface may replace the one the user is looking at.
   */
  assess(surfaceId: string): SurfaceQuality | undefined {
    const state = this.surfaces.get(surfaceId);
    if (!state) return undefined;
    const errors = this.lint(state).filter((d) => d.severity === "error").length;
    let content = 0;
    const root = this.resolve(surfaceId)?.root;
    if (root) {
      walk(root, (n) => {
        if (n.type.startsWith("$")) return;
        if (!LAYOUT_TYPES.has(n.type) || this.showsOwnText(n.type, n.props)) content++;
      });
    }
    return { errors, content };
  }

  /** A container showing text of its own (a section's title) is content, not just a frame. */
  private showsOwnText(type: string, props: Record<string, unknown> | undefined): boolean {
    const declared = this.catalog.components[type]?.props.properties ?? {};
    return ["title", "description", "content"].some((k) => k in declared && typeof props?.[k] === "string" && props[k]);
  }

  /**
   * Layout containers below the root with no children and nothing of their own
   * to show draw empty frames: the 0.8B workout plan's five "tabs" (titled, with
   * no panels) showed as bare divider lines. They are removed; if nothing is
   * left, lintEmpty reports the surface as empty so the model adds content.
   */
  private dropEmptyContainers(state: SurfaceState): Diagnostic[] {
    const rootId = this.rootId(state);
    const empty = new Set<string>();
    for (const [nid, n] of state.nodes) {
      if (nid === rootId || !LAYOUT_TYPES.has(n.type) || (n.children !== undefined && (!Array.isArray(n.children) || n.children.length))) continue;
      if (this.showsOwnText(n.type, n.props)) continue;
      empty.add(nid);
    }
    if (!empty.size) return [];
    for (const nid of empty) state.nodes.delete(nid);
    for (const n of state.nodes.values()) if (Array.isArray(n.children)) n.children = n.children.filter((c) => !empty.has(c));
    return [{ severity: "warning", surface: state.id, message: `empty containers removed (no children, nothing to show): ${[...empty].map((e) => `"${e}"`).join(", ")}` }];
  }

  /** Nodes rendered per list item (templates and everything inside them). */
  private templateNodes(state: SurfaceState): Set<string> {
    const inTemplate = new Set<string>();
    const mark = (id: string) => {
      if (inTemplate.has(id)) return;
      inTemplate.add(id);
      const ch = state.nodes.get(id)?.children;
      if (Array.isArray(ch)) ch.forEach(mark);
      else if (ch) mark(ch.template);
    };
    for (const n of state.nodes.values()) if (n.children && !Array.isArray(n.children)) mark(n.children.template);
    return inTemplate;
  }

  /**
   * "Total: {size}, {crust}" outside any list, with no surface data of those
   * names but inputs bound to "/form/size" and "/form/crust" (4B, bench
   * pizza-order): the name is that input's value. Only when exactly one input's
   * bind path ends in the name; otherwise lintUnbound reports it.
   */
  private bindInputNames(state: SurfaceState): Diagnostic[] {
    const binds = [...state.nodes.values()].map((n) => n.props?.bind).filter((b): b is string => typeof b === "string" && b.startsWith("/"));
    if (!binds.length) return [];
    const inTemplate = this.templateNodes(state);
    const diags: Diagnostic[] = [];
    const rewrite = (v: unknown, node: string, schema?: JSONSchema): unknown => {
      if (schema?.literal && !isBinding(v)) return v;
      if (typeof v === "string") {
        return v.replace(/(?<!\\)\{([A-Za-z_][\w-]*)\}/g, (m, name: string) => {
          if (getAt(state.data, `/${name}`) !== undefined) return m;
          const hits = binds.filter((b) => b.endsWith(`/${name}`));
          if (hits.length !== 1) return m;
          diags.push({ severity: "warning", surface: state.id, node, message: `{${name}} read as the value of the input bound to "${hits[0]}"` });
          return `{${hits[0]}}`;
        });
      }
      if (Array.isArray(v)) return v.map((x) => rewrite(x, node, schema?.items));
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x, node, schema?.properties?.[k])]));
      return v;
    };
    for (const node of state.nodes.values()) {
      if (inTemplate.has(node.id) || !node.props || node.props.bind !== undefined) continue;
      node.props = rewrite(node.props, node.id, propsSchema(this.catalog, node.type)) as Record<string, unknown>;
    }
    return diags;
  }

  private normalizeChildren(raw: unknown, into: Map<string, VpsNode>, surface: string, diags: Diagnostic[], merge = false): Children | undefined {
    if (raw === undefined || raw === null) return undefined;
    // A template spec, possibly written as the only entry of a children list.
    const spec = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
    if (isObject(spec) && spec.each !== undefined && spec.template !== undefined) {
      const each = coerce({ type: "string" }, spec.each);
      // The template written in place, as inline authoring writes every other
      // child: it is ingested like one, so it cannot be left undefined. Only
      // a node (it has a type); `{template: "h"}` is a wrapped id, which
      // coerce unwraps.
      const inline = isObject(spec.template) && NODE_TYPE_KEYS.some((k) => typeof (spec.template as Record<string, unknown>)[k] === "string");
      const template = inline ? this.ingest(spec.template, into, surface, diags, merge, true) : coerce({ type: "string" }, spec.template);
      if (typeof each === "string" && typeof template === "string") return { each, template };
    }
    const list = Array.isArray(raw) ? raw : [raw];
    const ids: string[] = [];
    for (const c of list) {
      if (typeof c === "string") ids.push(c);
      else if (isObject(c) && this.onlyNodeSettings(c)) this.applyToPrevious(c, ids, into, surface, diags);
      else if (isObject(c)) {
        // Nested node instead of an id: flatten it.
        const id = this.ingest(c, into, surface, diags, merge, true);
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  /** Names (and aliases) of the props every node accepts: span, priority, visibleIf. */
  private get commonKeys(): Set<string> {
    return (this.commonKeyCache ??= new Set(Object.entries(this.catalog.common).flatMap(([k, s]) => [k, ...(((s as { aliases?: string[] }).aliases) ?? [])])));
  }
  private commonKeyCache: Set<string> | undefined;

  /** An object of node-level settings only ({"priority": "secondary"}), with no id, type, props or children. */
  private onlyNodeSettings(raw: Record<string, unknown>): boolean {
    const keys = Object.keys(raw).filter((k) => !isMetaKey(k));
    return keys.length > 0 && keys.every((k) => this.commonKeys.has(k));
  }

  /**
   * `[{...node}, {"priority": "secondary"}]`: the 4B model closed a node
   * early and wrote its remaining members as an object of their own (Telegram
   * hotel booking, 2026-10-25). That object is not a node; as one, it had no
   * type, was an error, and cost a retry. Its settings belong to the node
   * before it; with none before it, they are dropped.
   */
  private applyToPrevious(raw: Record<string, unknown>, ids: string[], into: Map<string, VpsNode>, surface: string, diags: Diagnostic[]): void {
    const prev = ids.length ? into.get(ids[ids.length - 1]!) : undefined;
    const written = JSON.stringify(raw);
    if (!prev || prev.type === "$invalid") {
      diags.push({ severity: "warning", surface, message: `${written} in a children list is not a node; ignored` });
      return;
    }
    const props = { ...prev.props };
    for (const [k, v] of Object.entries(raw)) if (!(k in props)) props[k] = v;
    prev.props = this.normalizer.prepareProps(prev.type, props, prev.id);
    diags.push({ severity: "warning", surface, node: prev.id, message: `${written} in a children list is not a node; applied to "${prev.id}", the node before it` });
  }

  /** Normalize one raw node into `into`; returns its id. With `merge`, an existing id is patched. */
  private ingest(raw: unknown, into: Map<string, VpsNode>, surface: string, diags: Diagnostic[], merge = false, inline = false): string | undefined {
    if (!isObject(raw)) return undefined;
    let givenId = typeof raw.id === "string" && raw.id ? raw.id : undefined;
    // A node written inside its parent whose id was already written earlier in
    // this call is a second node, not a replacement: the 4B model gave every
    // day's button the id "actions" in a 5-tab plan, and the last one replaced
    // the rest (Day 1 showed "Start Day 5"; days 2-5 had none).
    // Only when the first was also written inside a parent: a top-level node
    // then written in place is that node being placed, not a second one (4B,
    // Kyoto hotels: a vak_update patched action1-3 at the top level, then sent
    // the tree with them inside their cards; renamed "action1_2", the patched
    // originals were left in no parent, re-attached to the root, and every
    // Book button showed twice).
    if (givenId && inline && this.callIds.get(givenId) === true) {
      const first = givenId;
      let n = 2;
      while (into.has(`${first}_${n}`) || this.callIds.has(`${first}_${n}`)) n++;
      givenId = `${first}_${n}`;
      diags.push({ severity: "warning", surface, node: givenId, message: `id "${first}" was already used in this call; this one is "${givenId}"` });
    }
    if (givenId) this.callIds.set(givenId, inline || this.callIds.get(givenId) === true);
    const existing = givenId ? into.get(givenId) : undefined;
    if (existing && merge) {
      this.mergePatch(existing, raw as unknown as NodePatch, into, surface, diags);
      return givenId;
    }

    // Props sent at the node's top level are props.
    const props: Record<string, unknown> = { ...propsOf(raw) };
    for (const [k, v] of Object.entries(raw)) if (!NODE_KEYS.has(k) && !(k in props)) props[k] = v;
    for (const k of Object.keys(props)) if (isMetaKey(k)) delete props[k];
    // `"description": null`, `"payload": null` (4B, bench recipe): null is "none",
    // as in a patch, not a value that fails the prop's type.
    for (const k of Object.keys(props)) if (props[k] === null) delete props[k];
    // `each` + `template` written as props are this node's children spec.
    let rawChildren = raw.children;
    if (rawChildren === undefined && props.each !== undefined && props.template !== undefined) {
      rawChildren = { each: props.each, template: props.template };
      delete props.each;
      delete props.template;
    }

    const typeKey = NODE_TYPE_KEYS.find((k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== "");
    const rawType = typeKey ? raw[typeKey] : undefined;
    // `{"data": {...}}` alone in a nodes list is the surface's data, not a node
    // (4B, bench recipe: inferred as a chart, since "data" is a series alias,
    // and reported as a chart missing its series).
    if (rawType === undefined && rawChildren === undefined && givenId === undefined && Object.keys(props).length === 1 && isObject(unwrapJson(props.data))) {
      this.takeNodeData(props, undefined);
      return undefined;
    }
    let match = this.normalizer.resolveType(rawType);
    // `{"id":"hotels","type":"data","value":[...]}` (4B, Vakyartha Kyoto
    // hotels): the data a list's `each: "/hotels"` reads, written as a node
    // named after its path. Reported as an unknown component, the data never
    // reached the model and the grid was empty.
    if (!match && typeof rawType === "string" && rawType.toLowerCase() === "data" && rawChildren === undefined) {
      const value = unwrapJson(props.value ?? props.data);
      if (givenId && value !== undefined) {
        this.nodeData = mergeDeep(this.nodeData ?? {}, { [givenId]: value });
        this.callIds.delete(givenId);
        return undefined;
      }
      if (!givenId && isObject(value)) {
        this.nodeData = mergeDeep(this.nodeData ?? {}, value);
        return undefined;
      }
    }
    if (!match && rawType === undefined) {
      match = this.normalizer.inferType(props, { id: givenId, hasChildren: rawChildren !== undefined });
      if (match) diags.push({ severity: "warning", surface, node: givenId, message: `no type given; inferred "${match.type}" from its props` });
      else if (Object.keys(props).length === 0 && rawChildren === undefined) {
        diags.push({ severity: "warning", surface, node: givenId, message: "node with no type, props or children was dropped" });
        return undefined;
      } else if (givenId === undefined && rawChildren === undefined) {
        // `{"name": "", "email": "", "projects": [...]}` in a children list (4B,
        // form slice job-application): no id, no type, and keys that describe
        // no component. It is the form's starting values: surface data, not a
        // node (reported as a node missing its type, it cost three retries).
        this.nodeData = mergeDeep(this.nodeData ?? {}, props);
        return undefined;
      }
    }
    // `{"id":"chart","type":"chart","children":[{"props":{...}}]}` (4B, bench
    // dashboard-filter, three retries in a row): a component that can't hold
    // children, given one child that is nothing but props, owns those props.
    if (match && !this.normalizer.canHoldChildren(match.type) && Array.isArray(rawChildren) && rawChildren.length === 1) {
      const only = rawChildren[0];
      if (isObject(only) && Object.keys(only).length > 0 && Object.keys(only).every((k) => (NODE_PROPS_KEYS as readonly string[]).includes(k))) {
        Object.assign(props, { ...propsOf(only), ...props });
        rawChildren = undefined;
      }
    }
    // 4B component bench put step records (sometimes section-wrapped props)
    // in children. A leaf with one unambiguous required object-list prop can
    // own those records; validate every item and never invent or drop fields.
    if (match && !this.normalizer.canHoldChildren(match.type) && Array.isArray(rawChildren) && rawChildren.length) {
      const schema = propsSchema(this.catalog, match.type)!;
      const sentItems = rawChildren;
      const candidates = (schema.required ?? []).flatMap((name) => {
        const sub = schema.properties?.[name];
        if (!sub || [name, ...(sub.aliases ?? [])].some((k) => props[k] !== undefined)) return [];
        const array = sub.type === "array" ? sub : sub.anyOf?.find((b) => b.type === "array");
        if (!array?.items?.properties) return [];
        const items = sentItems.map((child) => {
          if (!isObject(child) || (Array.isArray(child.children) && child.children.length) || (child.children && !Array.isArray(child.children))) return undefined;
          const fields = { ...propsOf(child) };
          for (const [k, v] of Object.entries(child)) if (!NODE_KEYS.has(k)) fields[k] = v;
          return Object.keys(fields).length ? coerce(array.items!, fields) : undefined;
        });
        return validate(array, items).length ? [] : [{ name, items }];
      });
      if (candidates.length === 1) {
        const { name, items } = candidates[0]!;
        props[name] = items;
        rawChildren = undefined;
        diags.push({ severity: "warning", surface, node: givenId, message: `item records in children read as props.${name}` });
      }
    }
    this.takeNodeData(props, match?.type);
    const id = givenId ?? this.nextId(match?.type ?? "node");
    if (existing) diags.push({ severity: "warning", surface, node: id, message: "duplicate id; later node replaced earlier one" });
    const retyped = match && this.retypeByValue(match, props, id, rawChildren !== undefined, surface, diags);
    if (retyped) match = retyped;
    else if (match && rawType !== undefined) match = this.checkDeclared(match, rawType, props, id, rawChildren !== undefined, surface, diags);

    const node: VpsNode = match
      ? { id, type: match.type, props: this.normalizer.prepareProps(match.type, props, id, match.presets) }
      : { id, type: "$invalid", props: { ...props, $error: rawType === undefined ? "missing type" : `unknown component "${String(rawType)}"` } };
    // Reserve the slot first so the parent precedes its flattened children.
    into.set(id, node);
    const children = this.normalizeChildren(rawChildren, into, surface, diags, merge);
    if (children) node.children = children;
    return id;
  }

  /**
   * `data` written on a node belongs to the surface's data model (VPS keeps
   * structure and data apart) unless the component declares a `data` prop.
   */
  private takeNodeData(props: Record<string, unknown>, type: string | undefined): void {
    const declared = type ? this.catalog.components[type]?.props.properties?.data : undefined;
    const d = unwrapJson(props.data);
    if (declared || !isObject(d)) return;
    this.nodeData = mergeDeep(this.nodeData ?? {}, d);
    delete props.data;
  }

  /** Props can contradict the declared type or select a catalog-declared semantic variant. */
  private checkDeclared(
    match: TypeMatch,
    rawType: unknown,
    props: Record<string, unknown>,
    id: string,
    hasChildren: boolean,
    surface: string,
    diags: Diagnostic[],
  ): TypeMatch {
    const better = this.normalizer.reinterpret(match, props, { id, hasChildren });
    if (!better) return match;
    diags.push({ severity: "warning", surface, node: id, message: `props on type "${String(rawType)}" describe "${better.type}", used that` });
    return better;
  }

  /** A prop value that names another component retypes the node (see Normalizer.retypeByValue); the naming prop is removed from `props`. */
  private retypeByValue(
    match: TypeMatch,
    props: Record<string, unknown>,
    id: string,
    hasChildren: boolean,
    surface: string,
    diags: Diagnostic[],
  ): TypeMatch | undefined {
    const hit = this.normalizer.retypeByValue(match, props, { id, hasChildren });
    if (!hit) return undefined;
    delete props[hit.key];
    diags.push({ severity: "warning", surface, node: id, message: `${hit.key} "${hit.value}" names the "${hit.match.type}" component; used it` });
    return hit.match;
  }

  private mergePatch(node: VpsNode, patch: NodePatch, nodes: Map<string, VpsNode>, surface: string, diags: Diagnostic[]): void {
    const raw = patch as unknown as Record<string, unknown>;
    const props = { ...node.props };
    const incoming: Record<string, unknown> = { ...propsOf(raw) };
    for (const [k, v] of Object.entries(raw)) if (!NODE_KEYS.has(k) && !(k in incoming)) incoming[k] = v;
    for (const [k, v] of Object.entries(incoming)) {
      if (v === null) delete props[k];
      else props[k] = v;
    }
    this.takeNodeData(props, node.type);
    const typeKey = NODE_TYPE_KEYS.find((k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== "");
    let presets: Record<string, unknown> | undefined;
    if (typeKey) {
      let match = this.normalizer.resolveType(raw[typeKey]);
      if (match) {
        match = this.checkDeclared(match, raw[typeKey], props, node.id, patch.children !== undefined || node.children !== undefined, surface, diags);
        node.type = match.type;
        presets = match.presets;
      } else diags.push({ severity: "error", surface, node: node.id, message: `unknown component "${String(raw[typeKey])}"` });
    }
    if (node.type === "$invalid") {
      const match = this.normalizer.inferType(props, { id: node.id, hasChildren: patch.children !== undefined || node.children !== undefined });
      if (match) {
        node.type = match.type;
        presets = match.presets;
      }
    }
    if (node.type !== "$invalid") {
      delete props.$error;
      const retyped = this.retypeByValue({ type: node.type, presets }, props, node.id, patch.children !== undefined || node.children !== undefined, surface, diags);
      if (retyped) {
        node.type = retyped.type;
        presets = retyped.presets;
      }
    }
    node.props = node.type === "$invalid" ? props : this.normalizer.prepareProps(node.type, props, node.id, presets);
    if (patch.children !== undefined) {
      const children = this.normalizeChildren(patch.children, nodes, surface, diags, true);
      if (children) node.children = children;
    }
  }

  // -------------------------------------------------------------------------
  // Validation

  /**
   * Bound inputs that nothing can submit collect values that go nowhere. An
   * error, so the model adds a form or an action. Inputs that only drive
   * visibility (their path is used by some visibleIf) are exempt.
   */
  private lintSubmittable(state: SurfaceState): Diagnostic[] {
    const nodes = [...state.nodes.values()];
    const canSubmit = nodes.some((n) => this.role(n) === "form" || (this.role(n) === "action" && typeof n.props?.action === "string" && n.props.action));
    if (canSubmit) return [];
    const toggles = new Set(nodes.map((n) => n.props?.visibleIf).filter((v): v is string => typeof v === "string").map((v) => v.replace(/^\{|\}$/g, "")));
    // A component whose bind is optional keeps its own state there (a board's
    // card moves) and needs no submit; inputs declare bind as required.
    const collects = (type: string) => this.catalog.components[type]?.props.required?.includes("bind") ?? true;
    const stranded = nodes.filter((n) => typeof n.props?.bind === "string" && !toggles.has(n.props.bind as string) && collects(n.type));
    if (!stranded.length) return [];
    const forms = Object.entries(this.catalog.components).filter(([, d]) => d.role === "form").map(([name]) => name);
    const actions = Object.entries(this.catalog.components).filter(([, d]) => d.role === "action" && !d.choices).map(([name]) => name);
    return [{
      severity: "error",
      surface: state.id,
      node: stranded[0]!.id,
      message: `inputs ${stranded.map((n) => `"${n.id}"`).join(", ")} collect values but nothing submits them: put them in a ${forms.join("/") || "form"} or add a ${actions.join("/") || "button"} with an action`,
    }];
  }

  /** A layout root with nothing in it shows the user only a title: an error, so the model fills it. */
  private lintEmpty(state: SurfaceState): Diagnostic[] {
    const id = this.rootId(state);
    const root = id ? state.nodes.get(id) : undefined;
    if (!root) return [];
    // Content is any component that isn't a layout container, or a container
    // showing text of its own (a section's title). Five "tabs" nodes with titles
    // but no panels in a grid (0.8B, playground 2026-10-25) drew only divider
    // lines and passed as clean, so the model never fixed it.
    for (const nid of reachable(state.nodes)) {
      const n = state.nodes.get(nid)!;
      if (!LAYOUT_TYPES.has(n.type) || this.showsOwnText(n.type, n.props)) return [];
    }
    return [{ severity: "error", surface: state.id, node: root.id, message: "the surface is empty: add the content as children of the root, or remove the surface and answer in text" }];
  }

  /**
   * `{name}` fills from a list item, or from the surface's own data of that
   * name. With neither it can never resolve and the user would see the
   * braces: an error, so the model supplies the value.
   */
  private lintUnbound(state: SurfaceState): Diagnostic[] {
    const inTemplate = this.templateNodes(state);
    // Paths the user fills in: an input's value is empty until typed.
    const inputs = [...state.nodes.values()].map((n) => n.props?.bind).filter((b): b is string => typeof b === "string" && b.startsWith("/")).map((b) => b.replace(/\./g, "/"));
    const filledByInput = (path: string) => {
      const p = path.replace(/\./g, "/");
      return inputs.some((b) => p === b || p.startsWith(`${b}/`) || b.startsWith(`${p}/`));
    };
    const diags: Diagnostic[] = [];
    for (const node of state.nodes.values()) {
      if (inTemplate.has(node.id)) continue;
      const found = new Set<string>();
      const missing = new Set<string>();
      const scan = (v: unknown, schema?: JSONSchema): void => {
        if (schema?.literal && !isBinding(v)) return;
        if (typeof v === "string") {
          for (const m of v.matchAll(/(?<!\\)\{([A-Za-z_][^{}\s]*)\}/g)) if (getAt(state.data, `/${m[1]}`) === undefined) found.add(m[1]!);
          for (const m of v.matchAll(/(?<!\\)\{(\/[A-Za-z0-9_~.\-][A-Za-z0-9_~.\-/]*)\}/g)) {
            if (boundValue(state.data, m[1]!) === undefined && !filledByInput(m[1]!)) missing.add(m[1]!);
          }
        } else if (Array.isArray(v)) v.forEach((x) => scan(x, schema?.items));
        else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => scan(x, schema?.properties?.[k]));
      };
      // visibleIf on a missing path hides the node, as meant; bind is where an input writes.
      const { visibleIf: _v, bind: _b, ...shown } = node.props ?? {};
      scan(shown, propsSchema(this.catalog, node.type));
      if (found.size) {
        const names = [...found].map((f) => `{${f}}`).join(", ");
        diags.push({ severity: "error", surface: state.id, node: node.id, message: `${names} has no value: there is no such surface data, and this node is not inside a list template. Put the value in "data", or render the node from children {each, template}` });
      }
      // `"values": "{/budget.income.values.0}"` with no such data (4B, budget
      // tracker): the chart drew empty series and the call passed as clean, so
      // the model never sent the numbers. Absolute paths were not checked.
      if (missing.size) {
        const names = [...missing].map((f) => `{${f}}`).join(", ");
        const top = isObject(state.data) ? Object.keys(state.data) : [];
        const has = top.length ? `; data has ${top.map((k) => `/${k}`).join(", ")}` : "; data is empty";
        diags.push({ severity: "error", surface: state.id, node: node.id, message: `${names} has no value: no such path in the surface data${has}. Put the values in "data" at that path, or bind to data that exists` });
      }
    }
    return diags;
  }

  /**
   * An input bound under data that can't hold it ("/todos/new-task" while
   * /todos is the task list, 4B, bench todo-add) never keeps what the user
   * types, so a required field blocks the form forever: an error naming the
   * conflict. Inputs inside list templates bind per item and are skipped.
   */
  private lintBindable(state: SurfaceState): Diagnostic[] {
    const inTemplate = this.templateNodes(state);
    const diags: Diagnostic[] = [];
    for (const node of state.nodes.values()) {
      const bind = node.props?.bind;
      if (inTemplate.has(node.id) || typeof bind !== "string" || !bind.startsWith("/")) continue;
      const segs = parsePointer(bind);
      for (let i = 1; i < segs.length; i++) {
        const prefix = "/" + segs.slice(0, i).join("/");
        const v = getAt(state.data, prefix);
        if (v === undefined || v === null) break;
        const blocked = typeof v !== "object" || (Array.isArray(v) && !/^(\d+|-)$/.test(segs[i]!));
        if (!blocked) continue;
        const what = Array.isArray(v) ? "a list" : `a ${typeof v}`;
        diags.push({ severity: "error", surface: state.id, node: node.id, message: `bind "${bind}" cannot hold a value: "${prefix}" is ${what} in data. Bind the input to a path of its own, e.g. "/form/${segs.at(-1)}"` });
        break;
      }
    }
    return diags;
  }

  /**
   * A template holding one fixed button per item ("Book Zen", "Book Villa",
   * ... with nothing from the item in them) was written as N buttons for N
   * items: each copy keeps only its own. One fixed button ("Choose") is the
   * normal pattern, since its click carries the item's data, and stays.
   */
  private perItemButtons(state: SurfaceState, templateId: string, count: number): Map<string, number> | undefined {
    const ch = state.nodes.get(templateId)?.children;
    if (!Array.isArray(ch) || count < 2) return undefined;
    const fixed = ch.filter((id) => {
      const n = state.nodes.get(id);
      return n && this.catalog.components[n.type]?.role === "action" && !/(?<!\\)\{(?!\/)[^{}\s]+\}/.test(JSON.stringify(n.props ?? {}));
    });
    if (fixed.length !== count) return undefined;
    return new Map(fixed.map((id, i) => [id, i]));
  }

  private rootId(state: SurfaceState): string | undefined {
    if (state.nodes.has("root")) return "root";
    return state.nodes.keys().next().value;
  }

  lint(state: SurfaceState): Diagnostic[] {
    const diags: Diagnostic[] = [...this.lintSubmittable(state), ...this.lintEmpty(state), ...this.lintUnbound(state), ...this.lintBindable(state), ...this.lintResolved(state)];
    const skip = (v: unknown) => isBinding(v);
    for (const node of state.nodes.values()) {
      if (node.type === "$invalid") {
        const why = typeof node.props?.$error === "string" ? node.props.$error : "invalid type";
        diags.push({ severity: "error", surface: state.id, node: node.id, message: `${why}; set "type" to one of: ${Object.keys(this.catalog.components).join(", ")}` });
        continue;
      }
      const schema = propsSchema(this.catalog, node.type)!;
      for (const e of validate(schema, node.props ?? {}, { skip })) {
        diags.push({ severity: "error", surface: state.id, node: node.id, message: `props${e.path} ${e.message}` });
      }
      const ch = node.children;
      if (Array.isArray(ch)) {
        for (const c of ch) {

          if (!state.nodes.has(c)) diags.push({ severity: "error", surface: state.id, node: node.id, message: `child "${c}" was never sent: send that node with vak_update, or remove it from children` });
        }
      } else if (ch && !state.nodes.has(ch.template)) {
        diags.push({ severity: "error", surface: state.id, node: node.id, message: `template "${ch.template}" was never sent: send one node with id "${ch.template}" (one item's layout, with {field} for the item's fields) using vak_update; the rest of the surface stays` });
      }
    }
    return diags;
  }

  /**
   * The schema check in lint skips bindings: their value is unknown until the
   * data fills them. Nothing checked them after, so any bound prop could
   * resolve to a shape its component can't show and pass as clean: a chart's
   * series bound to records [{day, km}] drew seven empty series (4B, running
   * stats), a stat bound to a list showed raw JSON (4B, budget tracker).
   * Each bound value is validated once resolved, as the component's schema
   * would have validated it written in place; the first failing instance of a
   * node (a template repeats) is reported.
   */
  private lintResolved(state: SurfaceState): Diagnostic[] {
    const root = this.resolve(state.id)?.root;
    if (!root) return [];
    const diags: Diagnostic[] = [];
    const reported = new Set<string>();
    walk(root, (n) => {
      const node = state.nodes.get(n.id);
      if (!node || reported.has(n.id) || n.type.startsWith("$")) return;
      const bound = bindingsIn(node.props ?? {});
      if (!bound.size) return;
      const schema = propsSchema(this.catalog, n.type);
      if (!schema) return;
      const props = coerce(schema, n.props) as Record<string, unknown>;
      const errors = validate(schema, props);
      // Scalar formatting within a real list is harmless (e.g. numeric
      // ratings shown as text). Coercing a whole bound scalar to an array
      // only in this lint copy, though, hid an empty table in the projector.
      const shape = (value: unknown) => Array.isArray(value) ? "array" : value && typeof value === "object" ? "object" : "scalar";
      for (const error of validate(schema, n.props)) {
        if (bound.has(error.path) && shape(getAt(props, error.path)) !== shape(getAt(n.props, error.path)) && !errors.some((e) => e.path === error.path)) errors.push(error);
      }
      for (const e of errors) {
        const at = [...bound.keys()].find((b) => e.path === b || e.path.startsWith(`${b}/`));
        // No value at all is lintUnbound's report (a path the data lacks).
        if (at === undefined || getAt(props, at) === undefined) continue;
        reported.add(n.id);
        // The schema's own description says what fits; a failed anyOf's last
        // branch ("expected string") does not.
        const want = schema.properties?.[at.split("/")[1]!]?.description;
        // What the data held, before a catalog finalize reshaped it. Only for
        // absolute paths: a relative one depends on the list item.
        const binding = bound.get(at)!;
        const held = describeValue(binding.startsWith("{/") ? resolveValue(binding, { data: state.data, base: "" }) : getAt(props, at));
        const why = want && e.path === at ? `${binding} is ${held}, but ${at.slice(1)} takes ${want}` : `props${e.path} ${e.message}, once ${binding} (${held}) is filled from the data`;
        diags.push({ severity: "error", surface: state.id, node: n.id, message: `${why}. Change the data to that shape, or bind to data that has it` });
        return;
      }
    });
    return diags;
  }

  // -------------------------------------------------------------------------
  // Resolution

  resolve(surfaceId: string): ResolvedSurface | undefined {
    const state = this.surfaces.get(surfaceId);
    if (!state) return undefined;
    const rootId = this.rootId(state);
    const root = rootId ? this.resolveNode(state, rootId, { data: state.data, base: "" }, rootId, new Set()) : null;
    return { id: state.id, title: state.title, version: state.version, root, data: state.data };
  }

  private resolveNode(state: SurfaceState, id: string, scope: Scope, key: string, path: Set<string>): ResolvedNode | null {
    const node = state.nodes.get(id);
    // Once the model has finished writing, a child it never sent is left
    // out: lint has told the model, and the user is not shown a placeholder
    // for content that is not coming.
    if (!node) return state.partial ? { key, id, type: "$pending", props: {}, children: [] } : null;
    if (path.has(id)) return { key, id, type: "$invalid", props: {}, children: [], error: "cycle" };
    let resolved = textProps(propsSchema(this.catalog, node.type), resolveValue(node.props ?? {}, scope, propsSchema(this.catalog, node.type)) as Record<string, unknown>);
    const variant = this.normalizer.semanticType(node.type, resolved, { id, hasChildren: node.children !== undefined });
    const type = variant?.type ?? node.type;
    if (variant) resolved = this.normalizer.prepareProps(type, resolved, id);
    const finalize = this.catalog.components[type]?.finalize;
    const props = finalize ? finalize(resolved) : resolved;

    if ("visibleIf" in props && !props.visibleIf) return null;

    const out: ResolvedNode = { key, id, type, props, children: [] };
    if (typeof props.$error === "string") out.error = props.$error;
    const rawBind = node.props?.bind;
    if (typeof rawBind === "string" && rawBind) {
      out.bindPath = resolvePath(rawBind.replace(/^\{|\}$/g, ""), scope.base);
      out.props.value = getAt(state.data, out.bindPath);
    }

    const next = new Set(path).add(id);
    const ch = node.children;
    if (Array.isArray(ch)) {
      for (const c of ch) {
        const r = this.resolveNode(state, c, scope, scopedKey(key, c), next);
        if (r) out.children.push(r);
      }
    } else if (ch) {
      const each = ch.each.replace(/^\{|\}$/g, "");
      let listPath = resolvePath(each, scope.base);
      // Inside a list item, "/amenities" that is not top-level data but is a
      // field of the item means the item's own list.
      if (scope.base && each.startsWith("/") && getAt(state.data, listPath) === undefined) {
        const own = resolvePath(each.slice(1), scope.base);
        if (Array.isArray(getAt(state.data, own))) listPath = own;
      }
      const list = getAt(state.data, listPath);
      if (Array.isArray(list)) {
        const perItem = this.perItemButtons(state, ch.template, list.length);
        list.forEach((_, i) => {
          const itemScope = { data: state.data, base: `${listPath}/${i}` };
          const r = this.resolveNode(state, ch.template, itemScope, `${ch.template}#${i}`, next);
          if (r && perItem) r.children = r.children.filter((c) => !perItem.has(c.id) || perItem.get(c.id) === i);
          if (r) out.children.push(r);
        });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Interaction

  private role(node: { type: string }): "form" | "action" | undefined {
    return this.catalog.components[node.type]?.role;
  }

  /**
   * A user activated `sourceId` (a button or a form). Validates bound inputs in
   * the enclosing form and returns the action to send back to the model.
   */
  /**
   * What activating a control submits: the control itself, and the scope whose
   * bound inputs travel with it — the enclosing form, or (when inputs sit in a
   * plain container) the nearest ancestor of an action that holds bound inputs.
   * Every projector uses this, so web and chat targets submit the same values.
   */
  submitScope(surfaceId: string, sourceId: string): { resolved: ResolvedSurface; source: ResolvedNode; scope?: ResolvedNode } | undefined {
    const resolved = this.resolve(surfaceId);
    if (!resolved?.root) return undefined;
    const choice = this.choice(resolved.root, sourceId);
    const trail = choice?.trail ?? findTrail(resolved.root, sourceId);
    if (!trail) return undefined;
    const source = choice?.source ?? trail[trail.length - 1]!;
    const hasInputs = (n: ResolvedNode) => {
      let found = false;
      walk(n, (c) => (found ||= c.bindPath !== undefined));
      return found;
    };
    const ancestors = trail.slice(0, -1).reverse();
    const scope =
      (this.role(source) === "form" ? source : undefined) ??
      ancestors.find((n) => this.role(n) === "form") ??
      (this.role(source) === "action" ? ancestors.find(hasInputs) : undefined);
    return { resolved, source, scope };
  }

  /** `<key>#<i>`: item i of a node's declared choices, as a control of its own. */
  private choice(root: ResolvedNode, sourceId: string): { trail: ResolvedNode[]; source: ResolvedNode } | undefined {
    const m = /^(.*)#(\d+)$/.exec(sourceId);
    if (!m) return undefined;
    const trail = findTrail(root, m[1]!);
    const node = trail?.at(-1);
    const prop = node ? this.catalog.components[node.type]?.choices : undefined;
    const items = prop ? node!.props[prop] : undefined;
    const item = Array.isArray(items) ? items[Number(m[2])] : undefined;
    if (!trail || !node || item === undefined) return undefined;
    const o = isObject(item) ? item : {};
    const option = String(o.name ?? o.title ?? o.label ?? o.id ?? item);
    const base = isObject(node.props.payload) ? node.props.payload : {};
    return { trail, source: { ...node, key: sourceId, props: { ...node.props, payload: { ...base, option } } } };
  }

  submit(surfaceId: string, sourceId: string, target?: string): SubmitResult {
    const found = this.submitScope(surfaceId, sourceId);
    if (!found) return { errors: { [sourceId]: [this.surfaces.has(surfaceId) ? "control not found" : "surface not found"] } };
    const { resolved, source, scope: form } = found;

    let name = typeof source.props.action === "string" ? source.props.action : undefined;
    const payload = source.props.payload;
    const data: Record<string, unknown> = isObject(payload) ? { ...payload } : payload !== undefined ? { value: payload } : {};
    const errors: Record<string, string[]> = {};

    if (form) {
      if (!name || source === form) name = typeof form.props.submit === "string" ? form.props.submit : (name ?? "submit");
      walk(form, (n) => {
        if (!n.bindPath) return;
        const value = getAt(resolved.data, n.bindPath);
        const fails = runChecks(value, n.props.checks);
        if (fails.length) errors[n.key] = fails;
        const segs = parsePointer(n.bindPath);
        data[segs[segs.length - 1] ?? n.id] = value;
      });
    }
    if (Object.keys(errors).length) return { errors };
    if (!name) return { errors: { [sourceId]: ["control has no action"] } };
    return {
      errors,
      action: { action: name, surface: surfaceId, source: source.id, ...(target ? { target } : {}), data },
    };
  }
}

function scopedKey(parentKey: string, childId: string): string {
  // Inside a template instance, children need instance-unique keys.
  const hash = parentKey.indexOf("#");
  return hash < 0 ? childId : `${childId}${parentKey.slice(hash)}`;
}

export function walk(node: ResolvedNode, fn: (n: ResolvedNode) => void): void {
  fn(node);
  for (const c of node.children) walk(c, fn);
}

function findTrail(node: ResolvedNode, key: string): ResolvedNode[] | null {
  if (node.key === key || node.id === key) return [node];
  for (const c of node.children) {
    const t = findTrail(c, key);
    if (t) return [node, ...t];
  }
  return null;
}

/** Render diagnostics as a compact tool-result message so the model can self-correct. */
/**
 * The fields of a data list's items, in first-seen order. Values that are
 * text for some items and lists for others (malformed model JSON) count as
 * text. Names a binding cannot address are skipped.
 */
function itemFields(list: unknown[]): ItemField[] {
  if (list.length && list.every((v) => v === null || typeof v !== "object")) return [{ name: ".", label: "", kind: "text" }];
  const kinds = new Map<string, Set<ItemField["kind"]>>();
  for (const item of list) {
    if (!isObject(item)) continue;
    for (const [k, v] of Object.entries(item)) {
      if (!/^[A-Za-z_][\w-]*$/.test(k) || v === null || v === undefined) continue;
      const kind = Array.isArray(v) ? (v.every((x) => x === null || typeof x !== "object") ? "list" : undefined) : typeof v === "object" ? undefined : "text";
      if (!kind) continue;
      if (!kinds.has(k)) kinds.set(k, new Set());
      kinds.get(k)!.add(kind);
    }
  }
  return [...kinds].map(([name, k]) => ({ name, label: humanize(name), kind: k.has("text") ? "text" : "list" }));
}

/** "price_per_night", "pricePerNight" -> "Price per night". */
function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatDiagnostics(diags: Diagnostic[]): string {
  if (diags.length === 0) return "ok";
  const errors = diags.filter((d) => d.severity === "error");
  const head = errors.length
    ? `rendered with ${errors.length} error(s); fix with vak_update:`
    : "rendered; notes:";
  return [head, ...diags.map((d) => `- ${d.severity}${d.node ? ` [${d.node}]` : ""}: ${d.message}`)].join("\n");
}


/** Ids reachable from the root through children lists and list templates. */
function reachable(nodes: Map<string, VpsNode>): Set<string> {
  const root = nodes.has("root") ? "root" : nodes.keys().next().value;
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !nodes.has(id)) return;
    seen.add(id);
    const ch = nodes.get(id)!.children;
    if (Array.isArray(ch)) ch.forEach(visit);
    else if (ch) visit(ch.template);
  };
  if (root !== undefined) visit(root);
  return seen;
}

/** Every node id written in a patch, including nodes nested inline as children. */
function collectIds(raw: unknown, into: Set<string>): void {
  if (Array.isArray(raw)) return raw.forEach((r) => collectIds(r, into));
  if (!isObject(raw)) return;
  if (typeof raw.id === "string") into.add(raw.id);
  collectIds(raw.children, into);
}

/** A text prop bound to a list of plain values shows them as text ("Onsen, Tatami"), not as JSON. */
function textProps(schema: JSONSchema | undefined, props: Record<string, unknown>): Record<string, unknown> {
  const fields = schema?.properties;
  if (!fields) return props;
  let out = props;
  for (const [k, v] of Object.entries(props)) {
    if (fields[k]?.type !== "string" || !Array.isArray(v) || !v.every((x) => x === null || typeof x !== "object")) continue;
    if (out === props) out = { ...props };
    out[k] = v.filter((x) => x !== null && x !== "").join(", ");
  }
  return out;
}

/** Pointer of every whole-binding value in props ("/series" → "{/rows}"). */
function bindingsIn(props: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const scan = (v: unknown, at: string): void => {
    if (isBinding(v)) out.set(at, v as string);
    else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${at}/${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) scan(x, `${at}/${k}`);
  };
  for (const [k, v] of Object.entries(props)) if (k !== "bind" && k !== "visibleIf") scan(v, `/${k}`);
  return out;
}

/** A short account of a resolved value, for telling the model what its data held. */
function describeValue(v: unknown): string {
  if (Array.isArray(v)) {
    const first = v.find((x) => x !== null && x !== undefined);
    const n = (word: string) => `a list of ${v.length} ${word}${v.length === 1 ? "" : "s"}`;
    if (first && typeof first === "object" && !Array.isArray(first)) return `${n("record")} with ${Object.keys(first).join(", ")}`;
    return n(first === undefined ? "item" : Array.isArray(first) ? "list" : typeof first);
  }
  if (v && typeof v === "object") return `a record with ${Object.keys(v).join(", ")}`;
  return `the ${typeof v} ${JSON.stringify(v)}`;
}
