// HTML email projection: a surface as a message any mail client shows the
// same way (Gmail, Outlook, Apple Mail). Mail clients are the oldest
// renderers there are, so: one 600px column of tables, every style inline,
// no scripts, no forms, no CSS layout. Interaction cannot work inside an
// email, so buttons and forms become one link back to where they live
// (`openUrl`), or are left out. Everything from the model is escaped; only
// https/mailto links and https images survive.

import { type CapabilityProfile, chartText, lowerSurface, type ResolvedNode, type ResolvedSurface, stripControls, tableText, type TextTable, byPriority, projectText } from "@vak/core";

export const emailCapabilities: CapabilityProfile = {
  target: "email",
  layout: "linear",
  streaming: "none",
  markup: "html",
  components: { chart: "degraded", form: "degraded", button: "degraded", grid: "degraded", split: "degraded", tabs: "degraded", input: "none", select: "none", checkbox: "none", date: "none", textarea: "none" },
};

export interface EmailOptions {
  /** Where buttons and forms can be used ("Open in vak"); without it they are left out. */
  openUrl?: string;
  /** Shown at the bottom (why the reader got this email). */
  footer?: string;
  /** Accent colour for links, the heading rule and the button. */
  accent?: string;
}

export interface EmailProjection {
  subject: string;
  html: string;
  /** The text/plain part: the same content for clients that don't show HTML. */
  text: string;
}

const C = { fg: "#17181c", muted: "#62656f", border: "#e3e4e8", soft: "#f4f5f7", bg: "#ffffff" };
const TONE: Record<string, string> = { info: "#2563eb", success: "#15803d", warning: "#b45309", danger: "#dc2626", neutral: C.muted };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
export const esc = (v: unknown) => stripControls(str(v)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeHref = (u: unknown) => (/^(https:|mailto:)/i.test(str(u)) ? esc(str(u)) : "");
const safeImg = (u: unknown) => (/^https:\/\//i.test(str(u)) ? esc(str(u)) : "");

/** The Markdown models write (bold, italic, code, links, lists, paragraphs), as escaped inline HTML. */
export function markdownToEmail(src: unknown, accent: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, `<code style="font-family:Menlo,Consolas,monospace;font-size:13px;background:${C.soft};padding:1px 4px;border-radius:4px">$1</code>`)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*(\S.*?)\*(?=[\s).,!?]|$)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(((?:https:|mailto:)[^)\s]+)\)/g, `<a href="$2" style="color:${accent}">$1</a>`);
  const out: string[] = [];
  const lines = stripControls(str(src)).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^(```|~~~)/.exec(line);
    if (fence) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.startsWith(fence[1]!)) code.push(lines[i]!);
      out.push(`<pre style="margin:0 0 12px;padding:12px;background:${C.soft};border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap">${esc(code.join("\n"))}</pre>`);
      continue;
    }
    const li = /^\s*(?:[-*•]|(\d+)\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = Boolean(li[1]);
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        items.push(`<li style="margin:0 0 4px">${inline(m[1]!)}</li>`);
      }
      i--;
      out.push(`<${ordered ? "ol" : "ul"} style="margin:0 0 12px;padding-left:22px">${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (line.trim()) out.push(`<p style="margin:0 0 12px">${inline(line.replace(/^#{1,6}\s+/, ""))}</p>`);
  }
  return out.join("");
}

function tableHtml(t: TextTable): string {
  if (!t.headers.length) return "";
  const cell = (v: string, i: number, head: boolean) =>
    `<${head ? "th" : "td"} align="${t.align[i] === "end" ? "right" : t.align[i] === "center" ? "center" : "left"}" style="padding:8px 10px;border-bottom:1px solid ${C.border};font-size:${head ? 12 : 14}px;${head ? `color:${C.muted};text-transform:uppercase;letter-spacing:.04em;background:${C.soft}` : ""}">${esc(v)}</${head ? "th" : "td"}>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${C.border};border-radius:8px;margin:0 0 16px"><tr>${t.headers.map((h, i) => cell(h, i, true)).join("")}</tr>${t.rows.map((r) => `<tr>${r.map((c, i) => cell(c, i, false)).join("")}</tr>`).join("")}</table>`;
}

export function projectEmail(surface: ResolvedSurface, opts: EmailOptions = {}): EmailProjection {
  surface = lowerSurface(surface);
  const accent = /^#[0-9a-f]{3,8}$/i.test(opts.accent ?? "") ? opts.accent! : "#4f46e5";
  const parts: string[] = [];
  let interactive = false;

  const walk = (n: ResolvedNode) => {
    const p = n.props;
    const kids = () => byPriority(n.children).forEach(walk);
    switch (n.type) {
      case "stack":
      case "grid":
      case "split":
        return kids();
      case "section":
        if (p.title) parts.push(`<h2 style="margin:20px 0 8px;font-size:17px">${esc(p.title)}</h2>`);
        if (p.description) parts.push(markdownToEmail(p.description, accent));
        return kids();
      case "tabs":
        for (const c of n.children) {
          parts.push(`<h3 style="margin:16px 0 8px;font-size:15px">${esc(c.props.title ?? c.props.label ?? "")}</h3>`);
          walk(c);
        }
        return;
      case "card": {
        const inner: string[] = [];
        if (safeImg(p.image)) inner.push(`<img src="${safeImg(p.image)}" alt="${esc(p.title)}" width="100%" style="display:block;border-radius:6px;margin:0 0 10px;max-width:100%">`);
        if (p.title) inner.push(`<div style="font-weight:600;font-size:15px">${esc(p.title)}${p.badge ? ` <span style="font-size:11px;color:${C.muted};border:1px solid ${C.border};border-radius:10px;padding:1px 7px">${esc(p.badge)}</span>` : ""}</div>`);
        if (p.subtitle) inner.push(`<div style="color:${C.muted};font-size:13px;margin:2px 0 6px">${esc(p.subtitle)}</div>`);
        if (p.body) inner.push(markdownToEmail(p.body, accent));
        parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:8px;margin:0 0 12px"><tr><td style="padding:14px">${inner.join("")}`);
        kids();
        parts.push("</td></tr></table>");
        return;
      }
      case "text":
        return void parts.push(p.variant === "heading" ? `<h2 style="margin:16px 0 8px;font-size:18px">${esc(p.content)}</h2>` : markdownToEmail(p.content, accent));
      case "stat":
        return void parts.push(`<div style="margin:0 0 10px"><div style="color:${C.muted};font-size:12px;text-transform:uppercase;letter-spacing:.04em">${esc(p.label)}</div><div style="font-size:22px;font-weight:700">${esc(p.value)}${p.delta ? ` <span style="font-size:13px;color:${p.trend === "down" || str(p.delta).startsWith("-") ? TONE.danger : TONE.success}">${esc(p.delta)}</span>` : ""}</div></div>`);
      case "table":
        return void parts.push(tableHtml(tableText(p)));
      case "chart":
        return void parts.push(tableHtml(chartText(p)));
      case "list":
        return void parts.push(markdownToEmail((Array.isArray(p.items) ? p.items : []).map((it, i) => `${p.ordered ? `${i + 1}.` : "-"} ${str(it)}`).join("\n"), accent));
      case "alert": {
        const c = TONE[str(p.tone)] ?? TONE.info!;
        return void parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px"><tr><td style="border-left:4px solid ${c};background:${C.soft};padding:10px 14px;border-radius:4px">${p.title ? `<div style="font-weight:600;color:${c};margin:0 0 4px">${esc(p.title)}</div>` : ""}${markdownToEmail(p.body, accent)}</td></tr></table>`);
      }
      case "image":
        return void (safeImg(p.src) && parts.push(`<img src="${safeImg(p.src)}" alt="${esc(p.alt)}" width="100%" style="display:block;max-width:100%;border-radius:6px;margin:0 0 12px">`));
      case "divider":
        return void parts.push(`<hr style="border:0;border-top:1px solid ${C.border};margin:16px 0">`);
      case "button":
      case "form":
        interactive = true;
        return;
      default:
        if (typeof p.bind === "string") interactive = true;
        else kids();
    }
  };
  if (surface.root) walk(surface.root);

  const open = opts.openUrl && safeHref(opts.openUrl);
  if (interactive && open) {
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0"><tr><td style="background:${accent};border-radius:8px"><a href="${open}" style="display:inline-block;padding:10px 18px;color:#ffffff;font-weight:600;text-decoration:none">Open to respond</a></td></tr></table>`);
  }
  const subject = stripControls(surface.title ?? "").replace(/\s+/g, " ").trim().slice(0, 140) || "Update";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head><body style="margin:0;padding:0;background:${C.soft}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.soft}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.bg};border-radius:12px;border-top:4px solid ${accent}"><tr><td style="padding:24px;font-family:${FONT};font-size:15px;line-height:1.5;color:${C.fg}">${surface.title ? `<h1 style="margin:0 0 16px;font-size:20px">${esc(surface.title)}</h1>` : ""}${parts.join("")}</td></tr></table>${opts.footer ? `<div style="font-family:${FONT};font-size:12px;color:${C.muted};padding:12px">${esc(opts.footer)}</div>` : ""}</td></tr></table></body></html>`;
  const text = projectText(surface) + (interactive && open ? `\n\nOpen to respond: ${opts.openUrl}` : "") + (opts.footer ? `\n\n${opts.footer}` : "");
  return { subject, html, text };
}
