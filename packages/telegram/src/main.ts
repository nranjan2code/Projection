// Run the vak Telegram bot with long polling.
// Env (or .env): TELEGRAM_BOT_TOKEN; VAK_PROVIDER (default ollama); VAK_MODEL.
// The model's plan comes from the capability policy, like the playground.

import { choosePlan, hardenNetwork, loadEnvFile, ProfileCache, providersFromEnv, resolveProfile } from "@vak/providers";
import { TelegramApi } from "./api.ts";
import { TelegramBot } from "./bot.ts";

hardenNetwork();
const repo = new URL("../../../", import.meta.url).pathname;
loadEnvFile(`${repo}.env`);
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in .env (create a bot with @BotFather).");
  process.exit(1);
}
const providerId = process.env.VAK_PROVIDER ?? "ollama";
const model = process.env.VAK_MODEL ?? "qwen3.5:4b-mlx";
const entry = providersFromEnv().find((p) => p.id === providerId);
if (!entry?.available) {
  console.error(`provider ${providerId} unavailable${entry?.reason ? ` (${entry.reason})` : ""}`);
  process.exit(1);
}
const provider = entry.make();
const profile = await resolveProfile(providerId, provider, model, new ProfileCache(`${repo}.vak/models.json`));
const plan = choosePlan(profile);
const api = new TelegramApi(token);
/** Confirm the token and the connection before polling, with a few retries. */
async function whoAmI(): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await api.call<{ username: string }>("getMe", {})).username;
    } catch (err) {
      const message = (err as Error).message;
      if (/401|Unauthorized/i.test(message)) throw new Error("Telegram rejected the token (401): check TELEGRAM_BOT_TOKEN in .env");
      if (attempt >= 3) throw new Error(`cannot reach api.telegram.org: ${(err as { cause?: { code?: string } }).cause?.code ?? message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}
let username: string;
try {
  username = await whoAmI();
} catch (err) {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
}
const bot = new TelegramBot({ api, provider, model, plan, log: (l) => console.error(l), transcriptDir: `${repo}.vak/telegram`, stateDir: `${repo}.vak/telegram` });
console.error(`vak telegram bot @${username} · ${providerId}/${model} · plan ${plan.generation}/${plan.tier}/${plan.examples ? "examples" : "plain"}/${plan.authoring ?? "flat"}`);

// A long-running bot logs unexpected failures instead of dying on them.
process.on("unhandledRejection", (err) => console.error(`unhandled: ${(err as Error)?.message ?? String(err)}`));

let offset = 0;
for (;;) {
  try {
    const updates = await api.getUpdates(offset, 30);
    for (const u of updates) {
      offset = u.update_id + 1;
      const what = u.message?.text ? `message "${u.message.text.slice(0, 60)}"` : u.callback_query ? "button press" : "update";
      console.error(`← chat ${u.message?.chat.id ?? u.callback_query?.message?.chat.id}: ${what}`);
      void bot.handle(u);
    }
  } catch (err) {
    console.error(`polling: ${(err as Error).message}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
