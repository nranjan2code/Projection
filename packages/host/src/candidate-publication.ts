// A canonical owner revalidates isolated worker bytes without rerunning a
// model or repairing facts. Native durability/consent remains the app's job.
import { basicCatalog, propsSchema, SurfaceStore, toWireSchema, validate, walk, type Catalog, type SurfaceSnapshot } from "@vak/core";
import type { HostCandidateResult, HostSessionSnapshot } from "./host.ts";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value) <= limit && !value.includes("\0");
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
function json(value: unknown): void {
  let count = 0;
  const visit = (item: unknown, depth: number) => {
    if (++count > 200_000 || depth > 96) throw new Error("Candidate JSON exceeds its bounds");
    if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) { item.forEach(value => visit(value, depth + 1)); return; }
    if (object(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item))) { Object.values(item).forEach(value => visit(value, depth + 1)); return; }
    throw new Error("Candidate must contain JSON values only");
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) throw new Error("Candidate exceeds 8 MiB");
}

function surfaces(value: unknown, catalog: Catalog): SurfaceSnapshot[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error("Expected at most 16 surfaces");
  const store = new SurfaceStore(catalog), ids = new Set<string>();
  for (const surface of value) {
    if (!object(surface) || !keys(surface, ["id", "title", "nodes", "data", "version", "partial"])
      || !bounded(surface.id, 240) || ids.has(surface.id) || !Number.isSafeInteger(surface.version) || Number(surface.version) < 1
      || surface.partial !== undefined || surface.title !== undefined && !bounded(surface.title, 512)
      || !object(surface.data) || !Array.isArray(surface.nodes) || !surface.nodes.length || surface.nodes.length > 1024) throw new Error("Invalid complete surface snapshot");
    ids.add(surface.id);
    const nodes = new Map<string, Record<string, unknown>>();
    for (const node of surface.nodes) {
      if (!object(node) || !keys(node, ["id", "type", "props", "children"]) || !bounded(node.id, 240) || nodes.has(node.id)
        || typeof node.type !== "string" || !Object.hasOwn(catalog.components, node.type)
        || node.props !== undefined && !object(node.props)) throw new Error("Invalid canonical node");
      if (node.children !== undefined && (!catalog.components[node.type]!.children || !(Array.isArray(node.children)
        ? node.children.every(id => bounded(id, 240)) : object(node.children) && keys(node.children, ["each", "template"]) && bounded(node.children.each, 512) && bounded(node.children.template, 240)))) throw new Error("Invalid node children");
      nodes.set(node.id, node);
    }
    if (surface.nodes[0]?.id !== "root") throw new Error("A canonical snapshot needs its root first");
    const reached = new Set<string>(), active = new Set<string>();
    const visit = (id: string, depth: number) => {
      if (active.has(id) || depth > 32 || !nodes.has(id)) throw new Error("Invalid cyclic, missing or deep node graph");
      if (reached.has(id)) return;
      reached.add(id); active.add(id);
      const children = nodes.get(id)!.children;
      for (const child of Array.isArray(children) ? children : object(children) ? [children.template] : []) visit(String(child), depth + 1);
      active.delete(id);
    };
    visit("root", 0);
    if (reached.size !== nodes.size) throw new Error("Disconnected canonical nodes");
    store.load(surface as unknown as SurfaceSnapshot);
  }
  for (const surface of store.list()) {
    if (store.lint(surface).some(issue => issue.severity === "error")) throw new Error("Candidate violates canonical surface semantics");
    const root = store.resolve(surface.id)?.root;
    if (root) walk(root, node => {
      const schema = propsSchema(catalog, node.type);
      if (!schema) throw new Error("Unknown resolved component");
      for (const [key, rule] of Object.entries(schema.properties ?? {})) {
        if (rule.wire && node.props[key] !== undefined && validate(toWireSchema(rule), node.props[key]).length) throw new Error("Invalid resolved wire value");
      }
    });
  }
  return structuredClone(value) as SurfaceSnapshot[];
}

/** Prepare a complete canonical session; no writes, broadcasts, tools or model calls. */
export function prepareCandidatePublication(input: {
  candidate: unknown; base?: HostSessionSnapshot; message: string; at: string;
}, catalog: Catalog = basicCatalog): HostSessionSnapshot {
  json(input.candidate);
  if (input.base !== undefined) json(input.base);
  const { candidate, base, message, at } = input;
  if (!bounded(message, 8000) || typeof at !== "string" || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) throw new Error("Invalid publication context");
  if (!object(candidate) || !keys(candidate, ["candidateId", "session", "provider", "model", "result", "reply", "baseVersions", "surfaces"])
    || !bounded(candidate.candidateId, 128) || !bounded(candidate.session, 120) || !bounded(candidate.provider, 120) || !bounded(candidate.model, 256)
    || typeof candidate.reply !== "string" || Buffer.byteLength(candidate.reply) > 512_000
    || !object(candidate.result) || !["end", "projected"].includes(String(candidate.result.stop))
    || !Array.isArray(candidate.baseVersions) || candidate.baseVersions.length > 16) throw new Error("Candidate has no publishable output");
  const next = surfaces(candidate.surfaces, catalog);
  if (!next.length && !candidate.reply.trim()) throw new Error("Candidate is empty");
  if (base && (base.id !== candidate.session || base.updated > at || base.created > at || !Array.isArray(base.messages) || !Array.isArray(base.timeline) || !Array.isArray(base.external))) throw new Error("Invalid canonical base");
  const previous = base ? surfaces(base.surfaces, catalog) : [];
  const versions = new Map<string, number>();
  for (const version of candidate.baseVersions) {
    if (!object(version) || !keys(version, ["id", "version"]) || !bounded(version.id, 240) || !Number.isSafeInteger(version.version) || Number(version.version) < 1 || versions.has(version.id)) throw new Error("Invalid candidate base versions");
    versions.set(version.id, Number(version.version));
  }
  if (previous.length !== versions.size || previous.some(surface => versions.get(surface.id) !== surface.version)) throw new Error("Candidate canonical base is stale");
  for (const surface of next) {
    const original = previous.find(value => value.id === surface.id);
    if (original && (surface.version < original.version || surface.version === original.version && JSON.stringify(surface) !== JSON.stringify(original))) throw new Error("Changed surface needs a newer canonical version");
  }
  const value = candidate as unknown as HostCandidateResult;
  const snapshot: HostSessionSnapshot = {
    id: value.session, title: base?.title ?? message.trim().replace(/\s+/g, " ").slice(0, 120), created: base?.created ?? at, updated: at,
    messages: [...(base?.messages ?? []), { role: "user", content: message }, { role: "assistant", content: value.reply }],
    timeline: [...(base?.timeline ?? []), { kind: "user", text: message, at }, { kind: "assistant", text: value.reply, surfaces: next.map(surface => surface.id), notes: [], status: "Ready for review", stop: value.result.stop, versions: next, at }],
    surfaces: next, external: (base?.external ?? []).filter(id => next.some(surface => surface.id === id)),
  };
  json(snapshot);
  return structuredClone(snapshot);
}
