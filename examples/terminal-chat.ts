// A model that answers with UI, in your terminal:
//   node examples/terminal-chat.ts                       (local Ollama, free)
//   VAK_MODEL=anthropic:claude-opus-5-5 node examples/terminal-chat.ts
// Keys come from the environment or the repo's .env.

import { createInterface } from "node:readline/promises";
import { loadEnvFile } from "@vak/providers";
import { createVak } from "@vak/kit";

loadEnvFile(new URL("../.env", import.meta.url).pathname);
const vak = createVak({ model: process.env.VAK_MODEL ?? "ollama:qwen3.5:4b-mlx" });
const rl = createInterface({ input: process.stdin, output: process.stdout });

for (;;) {
  const q = (await rl.question("\n› ")).trim();
  if (!q || q === "exit") break;
  const reply = await vak.ask(q);
  if (reply.text.trim()) console.log(`\n${reply.text.trim()}`);
  for (const s of reply.surfaces) console.log(`\n${vak.render("terminal", s.id, { width: process.stdout.columns })}`);
}
rl.close();
