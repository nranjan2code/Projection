// A surface title the content already says. Models often title a surface and
// then open it with the same words as a heading, a card title or the first
// sentence ("Hello!" over "Hello! How can I help?"); drawing both reads as an echo.

import type { ResolvedNode } from "./surface.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The first words a reader meets: a card or section title, or the first text, down the first children. */
function firstWords(node: ResolvedNode | null | undefined, depth = 0): string | undefined {
  if (!node || depth > 6) return undefined;
  for (const key of ["title", "content", "text", "label"]) {
    const v = node.props[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return firstWords(node.children[0], depth + 1);
}

/** Whether the opening content repeats the title, so the title can be left out. */
export function titleRepeated(title: string | undefined, root: ResolvedNode | null | undefined): boolean {
  const t = norm(title ?? "");
  const f = norm(firstWords(root) ?? "");
  if (!t || !f) return false;
  // The content says the whole title, or most of it: a short card title under a longer surface title adds nothing, but a lone word would lose the rest.
  return f.startsWith(t) || (t.startsWith(f) && f.length >= t.length * 0.6);
}
