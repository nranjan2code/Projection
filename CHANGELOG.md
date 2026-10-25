# Changelog

What changed, newest first. Nothing is released yet: every package is `0.1.0` and unpublished. Details of each step are in [HANDOVER.md](HANDOVER.md); the architecture is in [SPECS.md](SPECS.md).

## 2026-10-25: desktop FinOps

- App-only FinOps in Settings, shared with the playground: duration, context composition, repeated conversation, output shape, provider tokens/cache usage and estimated API cost charts.
- Per-turn drilldown, chat filter, CSV export and editable per-model rates. Numeric telemetry is stored locally; prompt and tool content is not copied into the ledger.
- Historical sessions are reconstructed; unavailable usage and paid spend stay unknown. Pricing, accounting and these charts remain in `apps/desktop`, outside the projection framework.
- Validated with accounting/concurrency tests, full test suite, typecheck, UI build and WebKit layout/turn-selection checks.

## 2026-10-25, evening: framework round (`cf68562`)

- **Local interactions:** web tables sort, filter and page in the projector, with no model turn. Lists and card grids filter. `totals: true` adds a computed totals row; a total the model wrote is replaced.
- **One interface:** the playground runs the desktop app's server and UI. Surfaces projected from outside (MCP) appear live, and their actions reach the outside agent.
- **MCP client and integrations:**
  - `@vak/mcp/client` (stdio, Streamable HTTP, no SDK).
  - Security: per-tool Allow/Ask/Off policies; approvals in the chat; untrusted-output wrapping; a minimal environment for servers.
  - Built-in tools: web fetch (SSRF-checked on every hop) and time.
  - A marketplace of pinned servers: Files, Memory, Brave Search, GitHub, Notion, Context7. You can also add your own server, marked unverified.
- **Components:** timeline, steps, code, map and gallery, lowered for targets that don't draw them.
- **Targets:** Markdown, terminal (ANSI) and HTML email (`@vak/email`).
- **Packaging:** `scripts/build-packages.ts`, `@vak/kit` (`createVak()`), and `examples/`.
- **Speed:** prompt caching (Anthropic, OpenAI), Ollama `keep_alive`, a turn profiler, and an elapsed-time status in the app.
- **App:** new icon (a Vakyartha sibling), sidebar collapse, WebKit layout fixes, UI errors in the engine log, the `webkit-check` tool, npm bundled.
- **Docs:** SECURITY.md, the desktop README, this changelog.

## 2026-10-25, afternoon: desktop everyday driver (`406730a`)

- **Host hardening:** JSON-only bodies, Origin and Host checks, a constant-time token check; a session index and eviction; renaming chats.
- **Providers:** 11 OpenAI-compatible labs as declared presets; Settings generated from the registry; each provider's own model list.
- **Desktop:**
  - Keys in the Keychain, an engine log, a context window.
  - Tray, close-to-background, single instance, launch at login.
  - Telegram as an in-app channel; Settings as a full page with themes; desktop-style right-click.

## 2026-10-25, midday: desktop app (`93681cd`)

- `@vak/host` extracted from the playground (sessions, persistence, token auth).
- `apps/desktop`: Tauri 2 shell, Vite UI, the engine as a Node sidecar; a minimal chat UI with a model picker.

## 2026-10-24 to 2026-10-25: engine, bench and channels

- **Engine:**
  - A lenient streaming parser, catalog-declared repairs, structure repair, lint, resolve.
  - Inline authoring (A/B: +14 points of check score on the 4B).
  - A history window for long chats; repairs from live 4B output (closers, embedded JSON, bindings, empty frames).
- **Bench:** 30 scenarios, rubrics, Wilson intervals, cassettes and the replay gate.
- **Projectors:** web, text, Telegram (rich messages, conversational forms, saved chats), Slack (Block Kit, modals), Discord (Components V2, paged modals).
- **MCP server** (`@vak/mcp`), the capability policy and calibration, the playground.
