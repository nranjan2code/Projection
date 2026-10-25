import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { agentTools, defaultDecision, htmlText, McpClient, MAX_TOOL_OUTPUT, safeFetch, toolName, untrusted } from "../src/index-client.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

test("a stdio server starts with a minimal environment: our API keys never reach it", async () => {
  process.env.OPENAI_API_KEY = "sk-must-not-leak";
  const sandbox = mkdtempSync(path.join(tmpdir(), "vak-mcp-"));
  const c = new McpClient({ name: "echo", transport: { kind: "stdio", command: process.execPath, args: [path.join(here, "fixtures/echo-server.mjs")], env: { ECHO_TOKEN: "t" }, sandboxDir: sandbox } });
  try {
    const tools = await c.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["env", "write"]);
    const res = await c.callTool("env", {});
    assert.doesNotMatch(res.text, /OPENAI_API_KEY/);
    assert.match(res.text, /ECHO_TOKEN/);
    assert.match(res.text, new RegExp(`home=${sandbox.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  } finally {
    c.close();
    delete process.env.OPENAI_API_KEY;
  }
});

test("default policy: local reads allowed; changes and the open internet ask", () => {
  const t = (annotations: object) => ({ name: "x", inputSchema: {}, annotations });
  assert.equal(defaultDecision(t({ readOnlyHint: true })), "allow");
  assert.equal(defaultDecision(t({ readOnlyHint: true, openWorldHint: true })), "ask");
  assert.equal(defaultDecision(t({ destructiveHint: true, readOnlyHint: true })), "ask");
  assert.equal(defaultDecision(t({})), "ask");
});

test("tool output is labelled as data and capped", () => {
  const out = untrusted("Files", "x".repeat(MAX_TOOL_OUTPUT + 10));
  assert.match(out, /not instructions/);
  assert.match(out, /10 more characters cut/);
  assert.equal(toolName("my files!", "read/file"), "my_files___read_file");
});

test("off tools are never offered; ask waits for approval and a no is reported, not run", async () => {
  const ran: string[] = [];
  const source = { callTool: async (name: string) => (ran.push(name), { text: "done", isError: false }) };
  const tools = [
    { name: "read", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "write", inputSchema: { type: "object" } },
    { name: "wipe", inputSchema: { type: "object" } },
  ];
  const policies: Record<string, "allow" | "ask" | "off"> = { read: "allow", write: "ask", wipe: "off" };
  const asked: string[] = [];
  const list = agentTools(source, tools, { server: "s", label: "S", policy: (t) => policies[t.name]!, approve: async (req) => (asked.push(req.tool), "deny") });
  assert.deepEqual(list.map((t) => t.spec.name), ["s__read", "s__write"]);
  assert.match(String(await list[0]!.execute({}, {})), /tool_output[\s\S]*done/);
  assert.match(String(await list[1]!.execute({}, {})), /declined/);
  assert.deepEqual(ran, ["read"]);
  assert.deepEqual(asked, ["write"]);
});

// The classic SSRF: a public URL that redirects to the cloud metadata address.
test("web fetch checks every redirect hop, not only the first URL", async () => {
  const fetcher = (async (url: string) => (url === "https://public.example/" ? new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } }) : new Response("secret", { headers: { "content-type": "text/plain" } }))) as typeof fetch;
  const check = async (u: string) => new URL(u).hostname !== "169.254.169.254";
  await assert.rejects(safeFetch("https://public.example/", undefined, fetcher, check), /not a public https address/);
});

test("pages are read as text: no scripts or styles, links kept", () => {
  const { title, text } = htmlText('<title>Hi</title><style>x{}</style><script>alert(1)</script><p>Hello <a href="/a">there</a></p>', "https://x.example/");
  assert.equal(title, "Hi");
  assert.match(text, /Hello there \(https:\/\/x\.example\/a\)/);
  assert.doesNotMatch(text, /alert|x\{\}/);
});
