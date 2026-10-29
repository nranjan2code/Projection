import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, formFields, SurfaceStore } from "@vak/core";
import { markdownToMrkdwn } from "../src/mrkdwn.ts";
import { projectSlack, SLACK_LIMITS } from "../src/project.ts";
import { readSlackModal, slackModal } from "../src/modal.ts";

const tokens = () => {
  let n = 0;
  return () => `a${n++}`;
};

const store = () => {
  const s = new SurfaceStore(basicCatalog);
  for (const ex of basicCatalog.examples) s.render(structuredClone(ex.render));
  return s;
};

test("catalog examples become Block Kit: header, stat fields, native tables, button actions", () => {
  const s = store();
  const sales = projectSlack(s.resolve("sales")!, tokens());
  assert.deepEqual(sales.blocks[0], { type: "header", text: { type: "plain_text", text: "Sales this month", emoji: true } });
  const fields = sales.blocks.find((b) => b.type === "section" && Array.isArray(b.fields))!;
  assert.match(JSON.stringify(fields), /Revenue \(\$k\)\\n\*198\*  \+8%/);
  const tables = sales.blocks.filter((b) => b.type === "table");
  assert.equal(tables.length, 2, "the chart's data and the product table");
  assert.deepEqual((tables[1]!.rows as { text: string }[][])[0]!.map((c) => c.text), ["Product", "Sales ($k)"]);
  const trips = projectSlack(s.resolve("trips")!, tokens());
  const actions = trips.blocks.filter((b) => b.type === "actions");
  assert.equal(actions.length, 3);
  assert.deepEqual(trips.controls.map((c) => c.kind), ["button", "button", "button"]);
  for (const p of [sales, trips]) assert.ok(p.blocks.length <= SLACK_LIMITS.blocks);
});

test("a form shows its fields and one button that opens it", () => {
  const beta = projectSlack(store().resolve("beta")!, tokens());
  assert.match(JSON.stringify(beta.blocks), /• Name \*\\n• Email \*\\n• Role\\n• Email me product updates/);
  const last = beta.blocks.at(-1)!;
  assert.equal(last.type, "actions");
  assert.deepEqual(beta.controls, [{ token: "a0", key: beta.controls[0]!.key, kind: "form", label: "Join the beta" }]);
});

test("model text cannot mention, link or inject", () => {
  const md = markdownToMrkdwn("hi <!channel> **bold** *it* [ok](https://a.io) [bad](javascript:x) <@U123>");
  assert.doesNotMatch(md, /<!channel>|<@U123>|javascript/);
  assert.match(md, /&lt;!channel&gt;/);
  assert.match(md, /\*bold\* _it_ <https:\/\/a\.io\|ok> bad/);
});

test("over the limits: long prose splits, extra blocks are cut with a note, big tables fall back to text", () => {
  const s = new SurfaceStore(basicCatalog);
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `t${i}`, type: "text", props: { content: `para ${i}` } }));
  s.render({ surface: "big", nodes: [{ id: "root", type: "stack", children: many.map((n) => n.id) }, ...many] });
  const big = projectSlack(s.resolve("big")!, tokens());
  assert.equal(big.blocks.length, SLACK_LIMITS.blocks);
  assert.match(JSON.stringify(big.blocks.at(-1)), /31 more blocks not shown/);

  const rows = Array.from({ length: 100 }, (_, i) => ({ a: "x".repeat(60), b: i }));
  s.render({ surface: "tables", nodes: [{ id: "root", type: "stack", children: ["t1", "t2"] }, { id: "t1", type: "table", props: { columns: ["a", "b"], rows } }, { id: "t2", type: "table", props: { columns: ["a", "b"], rows } }] });
  const t = projectSlack(s.resolve("tables")!, tokens());
  assert.equal(t.blocks.filter((b) => b.type === "table").length, 1, "the second table would pass 10,000 table characters");
  assert.match(JSON.stringify(t.blocks.at(-1)), /```/);
});

test("modal: native inputs, prefilled values, and per-field errors on submit", () => {
  const s = store();
  const form = s.resolve("beta")!.root!;
  const fields = formFields(form);
  const view = slackModal(fields, { title: "Join the beta", callbackId: "beta", values: { [fields[0]!.bindPath]: "Ada" } });
  const blocks = view.blocks as Record<string, Record<string, unknown>>[];
  assert.deepEqual(blocks.map((b) => b.element!.type), ["plain_text_input", "email_text_input", "static_select", "checkboxes"]);
  assert.equal(blocks[0]!.element!.initial_value, "Ada");
  assert.equal(blocks[0]!.optional, false);

  const bad = readSlackModal(fields, { f0: { v: { type: "plain_text_input", value: "Ada" } }, f1: { v: { type: "email_text_input", value: "nope" } } });
  assert.deepEqual(bad.errors, { f1: "Enter a valid email" });
  const ok = readSlackModal(fields, {
    f0: { v: { value: "Ada" } },
    f1: { v: { value: "ada@example.com" } },
    f2: { v: { selected_option: { value: "1" } } },
    f3: { v: { selected_options: [{ value: "yes" }] } },
  });
  assert.deepEqual(ok.errors, {});
  for (const [path, value] of Object.entries(ok.values)) s.setValue("beta", path, value);
  assert.deepEqual(s.submit("beta", form.key).action?.data, { name: "Ada", email: "ada@example.com", role: "Designer", updates: true });
});
