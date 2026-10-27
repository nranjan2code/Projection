import { getAt } from "./pointer.ts";
import { sourceTableSchema, calculationSchema, compileSourceTable, type TableSources, type SourceCell } from "./table-source.ts";
// Complete inline documents remove reference bookkeeping from initial authoring.
// A private candidate prevents a rejected repair from damaging accepted surfaces.
import { toolDefinitions, propsSchema, type Catalog, type ToolDefinition } from "./catalog.ts";
import { SurfaceStore, walk, type SurfaceSnapshot } from "./surface.ts";
import { TOOL_RENDER, TOOL_UPDATE, TOOL_REMOVE, type VpsNode } from "./vps.ts";
import { validate, toWireSchema, type JSONSchema } from "./schema.ts";

export const TOOL_SUBMIT = "vak_submit";
const generated = "__vak_";
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function submissionTool(catalog: Catalog, surfaceIds?: readonly string[], sources: TableSources = {}, parameters: Readonly<Record<string, SourceCell>> = {}): ToolDefinition {
  const existing = toolDefinitions(catalog, { mode: "compact" });
  const patch = existing.find((tool) => tool.name === TOOL_UPDATE)!.inputSchema;
  const remove = existing.find((tool) => tool.name === TOOL_REMOVE)!.inputSchema;
  const sourceColumns = [...new Set(Object.values(sources).flatMap((source) => source.columns))];
  const calculation: JSONSchema = Object.keys(sources).length ? { anyOf: calculationSchema.anyOf!.flatMap((branch) => {
    if (branch.properties?.parameter) return Object.keys(parameters).length ? [{ ...branch, properties: { parameter: { type: "string", enum: Object.keys(parameters) } } }] : [];
    if (branch.properties?.column) return [{ ...branch, properties: { column: { type: "string", enum: sourceColumns } } }];
    return [branch];
  }) } : calculationSchema;
  const specialize = (summary: boolean): JSONSchema => ({ anyOf: calculation.anyOf!.filter((branch) => summary ? !branch.properties?.column : !branch.properties?.sum).map((branch) => branch.properties?.args ? { ...branch, properties: { ...branch.properties, args: { ...branch.properties.args, items: { $ref: summary ? "#/$defs/vak_summary_calculation" : "#/$defs/vak_row_calculation" } } } } : branch) });
  const ref: JSONSchema = { $ref: "#/$defs/vak_node" };
  const node: JSONSchema = { anyOf: Object.entries(catalog.components).map(([type, definition]) => ({
    type: "object", required: ["type", ...(propsSchema(catalog, type)?.required?.length ? ["props"] : [])], additionalProperties: false, properties: {
      id: { type: "string", description: "optional stable ID; omit for automatic IDs, never use __vak_ prefix" },
      type: { type: "string", const: type }, props: type === "table" && Object.keys(sources).length ? sourceTableSchema(sources) : toWireSchema(propsSchema(catalog, type)!),
      ...(definition.children ? { children: { anyOf: [{ type: "array", items: ref }, { type: "object", required: ["each", "template"], additionalProperties: false, properties: { each: { type: "string" }, template: ref } }] } } : {}),
    },
  })) };
  const entry = (op: string, properties: Record<string, JSONSchema>, required: readonly string[]): JSONSchema => ({ type: "object", additionalProperties: false, required: ["op", ...required], properties: { op: { type: "string", const: op }, ...properties } });
  const branches = [
    entry("replace", { ...(surfaceIds ? surfaceIds.length ? { surface: { type: "string", enum: surfaceIds, description: "existing surface to replace; omit to create a new surface" } } : {} : { surface: { type: "string", minLength: 1, maxLength: 120 } }), title: { type: "string", maxLength: 500 }, root: { $ref: "#/$defs/vak_root" }, data: { type: "object" } }, ["root", ...(surfaceIds ? ["data"] : [])]),
    ...(surfaceIds?.length === 0 ? [] : [
      entry("patch", { ...patch.properties!, ...(surfaceIds ? { surface: { type: "string", enum: surfaceIds } } : {}) }, patch.required!),
      entry("remove", { ...remove.properties!, ...(surfaceIds ? { surface: { type: "string", enum: surfaceIds } } : {}) }, remove.required!),
    ]),
  ];
  return { name: TOOL_SUBMIT, description: "Submit a complete candidate in one transaction. Replace with inline root trees (children and collection templates are node objects, not ID references). Omit surface and node IDs for new content; the framework generates them. Use a surface ID only when replacing existing content. Patch existing nodes by their canonical IDs; data uses existing merge/JSON Patch semantics. Remove explicitly. Unmentioned surfaces stay. All changes are checked together; rejection changes nothing. Call alone after external work; acceptance ends this run.", inputSchema: {
    $defs: { vak_calculation: calculation, vak_row_calculation: specialize(false), vak_summary_calculation: specialize(true), vak_node: node, vak_root: { anyOf: node.anyOf!.map((branch) => ({ ...branch, properties: { ...branch.properties, id: { type: "string", const: "root" } } })) } }, type: "object", additionalProperties: false, required: ["surfaces"], properties: {
      reply: { type: "string", maxLength: 8000, description: "Brief acknowledgement only; requested substantive content belongs in the surface documents" },
      surfaces: { type: "array", minItems: 1, maxItems: 16, items: { anyOf: branches } },
    },
  } };
}

export interface SubmissionCandidate {
  store?: SurfaceStore;
  issues: string[];
  reply: string;
}

export function prepareSubmission(catalog: Catalog, current: readonly SurfaceSnapshot[], value: unknown, options: { sources?: TableSources; parameters?: Readonly<Record<string, SourceCell>> } = {}): SubmissionCandidate {
  try { if (JSON.stringify(value)?.length > 512000) return { issues: ["Submission exceeds 512000 characters"], reply: "" }; }
  catch { return { issues: ["Submission must be bounded JSON data"], reply: "" }; }
  const sources = options.sources ?? {};
  const issues = validate(submissionTool(catalog, undefined, sources, options.parameters).inputSchema, value).map((issue) => `${issue.path}: ${issue.message}`);
  if (issues.length || !object(value)) return { issues, reply: "" };
  const reply = typeof value.reply === "string" ? value.reply : "";
  const candidate = new SurfaceStore(catalog);
  current.forEach((snapshot) => candidate.load(snapshot));
  const targets = new Set<string>();
  let count = 0;
  for (const entry of value.surfaces as Record<string, unknown>[]) {
    let generatedSurface = 1;
    while (candidate.get(`__vak_surface_${generatedSurface}`) || targets.has(`__vak_surface_${generatedSurface}`)) generatedSurface++;
    const surface = entry.op === "replace" && entry.surface === undefined ? `__vak_surface_${generatedSurface}` : String(entry.surface);
    if (targets.has(surface)) { issues.push(`Surface ${JSON.stringify(surface)} occurs more than once; combine its changes in one operation.`); continue; }
    targets.add(surface);
    if (entry.op !== "replace" && !candidate.get(surface)) { issues.push(`No existing surface ${JSON.stringify(surface)} to ${entry.op}.`); continue; }
    if (Object.keys(sources).length && (object(entry.data) && Object.hasOwn(entry.data, "sources") || Array.isArray(entry.data) && entry.data.some((patch) => object(patch) && typeof patch.path === "string" && (patch.path === "" || patch.path === "/sources" || patch.path.startsWith("/sources/"))))) { issues.push("Source-backed data is immutable; do not author data.sources"); continue; }
    if (entry.op === "replace") {
      const data = object(entry.data) ? structuredClone(entry.data) : {};
      const computedSources: Record<string, unknown> = {};
      const nodes: VpsNode[] = [], ids = new Set<string>();
      const compile = (raw: unknown, path: string, depth: number): string => {
        if (++count > 1024 || depth > 32) throw new Error("Submission exceeds 1024 nodes or 32 tree levels");
        if (!object(raw) || Object.keys(raw).some((key) => !["id", "type", "props", "children"].includes(key))) throw new Error(`${surface}/${path}: expected {type, props?, children?, id?}`);
        if (typeof raw.type !== "string" || !Object.hasOwn(catalog.components, raw.type)) throw new Error(`${surface}/${path}: unknown component type`);
        if (raw.id !== undefined && (typeof raw.id !== "string" || !raw.id || raw.id.length > 120 || raw.id.startsWith(generated))) throw new Error(`${surface}/${path}: invalid or reserved node ID`);
        if (depth === 0 && raw.id !== undefined && raw.id !== "root") throw new Error(`${surface}: the root ID must be root or omitted`);
        const id = typeof raw.id === "string" ? raw.id : depth === 0 ? "root" : generated + path;
        if (ids.has(id)) throw new Error(`${surface}: duplicate node ID ${JSON.stringify(id)}`);
        ids.add(id);
        if (raw.props !== undefined && !object(raw.props)) throw new Error(`${surface}/${path}: props must be an object`);
        let props = raw.props === undefined ? undefined : structuredClone(raw.props) as Record<string, unknown>;
        if (raw.type === "input" && typeof props?.bind === "string" && typeof options.parameters?.[props.bind] === "number") {
          if (props.kind !== undefined && props.kind !== "number") throw new Error("A numeric caller parameter needs a numeric input");
          props.kind = "number";
        }
        if (raw.type === "table" && Object.keys(sources).length) {
          const compiled = compileSourceTable(props ?? {}, sources, options.parameters ?? {});
          if (computedSources[compiled.id]) throw new Error("A source appears in more than one table in this surface");
          computedSources[compiled.id] = compiled.data; props = compiled.props;
        }
        const node: VpsNode = { id, type: raw.type, ...(props === undefined ? {} : { props }) };
        nodes.push(node);
        if (raw.children !== undefined) {
          if (!catalog.components[raw.type]!.children) throw new Error(`${surface}/${path}: ${raw.type} does not accept children`);
          if (Array.isArray(raw.children)) node.children = raw.children.map((child, index) => compile(child, `${path}_${index}`, depth + 1));
          else if (object(raw.children) && Object.keys(raw.children).every((key) => ["each", "template"].includes(key)) && typeof raw.children.each === "string" && object(raw.children.template)) node.children = { each: raw.children.each, template: compile(raw.children.template, `${path}_template`, depth + 1) };
          else throw new Error(`${surface}/${path}: children must be inline node objects or {each, template: node}`);
        }
        return id;
      };
      try {
        compile(entry.root, "0", 0);
        issues.push(...candidate.apply(TOOL_RENDER, { surface, title: entry.title, nodes, data: { ...data, ...(Object.keys(computedSources).length ? { sources: computedSources } : {}) } }).filter((issue) => issue.severity === "error").map((issue) => `${surface}/${issue.node ?? ""}: ${issue.message}`));
      } catch (err) { issues.push((err as Error).message); }
    } else {
      if (Array.isArray(entry.nodes) && entry.nodes.length > 1024) { issues.push("Patch exceeds 1024 nodes"); continue; }
      if (Object.keys(sources).length && Array.isArray(entry.nodes) && entry.nodes.some((node) => object(node) && (node.type === "table" || candidate.get(surface)?.nodes.get(String(node.id))?.type === "table") && object(node.props) && Object.keys(node.props).some((key) => !["searchable", "sortable", "pageSize"].includes(key)))) { issues.push("Replace a source-backed table through its source declaration to change its columns or calculations"); continue; }
      const { op, ...args } = entry;
      issues.push(...candidate.apply(op === "patch" ? TOOL_UPDATE : TOOL_REMOVE, args).filter((issue) => issue.severity === "error").map((issue) => `${surface}/${issue.node ?? ""}: ${issue.message}`));
    }
  }
  if (Object.keys(sources).length) for (const surface of candidate.list()) for (const node of surface.nodes.values()) {
    const path = node.props?.bind;
    if (typeof path === "string" && Object.hasOwn(options.parameters ?? {}, path) && getAt(surface.data, path) !== options.parameters![path]) issues.push(`Source parameter ${path} must retain its caller/current user value; model authorship cannot revise it`);
  }
  // Removing a referenced node or patching an unaffected surface can break a
  // relationship outside that operation: assess the entire resulting store.
  for (const surface of candidate.list()) {
    issues.push(...candidate.lint(surface).filter((issue) => issue.severity === "error").map((issue) => `${surface.id}/${issue.node ?? ""}: ${issue.message}`));
    const resolved = candidate.resolve(surface.id);
    if (resolved?.root) walk(resolved.root, (node) => {
      for (const [key, schema] of Object.entries(catalog.components[node.type]?.props.properties ?? {})) {
        if (schema.wire && node.props[key] !== undefined) issues.push(...validate(toWireSchema(schema), node.props[key]).map((issue) => `${surface.id}/${node.id}/props/${key}${issue.path}: ${issue.message}`));
      }
    });
  }
  return { ...(issues.length ? {} : { store: candidate }), issues: [...new Set(issues)], reply };
}
