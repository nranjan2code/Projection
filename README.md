# vak Projection

**Let language models answer with interfaces.**

vak turns model output into cards, dashboards, tables, charts, forms and buttons. The model describes an interface once using the Vak Projection Spec (VPS); the engine parses, repairs and validates it, then projects it onto the web, chat platforms or text. Button presses and form submissions go back to the model so the interface can evolve through a conversation.

Built for local models first, with Ollama `qwen3.5:4b-mlx` as the primary target. Hosted providers work too.

[Quick start](#quick-start) · [Use in code](#use-in-code) · [Supported surfaces](#supported-surfaces) · [Built with vak](#built-with-vak) · [Documentation](#documentation) · [MIT license](LICENSE)

## Why vak

- **One spec, multiple surfaces.** Share interface structure, data bindings and validation across projectors.
- **Repair before retry.** A lenient streaming parser and catalog-driven normalization recover malformed model output before asking the model to try again.
- **Interactive answers.** Forms validate inputs; buttons carry context; web tables sort, filter and page locally without another model call.
- **Local and hosted models.** Provider adapters use `fetch`, with model capabilities guiding generation mode and prompt contracts.
- **No third-party runtime dependencies in the framework.** `packages/*` and the playground use Node 24 built-ins, browser APIs and `fetch`.
- **Regression checks from real output.** Recorded model calls replay through the current engine as part of the test suite.

## Quick start

You need **Node.js 24+**, npm, and a running model provider. For local use, start Ollama with `qwen3.5:4b-mlx` available. Local Ollama inference needs no API key.

```bash
git clone https://github.com/nranjan2code/Projection.git
cd Projection
npm ci
npm run playground
```

Open [http://127.0.0.1:5177](http://127.0.0.1:5177) and try:

> Compare three laptops for a student, with a table and a button to choose each one.

The playground is the framework's own viewer: `@vak/host` plus one page of `<vak-surface>`, with no build step. `?session=` picks a session (MCP agents project into `mcp`, `bench report` into `bench`) and `?model=provider:model` picks the model. For a full app with saved chats, settings and integrations, see [Vakyartha](#built-with-vak).

For hosted providers, copy [`.env.example`](.env.example) to `.env` and fill in the relevant keys. Hosted inference may incur provider charges. Keep `.env` and the `.vak/` data directory private.

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
| Telegram | Live bot; rich messages, inline buttons and validated forms asked one field at a time |
| Slack | Block Kit projection and modal forms; a live bot listener is not implemented |
| Discord | Components V2 projection and paged modal forms; a live bot listener is not implemented |
| Markdown / plain text / terminal | Text projections, including ANSI terminal output |
| HTML email | Table-based HTML with a plain-text alternative; controls link out to respond |

Components adapt to each target’s capabilities. For example, charts become data tables in Telegram, Slack and Discord.

### Telegram

Create a bot with BotFather and set `TELEGRAM_BOT_TOKEN` in `.env`, then run:

```bash
npm run telegram
```

`VAK_PROVIDER` and `VAK_MODEL` select its model; see [`.env.example`](.env.example). Chats, surfaces and unfinished form state persist in `.vak/telegram/`. Run only one poller per bot token.

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

Provider adapters support Ollama, Anthropic, OpenAI, Gemini and OpenAI-compatible endpoints, including LM Studio and the hosted presets in `COMPATIBLE_PRESETS`. Model capability profiles select tool calling or constrained JSON generation and the appropriate catalog tier.

## Integrations and security

The app can give models access to tools through MCP. It includes built-in web-page and time tools, a catalog of integrations such as Files, Memory, Brave Search, GitHub, Notion and Context7, and support for custom servers.

Tools have **Allow / Ask / Off** policies. Writes, deletes and open-internet access default to approval in chat. External servers receive only their declared environment variables; catalog npm servers use pinned versions and install with scripts disabled. Projectors escape model content, and loopback servers validate Host, Origin and request content type.

Custom MCP servers run with your account’s permissions; they are not sandboxed. Hosted providers receive the prompts sent to them. Read [SECURITY.md](SECURITY.md) for the threat model, limits and private vulnerability reporting guidance.

## Web appearance and white-label themes

`<vak-surface>` ships with a minimal neutral theme: compact controls, quiet borders,
no card shadows, and responsive layouts. Omit `theme` to follow the system, or set
`theme="light"` / `theme="dark"` on a surface. The host app owns its page background.

Public `--vak-*` CSS tokens inherit from any app wrapper and can also be set on an
individual surface. Defaults only fill missing tokens; they never override the
app’s inherited values. No fonts, CSS library or branding assets are downloaded.

```css
.my-app {
  --vak-font: "My app font", system-ui, sans-serif;
  --vak-font-size: 14px;
  --vak-accent: #27634a;
  --vak-accent-fg: #ffffff;
  --vak-accent-soft: #e4efe9;
  --vak-radius: 4px;
  --vak-radius-sm: 3px;
  --vak-card-padding: 16px;
  --vak-control-height: 36px;
  --vak-series-1: #398464;
}
.my-app[data-appearance="dark"] {
  --vak-accent: #92ccac;
  --vak-accent-fg: #10251b;
  --vak-accent-soft: #213a2c;
  --vak-series-1: #92ccac;
}
```

Set the surfaces’ `theme` attribute alongside the app’s appearance. When overriding
colors, provide coordinated foreground/background values for each appearance.

| Tokens (all prefixed `--vak-`) | Controls |
| --- | --- |
| `font`, `mono`, `font-size`, `line-height` | Type families and base scale; component text scales with it |
| `weight-heading`, `weight-label`, `weight-value` | Heading, label and numeric emphasis |
| `bg`, `surface`, `surface-2`, `fg`, `muted`, `border` | Backgrounds, text and separators |
| `accent`, `accent-fg`, `accent-soft` | Actions, selection and focus |
| `info`, `success`, `warning`, `danger` | Semantic feedback |
| `series-1` through `series-6` | Chart, graph and Gantt palette |
| `radius`, `radius-sm`, `shadow`, `shadow-hover` | Panel/control shape and elevation |
| `space-sm`, `space-md`, `space-lg`, `card-padding` | Layout gaps and panel padding |
| `control-height`, `grid-min`, `grid-align` | Control minimum height, default grid item minimum width and vertical alignment |

Touch controls retain a 44px minimum. Explicit grid `minItemWidth: "sm"` or `"lg"`
keeps its requested minimum; `grid-min` tunes the default medium minimum.
Grid items keep their natural height by default; `--vak-grid-align: stretch` gives
equal-height rows when an app wants them.
`--_vak-*` values are private implementation fallbacks, not customization hooks.

Run `npm run playground` and open [the theme reference](http://127.0.0.1:5177/styles)
to review every catalog component with light/dark, brand and density switches.
The reference uses fixed data and handles actions locally, without model calls.
Gallery samples load HTTPS placeholder images; other illustrations are embedded.

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
| `playground` | The framework's viewer: host + `<vak-surface>`, the MCP and bench target |
| `examples`, `scripts` | Runnable examples and maintenance tools |

## Built with vak

**[Vakyartha](https://github.com/nranjan2code/vakyartha)** is the desktop app built on this framework (Tauri, macOS first): saved chats whose answers are interfaces, a model picker, provider and integration settings, an artifacts canvas, FinOps, and Telegram running in the background. It lives in its own repository and uses Projection as a git submodule pinned to a commit, so the dependency runs one way: the app draws on the framework, and nothing here depends on the app.

## Documentation

- [Examples](examples/README.md) — runnable starting points.
- [Architecture and specification](SPECS.md) — data model, engine and providers.
- [Scope](SCOPE.md) and [design research](STUDY.md) — goals and design choices.
- [Security](SECURITY.md) — protections, limitations and vulnerability reporting.
- [Releasing](RELEASING.md) — versions, tags and what apps built on the framework can rely on.
- [Maintenance instructions](AGENTS.md) and [current state](HANDOVER.md) — working rules and next steps.

## Contributions

This is a maintainer-developed project. **External contributions are not accepted**, including pull requests for code, documentation or translations. Please maintain your changes in your own fork. See [CONTRIBUTING.md](CONTRIBUTING.md) for the policy.

## License

Copyright © 2026 Nisheeth Ranjan. Released under the [MIT License](LICENSE).

You may use, modify and redistribute the software, including commercially, under the license terms. The contribution policy governs what is accepted into this repository and does not restrict the permissions granted by MIT.
