// Terminal projection: ANSI colour and box drawing for CLIs and agents that
// print to a terminal. Tables are aligned to the terminal's width, cards are
// boxed, tones are coloured. Every control character in model text is
// stripped first: a model (or a page it read) must not be able to move the
// cursor, retitle the window or hide text with escape codes.

import type { CapabilityProfile } from "./catalog.ts";
import { chartText, tableText, type TextTable } from "./chat.ts";
import { lowerSurface } from "./lower.ts";
import { byPriority, type Projector } from "./projector.ts";
import type { ResolvedNode, ResolvedSurface } from "./surface.ts";

export const ansiCapabilities: CapabilityProfile = {
  target: "terminal",
  layout: "linear",
  streaming: "none",
  markup: "plain",
  components: { chart: "degraded", form: "degraded", image: "none", gallery: "none", grid: "degraded", split: "degraded", tabs: "degraded" },
};

export interface AnsiOptions {
  /** Columns to fit (default 80). */
  width?: number;
  /** false: plain text with the same layout (pipes, logs, NO_COLOR). */
  color?: boolean;
}

/** Remove escape sequences and control characters other than newline and tab. */
export function stripControls(v: unknown): string {
  return String(v ?? "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][\s\S]*?(\u0007|\u001b\\)/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

/** Display width: wide (CJK, emoji) characters take two columns. */
function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
  return w;
}

function clip(s: string, max: number): string {
  if (width(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (width(out + ch) > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

const pad = (s: string, w: number, align: "start" | "center" | "end" = "start") => {
  const gap = Math.max(0, w - width(s));
  return align === "end" ? " ".repeat(gap) + s : align === "center" ? " ".repeat(gap >> 1) + s + " ".repeat(gap - (gap >> 1)) : s + " ".repeat(gap);
};

/** Plain wrapping at word boundaries. */
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && width(`${line} ${word}`) > max) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

/** Markdown read as terminal text: emphasis marks dropped, links as "text <url>". */
function plainMd(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\((https:[^)\s]+)\)/g, "$1 <$2>")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\s)[*_](\S.*?)[*_](?=\s|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "");
}

export function projectAnsi(surface: ResolvedSurface, opts: AnsiOptions = {}): string {
  surface = lowerSurface(surface);
  const W = Math.max(30, opts.width ?? 80);
  const color = opts.color !== false;
  const sgr = (code: string) => (s: string) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  const bold = sgr("1");
  const dim = sgr("2");
  const tone: Record<string, (s: string) => string> = { info: sgr("34"), success: sgr("32"), warning: sgr("33"), danger: sgr("31"), neutral: (s) => s };
  const out: string[] = [];
  const t = (v: unknown) => stripControls(v);

  const table = (tt: TextTable, indent: string) => {
    if (!tt.headers.length) return;
    const n = tt.headers.length;
    const avail = W - indent.length - (n - 1) * 3;
    const natural = tt.headers.map((h, i) => Math.max(width(t(h)), ...tt.rows.map((r) => width(t(r[i] ?? "")))));
    // Shrink the widest columns first until the table fits.
    const widths = [...natural];
    while (widths.reduce((a, b) => a + b, 0) > avail && Math.max(...widths) > 4) widths[widths.indexOf(Math.max(...widths))]!--;
    const row = (cells: string[], f = (s: string) => s) => indent + cells.map((c, i) => f(pad(clip(t(c), widths[i]!), widths[i]!, tt.align[i]))).join(dim(" │ "));
    out.push(row(tt.headers, bold));
    out.push(indent + widths.map((w) => "─".repeat(w)).join(dim("─┼─")));
    for (const r of tt.rows) out.push(row(r));
  };

  const box = (title: string, body: string[], indent: string, paint = (s: string) => s) => {
    const inner = W - indent.length - 4;
    // Painted in pieces: a reset inside the bold title would end the border's colour.
    const label = title ? clip(title, inner - 2) : "";
    out.push(indent + paint("╭─") + (label ? ` ${bold(label)} ` : "") + paint(`${"─".repeat(Math.max(0, inner - (label ? width(label) + 2 : 0)))}─╮`));
    for (const l of body.flatMap((b) => wrap(b, inner))) out.push(`${indent}${paint("│")} ${pad(l, inner)} ${paint("│")}`);
    out.push(indent + paint(`╰${"─".repeat(inner + 2)}╯`));
  };

  const walk = (n: ResolvedNode, indent: string) => {
    const p = n.props;
    const kids = (i = indent) => byPriority(n.children).forEach((c) => walk(c, i));
    const text = (s: string) => wrap(plainMd(t(s)), W - indent.length).forEach((l) => out.push(indent + l));
    switch (n.type) {
      case "stack":
      case "grid":
      case "split":
        return kids();
      case "section":
        if (p.title) out.push(indent + bold(t(p.title)));
        if (p.description) text(str(p.description));
        return kids(`${indent}  `);
      case "tabs":
        for (const c of n.children) {
          out.push(indent + bold(`▸ ${t(c.props.title ?? c.props.label ?? "Tab")}`));
          walk(c, `${indent}  `);
        }
        return;
      case "card": {
        const body = [p.subtitle ? t(p.subtitle) : "", p.body ? plainMd(t(p.body)) : ""].filter(Boolean);
        box([t(p.title), p.badge ? `[${t(p.badge)}]` : ""].filter(Boolean).join(" "), body.length ? body : [""], indent);
        return kids(`${indent}  `);
      }
      case "text":
        return text(str(p.content));
      case "stat": {
        const d = str(p.delta);
        const paint = p.trend === "down" || d.startsWith("-") ? tone.danger! : p.trend === "up" || d.startsWith("+") ? tone.success! : (s: string) => s;
        return void out.push(`${indent}${dim(t(p.label))}  ${bold(t(p.value))}${d ? `  ${paint(t(d))}` : ""}`);
      }
      case "table":
        return table(tableText(p), indent);
      case "chart":
        return table(chartText(p), indent);
      case "list":
        (Array.isArray(p.items) ? p.items : []).forEach((it, i) => {
          const mark = p.ordered ? `${i + 1}.` : "•";
          wrap(plainMd(t(it)), W - indent.length - mark.length - 1).forEach((l, j) => out.push(`${indent}${j ? " ".repeat(mark.length) : mark} ${l}`));
        });
        return;
      case "alert":
        return box(t(p.title) || str(p.tone ?? "note").toUpperCase(), [plainMd(t(p.body))], indent, tone[str(p.tone)] ?? tone.info!);
      case "divider":
        return void out.push(indent + dim("─".repeat(W - indent.length)));
      case "button":
        return void out.push(`${indent}${sgr("7")(` ${t(p.label)} `)}`);
      case "image":
        return void (p.alt && out.push(indent + dim(`[image: ${t(p.alt)}]`)));
      default:
        if (typeof p.bind === "string") out.push(`${indent}${t(p.label ?? n.id)}: ${p.value !== undefined && p.value !== "" ? bold(t(p.value)) : dim("____")}`);
        else kids();
    }
  };

  if (surface.title) out.push(bold(t(surface.title)), "");
  if (surface.root) walk(surface.root, "");
  return out.join("\n").replace(/ ( \u001b\[7m)/g, "$1");
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export const ansiProjector: Projector<string> = { capabilities: ansiCapabilities, project: (s) => projectAnsi(s) };
