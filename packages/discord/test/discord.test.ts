import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, formFields, SurfaceStore } from "@vak/core";
import { esc, markdownToDiscord } from "../src/markdown.ts";
import { C, DISCORD_LIMITS, IS_COMPONENTS_V2, projectDiscord } from "../src/project.ts";
import { discordModal, modalPages, readDiscordModal } from "../src/modal.ts";

const tokens = () => {
  let n = 0;
  return () => `d${n++}`;
};

const store = () => {
  const s = new SurfaceStore(basicCatalog);
  for (const ex of basicCatalog.examples) s.render(structuredClone(ex.render));
  return s;
};

type Comp = { type: number; content?: string; components?: Comp[]; style?: number; label?: string; custom_id?: string };
const inner = (p: ReturnType<typeof projectDiscord>) => (p.message.components[0] as Comp).components!;
const total = (cs: Comp[]): number => cs.reduce((a, c) => a + 1 + (c.components ? total(c.components) : 0), 0);
const text = (cs: Comp[]) => cs.filter((c) => c.type === C.TextDisplay).map((c) => c.content).join("\n");

test("catalog examples become a Components V2 container: text, monospace tables, button rows", () => {
  const s = store();
  const sales = projectDiscord(s.resolve("sales")!, tokens());
  assert.equal(sales.message.flags, IS_COMPONENTS_V2);
  assert.deepEqual(sales.message.allowed_mentions, { parse: [] });
  const body = text(inner(sales));
  assert.match(body, /^## Sales this month/);
  assert.match(body, /\*\*\$198k\*\* · Revenue · \+8%/);
  assert.match(body, /```\nProduct\s+Sales\n─+\s+─+\nDesk lamp\s+\$24k/);
  const trips = projectDiscord(s.resolve("trips")!, tokens());
  const rows = inner(trips).filter((c) => c.type === C.ActionRow);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.components![0]!.style, 1, "primary");
  for (const p of [sales, trips]) assert.ok(1 + total(inner(p)) <= DISCORD_LIMITS.components);
});

test("plain strings are escaped; only safe links survive", () => {
  assert.equal(esc("**not bold** # no heading"), "\\*\\*not bold\\*\\* \\# no heading");
  assert.equal(markdownToDiscord("[ok](https://a.io) [bad](javascript:x)"), "[ok](https://a.io) bad");
});

test("over the limits: components and text are cut with a note", () => {
  const s = new SurfaceStore(basicCatalog);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, type: "divider" }));
  s.render({ surface: "big", nodes: [{ id: "root", type: "stack", children: many.map((n) => n.id) }, ...many] });
  const big = inner(projectDiscord(s.resolve("big")!, tokens()));
  assert.ok(1 + total(big) <= DISCORD_LIMITS.components);
  assert.equal(big.at(-1)!.content, "-# more not shown");
  const long = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, type: "text", props: { content: "word ".repeat(60) + i } }));
  s.render({ surface: "long", nodes: [{ id: "root", type: "stack", children: long.map((n) => n.id) }, ...long] });
  const chars = inner(projectDiscord(s.resolve("long")!, tokens())).reduce((a, c) => a + (c.content?.length ?? 0), 0);
  assert.ok(chars <= DISCORD_LIMITS.text, `${chars} characters`);
});

test("modal pages of 5, selects for choices, and errors by field on submit", () => {
  const s = store();
  const form = s.resolve("beta")!.root!;
  const fields = formFields(form);
  assert.deepEqual(modalPages([...fields, ...fields]).map((p) => p.length), [5, 3]);
  const modal = discordModal(fields, { customId: "beta", title: "Join the beta" });
  const kinds = (modal.components as { component: { type: number } }[]).map((l) => l.component.type);
  assert.deepEqual(kinds, [C.TextInput, C.TextInput, C.StringSelect, C.StringSelect]);

  const bad = readDiscordModal(fields, [{ component: { custom_id: "f0", value: "Ada" } }, { component: { custom_id: "f1", value: "nope" } }]);
  assert.deepEqual(bad.errors, { Email: "Enter a valid email" });
  const ok = readDiscordModal(fields, [
    { component: { custom_id: "f0", value: "Ada" } },
    { component: { custom_id: "f1", value: "ada@example.com" } },
    { component: { custom_id: "f2", values: ["1"] } },
    { component: { custom_id: "f3", values: ["0"] } },
  ]);
  assert.deepEqual(ok.errors, {});
  for (const [path, value] of Object.entries(ok.values)) s.setValue("beta", path, value);
  assert.deepEqual(s.submit("beta", form.key).action?.data, { name: "Ada", email: "ada@example.com", role: "Designer", updates: true });
});
