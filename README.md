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

## Layout

| Path | What |
|---|---|
| `packages/core` | spec, catalog, parser, normalizer, surface store, events |
| `packages/providers` | provider adapters, agent loop, calibration, policy, profiles |
| `packages/web` | `<vak-surface>` renderer, charts, markdown, client |
| `apps/playground` | dev server + chat UI + `/api/project` for direct projection |
| `scripts` | eval and smoke tests |
