// Safe text → Discord markdown. Discord renders markdown natively, so model
// markdown mostly passes through; plain strings (titles, labels) are escaped
// so they cannot start formatting, and links keep only safe schemes. Mentions
// are neutralized at send time (allowed_mentions: { parse: [] }), not here.

/** Escape a plain string so Discord shows it literally. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/([\\*_`~|>#\-[\]()])/g, "\\$1");
}

const SAFE_URL = /^(https?:|mailto:)/i;

/** Model markdown → Discord markdown: unsafe link targets lose their link. */
export function markdownToDiscord(src: unknown): string {
  return String(src ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, text: string, href: string) => (SAFE_URL.test(href) ? m : text))
    .replace(/^#{4,6}\s+/gm, "### ")
    .trim();
}
