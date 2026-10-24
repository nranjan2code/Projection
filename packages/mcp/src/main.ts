#!/usr/bin/env node
// vak MCP server entry point (stdio).
// Env: VAK_URL (default http://127.0.0.1:5177), VAK_SESSION (default "mcp").

import { McpServer } from "./server.ts";
import { vakInstructions, vakTools } from "./vak-tools.ts";

const opts = {
  url: (process.env.VAK_URL ?? "http://127.0.0.1:5177").replace(/\/$/, ""),
  session: process.env.VAK_SESSION ?? "mcp",
};

new McpServer({ name: "vak", version: "0.1.0" }, vakInstructions(opts), vakTools(opts)).serveStdio();
