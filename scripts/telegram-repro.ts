// Reproduce one Telegram turn offline and print the model's raw tool calls.
// Usage: node scripts/telegram-repro.ts "<request>"
import { basicCatalog, projectText, SurfaceStore } from "@vak/core";
import { choosePlan, hardenNetwork, loadEnvFile, type Message, ProfileCache, providersFromEnv, resolveProfile, runAgent } from "@vak/providers";
import { telegramProfile } from "@vak/telegram";

hardenNetwork();
const repo = new URL("../", import.meta.url).pathname;
loadEnvFile(`${repo}.env`);
const model = process.env.VAK_MODEL ?? "qwen3.5:4b-mlx";
const provider = providersFromEnv().find((p) => p.id === "ollama")!.make();
const plan = choosePlan(await resolveProfile("ollama", provider, model, new ProfileCache(`${repo}.vak/models.json`)));
const store = new SurfaceStore(basicCatalog);
const messages: Message[] = [{ role: "user", content: process.argv[2] ?? "Compare three hotels in Kyoto and let me book one" }];
await runAgent({ provider, model, store, messages, profile: telegramProfile, plan, emit: (e) => e.type === "error" && console.error("error:", e.message) });
for (const m of messages) {
  for (const c of m.toolCalls ?? []) console.log(`\n=== ${c.name}\n${c.arguments}`);
  if (m.role === "tool") console.log(`--- result${m.isError ? " (error)" : ""}: ${m.content.slice(0, 600)}`);
}
for (const s of store.list()) console.log(`\n### ${s.id}\n${projectText(store.resolve(s.id)!)}`);
