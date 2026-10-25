// Markdown projection (GitHub-flavoured): for docs, issues, READMEs, and any
// chat that renders Markdown. Tables are pipe tables, charts their data,
// forms a list of the fields, buttons a line of their labels. Model text is
// written as Markdown already; labels and cells are escaped so they cannot
// open links or break a table.

import type { CapabilityProfile } from "./catalog.ts";
import { chartText, tableText, type TextTable } from "./chat.ts";
import { isRequired } from "./checks.ts";
import { stripControls } from "./ansi-projector.ts";
import { lowerSurface } from "./lower.ts";
import { byPriority, type Projector } from "./projector.ts";
import type { ResolvedNode, ResolvedSurface } from "./surface.ts";

export const markdownCapabilities: CapabilityProfile = {
  target: "markdown",
  layout: "linear",
  streaming: "none",
  markup: "markdown",
  components: { chart: "degraded", form: "degraded", button: "degraded", grid: "degraded", split: "degraded", tabs: "degraded" },
};

const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
/** Text that must stay text: no emphasis, links, headings or HTML from a label. */
export const mdEscape = (v: unknown) => stripControls(str(v)).replace(/([\\`*_{}[\]<>()#+!|~])/g, "\\$1").replace(/\n+/g, " ");
const cellEscape = (v: string) => v.replace(/\|/g, "\\|").replace(/\n+/g, " ");
/** Only https and mailto links survive, as everywhere else in vak. */
const safeUrl = (u: unknown) => (/^(https:|mailto:)/i.test(str(u)) ? str(u).replace(/[()\s]/g, encodeURIComponent) : "");

export function markdownTable(t: TextTable): string {
  if (!t.headers.length) return "";
  const sep = t.align.map((a) => (a === "end" ? "---:" : a === "center" ? ":---:" : "---"));
  return [`| ${t.headers.map(cellEscape).join(" | ")} |`, `| ${sep.join(" | ")} |`, ...t.rows.map((r) => `| ${r.map(cellEscape).join(" | ")} |`)].join("\n");
}

function block(node: ResolvedNode, out: string[], level: number): void {
  const p = node.props;
  const kids = (l = level) => byPriority(node.children).forEach((c) => block(c, out, l));
  const h = (n: number) => "#".repeat(Math.min(6, n));
  switch (node.type) {
    case "stack":
    case "grid":
    case "split":
      return kids();
    case "section":
      if (p.title) out.push(`${h(level)} ${mdEscape(p.title)}`);
      if (p.description) out.push(str(p.description));
      return kids(level + 1);
    case "tabs":
      for (const c of node.children) {
        out.push(`${h(level)} ${mdEscape(c.props.title ?? c.props.label ?? "Tab")}`);
        block(c, out, level + 1);
      }
      return;
    case "card": {
      const head = [p.title ? `**${mdEscape(p.title)}**` : "", p.subtitle ? `*${mdEscape(p.subtitle)}*` : "", p.badge ? `\`${str(p.badge).replace(/`/g, "")}\`` : ""].filter(Boolean).join(" · ");
      if (head) out.push(head);
      if (safeUrl(p.image)) out.push(`![${mdEscape(p.title)}](${safeUrl(p.image)})`);
      if (p.body) out.push(str(p.body));
      return kids();
    }
    case "text":
      return void out.push(p.variant === "heading" ? `${h(level)} ${str(p.content)}` : p.variant === "subheading" ? `${h(level + 1)} ${str(p.content)}` : str(p.content));
    case "stat":
      return void out.push(`**${mdEscape(p.label)}:** ${mdEscape(p.value)}${p.delta ? ` (${mdEscape(p.delta)})` : ""}`);
    case "table":
      return void out.push(markdownTable(tableText(p)));
    case "chart":
      return void out.push(markdownTable(chartText(p)));
    case "list": {
      const items = Array.isArray(p.items) ? p.items : [];
      return void out.push(items.map((it, i) => `${p.ordered ? `${i + 1}.` : "-"} ${str(it)}`).join("\n"));
    }
    case "alert": {
      const kind = { info: "NOTE", success: "TIP", warning: "WARNING", danger: "CAUTION" }[str(p.tone)] ?? "NOTE";
      const body = [p.title ? `**${mdEscape(p.title)}**` : "", str(p.body)].filter(Boolean).join("\n");
      return void out.push(`> [!${kind}]\n${body.replace(/^/gm, "> ")}`);
    }
    case "image":
      return void (safeUrl(p.src) && out.push(`![${mdEscape(p.alt)}](${safeUrl(p.src)})`));
    case "divider":
      return void out.push("---");
    case "button":
      return void out.push(`[${mdEscape(p.label)}]`);
    case "form": {
      const fields: string[] = [];
      const collect = (n: ResolvedNode) => {
        if (typeof n.props.bind === "string") fields.push(`- ${mdEscape(n.props.label ?? n.id)}${isRequired(n.props.checks) ? " *" : ""}${n.props.value !== undefined && n.props.value !== "" ? `: ${mdEscape(n.props.value)}` : ""}`);
        n.children.forEach(collect);
      };
      node.children.forEach(collect);
      if (fields.length) out.push(fields.join("\n"));
      if (p.submitLabel) out.push(`[${mdEscape(p.submitLabel)}]`);
      return;
    }
    default:
      if (typeof p.bind === "string") out.push(`- ${mdEscape(p.label ?? node.id)}`);
  }
}

export function projectMarkdown(surface: ResolvedSurface): string {
  surface = lowerSurface(surface);
  const out: string[] = [];
  if (surface.title) out.push(`## ${mdEscape(surface.title)}`);
  if (surface.root) block(surface.root, out, surface.title ? 3 : 2);
  // A row of buttons reads as one line: "[Book] [Compare]".
  return out.filter(Boolean).join("\n\n").replace(/\](\n\n)\[/g, "] [");
}

export const markdownProjector: Projector<string> = { capabilities: markdownCapabilities, project: projectMarkdown };
