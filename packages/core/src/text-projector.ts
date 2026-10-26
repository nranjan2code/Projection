// Plain-text projection of a resolved surface: for text-only targets
// (terminal, SMS, logs) and for model judges that read what a user would see.

import { lowerSurface } from "./lower.ts";
import type { CapabilityProfile } from "./catalog.ts";
import { isRequired } from "./checks.ts";
import { byPriority, type Projector } from "./projector.ts";
import type { ResolvedNode, ResolvedSurface } from "./surface.ts";

export const textCapabilities: CapabilityProfile = {
  target: "text",
  layout: "linear",
  streaming: "none",
  markup: "plain",
};

const str = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

function options(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => (o && typeof o === "object" ? str((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).value) : str(o)));
}

function lines(node: ResolvedNode, depth: number, out: string[]): void {
  const p = node.props;
  const pad = "  ".repeat(depth);
  const put = (text: string) => {
    for (const l of text.split("\n")) if (l.trim()) out.push(pad + l);
  };
  const kids = (d = depth + 1) => byPriority(node.children).forEach((c) => lines(c, d, out));
  const req = isRequired(p.checks) ? "*" : "";

  switch (node.type) {
    case "stack":
    case "grid":
    case "split":
      return kids(depth);
    case "section":
      if (p.title) put(`## ${str(p.title)}`);
      if (p.description) put(str(p.description));
      return kids();
    case "tabs":
      for (const c of node.children) {
        put(`[Tab: ${str(c.props.title ?? c.props.label) || "untitled"}]`);
        lines(c, depth + 1, out);
      }
      return;
    case "card":
      put(`[Card] ${str(p.title)}${p.subtitle ? ` — ${str(p.subtitle)}` : ""}${p.badge ? ` (${str(p.badge)})` : ""}`);
      if (p.body) put(`  ${str(p.body)}`);
      return kids();
    case "text":
      return put(str(p.content));
    case "stat":
      return put(`${str(p.label)}: ${str(p.value)}${p.delta ? ` (${str(p.delta)})` : ""}`);
    case "table": {
      const cols = (Array.isArray(p.columns) ? p.columns : []) as Record<string, unknown>[];
      const rows = Array.isArray(p.rows) ? p.rows : [];
      put(`[Table] ${cols.map((c) => str(c.label ?? c.key)).join(" | ")}`);
      for (const r of rows) {
        const cells = cols.map((c, i) => (Array.isArray(r) ? r[i] : r && typeof r === "object" ? (r as Record<string, unknown>)[str(c.key)] : r));
        put(`  ${cells.map(str).join(" | ")}`);
      }
      return;
    }
    case "list":
      (Array.isArray(p.items) ? p.items : []).forEach((item, i) => put(`${p.ordered ? `${i + 1}.` : "-"} ${str(item)}`));
      return;
    case "chart": {
      const series = (Array.isArray(p.series) ? p.series : []) as Record<string, unknown>[];
      put(`[${str(p.kind) || "bar"} chart] ${(Array.isArray(p.labels) ? p.labels : []).map(str).join(", ")}`);
      for (const s of series) put(`  ${str(s.name) || "series"}: ${(Array.isArray(s.values) ? s.values : []).map(str).join(", ")}`);
      return;
    }
    case "alert":
      return put(`[${str(p.tone) || "note"}] ${str(p.title)}${p.title && p.body ? ": " : ""}${str(p.body)}`);
    case "image":
      return put(`[Image: ${str(p.alt) || "untitled"}]`);
    case "media":
      put(`[${str(p.kind)}: ${str(p.title) || str(p.alt) || "untitled"}]`);
      if (p.description) put(str(p.description));
      if (p.transcript) put(str(p.transcript));
      return;
    case "divider":
      return put("---");
    case "button":
      return put(`[Button: ${str(p.label)} → ${str(p.action)}]`);
    case "form":
      put(`[Form → ${str(p.submit) || "submit"}]`);
      kids();
      return put(`  [Submit: ${str(p.submitLabel) || "Submit"}]`);
    case "input":
    case "textarea":
      return put(`[${node.type === "textarea" ? "Text area" : "Input"}${p.kind && p.kind !== "text" ? ` (${str(p.kind)})` : ""}] ${str(p.label)}${req}`);
    case "select":
      return put(`[Select${p.multiple ? " multiple" : ""}] ${str(p.label)}${req}: ${options(p.options).join(" / ")}`);
    case "checkbox":
      return put(`[Checkbox] ${str(p.label)}`);
    case "date":
      return put(`[Date${p.range ? " range" : ""}] ${str(p.label)}${req}`);
    default:
      return put(`[${node.type === "$pending" ? "pending" : "invalid"}${node.error ? `: ${node.error}` : ""}]`);
  }
}

export function projectText(surface: ResolvedSurface): string {
  surface = lowerSurface(surface);
  const out: string[] = [];
  if (surface.title) out.push(`# ${surface.title}`);
  if (surface.root) lines(surface.root, 0, out);
  return out.join("\n");
}

export const textProjector: Projector<string> = { capabilities: textCapabilities, project: projectText };
