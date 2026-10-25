import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, projectAnsi, projectMarkdown, stripControls, SurfaceStore } from "@vak/core";
import { projectEmail } from "../src/index.ts";

function resolved(nodes: unknown[], title = "Report") {
  const s = new SurfaceStore(basicCatalog);
  s.render({ surface: "x", title, nodes } as never);
  return s.resolve("x")!;
}

const hostile = resolved(
  [
    {
      id: "root",
      type: "stack",
      children: [
        { id: "t", type: "text", props: { content: 'Hi <script>alert(1)</script> [click](javascript:alert(1)) [ok](https://example.com) <img src=x onerror="alert(1)">' } },
        { id: "i", type: "image", props: { src: "http://insecure.example/a.png", alt: "pic" } },
        { id: "b", type: "button", props: { label: "Approve", action: "approve" } },
      ],
    },
  ],
  "Q3 <b>report</b>\u001b]0;x\u0007",
);

test("email: model text is escaped, only https links and images survive, buttons become one link back", () => {
  const e = projectEmail(hostile, { openUrl: "https://app.example/c/1" });
  assert.doesNotMatch(e.html, /<script|onerror=|href="javascript|http:\/\/insecure/);
  assert.match(e.html, /href="https:\/\/example.com"/);
  assert.match(e.html, /Open to respond/);
  assert.equal(e.subject, "Q3 <b>report</b>");
  assert.match(e.text, /Open to respond: https:\/\/app.example\/c\/1/);
  // Without a place to respond, controls are left out rather than shown dead.
  assert.doesNotMatch(projectEmail(hostile).html, /Open to respond|Approve/);
});

test("markdown: labels can't open links or break a table; escape sequences are dropped", () => {
  const md = projectMarkdown(resolved([{ id: "root", type: "table", props: { columns: ["Name"], rows: [{ name: "a | b" }] } }], "Title [x](https://evil.example)\u001b[2J"));
  assert.match(md, /a \\\| b/);
  assert.match(md, /Title \\\[x\\\]\\\(https:\/\/evil\.example\\\)/);
  assert.doesNotMatch(md, /\u001b/);
});

test("terminal: escape sequences from the model never reach the terminal", () => {
  assert.equal(stripControls("ok\u001b[2J\u001b]0;title\u0007\u0007done"), "okdone");
  const out = projectAnsi(resolved([{ id: "root", type: "text", props: { content: "clear\u001b[2Jme" } }], "T"), { color: false });
  assert.doesNotMatch(out, /\u001b/);
  assert.match(out, /clearme/);
});
