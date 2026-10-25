// Telegram projector: a resolved VPS surface → one rich message (HTML).
// Telegram is a linear target: containers flatten in priority order. What
// Telegram cannot show natively degrades declaratively (see telegramProfile).

import { byPriority, type CapabilityProfile, chartText, isRequired, type ResolvedNode, type ResolvedSurface, tableText, type TextTable, walk } from "@vak/core";
import { esc, markdownToHtml } from "./html.ts";

/** What the model should know about this target (narrows the catalog and prompt). */
export const telegramProfile: CapabilityProfile = {
  target: "telegram",
  layout: "linear",
  streaming: "edit",
  markup: "html",
  maxFormFields: 6,
  components: {
    chart: "degraded",
    form: "degraded",
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
  notes: [
    "Telegram shows one column; charts appear as data tables; forms are filled one question at a time.",
    "Keep tables to at most 20 columns; prefer short labels on buttons.",
  ],
};

/** A control the user can activate, addressed by a short token (callback_data ≤ 64 bytes). */
export interface Control {
  token: string;
  /** Node key in the resolved surface (button key or form key). */
  key: string;
  kind: "button" | "form";
  /** What the button says, for keyboards outside the rich message. */
  label: string;
}

export interface TelegramProjection {
  html: string;
  controls: Control[];
}

/** Telegram allows 20 table columns. */
const MAX_COLUMNS = 20;
const SAFE_SRC = /^https?:\/\//i;

const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export interface ProjectOptions {
  /**
   * Which image URLs may be embedded. Telegram fetches every image in a rich
   * message and rejects the whole message if one is not real media, so the
   * sender verifies URLs first. Default: none (images are omitted).
   */
  allowImage?: (src: string) => boolean;
}

/** Every image URL a surface would embed, for the sender to verify. */
export function imageSources(surface: ResolvedSurface): string[] {
  const out = new Set<string>();
  if (surface.root) {
    walk(surface.root, (n) => {
      const src = n.type === "card" ? n.props.image : n.type === "image" ? n.props.src : undefined;
      if (typeof src === "string" && SAFE_SRC.test(src)) out.add(src);
    });
  }
  return [...out];
}

export function projectTelegram(
  surface: ResolvedSurface,
  tokenFor: (key: string, kind: Control["kind"]) => string,
  opts: ProjectOptions = {},
): TelegramProjection {
  const controls: Control[] = [];
  const control = (key: string, kind: Control["kind"], label: string) => {
    const token = tokenFor(key, kind);
    controls.push({ token, key, kind, label });
    return token;
  };
  const ctx: Ctx = { control, allowImage: opts.allowImage ?? (() => false) };
  const out: string[] = [];
  if (surface.title) out.push(`<h2>${esc(surface.title)}</h2>`);
  if (surface.root) block(surface.root, out, ctx);
  return { html: out.join(""), controls };
}

/** Per-projection context threaded through the tree. */
interface Ctx {
  control: (key: string, kind: Control["kind"], label: string) => string;
  allowImage: (src: string) => boolean;
}

/** Children in reading order, grouping runs of stats into one table and buttons into one row. */
function children(nodes: readonly ResolvedNode[], out: string[], ctx: Ctx): void {
  const ordered = byPriority(nodes);
  for (let i = 0; i < ordered.length; i++) {
    const n = ordered[i]!;
    if (n.type === "stat") {
      const run: ResolvedNode[] = [];
      while (ordered[i]?.type === "stat") run.push(ordered[i++]!);
      i--;
      out.push(statTable(run));
    } else if (n.type === "button") {
      const run: ResolvedNode[] = [];
      while (ordered[i]?.type === "button") run.push(ordered[i++]!);
      i--;
      out.push(buttonRow(run, ctx));
    } else block(n, out, ctx);
  }
}

function statTable(stats: ResolvedNode[]): string {
  const rows = stats.map((s) => `<tr><td>${esc(s.props.label)}</td><td align="right"><b>${esc(s.props.value)}</b></td><td>${esc(s.props.delta ?? "")}</td></tr>`);
  return `<table compact>${rows.join("")}</table>`;
}

function buttonRow(buttons: ResolvedNode[], ctx: Ctx): string {
  const style = (b: ResolvedNode) => (["primary", "danger", "link"].includes(str(b.props.style)) ? ` style="${str(b.props.style)}"` : "");
  return `<tg-button-row>${buttons
    .map((b) => `<tg-button type="callback_data" data="${esc(ctx.control(b.key, "button", str(b.props.label)))}"${style(b)}>${esc(b.props.label)}</tg-button>`)
    .join("")}</tg-button-row>`;
}

function htmlTable(t: TextTable, attrs: string, headless = false): string {
  const align = (i: number) => (t.align[i] === "end" ? ' align="right"' : t.align[i] === "center" ? ' align="center"' : "");
  const head = headless ? "" : `<tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  const body = t.rows.map((r) => `<tr>${r.map((v, i) => `<td${align(i)}>${esc(v)}</td>`).join("")}</tr>`).join("");
  return `<table ${attrs}>${head}${body}</table>`;
}

function block(n: ResolvedNode, out: string[], ctx: Ctx): void {
  const p = n.props;
  switch (n.type) {
    case "stack":
    case "grid":
    case "split":
      return children(n.children, out, ctx);
    case "section":
      if (p.title) out.push(`<h3>${esc(p.title)}</h3>`);
      if (p.description) out.push(markdownToHtml(p.description));
      return children(n.children, out, ctx);
    case "tabs":
      n.children.forEach((tab, i) => {
        const inner: string[] = [];
        block(tab, inner, ctx);
        out.push(`<details${i === 0 ? " open" : ""}><summary>${esc(tab.props.title ?? tab.props.label ?? `Tab ${i + 1}`)}</summary>${inner.join("")}</details>`);
      });
      return;
    case "card": {
      if (typeof p.image === "string" && SAFE_SRC.test(p.image) && ctx.allowImage(p.image)) out.push(`<figure><img src="${esc(p.image)}"/></figure>`);
      const badge = p.badge ? ` · <i>${esc(p.badge)}</i>` : "";
      if (p.title) out.push(`<h4>${esc(p.title)}${badge}</h4>`);
      if (p.subtitle) out.push(`<p><i>${esc(p.subtitle)}</i></p>`);
      if (p.body) out.push(markdownToHtml(p.body));
      return children(n.children, out, ctx);
    }
    case "text": {
      const v = str(p.variant);
      if (v === "heading") return void out.push(`<h3>${esc(p.content)}</h3>`);
      if (v === "subheading") return void out.push(`<h4>${esc(p.content)}</h4>`);
      if (v === "code") return void out.push(`<pre><code>${esc(p.content)}</code></pre>`);
      if (v === "caption") return void out.push(`<p><i>${esc(p.content)}</i></p>`);
      return void out.push(markdownToHtml(p.content));
    }
    case "stat":
      return void out.push(statTable([n]));
    case "table":
      return void out.push(htmlTable(tableText(p, MAX_COLUMNS), "bordered striped compact"));
    case "list": {
      const tag = p.ordered ? "ol" : "ul";
      const items = (Array.isArray(p.items) ? p.items : []).map((i) => `<li>${markdownToHtml(i).replace(/^<p>|<\/p>$/g, "")}</li>`);
      return void out.push(`<${tag}>${items.join("")}</${tag}>`);
    }
    case "chart":
      // No charts in Telegram: the same data as a table (a pie shows shares).
      return void out.push(htmlTable(chartText(p), "compact", p.kind === "pie"));
    case "alert":
      return void out.push(`<blockquote>${p.title ? `<b>${esc(p.title)}</b><br/>` : ""}${markdownToHtml(p.body).replace(/^<p>|<\/p>$/g, "")}</blockquote>`);
    case "image":
      if (typeof p.src === "string" && SAFE_SRC.test(p.src) && ctx.allowImage(p.src)) {
        out.push(`<figure><img src="${esc(p.src)}"/>${p.alt ? `<figcaption>${esc(p.alt)}</figcaption>` : ""}</figure>`);
      } else if (p.alt) out.push(`<p><i>${esc(p.alt)}</i></p>`);
      return;
    case "divider":
      return void out.push("<hr/>");
    case "button":
      return void out.push(buttonRow([n], ctx));
    case "form": {
      // Rich messages have no inputs: list what will be asked, and one button to start.
      const fields: string[] = [];
      walk(n, (f) => {
        if (!f.bindPath) return;
        fields.push(`<li>${esc(f.props.label)}${isRequired(f.props.checks) ? " *" : ""}</li>`);
      });
      if (fields.length) out.push(`<ul>${fields.join("")}</ul>`);
      const label = str(p.submitLabel) || "Fill in";
      return void out.push(`<tg-button-row><tg-button type="callback_data" data="${esc(ctx.control(n.key, "form", label))}" style="primary">${esc(label)}</tg-button></tg-button-row>`);
    }
    case "input":
    case "textarea":
    case "select":
    case "checkbox":
    case "date":
      // Fields outside a form are asked when their container's button is pressed.
      return void out.push(`<p>${esc(p.label)}${p.value !== undefined && p.value !== "" ? `: <b>${esc(str(p.value))}</b>` : ""}</p>`);
    default:
      return; // $pending / $invalid: nothing to show yet
  }
}
