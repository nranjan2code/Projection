// Run the vak Telegram bot with long polling.
// Env (or .env): TELEGRAM_BOT_TOKEN; VAK_PROVIDER (default ollama); VAK_MODEL.
// The model's plan comes from the capability policy, like the playground.

import { choosePlan, loadEnvFile, ProfileCache, providersFromEnv, resolveProfile } from "@vak/providers";
import { TelegramApi } from "./api.ts";
import { TelegramBot } from "./bot.ts";

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
const bot = new TelegramBot({ api, provider, model, plan, log: (l) => console.error(l) });
console.error(`vak telegram bot · ${providerId}/${model} · plan ${plan.generation}/${plan.tier}/${plan.examples ? "examples" : "plain"}`);

let offset = 0;
for (;;) {
  try {
    const updates = await api.getUpdates(offset, 30);
    for (const u of updates) {
      offset = u.update_id + 1;
      void bot.handle(u);
    }
  } catch (err) {
    console.error(`polling: ${(err as Error).message}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
