import assert from "node:assert/strict";
import { test } from "node:test";

// Model text is untrusted: a label or a table cell can carry markup or a
// javascript: link. These render through markdown.ts into nodes, never
// innerHTML, so nothing here can become markup.
import { renderMarkdown } from "../src/markdown.ts";
import { fakeDoc, findAll, textOf } from "./dom.ts";

test("markdown: markup in model text stays text, never an element", () => {
  const doc = fakeDoc();
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">', doc);
  assert.equal(findAll(html, "script").length, 0);
  assert.equal(findAll(html, "img").length, 0);
  assert.match(textOf(html), /<script>alert\(1\)<\/script>/);
  assert.match(textOf(html), /onerror="alert\(2\)"/);
});

test("markdown: only https and mailto links survive; others keep their label", () => {
  const doc = fakeDoc();
  const html = renderMarkdown("[ok](https://example.com/a) [bad](javascript:alert(1)) [mail](mailto:a@b.example)", doc);
  const links = findAll(html, "a");
  assert.equal(links.length, 2);
  assert.equal((links[0] as unknown as { href: string }).href, "https://example.com/a");
  assert.equal((links[1] as unknown as { href: string }).href, "mailto:a@b.example");
  assert.equal((links[0] as unknown as { rel: string }).rel, "noopener noreferrer");
  assert.match(textOf(html), /bad/);
  assert.doesNotMatch(textOf(html), /javascript:/);
});

test("markdown: headings, bold, inline code and fenced code blocks", () => {
  const doc = fakeDoc();
  const html = renderMarkdown("## Title\n\n**bold** and `x<y`\n\n```js\nconst a = 1 < 2;\n```", doc);
  assert.equal(findAll(html, "h4").length, 1);
  assert.equal(findAll(html, "strong").length, 1);
  assert.equal(findAll(html, "code").length, 2);
  assert.match(textOf(html), /const a = 1 < 2;/);
});
