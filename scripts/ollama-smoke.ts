// Live check: can a local Ollama model drive the projection tools end to end?
// Usage: node scripts/ollama-smoke.ts [model] ["prompt"]
// Uses raw fetch against Ollama's /api/chat; the provider package will replace this.

import { basicCatalog, formatDiagnostics, SurfaceStore, systemPrompt, toolDefinitions } from "../packages/core/src/index.ts";

const model = process.argv[2] ?? "qwen3.5:4b-mlx";
const prompt = process.argv[3] ?? "Compare 3 hotels in Kyoto for a 1-week stay (price, rating, area) and let me book one with my name and dates.";
const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";

const store = new SurfaceStore(basicCatalog);
const tools = toolDefinitions(basicCatalog, { mode: "compact" }).map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

type Msg = { role: string; content: string; tool_calls?: { function: { name: string; arguments: unknown } }[]; tool_name?: string };
const messages: Msg[] = [
  { role: "system", content: systemPrompt(basicCatalog) },
  { role: "user", content: prompt },
];

for (let round = 1; round <= 3; round++) {
  const t0 = Date.now();
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, tools, stream: false, think: false, options: { temperature: 0.2 } }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { message: Msg };
  const msg = body.message;
  messages.push(msg);
  console.log(`\n— round ${round} (${((Date.now() - t0) / 1000).toFixed(1)}s) —`);
  if (!msg.tool_calls?.length) {
    console.log("no tool call; text:", msg.content.slice(0, 400));
    break;
  }
  let errors = 0;
  for (const call of msg.tool_calls) {
    const args = typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments;
    if (process.env.VAK_DEBUG) console.log("args:", JSON.stringify(args).slice(0, 3000));
    const diags = store.apply(call.function.name, args);
    errors += diags.filter((d) => d.severity === "error").length;
    const feedback = formatDiagnostics(diags);
    console.log(`${call.function.name} →`, feedback);
    messages.push({ role: "tool", tool_name: call.function.name, content: feedback });
  }
  if (errors === 0) break;
}

for (const s of store.list()) {
  const r = store.resolve(s.id)!;
  const outline = (n: NonNullable<typeof r.root>, depth = 0): string =>
    `${"  ".repeat(depth)}${n.type}${n.props.title ? ` "${n.props.title}"` : n.props.label ? ` "${n.props.label}"` : ""}${n.error ? ` !${n.error}` : ""}\n` +
    n.children.map((c) => outline(c, depth + 1)).join("");
  console.log(`\nsurface ${s.id} (v${s.version}):\n${r.root ? outline(r.root) : "(empty)"}`);
}
