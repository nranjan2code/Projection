# RELEASING.md: vak Projection

How the framework is versioned and released, and what apps that depend on it can rely on. Rules for any change: [AGENTS.md](AGENTS.md).

## Who depends on this

Apps consume Projection as an external library and pin it; Projection never depends on an app. Today that is [Vakyartha](https://github.com/nranjan2code/vakyartha), which pins this repository as a git submodule (`framework/`) at an exact commit or tag. Its side of the procedure (when and how it moves the pin) is in its own RELEASING.md.

## Versions

- **SemVer for the repository**, tagged `vX.Y.Z` (annotated) on `main`. `0.x` until the API is declared stable: a minor bump may break an export, and says so; a patch never does.
- **The packages** (`@vak/*`) share the repository's version. They are not published to npm yet; `node scripts/build-packages.ts` already produces publishable `dist/` folders.
- **The API apps rely on** is each package's `exports` in its `package.json`, plus the host's HTTP routes (`/api/chat`, `/api/project`, `/api/actions`, `/api/events`, `/api/sessions`) and their event shapes. Anything else (internal files, test helpers) can change without notice.
- **CHANGELOG.md** gets an entry for every change worth knowing. A change that breaks the API above starts with **Breaking:** and says what an app must change.

## Release checklist

1. On `main`, clean tree; `npm ci`, `npm test` (including the replay gate) and `npm run typecheck` pass.
2. Bench where engine behaviour changed: `npm run bench -- gate ollama:qwen3.5:4b-mlx --runs 1` (local, free). No paid runs without asking.
3. Set the version in every `packages/*/package.json` (same value), and turn the top CHANGELOG entries into a `## X.Y.Z (YYYY-MM-DD)` section; check every **Breaking** line names the fix.
4. `node scripts/build-packages.ts` builds cleanly (proves the packages still package).
5. Commit `Release X.Y.Z`, `git tag -a vX.Y.Z -m "Projection X.Y.Z"`, run the secret scan in AGENTS.md, `git push origin main --follow-tags`.
6. Tell the apps: in Vakyartha, follow its "Updating Projection" steps to move the pin to `vX.Y.Z`.

Between releases apps may pin a pushed commit on `main`; a tag is preferred for anything they release.

## Publishing to npm (not yet)

Before the first publish: confirm the `@vak` npm scope, add `repository`/`license` fields to the generated `package.json`, publish from `packages/*/dist` with provenance, and switch apps from the submodule to exact versions. Ask before publishing.
