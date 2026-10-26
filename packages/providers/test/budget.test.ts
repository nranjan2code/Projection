import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, SurfaceStore, type AgentEvent } from "@vak/core";
import { runAgent, type AgentTool, type Message, type Provider, type ProviderEvent } from "../src/index.ts";

/** A provider that plays one scripted reply per step and records what each step was offered. */
function scripted(replies: ((step: number) => ProviderEvent[])): { provider: Provider; seen: { tools: string[]; last: string }[] } {
  const seen: { tools: string[]; last: string }[] = [];
  const provider: Provider = {
    id: "scripted",
    async *stream(req) {
      seen.push({ tools: (req.tools ?? []).map((t) => t.name), last: String(req.messages.at(-1)?.content ?? "") });
      yield* replies(seen.length - 1);
    },
  };
  return { provider, seen };
}
const call = (id: string, name: string, args = "{}"): ProviderEvent[] => [{ type: "tool_start", id, name }, { type: "tool_args", id, delta: args }, { type: "done", stop: "tool_use" }];
const answer = (text: string): ProviderEvent[] => [{ type: "text", delta: text }, { type: "done", stop: "end" }];
const search = (execute: AgentTool["execute"]): AgentTool => ({ spec: { name: "search", description: "Search", inputSchema: { type: "object" } }, execute });

test("integration rounds draw on their own budget, then a closing round answers without them", async () => {
  let runs = 0;
  const { provider, seen } = scripted((step) => (step < 3 ? call(`c${step}`, "search", `{"q":${step}}`) : answer("Summary from the results")));
  const events: AgentEvent[] = [];
  const result = await runAgent({ provider, model: "m", messages: [{ role: "user", content: "Compare things" }], store: new SurfaceStore(basicCatalog), maxSteps: 1, toolRounds: 3, emit: (e) => events.push(e), tools: [search(() => `result ${++runs}`)] });
  assert.deepEqual(result, { stop: "end", limit: "tools" });
  assert.equal(runs, 3);
  // Three gathering rounds and the answer, though maxSteps is 1.
  assert.equal(seen.length, 4);
  assert.ok(seen[2]!.tools.includes("search"));
  assert.ok(!seen[3]!.tools.includes("search") && seen[3]!.tools.length > 0);
  assert.match(seen[3]!.last, /tool budget is spent/);
  assert.deepEqual(events.at(-1), { type: "run_end", stop: "end", limit: "tools", usage: undefined });
});

test("a turn that never answers stops at its step budget and says so", async () => {
  const { provider } = scripted(() => call("v", "vak_render", "{"));
  const result = await runAgent({ provider, model: "m", messages: [{ role: "user", content: "Show" }], store: new SurfaceStore(basicCatalog), maxSteps: 2, emit: () => {} });
  assert.deepEqual(result, { stop: "max_steps", limit: "steps" });
});

test("the model sees a clipped integration result; the event keeps it whole", async () => {
  const long = "x".repeat(500);
  const { provider } = scripted((step) => (step === 0 ? call("c", "search") : answer("ok")));
  const messages: Message[] = [{ role: "user", content: "Find" }];
  const events: AgentEvent[] = [];
  await runAgent({ provider, model: "m", messages, store: new SurfaceStore(basicCatalog), toolResultChars: 100, emit: (e) => events.push(e), tools: [search(() => long)] });
  const seen = messages.find((m) => m.role === "tool")!.content;
  assert.ok(seen.startsWith("x".repeat(100)) && seen.includes("100 of 500 characters"));
  assert.equal(events.find((e) => e.type === "tool_end")?.type === "tool_end" && (events.find((e) => e.type === "tool_end") as { result: string }).result, long);
});

test("an identical call that already failed this turn is not run again", async () => {
  let runs = 0;
  const { provider } = scripted((step) => (step < 2 ? call(`c${step}`, "search", `{"q":"same"}`) : answer("done")));
  const messages: Message[] = [{ role: "user", content: "Find" }];
  await runAgent({ provider, model: "m", messages, store: new SurfaceStore(basicCatalog), emit: () => {}, tools: [search(() => { runs++; throw new Error("timeout"); })] });
  assert.equal(runs, 1);
  assert.match(messages.filter((m) => m.role === "tool")[1]!.content, /already failed/);
});
