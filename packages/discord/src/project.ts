// Discord projector: a resolved VPS surface → one Components V2 message. The
// surface becomes a container of text displays, separators, media and button
// rows. Discord markdown has no tables, so tables and charts are aligned
// monospace blocks. A form becomes a list of its fields plus a button that
// opens a modal (see modal.ts). Limits are Discord's; anything over them is
// cut with a note, never sent for Discord to reject.

import { byPriority, type CapabilityProfile, chartText, isRequired, type ResolvedNode, type ResolvedSurface, tableText, type TextTable, walk, lowerSurface } from "@vak/core";
import { esc, markdownToDiscord } from "./markdown.ts";

export const discordProfile: CapabilityProfile = {
  target: "discord",
  layout: "linear",
  streaming: "edit",
  markup: "markdown",
  maxFormFields: 5,
  components: {
    chart: "degraded",
    form: "native",
    split: "degraded",
    grid: "degraded",
    tabs: "degraded",
    image: "native",
    table: "degraded",
    list: "native",
    card: "native",
    text: "native",
    stat: "native",
    alert: "native",
    button: "native",
    divider: "native",
  },
  notes: ["Discord shows one column; tables and charts appear as monospace text; a form opens as a dialog of up to 5 fields at a time."],
};

/** Component type ids and limits (Discord developer docs, Components V2). */
export const C = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4, TextDisplay: 10, MediaGallery: 12, Separator: 14, Container: 17, Label: 18 } as const;
export const IS_COMPONENTS_V2 = 1 << 15;
export const DISCORD_LIMITS = { components: 40, text: 4000, buttonsPerRow: 5, buttonLabel: 80, customId: 100, gallery: 10 } as const;
const STYLE = { primary: 1, secondary: 2, danger: 4 } as const;

export interface Control {
  /** custom_id of the button. */
  token: string;
  key: string;
  kind: "button" | "form";
  label: string;
}

export type Component = Record<string, unknown>;

export interface DiscordProjection {
  /** Body for POST /channels/{id}/messages (or PATCH to edit). */
  message: { flags: number; components: Component[]; allowed_mentions: { parse: [] } };
  controls: Control[];
}

export interface ProjectOptions {
  allowImage?: (src: string) => boolean;
}

const SAFE_SRC = /^https:\/\//i;
const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

interface Ctx {
  control: (key: string, kind: Control["kind"], label: string) => string;
  allowImage: (src: string) => boolean;
  out: Component[];
  /** Markdown waiting to become one text display (adjacent text shares a component). */
  pending: string[];
}

function flush(ctx: Ctx): void {
  if (!ctx.pending.length) return;
  ctx.out.push({ type: C.TextDisplay, content: ctx.pending.join("\n\n") });
  ctx.pending = [];
}

const write = (ctx: Ctx, md: string) => md && ctx.pending.push(md);
const push = (ctx: Ctx, c: Component) => (flush(ctx), ctx.out.push(c));

export function projectDiscord(surface: ResolvedSurface, tokenFor: (key: string, kind: Control["kind"]) => string, opts: ProjectOptions = {}): DiscordProjection {
  // Timeline, steps, code, map and gallery as lists, text and images.
  surface = lowerSurface(surface);
  const controls: Control[] = [];
  const ctx: Ctx = {
    control: (key, kind, label) => {
      const token = tokenFor(key, kind);
      controls.push({ token, key, kind, label });
      return token;
    },
    allowImage: opts.allowImage ?? (() => false),
    out: [],
    pending: [],
  };
  if (surface.title) write(ctx, `## ${esc(surface.title)}`);
  if (surface.root) block(surface.root, ctx);
  flush(ctx);
  return { message: { flags: IS_COMPONENTS_V2, components: [{ type: C.Container, components: fit(ctx.out) }], allowed_mentions: { parse: [] } }, controls };
}

/** Keep within the component and text budgets (the container itself counts as one component). */
function fit(items: Component[]): Component[] {
  const count = (c: Component): number => 1 + (Array.isArray(c.components) ? (c.components as Component[]).reduce((a, x) => a + count(x), 0) : 0);
  const out: Component[] = [];
  let components = 1;
  let chars = 0;
  for (const c of items) {
    const n = count(c);
    const len = typeof c.content === "string" ? c.content.length : 0;
    if (components + n > DISCORD_LIMITS.components - 1 || chars + len > DISCORD_LIMITS.text - 40) {
      const room = DISCORD_LIMITS.text - 40 - chars;
      if (len && room > 200 && components + 2 <= DISCORD_LIMITS.components) out.push({ ...c, content: clip(c.content as string, room) });
      out.push({ type: C.TextDisplay, content: "-# more not shown" });
      break;
    }
    out.push(c);
    components += n;
    chars += len;
  }
  return out;
}

function children(nodes: readonly ResolvedNode[], ctx: Ctx): void {
  const ordered = byPriority(nodes);
  for (let i = 0; i < ordered.length; i++) {
    const n = ordered[i]!;
    if (n.type === "stat" || n.type === "button") {
      const run: ResolvedNode[] = [];
      while (ordered[i]?.type === n.type) run.push(ordered[i++]!);
      i--;
      if (n.type === "stat") stats(run, ctx);
      else buttons(run, ctx);
    } else block(n, ctx);
  }
}

function stats(run: ResolvedNode[], ctx: Ctx): void {
  write(ctx, run.map((s) => `**${esc(s.props.value)}** · ${esc(s.props.label)}${s.props.delta ? ` · ${esc(s.props.delta)}` : ""}`).join("\n"));
}

function buttons(run: ResolvedNode[], ctx: Ctx): void {
  for (let i = 0; i < run.length; i += DISCORD_LIMITS.buttonsPerRow) {
    push(ctx, {
      type: C.ActionRow,
      components: run.slice(i, i + DISCORD_LIMITS.buttonsPerRow).map((b) => {
        const label = str(b.props.label);
        return { type: C.Button, style: STYLE[str(b.props.style) as keyof typeof STYLE] ?? STYLE.secondary, label: clip(label, DISCORD_LIMITS.buttonLabel) || "Open", custom_id: ctx.control(b.key, "button", label) };
      }),
    });
  }
}

/** A text table as an aligned monospace block. */
function mono(t: TextTable, headless = false): string {
  const rows = [...(headless ? [] : [t.headers]), ...t.rows].map((r) => r.map((c) => c.replace(/`/g, "'").replace(/\n/g, " ")));
  if (!rows.length || !t.headers.length) return "";
  const widths = t.headers.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => (t.align[i] === "end" ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join("  ").trimEnd();
  const lines = rows.map(line);
  if (!headless) lines.splice(1, 0, widths.map((w) => "─".repeat(w)).join("  "));
  return `\`\`\`\n${lines.join("\n")}\n\`\`\``;
}

function block(n: ResolvedNode, ctx: Ctx): void {
  const p = n.props;
  switch (n.type) {
    case "stack":
    case "grid":
    case "split":
      return children(n.children, ctx);
    case "section":
      write(ctx, [p.title ? `### ${esc(p.title)}` : "", p.description ? markdownToDiscord(p.description) : ""].filter(Boolean).join("\n"));
      return children(n.children, ctx);
    case "tabs":
      for (const [i, tab] of n.children.entries()) {
        write(ctx, `### ${esc(tab.props.title ?? tab.props.label ?? `Tab ${i + 1}`)}`);
        block(tab, ctx);
      }
      return;
    case "card": {
      const img = typeof p.image === "string" && SAFE_SRC.test(p.image) && ctx.allowImage(p.image) ? p.image : undefined;
      if (img) push(ctx, { type: C.MediaGallery, items: [{ media: { url: img }, description: clip(str(p.title), 1024) || undefined }] });
      const badge = p.badge ? ` \`${str(p.badge).replace(/`/g, "'")}\`` : "";
      write(ctx, [p.title ? `**${esc(p.title)}**${badge}` : "", p.subtitle ? `*${esc(p.subtitle)}*` : "", p.body ? markdownToDiscord(p.body) : ""].filter(Boolean).join("\n"));
      children(n.children, ctx);
      // Cards are separated; the separator after the last one is harmless.
      return void push(ctx, { type: C.Separator, divider: false, spacing: 1 });
    }
    case "text": {
      const v = str(p.variant);
      const content = str(p.content);
      if (v === "heading") return void write(ctx, `### ${esc(content)}`);
      if (v === "subheading") return void write(ctx, `**${esc(content)}**`);
      if (v === "code") return void write(ctx, `\`\`\`\n${content.replace(/```/g, "'''")}\n\`\`\``);
      if (v === "caption") return void write(ctx, `-# ${esc(content)}`);
      return void write(ctx, markdownToDiscord(content));
    }
    case "stat":
      return stats([n], ctx);
    case "table":
      return void write(ctx, mono(tableText(p)));
    case "chart":
      return void write(ctx, mono(chartText(p), p.kind === "pie"));
    case "list": {
      const items = Array.isArray(p.items) ? p.items : [];
      return void write(ctx, items.map((it, i) => `${p.ordered ? `${i + 1}.` : "-"} ${markdownToDiscord(it)}`).join("\n"));
    }
    case "alert": {
      const icon = { success: "✅", warning: "⚠️", danger: "⛔", info: "ℹ️" }[str(p.tone)] ?? "ℹ️";
      const body = [`${icon} ${p.title ? `**${esc(p.title)}**` : ""}`.trim(), p.body ? markdownToDiscord(p.body) : ""].filter(Boolean).join("\n");
      return void write(ctx, body.replace(/^/gm, "> "));
    }
    case "image":
      if (typeof p.src === "string" && SAFE_SRC.test(p.src) && ctx.allowImage(p.src)) {
        push(ctx, { type: C.MediaGallery, items: [{ media: { url: p.src }, ...(p.alt ? { description: clip(str(p.alt), 1024) } : {}) }] });
      } else if (p.alt) write(ctx, `*${esc(p.alt)}*`);
      return;
    case "divider":
      return void push(ctx, { type: C.Separator, divider: true, spacing: 1 });
    case "button":
      return buttons([n], ctx);
    case "form": {
      const fields: string[] = [];
      walk(n, (f) => {
        if (f.bindPath) fields.push(`- ${esc(f.props.label)}${isRequired(f.props.checks) ? " \\*" : ""}`);
      });
      if (fields.length) write(ctx, fields.join("\n"));
      const label = str(p.submitLabel) || "Fill in";
      return void push(ctx, { type: C.ActionRow, components: [{ type: C.Button, style: STYLE.primary, label: clip(label, DISCORD_LIMITS.buttonLabel), custom_id: ctx.control(n.key, "form", label) }] });
    }
    case "input":
    case "textarea":
    case "select":
    case "checkbox":
    case "date":
      return void write(ctx, `${esc(p.label)}${p.value !== undefined && p.value !== "" ? `: **${esc(str(p.value))}**` : ""}`);
    default:
      return;
  }
}
