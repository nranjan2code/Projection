// Slack projector: a resolved VPS surface → one message of Block Kit blocks.
// Slack is a linear target: containers flatten in priority order. Stats group
// into section fields, tables use Slack's table block, charts become tables,
// and a form becomes a list of its fields plus a button that opens a modal
// (see modal.ts). Limits are Slack's; anything over them is cut with a note,
// never sent for Slack to reject.

import { byPriority, type CapabilityProfile, chartText, isRequired, type ResolvedNode, type ResolvedSurface, tableText, type TextTable, walk, lowerSurface } from "@vak/core";
import { esc, markdownToMrkdwn } from "./mrkdwn.ts";

export const slackProfile: CapabilityProfile = {
  target: "slack",
  layout: "linear",
  streaming: "edit",
  markup: "mrkdwn",
  maxFormFields: 10,
  components: {
    chart: "degraded",
    form: "native",
    split: "degraded",
    grid: "degraded",
    tabs: "degraded",
    image: "native",
    table: "native",
    list: "native",
    card: "native",
    text: "native",
    stat: "native",
    alert: "native",
    button: "native",
    divider: "native",
  },
  notes: ["Slack shows one column; charts appear as data tables; a form opens as a dialog with all its fields."],
};

/** Slack's limits for one message. */
export const SLACK_LIMITS = {
  blocks: 50,
  sectionText: 3000,
  headerText: 150,
  fields: 10,
  fieldText: 2000,
  buttonText: 75,
  actionsElements: 25,
  tableRows: 100,
  tableColumns: 20,
  /** All table cells in a message together. */
  tableChars: 10_000,
} as const;

export interface Control {
  /** action_id of the button (unique in the message). */
  token: string;
  key: string;
  kind: "button" | "form";
  label: string;
}

export type Block = Record<string, unknown>;

export interface SlackProjection {
  blocks: Block[];
  /** Notification / fallback text (Slack requires it alongside blocks). */
  text: string;
  controls: Control[];
}

export interface ProjectOptions {
  /** Which image URLs may be shown (Slack fetches them and rejects the message on failure). Default: none. */
  allowImage?: (src: string) => boolean;
}

const SAFE_SRC = /^https:\/\//i;
const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const plain = (s: string, max: number) => ({ type: "plain_text", text: clip(s, max) || " ", emoji: true });
const mrkdwn = (s: string) => ({ type: "mrkdwn", text: clip(s, SLACK_LIMITS.sectionText) });

interface Ctx {
  control: (key: string, kind: Control["kind"], label: string) => string;
  allowImage: (src: string) => boolean;
  tableChars: number;
}

export function projectSlack(surface: ResolvedSurface, tokenFor: (key: string, kind: Control["kind"]) => string, opts: ProjectOptions = {}): SlackProjection {
  // Timeline, steps, code, map, gallery and graph as lists, text and images.
  surface = lowerSurface(surface);
  const controls: Control[] = [];
  const ctx: Ctx = {
    control: (key, kind, label) => {
      const token = tokenFor(key, kind);
      controls.push({ token, key, kind, label });
      return token;
    },
    allowImage: opts.allowImage ?? (() => false),
    tableChars: 0,
  };
  const out: Block[] = [];
  if (surface.title) out.push({ type: "header", text: plain(surface.title, SLACK_LIMITS.headerText) });
  if (surface.root) block(surface.root, out, ctx);
  let blocks = out;
  if (blocks.length > SLACK_LIMITS.blocks) {
    blocks = [...out.slice(0, SLACK_LIMITS.blocks - 1), { type: "context", elements: [mrkdwn(`_${out.length - SLACK_LIMITS.blocks + 1} more blocks not shown_`)] }];
  }
  return { blocks, text: surface.title ?? "vak", controls };
}

function children(nodes: readonly ResolvedNode[], out: Block[], ctx: Ctx): void {
  const ordered = byPriority(nodes);
  for (let i = 0; i < ordered.length; i++) {
    const n = ordered[i]!;
    if (n.type === "stat" || n.type === "button") {
      const run: ResolvedNode[] = [];
      while (ordered[i]?.type === n.type) run.push(ordered[i++]!);
      i--;
      if (n.type === "stat") stats(run, out);
      else buttons(run, out, ctx);
    } else block(n, out, ctx);
  }
}

function stats(run: ResolvedNode[], out: Block[]): void {
  for (let i = 0; i < run.length; i += SLACK_LIMITS.fields) {
    const fields = run.slice(i, i + SLACK_LIMITS.fields).map((s) => {
      const delta = s.props.delta ? `  ${esc(s.props.delta)}` : "";
      return { type: "mrkdwn", text: clip(`${esc(s.props.label)}\n*${esc(s.props.value)}*${delta}`, SLACK_LIMITS.fieldText) };
    });
    out.push({ type: "section", fields });
  }
}

function button(b: ResolvedNode, ctx: Ctx): Block {
  const style = str(b.props.style);
  const label = str(b.props.label);
  return {
    type: "button",
    text: plain(label, SLACK_LIMITS.buttonText),
    action_id: ctx.control(b.key, "button", label),
    ...(style === "primary" || style === "danger" ? { style } : {}),
  };
}

function buttons(run: ResolvedNode[], out: Block[], ctx: Ctx): void {
  for (let i = 0; i < run.length; i += SLACK_LIMITS.actionsElements) {
    out.push({ type: "actions", elements: run.slice(i, i + SLACK_LIMITS.actionsElements).map((b) => button(b, ctx)) });
  }
}

function text(s: string, out: Block[]): void {
  // Long prose: split on paragraph boundaries into sections under the limit.
  let rest = s;
  while (rest) {
    let cut = rest.length <= SLACK_LIMITS.sectionText ? rest.length : rest.lastIndexOf("\n", SLACK_LIMITS.sectionText);
    if (cut <= 0) cut = SLACK_LIMITS.sectionText;
    out.push({ type: "section", text: mrkdwn(rest.slice(0, cut)) });
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
}

/** A text table as Slack's table block, or as monospace text once the message's table budget is spent. */
function table(t: TextTable, out: Block[], ctx: Ctx, headless = false): void {
  const cols = Math.min(t.headers.length, SLACK_LIMITS.tableColumns);
  const rows = [...(headless ? [] : [t.headers]), ...t.rows].slice(0, SLACK_LIMITS.tableRows).map((r) => r.slice(0, cols));
  const chars = rows.reduce((a, r) => a + r.reduce((b, c) => b + c.length, 0), 0);
  if (cols === 0) return;
  if (ctx.tableChars + chars <= SLACK_LIMITS.tableChars) {
    ctx.tableChars += chars;
    out.push({
      type: "table",
      rows: rows.map((r) => r.map((c) => ({ type: "raw_text", text: c || " " }))),
      column_settings: t.align.slice(0, cols).map((a) => (a === "start" ? null : { align: a === "end" ? "right" : "center" })),
    });
    return;
  }
  const widths = Array.from({ length: cols }, (_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  const lines = rows.map((r) => r.map((c, i) => (t.align[i] === "end" ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join("  "));
  text(`\`\`\`${esc(lines.join("\n").replace(/```/g, "'''"))}\`\`\``, out);
}

function block(n: ResolvedNode, out: Block[], ctx: Ctx): void {
  const p = n.props;
  switch (n.type) {
    case "stack":
    case "grid":
    case "split":
      return children(n.children, out, ctx);
    case "section":
      if (p.title || p.description) text([p.title ? `*${esc(p.title)}*` : "", p.description ? markdownToMrkdwn(p.description) : ""].filter(Boolean).join("\n"), out);
      return children(n.children, out, ctx);
    case "tabs":
      // No tabs in Slack: each tab under its title, in order.
      for (const [i, tab] of n.children.entries()) {
        out.push({ type: "section", text: mrkdwn(`*${esc(tab.props.title ?? tab.props.label ?? `Tab ${i + 1}`)}*`) });
        block(tab, out, ctx);
      }
      return;
    case "card": {
      const badge = p.badge ? `  \`${esc(p.badge)}\`` : "";
      const lines = [p.title ? `*${esc(p.title)}*${badge}` : "", p.subtitle ? `_${esc(p.subtitle)}_` : "", p.body ? markdownToMrkdwn(p.body) : ""].filter(Boolean);
      const img = typeof p.image === "string" && SAFE_SRC.test(p.image) && ctx.allowImage(p.image) ? p.image : undefined;
      if (lines.length || img) {
        out.push({ type: "section", text: mrkdwn(lines.join("\n") || " "), ...(img ? { accessory: { type: "image", image_url: img, alt_text: clip(str(p.title) || "image", 2000) } } : {}) });
      }
      return children(n.children, out, ctx);
    }
    case "text": {
      const v = str(p.variant);
      const content = str(p.content);
      if (v === "heading" || v === "subheading") return text(`*${esc(content)}*`, out);
      if (v === "code") return text(`\`\`\`${esc(content.replace(/```/g, "'''"))}\`\`\``, out);
      if (v === "caption") return void out.push({ type: "context", elements: [mrkdwn(markdownToMrkdwn(content))] });
      return text(markdownToMrkdwn(content), out);
    }
    case "stat":
      return stats([n], out);
    case "table":
      return table(tableText(p), out, ctx);
    case "chart":
      return table(chartText(p), out, ctx, p.kind === "pie");
    case "list": {
      const items = Array.isArray(p.items) ? p.items : [];
      return text(items.map((it, i) => `${p.ordered ? `${i + 1}.` : "•"} ${markdownToMrkdwn(it)}`).join("\n"), out);
    }
    case "alert": {
      const icon = { success: "✅", warning: "⚠️", danger: "⛔", info: "ℹ️" }[str(p.tone)] ?? "ℹ️";
      return text([`${icon} ${p.title ? `*${esc(p.title)}*` : ""}`.trim(), p.body ? markdownToMrkdwn(p.body) : ""].filter(Boolean).join("\n").replace(/^/gm, "> ").replace(/^&gt; /gm, "> "), out);
    }
    case "image":
      if (typeof p.src === "string" && SAFE_SRC.test(p.src) && ctx.allowImage(p.src)) {
        out.push({ type: "image", image_url: p.src, alt_text: clip(str(p.alt) || "image", 2000) });
      } else if (p.alt) out.push({ type: "context", elements: [mrkdwn(`_${esc(p.alt)}_`)] });
      return;
    case "divider":
      return void out.push({ type: "divider" });
    case "button":
      return buttons([n], out, ctx);
    case "form": {
      // A message has no inputs: list the fields; the button opens them as a modal.
      const fields: string[] = [];
      walk(n, (f) => {
        if (f.bindPath) fields.push(`• ${esc(f.props.label)}${isRequired(f.props.checks) ? " *" : ""}`);
      });
      if (fields.length) text(fields.join("\n"), out);
      const label = str(p.submitLabel) || "Fill in";
      return void out.push({ type: "actions", elements: [{ type: "button", text: plain(label, SLACK_LIMITS.buttonText), action_id: ctx.control(n.key, "form", label), style: "primary" }] });
    }
    case "input":
    case "textarea":
    case "select":
    case "checkbox":
    case "date":
      return text(`${esc(p.label)}${p.value !== undefined && p.value !== "" ? `: *${esc(str(p.value))}*` : ""}`, out);
    default:
      return; // $pending / $invalid: nothing to show yet
  }
}
