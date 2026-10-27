// A standard source workspace is compiled from semantic references. The model
// chooses prepared datasets, not graph wiring or copies of authoritative data.
import type { TableSources, SourceCell } from "./table-source.ts";
import type { ToolDefinition } from "./catalog.ts";
import { validate } from "./schema.ts";

export function sourceWorkspaceTool(sources: TableSources, parameters: Readonly<Record<string, SourceCell>>): ToolDefinition {
  return { name: "vak_submit", description: "Publish the requested source workspace. reports references prepared sources; criteria lists caller parameters. The framework creates separate interactive criteria/report surfaces, source evidence and factual explanations. Do not author UI nodes, binding data, source cells or copied numbers.", inputSchema: {
    type: "object", additionalProperties: false, required: ["reports", "criteria"], properties: {
      reports: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", enum: Object.keys(sources) } },
      criteria: { type: "array", minItems: Object.keys(parameters).length, maxItems: Object.keys(parameters).length, items: { type: "string", ...(Object.keys(parameters).length ? { enum: Object.keys(parameters) } : {}) } },
    },
  } };
}
export function compileSourceWorkspace(value: unknown, sources: TableSources, parameters: Readonly<Record<string, SourceCell>>, canonicalIds: readonly string[]): unknown {
  const issues = validate(sourceWorkspaceTool(sources, parameters).inputSchema, value);
  if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  const { reports, criteria } = value as { reports: string[]; criteria: string[] };
  if (new Set(reports).size !== reports.length || new Set(criteria).size !== criteria.length) throw new Error("Workspace references must be distinct");
  if (Object.keys(parameters).some((path) => !criteria.includes(path))) throw new Error("Preserve every declared criterion");
  const surfaces: Record<string, unknown>[] = [];
  if (criteria.length) surfaces.push({ op: "replace", surface: "source_criteria", title: "Criteria", root: { type: "form", props: { parameters: criteria, submit: "apply_parameters", submitLabel: "Update criteria" } }, data: {} });
  for (const source of reports) surfaces.push({ op: "replace", surface: `source_report_${source}`, title: sources[source]!.filename, root: { type: "table", props: { source, searchable: true, sortable: true } }, data: {} });
  const kept = new Set(surfaces.map((surface) => surface.surface));
  for (const surface of canonicalIds) if (!kept.has(surface)) surfaces.push({ op: "remove", surface });
  return { surfaces };
}
