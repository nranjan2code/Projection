# vak Projection

A projection engine that lets any LLM answer with **rich, interactive UI** (cards, dashboards, forms, tables, charts) instead of prose. The model describes the UI once, in a target-neutral spec. The engine repairs, validates and streams it onto any surface: web today, chat platforms next.

**Zero runtime dependencies.** Provider clients, the streaming parser, schema validation, the renderer and the server are all written here. The only dev dependencies are TypeScript (type checking only) and Node type definitions.

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

- **Spec (VPS):** flat, id-addressed nodes, root first; a separate data model bound with `{/path}`; templated lists; named validation checks. See [SCOPE.md](SCOPE.md).
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

## Benchmark

`npm run bench -- run <provider:model> --runs 2 --save` runs 30 scenarios, single- and multi-turn, and scores them with structural checks plus an optional semantic judge (`--judge provider:model`). Results come with 95% intervals. Each record is saved as soon as it finishes, so a stopped run keeps what it measured.

- `npm test` replays the recorded model outputs (cassettes) through the current engine and fails on any regression.
- `npm run bench:gate` compares a live run with the stored baseline and fails only on a statistically significant drop.

## Layout

| Path | What |
|---|---|
| `packages/core` | spec, catalog, parser, normalizer, surface store, events |
| `packages/providers` | provider adapters, agent loop, calibration, policy, profiles |
| `packages/web` | `<vak-surface>` renderer, charts, markdown, client |
| `packages/mcp` | MCP server exposing vak tools over stdio |
| `packages/telegram` | Telegram projector, form flow, Bot API client, bot |
| `packages/bench` | scenarios, rubric, runner, replay, stats, judge |
| `apps/playground` | dev server + chat UI + `/api/project` for direct projection |
| `scripts` | eval and smoke tests |
