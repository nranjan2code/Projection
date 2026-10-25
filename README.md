# vak Projection

**Let language models answer with interfaces.**

vak turns model output into cards, dashboards, tables, charts, forms and buttons. The model describes an interface once using the Vak Projection Spec (VPS); the engine parses, repairs and validates it, then projects it onto the web, desktop, chat platforms or text. Button presses and form submissions go back to the model so the interface can evolve through a conversation.

Built for local models first, with Ollama `qwen3.5:4b-mlx` as the primary target. Hosted providers work too.

[Quick start](#quick-start) · [Use in code](#use-in-code) · [Supported surfaces](#supported-surfaces) · [Documentation](#documentation) · [MIT license](LICENSE)

## Why vak

- **One spec, multiple surfaces.** Share interface structure, data bindings and validation across projectors.
- **Repair before retry.** A lenient streaming parser and catalog-driven normalization recover malformed model output before asking the model to try again.
- **Interactive answers.** Forms validate inputs; buttons carry context; web tables sort, filter and page locally without another model call.
- **Local and hosted models.** Provider adapters use `fetch`, with model capabilities guiding generation mode and prompt contracts.
- **No third-party runtime dependencies in the framework.** `packages/*` uses Node 24 built-ins, browser APIs and `fetch`. The separate desktop app uses Tauri and Vite; the playground serves that app’s UI.
- **Regression checks from real output.** Recorded model calls replay through the current engine as part of the test suite.

## Quick start

You need **Node.js 24+**, npm, and a running model provider. For local use, start Ollama with `qwen3.5:4b-mlx` available, or select another installed model in the app. Local Ollama inference needs no API key.

```bash
git clone https://github.com/nranjan2code/Projection.git
cd Projection
npm ci
npm run playground
```

Open [http://127.0.0.1:5177](http://127.0.0.1:5177), choose a model, and try:

> Compare three laptops for a student, with a table and a button to choose each one.

The playground is the desktop app’s UI in a browser, including saved chats, model settings, integrations and interactive surfaces. Its UI builds automatically when you start it; the framework runs directly from TypeScript sources.

For hosted providers, configure credentials in **Settings → Providers**, or copy [`.env.example`](.env.example) to `.env` and fill in the relevant keys. Hosted inference may incur provider charges. Keep `.env` and the `.vak/` data directory private.

## Use in code

The workspace package `@vak/kit` combines the engine, a provider and text projectors:

```ts
import { createVak } from "@vak/kit";

const vak = createVak({ model: "ollama:qwen3.5:4b-mlx" });

await vak.ask("Compare three laptops for a student");
console.log(vak.render("terminal"));
// Also available: vak.render("markdown"), vak.render("text"), vak.email().
```

This example uses the local workspace after `npm ci`. Packages are not yet published to npm. To try a complete example from the repository root:

```bash
node examples/terminal-chat.ts
```

See [examples](examples/README.md) for an interactive terminal chat, an HTML email digest and a minimal web app. `vak.act(...)` sends button or form actions back through the same model conversation.

## Supported surfaces

| Surface | What works today |
|---|---|
| Web / playground | Adaptive layouts, cards, charts, tables, forms, buttons and local sorting/filtering/pagination |
| Desktop | The same UI in a Tauri app, with saved chats, provider settings, integrations and background Telegram support |
| Telegram | Live bot; rich messages, inline buttons and validated forms asked one field at a time |
| Slack | Block Kit projection and modal forms; a live bot listener is not implemented |
| Discord | Components V2 projection and paged modal forms; a live bot listener is not implemented |
| Markdown / plain text / terminal | Text projections, including ANSI terminal output |
| HTML email | Table-based HTML with a plain-text alternative; controls link out to respond |

Components adapt to each target’s capabilities. For example, charts become data tables in Telegram, Slack and Discord.

### Desktop app

The desktop app adds a model picker, themes, provider and integration settings, channel controls and a menu-bar mode. macOS credentials are stored in the Keychain.

**Artifacts** collects saved forms, dashboards and interfaces in a dedicated page with search, type filters and sorting. Open an artifact from any chat in the resizable canvas beside the conversation. The canvas keeps forms live and provides Preview/Text, copy, Markdown download and full/split views. See [Canvas and Artifacts](apps/desktop/CANVAS.md).

Settings → FinOps charts per-turn duration, context growth, output shape, token/cache usage and estimated API cost, with editable model rates and CSV export. FinOps belongs to the app; the framework stays focused on projection. Historical usage that was never recorded remains unknown. See [desktop FinOps](apps/desktop/FINOPS.md).

Building the native app requires Rust and the Tauri platform prerequisites in addition to Node 24+:

```bash
npm run desktop         # development window
npm run desktop:build   # release bundle with the Node sidecar and npm
```

The current desktop workflow is tested on macOS. Builds are not yet code-signed or notarized; Windows and Linux builds remain unverified. See [SPECS.md, section 10](SPECS.md) for desktop architecture and behavior.

### Telegram

Create a bot with BotFather and set `TELEGRAM_BOT_TOKEN` in `.env`, then run:

```bash
npm run telegram
```

`VAK_PROVIDER` and `VAK_MODEL` select its model; see [`.env.example`](.env.example). Chats, surfaces and unfinished form state persist in `.vak/telegram/`. You can also enable Telegram from the desktop app’s channel settings. Run only one poller per bot token.

### MCP hosts

vak includes a stdio MCP server exposing four tools:

| Tool | Purpose |
|---|---|
| `vak_render` | Create or replace a surface |
| `vak_update` | Patch nodes or surface data |
| `vak_remove` | Remove a surface or selected nodes |
| `vak_wait_action` | Wait for a button press or form submission |

Start the playground and open [the MCP viewer](http://127.0.0.1:5177/?session=mcp). Configure your MCP host to launch:

```bash
node --disable-warning=ExperimentalWarning /absolute/path/to/Projection/packages/mcp/src/main.ts
```

The repository’s [`.mcp.json`](.mcp.json) supplies a Claude Code configuration. `VAK_URL` and `VAK_SESSION` override the default viewer URL and session.

## How it works

```text
Model → projection tools → streaming parser → repair + validation → surface store
                                                                       ↓
                                                          target-specific projector
                                                                       ↓
                                                         button press / form submit
                                                                       ↓
                                                               next model turn
```

A surface contains a node tree and a separate data model. Props bind to data with JSON Pointer placeholders such as `{/revenue}`. The component catalog defines schemas, aliases, defaults, repair rules and worked examples, keeping the prompt contract and engine behavior together.

Provider adapters support Ollama, Anthropic, OpenAI, Gemini and OpenAI-compatible endpoints, including LM Studio and the hosted presets listed in Settings. Model capability profiles select tool calling or constrained JSON generation and the appropriate catalog tier.

## Integrations and security

The app can give models access to tools through MCP. It includes built-in web-page and time tools, a catalog of integrations such as Files, Memory, Brave Search, GitHub, Notion and Context7, and support for custom servers.

Tools have **Allow / Ask / Off** policies. Writes, deletes and open-internet access default to approval in chat. External servers receive only their declared environment variables; catalog npm servers use pinned versions and install with scripts disabled. Projectors escape model content, and loopback servers validate Host, Origin and request content type.

Custom MCP servers run with your account’s permissions; they are not sandboxed. Hosted providers receive the prompts sent to them. Read [SECURITY.md](SECURITY.md) for the threat model, limits and private vulnerability reporting guidance.

## Development and benchmarks

```bash
npm test                         # unit tests and recorded-output replay gate
npm run typecheck                # TypeScript checks
node scripts/build-packages.ts   # build JS + declarations; publishes nothing
```

Bench v3 measures 36 single- and multi-turn scenarios with structural checks and confidence intervals. Six cover timeline, steps, code, map, gallery and computed table totals. Property checks inspect resolved component data as well as projected text. Live runs call the selected provider; replay uses recorded output.

```bash
# Full suite: extended tier exposes all components to the local 4B.
npm run bench -- run ollama:qwen3.5:4b-mlx --runs 1 --plan tools/extended/examples/inline --save

# Compare a live local run with the stored baseline.
npm run bench -- gate ollama:qwen3.5:4b-mlx --runs 1 --plan tools/extended/examples/inline
```

The latest v3 component baseline is `components-contract`: 11/12 live runs completely passing, 94% mean check score. The final failure exposed a quoted-pointer issue; after that engine fix all 12 recorded outputs replay completely. The original `components-v3` slice (2/6 completely passing) and intermediate recordings remain available. Earlier v2 full-suite and form baselines remain historical; re-record a baseline before comparing live v3 runs. `npm test` continues to replay both versions. See [HANDOVER.md](HANDOVER.md) for the component-only recording command and the known failures.

Hosted benchmark runs and optional semantic judges may incur charges. See [AGENTS.md](AGENTS.md) for the maintenance workflow and [HANDOVER.md](HANDOVER.md) for current measurements and known gaps.

## Repository layout

| Path | Responsibility |
|---|---|
| `packages/core` | VPS, catalog, parser, normalization, surface store and text projectors |
| `packages/providers` | Provider adapters, agent loop, capability policy and profiles |
| `packages/web` | `<vak-surface>` Web Component and browser client |
| `packages/host` | HTTP/SSE host, sessions, persistence and approvals |
| `packages/mcp` | MCP server, client, tool policy and built-in tools |
| `packages/telegram` | Telegram projector, conversational forms and bot |
| `packages/slack`, `packages/discord` | Platform projectors and modal forms |
| `packages/email`, `packages/kit` | HTML email projection and the `createVak()` API |
| `packages/bench` | Scenarios, scoring, runners, replay and statistics |
| `apps/desktop` | Tauri shell, shared UI and Node sidecar |
| `apps/playground` | Browser entry point for the shared app |
| `examples`, `scripts` | Runnable examples and maintenance tools |

## Documentation

- [Examples](examples/README.md) — runnable starting points.
- [Architecture and specification](SPECS.md) — data model, engine, providers and app.
- [Scope](SCOPE.md) and [design research](STUDY.md) — goals and design choices.
- [Security](SECURITY.md) — protections, limitations and vulnerability reporting.
- [Maintenance instructions](AGENTS.md) and [current state](HANDOVER.md) — working rules and next steps.

## Contributions

This is a maintainer-developed project. **External contributions are not accepted**, including pull requests for code, documentation or translations. Please maintain your changes in your own fork. See [CONTRIBUTING.md](CONTRIBUTING.md) for the policy.

## License

Copyright © 2026 Nisheeth Ranjan. Released under the [MIT License](LICENSE).

You may use, modify and redistribute the software, including commercially, under the license terms. The contribution policy governs what is accepted into this repository and does not restrict the permissions granted by MIT.
