# vak Projection

A projection engine that lets any LLM answer with **rich, interactive UI** (cards, dashboards, forms, tables, charts) instead of prose. The model describes the UI once, in a target-neutral spec. The engine repairs, validates and streams it onto any surface: web today, chat platforms next.

**Zero runtime dependencies.** Provider clients, the streaming parser, schema validation, the renderer and the server are all written here. The only dev dependencies are TypeScript (type checking only) and Node type definitions.


Docs: [SPECS.md](SPECS.md) (architecture), [AGENTS.md](AGENTS.md) (rules for contributors and coding agents), [HANDOVER.md](HANDOVER.md) (current state and next steps).

## How it works

```
LLM (Ollama · Anthropic · OpenAI · Gemini · any OpenAI-compatible)
  │  vak_render / vak_update / vak_remove   (or grammar-constrained JSON)
  ▼
@vak/providers   fetch adapters → agent loop → capability policy
  ▼
@vak/core        lenient streaming parser → repair pipeline → surface store
  ▼
@vak/web         <vak-surface> Web Component, adaptive layout
  │  form submit / button press
  └────────────► back to the model as an action
```

- **Spec (VPS):** id-addressed nodes, root first, children written inline (or referenced by id); a separate data model bound with `{/path}`; templated lists; named validation checks. See [SCOPE.md](SCOPE.md).
- **Catalog:** the single source of truth. It generates tool schemas and prompts, declares the repair vocabulary (component/prop aliases, enum spellings, defaults) and worked examples.
- **Repair, not rejection:** malformed or sloppy model output is normalized by general rules: schema-scored type inference, structural repair, alias resolution. Whatever can't be repaired goes back to the model as diagnostics.
- **Capability policy:** per model, declared facts from the provider API plus an optional cached calibration run choose the generation mode, catalog tier and prompt guidance, with stated reasons.
- **Adaptive layout:** `grid`, `split`, `stack`, `span`, `priority`, rendered with container queries so a surface fits whatever box it lands in.

Design research behind these choices: [STUDY.md](STUDY.md).

## Run it

Requires Node 24+ (it runs TypeScript directly; no build step).

```bash
npm install          # dev tooling only
npm test             # unit tests
npm run playground   # http://127.0.0.1:5177
```

Keys go in `.env` (gitignored; see `.env.example`). Ollama works locally with no key.

```bash
# Measure a model on the calibration suite (keys from .env)
node scripts/eval.ts ollama:qwen3.5:4b-mlx 2 tools
VAK_CASES=1 node scripts/eval.ts openai:<model> 1 tools   # small paid check
```

## Desktop app

`apps/desktop` is an everyday chat app built on the framework: saved chats, a model picker in the composer, a Settings page (models, providers with their own model lists, channels, themes), keys in the macOS Keychain, and a menu-bar mode that keeps Telegram answering while the window is closed. It is a separate product (Tauri 2 + Vite); the framework packages stay dependency-free.

Providers: Ollama, LM Studio, Anthropic, OpenAI, Gemini, Mistral, xAI, DeepSeek, Groq, Cerebras, OpenRouter, Together, Fireworks, Moonshot, Qwen, and any OpenAI-compatible server.

```bash
npm run desktop         # dev window (needs Rust and Node 24+)
npm run desktop:build   # release .app / installer, Node bundled
```

## Use vak from any MCP host

`packages/mcp` is an MCP server (stdio, no SDK). It speaks both the current protocol revision (per-request versions, `server/discover`) and the older `initialize` handshake. It gives the host model four tools:

| Tool | What it does |
|---|---|
| `vak_render` | show a surface (the result includes what the user now sees, as text) |
| `vak_update` | patch nodes or data on a surface |
| `vak_remove` | remove a surface or nodes |
| `vak_wait_action` | wait for the user to submit a form or press a button, and return the data |

Surfaces appear in the playground viewer, so start it first (`npm run playground`), then open `http://127.0.0.1:5177/?session=mcp`.

- **Claude Code:** this repo's `.mcp.json` registers the server; approve it when prompted.
- **Other hosts:** run `node --disable-warning=ExperimentalWarning /absolute/path/to/packages/mcp/src/main.ts` over stdio. Set `VAK_URL` and `VAK_SESSION` to change the viewer and session.

## Telegram

`packages/telegram` projects surfaces into Telegram **rich messages** (Bot API 10.1+). Containers flatten in priority order, tabs become collapsible `<details>`, and tables and lists are native. Consecutive stats group into a compact table, and charts become data tables. Buttons are inline buttons. Forms become a conversation: one question per message, choices as buttons, yes/no for checkboxes, typed replies for text, each answer checked with the same rules as the web. When the model updates a surface, its message is edited in place, and every action goes back to the model.

```
TELEGRAM_BOT_TOKEN=…   # in .env, from @BotFather
npm run telegram       # long polling; VAK_PROVIDER / VAK_MODEL pick the model
```

Chats are saved in `.vak/telegram/`, so a restarted bot keeps its views, buttons and forms in progress.

## Slack and Discord

`packages/slack` projects a surface into one Block Kit message: a header, sections in mrkdwn, stats as section fields, native table blocks (charts become tables), and button rows. A form shows its fields and opens as a **modal** with Slack's own inputs (selects, date pickers, checkboxes); submitted values are read back through the same field rules, and problems return as per-field errors.

`packages/discord` projects a surface into one **Components V2** message: a container of text displays, separators, media and button rows. Tables and charts are aligned monospace blocks, since Discord markdown has none. A form opens as modals of up to 5 fields (selects for choices), paged when longer.

Both keep within each platform's limits (blocks, components, characters) and cut with a note rather than send something the platform rejects. Model text is escaped, mentions are disabled, and only `https` / `mailto` links survive. The bots that send these and route clicks are not built yet.

## Benchmark

`npm run bench -- run <provider:model> --runs 2 --save` runs 30 scenarios, single- and multi-turn, and scores them with structural checks plus an optional semantic judge (`--judge provider:model`). Results come with 95% intervals. Each record is saved as soon as it finishes, so a stopped run keeps what it measured.

- `npm test` replays the recorded model outputs (cassettes) through the current engine and fails on any regression.
- `npm run bench:gate` compares a live run with the stored baseline and fails only on a statistically significant drop.
- `--plan generation/tier/examples[/inline]` pins a configuration, for A/B tests. Writing children inline instead of as a flat id list raised the 4B model's mean check score from 75% to 90% (paired difference +14 points, 95% CI +3 to +26, bench v2, one run per scenario), so tool-calling plans now default to inline.

## Layout

| Path | What |
|---|---|
| `packages/core` | spec, catalog, parser, normalizer, surface store, events |
| `packages/providers` | provider adapters, agent loop, calibration, policy, profiles |
| `packages/web` | `<vak-surface>` renderer, charts, markdown, client |
| `packages/mcp` | MCP server exposing vak tools over stdio |
| `packages/telegram` | Telegram projector, form flow, Bot API client, bot |
| `packages/slack` | Block Kit projector, modal forms |
| `packages/discord` | Components V2 projector, modal forms |
| `packages/bench` | scenarios, rubric, runner, replay, stats, judge |
| `packages/host` | HTTP + SSE host for the agent loop: sessions, persistence, token auth |
| `apps/playground` | dev server + chat UI + `/api/project` for direct projection |
| `apps/desktop` | desktop app: Tauri 2 shell, Vite UI, engine as a Node sidecar |
| `scripts` | eval and smoke tests |
