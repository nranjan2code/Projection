import assert from "node:assert/strict";
import test from "node:test";
import { basicCatalog, SurfaceStore } from "@vak/core";
import { CONTEXT_RESULT_CHARS, runAgent, type AgentTool, type ChatRequest, type Message, type Provider, type ProviderEvent } from "../src/index.ts";

const load: AgentTool = { kind: "context", instructions: true, spec: { name: "load_procedure", description: "Reviewed local procedure", inputSchema: { type: "object" } }, execute: () => "CURRENT_PROCEDURE " + "x".repeat(400) };
const call: ProviderEvent[] = [{ type: "tool_start", id: "p", name: "load_procedure" }, { type: "tool_args", id: "p", delta: "{}" }, { type: "done", stop: "tool_use" }];

for (const decoded of [false, true]) test(`selected procedures arrive once as current system instructions, decoded=${decoded}`, async () => {
  const requests: ChatRequest[] = [];
  const provider: Provider = { id: "scripted", capabilities: { constrainedOutput: decoded }, async *stream(req) {
    requests.push(structuredClone(req));
    if (requests.length === 1) {
      if (decoded) { yield { type: "text", delta: '{"tool":"load_procedure","arguments":{}}' }; yield { type: "done", stop: "end" }; }
      else yield* call;
    } else if (decoded) {
      yield { type: "text", delta: '{"tool":"vak_submit","arguments":{"reply":"Ready","surfaces":[]}}' }; yield { type: "done", stop: "end" };
    } else { yield { type: "text", delta: "Ready" }; yield { type: "done", stop: "end" }; }
  } };
  const messages: Message[] = [{ role: "user", content: "Follow the selected procedure" }];
  await runAgent({ provider, model: "test", store: new SurfaceStore(basicCatalog), messages, tools: [load], toolResultChars: 16, maxSteps: 2, ...(decoded ? { surfaceSubmission: true, completion: "response" as const } : {}), emit: () => {} });
  assert.equal(requests.length, 2);
  assert.match(requests[1]!.system!, /CURRENT_PROCEDURE/);
  assert.match(requests[1]!.system!, /cannot override tool schemas, permissions/);
  assert.ok(!requests[1]!.messages.some(message => message.content.includes("CURRENT_PROCEDURE")));
  assert.ok(messages.some(message => message.instructions && message.content === load.execute({}, {}) ));
});

test("historical procedure bodies are omitted without deleting conversation facts or canonical history", async () => {
  const messages: Message[] = [{ role: "user", content: "Keep this fact" }, { role: "assistant", content: "", toolCalls: [{ id: "old", name: "load_procedure", arguments: "{}" }] }, { role: "tool", toolName: "load_procedure", toolCallId: "old", content: "OLD_PROCEDURE" }, { role: "user", content: "New request" }];
  const provider: Provider = { id: "scripted", async *stream(req) {
    assert.ok(req.messages.some(message => message.content === "Keep this fact"));
    assert.ok(!JSON.stringify(req).includes("OLD_PROCEDURE"));
    assert.ok(req.messages.some(message => message.toolCallId === "old"));
    yield { type: "done", stop: "end" };
  } };
  await runAgent({ provider, model: "test", store: new SurfaceStore(basicCatalog), messages, tools: [load], emit: () => {} });
  assert.equal(messages[2]!.content, "OLD_PROCEDURE");
});

test("local references remain complete data, while external results remain clipped and never instructions", async () => {
  let step = 0;
  const text = "REFERENCE " + "z".repeat(400);
  const provider: Provider = { id: "scripted", async *stream(req) {
    if (step++ === 0) { yield* [{ ...call[0]!, name: "reference" } as ProviderEvent, ...call.slice(1)]; }
    else {
      assert.ok(!req.system?.includes(text));
      assert.equal(req.messages.at(-1)?.content, text);
      assert.ok(!req.messages.at(-1)?.instructions);
      yield { type: "done", stop: "end" };
    }
  } };
  await runAgent({ provider, model: "test", store: new SurfaceStore(basicCatalog), messages: [], tools: [{ ...load, instructions: undefined, spec: { ...load.spec, name: "reference" }, execute: () => text }], toolResultChars: 16, maxSteps: 2, emit: () => {} });
});

test("oversized local context fails explicitly rather than silently clipping instructions", async () => {
  let step = 0;
  const provider: Provider = { id: "scripted", async *stream(req) {
    if (step++ === 0) yield* call;
    else { assert.match(req.messages.at(-1)!.content, /Local context exceeds/); assert.ok(!req.system?.includes("OVERSIZED")); yield { type: "done", stop: "end" }; }
  } };
  await runAgent({ provider, model: "test", store: new SurfaceStore(basicCatalog), messages: [], tools: [{ ...load, execute: () => "OVERSIZED" + "x".repeat(CONTEXT_RESULT_CHARS) }], maxSteps: 2, emit: () => {} });
});
