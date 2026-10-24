import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { basicCatalog, SurfaceStore } from "@vak/core";
import type { Provider, ProviderEvent } from "@vak/providers";
import { TelegramApi } from "../src/api.ts";
import { TelegramBot } from "../src/bot.ts";
import { FormFlow, stepsOf } from "../src/flow.ts";
import { projectTelegram } from "../src/project.ts";

const tokens = () => {
  let n = 0;
  return () => `t${n++}`;
};

test("projection: catalog examples become rich-message HTML with tokenized buttons", () => {
  const store = new SurfaceStore(basicCatalog);
  for (const ex of basicCatalog.examples) store.render(structuredClone(ex.render));
  const sales = projectTelegram(store.resolve("sales")!, tokens());
  assert.match(sales.html, /^<h2>Sales this month<\/h2>/);
  assert.match(sales.html, /<table compact><tr><td>Revenue<\/td><td align="right"><b>\$198k<\/b><\/td><td>\+8%<\/td><\/tr>/, "stats grouped into one table");
  assert.match(sales.html, /<tr><th><\/th><th>Revenue \(\$k\)<\/th><\/tr><tr><td>W1<\/td><td align="right">42<\/td><\/tr>/, "chart degraded to a data table");
  assert.match(sales.html, /<table bordered striped compact><tr><th>Product<\/th><th>Sales<\/th><\/tr><tr><td>Desk lamp<\/td><td align="right">\$24k<\/td><\/tr>/);
  const trips = projectTelegram(store.resolve("trips")!, tokens());
  assert.equal((trips.html.match(/<tg-button type="callback_data" data="t\d" style="primary">Choose<\/tg-button>/g) ?? []).length, 3);
  assert.deepEqual(trips.controls.map((c) => c.kind), ["button", "button", "button"]);
  const beta = projectTelegram(store.resolve("beta")!, tokens());
  assert.match(beta.html, /<ul><li>Name \*<\/li><li>Email \*<\/li><li>Role<\/li><li>Email me product updates<\/li><\/ul>/);
  assert.match(beta.html, /<tg-button type="callback_data" data="t0" style="primary">Join the beta<\/tg-button>/);
});

test("projection: model text cannot inject markup", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({ surface: "x", nodes: [{ id: "root", type: "card", props: { title: '<b onclick="x">Hi</b>', body: "**ok** <script>alert(1)</script> [bad](javascript:alert(1)) [good](https://a.io)" } }] });
  const { html } = projectTelegram(store.resolve("x")!, tokens());
  // No live markup from model text: tags arrive escaped, unsafe links lose their target.
  assert.doesNotMatch(html, /<script|<b onclick|href="javascript/);
  assert.match(html, /<h4>&lt;b onclick=&quot;x&quot;&gt;Hi&lt;\/b&gt;<\/h4>/);
  assert.match(html, /<b>ok<\/b>\s+bad <a href="https:\/\/a\.io">good<\/a>/);
});

test("form flow: typed answers are checked, choices are buttons, optional steps can be skipped", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render(structuredClone(basicCatalog.examples.find((e) => e.render.surface === "beta")!.render));
  const form = store.resolve("beta")!.root!;
  const flow = new FormFlow("beta", form.key, stepsOf(form));
  assert.deepEqual(flow.steps.map((s) => s.label), ["Name", "Email", "Role", "Email me product updates"]);
  assert.equal(flow.prompt(store)!.typed, true);
  assert.equal(flow.answer(store, { text: "" }), "This field is required");
  assert.equal(flow.answer(store, { text: "Ada" }), undefined);
  assert.equal(flow.answer(store, { text: "not-an-email" }), "Enter a valid email");
  assert.equal(flow.answer(store, { text: "ada@example.com" }), undefined);
  assert.deepEqual(flow.prompt(store)!.choices, [["Developer"], ["Designer"], ["Other"], ["Skip"]]);
  assert.equal(flow.answer(store, { choice: "Designer" }), undefined);
  assert.deepEqual(flow.prompt(store)!.choices, [["Yes"], ["No"], ["Skip"]]);
  assert.equal(flow.answer(store, { choice: "Yes" }), undefined);
  assert.ok(flow.done);
  assert.deepEqual(store.submit("beta", form.key).action?.data, { name: "Ada", email: "ada@example.com", role: "Designer", updates: true });
});

// --- end to end against a fake Bot API ------------------------------------------------
let server: Server;
let base = "";
const calls: { method: string; params: any }[] = [];
let nextId = 100;
before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const method = req.url!.split("/").pop()!;
      const params = body ? JSON.parse(body) : {};
      calls.push({ method, params });
      const result = method.startsWith("send") ? { message_id: nextId++, chat: { id: params.chat_id } } : true;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

function scripted(responses: { name: string; args: unknown }[]): Provider {
  let i = 0;
  return {
    id: "scripted",
    async *stream(): AsyncGenerator<ProviderEvent> {
      const r = responses[i++];
      if (!r) return void (yield { type: "done", stop: "end" });
      yield { type: "tool_start", id: `c${i}`, name: r.name };
      yield { type: "tool_args", id: `c${i}`, delta: JSON.stringify(r.args) };
      yield { type: "tool_end", id: `c${i}` };
      yield { type: "done", stop: "tool_use" };
    },
  };
}

test("bot: message → rich form → step-by-step answers → submit → model update edits the same message", async () => {
  const signup = basicCatalog.examples.find((e) => e.render.surface === "beta")!.render;
  const bot = new TelegramBot({
    api: new TelegramApi("TEST", base),
    provider: scripted([
      { name: "vak_render", args: signup },
      { name: "vak_update", args: { surface: "beta", nodes: [{ id: "root", type: "alert", props: { tone: "success", title: "Welcome, {/signup/name}!" }, children: [] }] } },
    ]),
    model: "m",
    editIntervalMs: 0,
  });
  const chat = { id: 42 };
  const msg = (text: string, id = 1) => ({ update_id: id, message: { message_id: id, chat, text } });
  const press = (data: string, id = 1) => ({ update_id: id, callback_query: { id: `cb${id}`, data, from: { id: 7 }, message: { message_id: 100, chat } } });
  const last = (method: string) => [...calls].reverse().find((c) => c.method === method)!;

  await bot.handle(msg("Let me sign up for the beta"));
  const rich = last("sendRichMessage");
  assert.equal(rich.params.chat_id, 42);
  const formToken = /<tg-button type="callback_data" data="([^"]+)" style="primary">Join the beta/.exec(rich.params.rich_message.html)![1]!;

  await bot.handle(press(formToken, 2));
  assert.equal(last("answerCallbackQuery").params.callback_query_id, "cb2");
  assert.match(last("sendMessage").params.text, /^1\/4 · Name/);
  assert.deepEqual(last("sendMessage").params.reply_markup, { force_reply: true });

  await bot.handle(msg("Ada", 3));
  assert.match(last("sendMessage").params.text, /^2\/4 · Email/);
  await bot.handle(msg("nope", 4));
  const lastTwo = calls.filter((c) => c.method === "sendMessage").slice(-2).map((c) => c.params.text);
  assert.equal(lastTwo[0], "Enter a valid email", "the error, then the same question again");
  assert.match(lastTwo[1], /^2\/4 · Email/);
  await bot.handle(msg("ada@example.com", 5));
  const roleKeyboard = last("sendMessage").params.reply_markup.inline_keyboard as { text: string; callback_data: string }[][];
  const designer = roleKeyboard.flat().find((b) => b.text === "Designer")!;
  assert.ok(designer.callback_data.length <= 64);
  await bot.handle(press(designer.callback_data, 6));
  const yes = (last("sendMessage").params.reply_markup.inline_keyboard as { text: string; callback_data: string }[][]).flat().find((b) => b.text === "Yes")!;
  await bot.handle(press(yes.callback_data, 7));

  const edit = last("editMessageText");
  assert.equal(edit.params.message_id, 100, "the same message is edited in place");
  assert.match(edit.params.rich_message.html, /<blockquote><b>Welcome, Ada!<\/b>/);
});
