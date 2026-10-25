import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { vakInstructions, vakTools } from "../src/vak-tools.ts";

const MAIN = new URL("../src/main.ts", import.meta.url).pathname;
const META = (version = "2026-07-28") => ({
  "io.modelcontextprotocol/protocolVersion": version,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
});

// A stub of the playground's two endpoints.
let stub: Server;
let stubUrl = "";
const projected: unknown[] = [];
before(async () => {
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/project") {
        projected.push(JSON.parse(body));
        return res.end(JSON.stringify({ result: "ok", diagnostics: [], viewers: 1, surface: "s", text: "# Hello\n[Button: Go → go]", url: "http://viewer/?session=t" }));
      }
      if (req.url?.startsWith("/api/actions")) {
        const q = new URL(req.url, "http://x").searchParams;
        return res.end(JSON.stringify({ actions: q.get("surface") === "s" ? [{ action: "go", surface: "s", source: "b", data: {} }] : [] }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  stubUrl = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
});
after(() => stub.close());

/** Spawn the server; send requests; collect every stdout line. */
function client(url = stubUrl) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", MAIN], {
    env: { ...process.env, VAK_URL: url, VAK_SESSION: "t" },
  });
  const lines: string[] = [];
  const pending = new Map<number, (m: any) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    lines.push(line);
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  });
  let next = 1;
  return {
    lines,
    request(method: string, params?: unknown): Promise<any> {
      const id = next++;
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n");
      return new Promise((resolve) => pending.set(id, resolve));
    },
    notify(method: string) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
    },
    close: () => child.kill(),
  };
}

test("legacy host: initialize handshake, then tools without per-request _meta", async () => {
  const c = client();
  const init = await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.result.serverInfo, { name: "vak", version: "0.1.0" });
  assert.match(init.result.instructions, /vak_wait_action/);
  c.notify("notifications/initialized");
  const list = await c.request("tools/list");
  assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ["vak_render", "vak_update", "vak_remove", "vak_wait_action"]);
  assert.equal(list.result.resultType, undefined, "legacy results carry no resultType");
  assert.doesNotMatch(JSON.stringify(list.result.tools), /"aliases"|"enumAliases"/, "wire schemas only");
  const call = await c.request("tools/call", { name: "vak_render", arguments: { surface: "s", nodes: [{ id: "root", type: "button", props: { label: "Go", action: "go" } }] } });
  assert.match(call.result.content[0].text, /The user now sees \(http:\/\/viewer\/\?session=t\):\n# Hello/);
  assert.equal(call.result.isError, undefined);
  assert.deepEqual((projected.at(-1) as { session: string; tool: string }).session, "t");
  c.close();
});

test("modern host: discover, per-request versions, version and _meta errors", async () => {
  const c = client();
  const d = await c.request("server/discover", { _meta: META() });
  assert.equal(d.result.resultType, "complete");
  assert.ok(d.result.supportedVersions.includes("2026-07-28"));
  assert.deepEqual(d.result.capabilities, { tools: {} });
  assert.deepEqual(d.result._meta["io.modelcontextprotocol/serverInfo"], { name: "vak", version: "0.1.0" });

  const list = await c.request("tools/list", { _meta: META() });
  assert.equal(list.result.resultType, "complete");
  assert.equal(list.result.tools.length, 4);

  const old = await c.request("tools/list", { _meta: META("1900-01-01") });
  assert.equal(old.error.code, -32022);
  assert.deepEqual(old.error.data.requested, "1900-01-01");
  assert.ok(old.error.data.supported.includes("2026-07-28"));

  const bare = await c.request("tools/list");
  assert.equal(bare.error.code, -32602, "modern requests must carry _meta");

  const wait = await c.request("tools/call", { name: "vak_wait_action", arguments: { surface: "s", timeoutSeconds: 1 }, _meta: META() });
  assert.equal(wait.result.resultType, "complete");
  assert.equal(wait.result.structuredContent.actions[0].action, "go");
  assert.match(wait.result.content[0].text, /The user acted/);

  const unknown = await c.request("tools/call", { name: "nope", _meta: META() });
  assert.equal(unknown.error.code, -32602);

  for (const line of c.lines) assert.doesNotThrow(() => JSON.parse(line), "stdout carries only JSON-RPC");
  c.close();
});

test("an unreachable viewer is a readable tool error, not a protocol failure", async () => {
  const c = client("http://127.0.0.1:9");
  const r = await c.request("tools/call", { name: "vak_render", arguments: { surface: "x", nodes: [] }, _meta: META() });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /npm run playground/);
  c.close();
});

test("MCP clients are taught inline children by default; flat on request", () => {
  // The instructions used to say "nodes is a FLAT list" while the playground and
  // Telegram teach inline (the A/B default). The engine reads both styles.
  const children = (authoring?: "flat" | "inline") =>
    JSON.stringify((vakTools({ url: "http://x", session: "s", authoring })[0]!.inputSchema as { properties: { nodes: { items: { properties: { children: unknown } } } } }).properties.nodes.items.properties.children);
  assert.match(vakInstructions({ url: "http://x", session: "s" }), /Write each child node directly inside its parent's "children" array/);
  assert.doesNotMatch(vakInstructions({ url: "http://x", session: "s" }), /FLAT list/);
  assert.match(children(), /a child node/);
  assert.match(vakInstructions({ url: "http://x", session: "s", authoring: "flat" }), /nodes is a FLAT list/);
  assert.match(children("flat"), /ids of child nodes/);
});
