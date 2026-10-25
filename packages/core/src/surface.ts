// Surface state: applies vak_render / vak_update / vak_remove, repairs common
// model mistakes instead of rejecting them, resolves bindings into a tree that
// projectors render, and turns user interactions into VpsAction results.

import { isBinding, resolveValue, type Scope } from "./bindings.ts";
import { type Catalog, propsSchema } from "./catalog.ts";
import { runChecks } from "./checks.ts";
import { isMetaKey, Normalizer, repairStructure, type TypeMatch } from "./normalize.ts";
import { parseLenient } from "./partial-json.ts";
import { getAt, parsePointer, resolvePath, setAt } from "./pointer.ts";
import { coerce, type JSONSchema, validate } from "./schema.ts";
import { LAYOUT_TYPES } from "./projector.ts";
import {
  type Children,
  NODE_LIST_KEYS,
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
}

export interface ResolvedNode {
  /** Unique per instance; template copies get `tpl#index`. */
  key: string;
  id: string;
  /** Component type, or "$pending" (child not arrived yet) / "$invalid". */
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
const NODE_KEYS = new Set<string>(["id", "props", "children", ...NODE_TYPE_KEYS]);

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
    return structuredClone({ id: s.id, title: s.title, nodes: [...s.nodes.values()], data: s.data, version: s.version });
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
    const shownBefore = reachable(state.nodes);
    const sent = new Set<string>();
    collectIds(args.nodes, sent);
    this.nodeData = undefined;
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

  private nextId(type: string): string {
    return `${type}_${++this.autoId}`;
  }

  private repair(state: SurfaceState): Diagnostic[] {
    const { nodes, repairs } = repairStructure(state.nodes, this.normalizer, (t) => this.nextId(t));
    state.nodes = nodes;
    return repairs.map((r) => ({ severity: "warning" as const, surface: state.id, node: r.node, message: r.message }));
  }

  private normalizeChildren(raw: unknown, into: Map<string, VpsNode>, surface: string, diags: Diagnostic[], merge = false): Children | undefined {
    if (raw === undefined || raw === null) return undefined;
    // A template spec, possibly written as the only entry of a children list.
    const spec = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
    if (isObject(spec) && spec.each !== undefined && spec.template !== undefined) {
      const each = coerce({ type: "string" }, spec.each);
      const template = coerce({ type: "string" }, spec.template);
      if (typeof each === "string" && typeof template === "string") return { each, template };
    }
    const list = Array.isArray(raw) ? raw : [raw];
    const ids: string[] = [];
    for (const c of list) {
      if (typeof c === "string") ids.push(c);
      else if (isObject(c)) {
        // Nested node instead of an id: flatten it.
        const id = this.ingest(c, into, surface, diags, merge);
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  /** Normalize one raw node into `into`; returns its id. With `merge`, an existing id is patched. */
  private ingest(raw: unknown, into: Map<string, VpsNode>, surface: string, diags: Diagnostic[], merge = false): string | undefined {
    if (!isObject(raw)) return undefined;
    const givenId = typeof raw.id === "string" && raw.id ? raw.id : undefined;
    const existing = givenId ? into.get(givenId) : undefined;
    if (existing && merge) {
      this.mergePatch(existing, raw as unknown as NodePatch, into, surface, diags);
      return givenId;
    }

    // Props sent at the node's top level are props.
    const props: Record<string, unknown> = isObject(raw.props) ? { ...raw.props } : {};
    for (const [k, v] of Object.entries(raw)) if (!NODE_KEYS.has(k) && !(k in props)) props[k] = v;
    for (const k of Object.keys(props)) if (isMetaKey(k)) delete props[k];
    // `each` + `template` written as props are this node's children spec.
    let rawChildren = raw.children;
    if (rawChildren === undefined && props.each !== undefined && props.template !== undefined) {
      rawChildren = { each: props.each, template: props.template };
      delete props.each;
      delete props.template;
    }

    const typeKey = NODE_TYPE_KEYS.find((k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== "");
    const rawType = typeKey ? raw[typeKey] : undefined;
    let match = this.normalizer.resolveType(rawType);
    if (!match && rawType === undefined) {
      match = this.normalizer.inferType(props, { id: givenId, hasChildren: rawChildren !== undefined });
      if (match) diags.push({ severity: "warning", surface, node: givenId, message: `no type given; inferred "${match.type}" from its props` });
      else if (Object.keys(props).length === 0 && rawChildren === undefined) {
        diags.push({ severity: "warning", surface, node: givenId, message: "node with no type, props or children was dropped" });
        return undefined;
      }
    }
    this.takeNodeData(props, match?.type);
    const id = givenId ?? this.nextId(match?.type ?? "node");
    if (existing) diags.push({ severity: "warning", surface, node: id, message: "duplicate id; later node replaced earlier one" });
    if (match && rawType !== undefined) match = this.checkDeclared(match, rawType, props, id, rawChildren !== undefined, surface, diags);

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

  /** A declared type that its props contradict yields to the type they describe (see Normalizer.reinterpret). */
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
    diags.push({ severity: "warning", surface, node: id, message: `type "${String(rawType)}" does not fit its props; they describe "${better.type}", used that` });
    return better;
  }

  private mergePatch(node: VpsNode, patch: NodePatch, nodes: Map<string, VpsNode>, surface: string, diags: Diagnostic[]): void {
    const raw = patch as unknown as Record<string, unknown>;
    const props = { ...node.props };
    const incoming: Record<string, unknown> = isObject(patch.props) ? { ...patch.props } : {};
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
    if (node.type !== "$invalid") delete props.$error;
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
    const stranded = nodes.filter((n) => typeof n.props?.bind === "string" && !toggles.has(n.props.bind as string));
    if (!stranded.length) return [];
    const forms = Object.entries(this.catalog.components).filter(([, d]) => d.role === "form").map(([name]) => name);
    const actions = Object.entries(this.catalog.components).filter(([, d]) => d.role === "action").map(([name]) => name);
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
    // Only a bare layout container is empty; a card or section with content is not.
    if (!root || !LAYOUT_TYPES.has(root.type)) return [];
    if (["title", "description", "content"].some((k) => typeof root.props?.[k] === "string" && root.props[k])) return [];
    const ch = root.children;
    if (ch && (!Array.isArray(ch) || ch.length)) return [];
    return [{ severity: "error", surface: state.id, node: root.id, message: "the surface is empty: add the content as children of the root, or remove the surface and answer in text" }];
  }

  /**
   * `{name}` fills from a list item, or from the surface's own data of that
   * name. With neither it can never resolve and the user would see the
   * braces: an error, so the model supplies the value.
   */
  private lintUnbound(state: SurfaceState): Diagnostic[] {
    const inTemplate = new Set<string>();
    const mark = (id: string) => {
      if (inTemplate.has(id)) return;
      inTemplate.add(id);
      const ch = state.nodes.get(id)?.children;
      if (Array.isArray(ch)) ch.forEach(mark);
      else if (ch) mark(ch.template);
    };
    for (const n of state.nodes.values()) if (n.children && !Array.isArray(n.children)) mark(n.children.template);
    const diags: Diagnostic[] = [];
    for (const node of state.nodes.values()) {
      if (inTemplate.has(node.id)) continue;
      const found = new Set<string>();
      const scan = (v: unknown): void => {
        if (typeof v === "string") {
          for (const m of v.matchAll(/(?<!\\)\{([A-Za-z_][^{}\s]*)\}/g)) if (getAt(state.data, `/${m[1]}`) === undefined) found.add(m[1]!);
        } else if (Array.isArray(v)) v.forEach(scan);
        else if (v && typeof v === "object") Object.values(v).forEach(scan);
      };
      scan(node.props);
      if (!found.size) continue;
      const names = [...found].map((f) => `{${f}}`).join(", ");
      diags.push({ severity: "error", surface: state.id, node: node.id, message: `${names} has no value: there is no such surface data, and this node is not inside a list template. Put the value in "data", or render the node from children {each, template}` });
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
    const diags: Diagnostic[] = [...this.lintSubmittable(state), ...this.lintEmpty(state), ...this.lintUnbound(state)];
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
        diags.push({ severity: "error", surface: state.id, node: node.id, message: `template "${ch.template}" does not exist` });
      }
    }
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
    if (!node) return { key, id, type: "$pending", props: {}, children: [] };
    if (path.has(id)) return { key, id, type: "$invalid", props: {}, children: [], error: "cycle" };
    const resolved = textProps(propsSchema(this.catalog, node.type), resolveValue(node.props ?? {}, scope) as Record<string, unknown>);
    const finalize = this.catalog.components[node.type]?.finalize;
    const props = finalize ? finalize(resolved) : resolved;

    if ("visibleIf" in props && !props.visibleIf) return null;

    const out: ResolvedNode = { key, id, type: node.type, props, children: [] };
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
    const trail = findTrail(resolved.root, sourceId);
    if (!trail) return undefined;
    const source = trail[trail.length - 1]!;
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
