// Safe text → Slack mrkdwn. Slack treats &, < and > as control characters
// (links, mentions), so everything is escaped first; then a controlled
// markdown subset becomes mrkdwn. Model text can never mention or link
// anything it was not allowed to.

export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SAFE_URL = /^(https?:|mailto:)/i;

/** Inline markdown (bold, italic, code, links) on already-escaped text. */
function inline(escaped: string): string {
  const code: string[] = [];
  return escaped
    .replace(/`([^`]+)`/g, (_m, c: string) => `\u0000${code.push(c) - 1}\u0000`)
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_m, text: string, href: string) => {
      const raw = href.replace(/&amp;/g, "&");
      return SAFE_URL.test(raw) ? `<${href.replace(/\|/g, "%7C")}|${text.replace(/\|/g, "/")}>` : text;
    })
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, "$1_$2_")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `*${a ?? b}*`)
    .replace(/~~([^~]+)~~/g, "~$1~")
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `\`${code[Number(i)]}\``);
}

/** Markdown prose → mrkdwn: headings become bold lines, list markers bullets. */
export function markdownToMrkdwn(src: unknown): string {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      const code: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i]!);
      out.push("```", esc(code.join("\n")), "```");
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push(`*${inline(esc(heading[1]!)).replace(/\*/g, "")}*`);
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push(`${bullet[1]}• ${inline(esc(bullet[2]!))}`);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      out.push(`&gt; ${inline(esc(quote[1]!))}`.replace(/^&gt;/, ">"));
      continue;
    }
    out.push(inline(esc(line)));
  }
  return out.join("\n").trim();
}
