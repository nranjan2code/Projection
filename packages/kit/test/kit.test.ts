import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Provider, ProviderEvent } from "@vak/providers";
import { createVak } from "../src/index.ts";

/** Renders a form first; after the [ui action], a confirmation. */
function scripted(): Provider {
  let n = 0;
  const call = (args: unknown): ProviderEvent[] => [
    { type: "tool_start", id: `c${n}`, name: "vak_render" },
    { type: "tool_args", id: `c${n}`, delta: JSON.stringify(args) },
    { type: "tool_end", id: `c${n}` },
    { type: "done", stop: "tool_use" },
  ];
  return {
    id: "scripted",
    async describeModel() {
      return { tools: true, fingerprint: "t", source: "t" };
    },
    async *stream(req) {
      n++;
      const acted = req.messages.some((m) => m.content.startsWith("[ui action]"));
      yield* acted
        ? call({ surface: "done", title: "Subscribed", nodes: [{ id: "root", type: "alert", props: { tone: "success", title: "You're in" } }] })
        : call({ surface: "signup", title: "Newsletter", nodes: [{ id: "root", type: "form", props: { submit: "join" }, children: [{ id: "email", type: "input", props: { label: "Email", bind: "/form/email", checks: ["required", "email"] } }] }] });
    },
  };
}

test("createVak: ask renders, act answers a form, render and email project the result", async () => {
  const vak = createVak({ model: "m", provider: scripted(), profilesPath: path.join(mkdtempSync(path.join(tmpdir(), "vak-kit-")), "m.json") });
  const first = await vak.ask("make a signup form");
  assert.equal(first.surfaces[0]?.id, "signup");
  assert.match(vak.render("markdown", "signup"), /Email \*/);
  await assert.rejects(vak.act({ surface: "signup", source: "root", data: { form: { email: "nope" } } }), /rejected/);
  const second = await vak.act({ surface: "signup", source: "root", data: { form: { email: "a@b.co" } } });
  assert.equal(second.surfaces[0]?.id, "done");
  assert.match(vak.render("terminal", "done", { color: false }), /You're in/);
  assert.equal(vak.email({ surface: "done" }).subject, "Subscribed");
});

test("createVak: a model string names the provider and says what is missing", () => {
  assert.throws(() => createVak({ model: "nonsense" }), /provider:model/);
  assert.throws(() => createVak({ model: "anthropic:claude-opus-5-5", env: {} }), /ANTHROPIC_API_KEY/);
});
