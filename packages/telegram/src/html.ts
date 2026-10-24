// Safe text → Telegram rich-message HTML. Everything is escaped first; then a
// controlled markdown subset becomes Telegram's supported tags. Model text can
// never inject markup.

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SAFE_URL = /^(https?:|mailto:|tel:)/i;

/** Inline markdown (bold, italic, code, links) on already-escaped text. */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<b>${a ?? b}</b>`)
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)|(^|[^_\w])_([^_\s][^_]*)_(?!_)/g, (_m, p1, a, p2, b) => `${p1 ?? p2}<i>${a ?? b}</i>`)
    // Link targets may contain one level of balanced parentheses (wiki-style URLs).
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_m, text: string, href: string) => {
      const raw = href.replace(/&amp;/g, "&");
      return SAFE_URL.test(raw) ? `<a href="${href}">${text}</a>` : text;
    });
}

/** Markdown prose → block HTML (paragraphs, headings, lists, code blocks). */
export function markdownToHtml(src: unknown): string {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | undefined;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(esc(l))).join("<br/>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`);
    list = undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      flushPara();
      flushList();
      const code: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i]!);
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = Math.min(heading[1]!.length + 2, 6);
      out.push(`<h${level}>${inline(esc(heading[2]!))}</h${level}>`);
      continue;
    }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const tag = item[2] ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(inline(esc(item[3]!)));
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join("");
}
