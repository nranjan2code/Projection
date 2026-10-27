import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { type AddressInfo } from "node:net";
import { createServer } from "node:http";
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

test("an http server's event stream is read whatever its line endings, even split across chunks", async () => {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const msg = JSON.parse(body);
      if (!("id" in msg)) return void res.writeHead(202).end();
      const result = msg.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "crlf", version: "0" } } : { tools: [{ name: "find", inputSchema: { type: "object" } }] };
      const frame = `event: message\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\r\n\r\n`;
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Split between the CR and LF of the blank line, and keep the stream open as a real server may.
      res.write(frame.slice(0, -1));
      setTimeout(() => res.write(frame.slice(-1)), 10);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const c = new McpClient({ name: "crlf", transport: { kind: "http", url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp` } });
  try {
    assert.deepEqual((await c.listTools()).map((t) => t.name), ["find"]);
  } finally {
    c.close();
    server.closeAllConnections();
    server.close();
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
  assert.match((await list[1]!.execute({}, {}) as { text: string }).text, /declined/);
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

test("result observation sees transport status only after permission and cannot turn denied calls into evidence", async () => {
  let calls = 0;
  const seen: { text: string; isError?: boolean }[] = [];
  const source = { callTool: async () => { calls++; return { text: "An actual source excerpt", isError: true }; } };
  const tools = [{ name: "read", inputSchema: { type: "object" } }];
  const denied = agentTools(source, tools, { server: "s", label: "S", policy: () => "ask", approve: async () => "deny", observe: (_tool, _args, result) => seen.push(result) });
  await denied[0]!.execute({}, {}); assert.equal(calls, 0); assert.equal(seen.length, 0);
  const allowed = agentTools(source, tools, { server: "s", label: "S", policy: () => "allow", approve: async () => "deny", observe: (_tool, _args, result) => seen.push(result) });
  await allowed[0]!.execute({}, {}); assert.equal(calls, 1); assert.equal(seen[0]!.isError, true);
});


test("HTTP uses the negotiated protocol, resets sessions on reconnect and refuses redirects", async () => {
  let initialized = false, initializations = 0, redirected = 0;
  const server = createServer((req, res) => {
    if (req.url === "/redirected") { redirected++; res.writeHead(500).end(); return; }
    if (req.url === "/redirect") { res.writeHead(307, {location:"/redirected"}).end(); return; }
    let body="";req.on("data",d=>body+=d);req.on("end",()=>{
      const msg=JSON.parse(body);
      if(msg.method==="initialize") {
        initializations++; initialized=false;
        assert.equal(req.headers["mcp-session-id"],undefined);
        assert.equal(req.headers["mcp-protocol-version"],"2025-11-25");
        return void res.writeHead(200,{"content-type":"application/json","mcp-session-id":`session-${initializations}`}).end(JSON.stringify({jsonrpc:"2.0",id:msg.id,result:{protocolVersion:"2025-06-18",serverInfo:{name:"legacy",version:"1"},capabilities:{tools:{}}}}));
      }
      assert.equal(req.headers["mcp-protocol-version"],"2025-06-18");
      assert.equal(req.headers["mcp-session-id"],`session-${initializations}`);
      if(msg.method==="notifications/initialized"){initialized=true;res.writeHead(202).end();return;}
      assert.ok(initialized);
      res.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({jsonrpc:"2.0",id:msg.id,result:{tools:[]}}));
    });
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const c=new McpClient({name:"negotiated",transport:{kind:"http",url:url+"/mcp"}});
  const redirect=new McpClient({name:"redirect",transport:{kind:"http",url:url+"/redirect",headers:{"X-Api-Key":"fixture"}}});
  try {
    await c.listTools();c.close();await c.listTools();assert.equal(initializations,2);
    await assert.rejects(redirect.listTools());assert.equal(redirected,0);
  } finally { c.close();redirect.close();server.closeAllConnections();server.close(); }
});
