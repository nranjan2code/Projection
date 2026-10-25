// A tiny MCP server over stdio for tests: one read-only tool that reports
// which environment variables it was started with.
import { createInterface } from "node:readline";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1" } } });
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "env", description: "env names", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }, { name: "write", description: "writes", inputSchema: { type: "object" } }] } });
  else if (msg.method === "tools/call") send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: msg.params.name === "env" ? Object.keys(process.env).sort().join(",") + " home=" + process.env.HOME : "wrote" }] } });
});
