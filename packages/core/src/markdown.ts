// Prose normalization: models often put HTML in fields meant for markdown.
// A safe subset of tags becomes markdown; every other tag is dropped (its text
// kept, except script/style which go entirely). Output is plain markdown text,
// so every projector treats it the same.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const SAFE_HREF = /^(https?:|mailto:)/i;

export function htmlToMarkdown(input: string): string {
  if (!/<\/?[a-z][^>]*>/i.test(input)) return input;
  let s = input.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");

  // Anchors first: [text](href) for safe links, bare text otherwise.
  s = s.replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href: string, text: string) =>
    SAFE_HREF.test(href) ? `[${text}](${href})` : text,
  );

  const lists: { kind: "ul" | "ol"; n: number }[] = [];
  s = s.replace(/<(\/?)([a-z0-9]+)\b[^>]*>/gi, (_m, close: string, tagRaw: string) => {
    const tag = tagRaw.toLowerCase();
    const open = !close;
    switch (tag) {
      case "br":
        return "\n";
      case "p":
      case "div":
        return "\n\n";
      case "strong":
      case "b":
        return "**";
      case "em":
      case "i":
        return "*";
      case "code":
        return "`";
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
        return open ? `\n\n${"#".repeat(Number(tag[1]))} ` : "\n\n";
      case "ul":
      case "ol":
        if (open) lists.push({ kind: tag, n: 0 });
        else lists.pop();
        return "\n";
      case "li": {
        if (!open) return "";
        const list = lists[lists.length - 1] ?? { kind: "ul", n: 0 };
        list.n++;
        return `\n${list.kind === "ol" ? `${list.n}. ` : "- "}`;
      }
      default:
        return "";
    }
  });
  s = s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
