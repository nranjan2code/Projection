// Run the vak Telegram bot with long polling.
// Env (or .env): TELEGRAM_BOT_TOKEN; VAK_PROVIDER (default ollama); VAK_MODEL.
// The model's plan comes from the capability policy, like the playground.

import { choosePlan, hardenNetwork, loadEnvFile, ProfileCache, providersFromEnv, resolveProfile } from "@vak/providers";
import { runTelegram } from "./runner.ts";

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
// A long-running bot logs unexpected failures instead of dying on them.
process.on("unhandledRejection", (err) => console.error(`unhandled: ${(err as Error)?.message ?? String(err)}`));

console.error(`vak telegram bot · ${providerId}/${model} · plan ${plan.generation}/${plan.tier}/${plan.examples ? "examples" : "plain"}/${plan.authoring ?? "flat"}`);
await runTelegram({
  token,
  provider,
  model,
  plan,
  dataDir: `${repo}.vak/telegram`,
  signal: new AbortController().signal,
  log: (l) => console.error(l),
  onState: (state, detail) => {
    console.error(`${state}: ${detail}`);
    if (state === "error" && /rejected the bot token/.test(detail)) process.exit(1);
  },
});
