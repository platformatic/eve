# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@platformatic/eve` is a Platformatic **capability** (a runtime adapter, not an app) that lets [Eve](https://vercel.com/eve) agent applications run inside a Platformatic runtime. It wraps Eve's Nitro-based dev/build/production lifecycle behind Platformatic's `BaseCapability` interface so an Eve app can be served through a Platformatic gateway, expose HTTP metrics, and be driven programmatically via `create()` / `build()` / `start()` / `inject()` / `stop()`.

The package ships compiled JS from `dist/` (`exports: ./dist/index.js`); `src/` is TypeScript authored with type stripping in mind (imports use `.ts` extensions, `allowImportingTsExtensions`).

## Commands

- **Build**: `npm run build` — clears `dist/` and runs `tsc -p tsconfig.base.json`, then `postbuild` regenerates `src/version.js`. **Tests depend on a fresh build** (the `test` script runs `build` first).
- **Test (all)**: `npm test` — builds, then runs `node --test` over `test/**/*.test.ts` under c8 coverage, serially (`--test-concurrency=1`), 60s timeout.
- **Test (single file)**: `npm run build && node --test --test-timeout=60000 test/version-check.test.ts`. Rebuild first if you changed `src/`, since tests import from `../src/index.ts` but exercise the built Eve/Platformatic packages.
- **Typecheck**: `npm run typecheck` (`tsc -p . --noEmit`, covers `src`, `test`, `scripts`).
- **Lint**: `npm run lint` (eslint, neostandard + prettier). **Format**: `npm run format`.
- **Full CI gate**: `npm run ci` (build → typecheck → lint → test:ci). This is what GitHub Actions runs on Node 22 and 24.

Test debug output env vars: `PLT_TESTS_DEBUG=true` (debug log level), `PLT_TESTS_VERBOSE=true` (info level, disables stdout/stderr silencing).

## Architecture

The whole capability is one class: **`EveCapability`** in `src/capability.ts`, extending `@platformatic/basic`'s `BaseCapability`. Key flow:

- **`init()`** resolves the consumer's `eve` package via CJS resolution, reads its `package.json`, and enforces `supportedVersions` (`^0.20.0`) — **only in development mode**; production trusts the already-built output. It also computes the gateway `basePath`.
- **Mode branching** in `start()`: if `application.commands.{development,production}` is set, Eve is bypassed entirely and the command runs as a Platformatic-managed child process. Otherwise `#startDevelopment()` / `#startProduction()` drive Eve directly.
- **Development** imports Eve's internal Nitro host (`eve/dist/src/internal/nitro/host.js`) and calls `createDevelopmentServer`.
- **Production** imports the built Nitro server (`<outputDirectory>/server/index.mjs`, default `.output`), prewarms Eve sandboxes (`eve/dist/src/execution/sandbox/prewarm.js`), and captures the created `http.Server` by subscribing to the `net.server.listen` diagnostics channel — this is how it injects Platformatic's server options (backlog, HTTPS) and grabs the request dispatcher for in-process `inject()`.
- **Production config is passed to Nitro via environment variables** (`HOST`, `NITRO_HOST`, `NITRO_PORT`, `PORT`, `NITRO_SHUTDOWN_*`, `NITRO_SSL_CERT/KEY`). These are set just before importing the Nitro server and **restored afterward** (`#setProductionEnvironment` / `#restoreEnvironment`) so process env isn't permanently mutated. HTTPS cert/key are serialized inline into env.
- **`inject()`** has two paths: in production it uses `light-my-request` against the captured in-process dispatcher; otherwise it falls back to a real HTTP request via `injectViaRequest`.

**Reaching into Eve's `dist/` internals is deliberate and fragile** — the deep import paths (`internal/nitro/host.js`, `execution/sandbox/prewarm.js`) are the integration seam and will break on incompatible Eve versions. This is why the version check exists and why `eve@0.20.0` is pinned exactly in devDependencies.

`src/index.ts` provides the public entrypoints: `create`, `loadConfiguration`, `transform` (forces `watch: { enabled: false }`), and re-exports the capability + schema. `src/schema.ts` builds the JSON Schema by composing shared schema components from `@platformatic/basic` and `@platformatic/foundation`; the only Eve-specific config is `eve.outputDirectory`.

## Version generation gotcha

`src/version.ts` is a placeholder that reads `package.json` at runtime. The `postbuild` script (`scripts/postbuild.ts`) **overwrites** the built `version.js` with hardcoded string literals for bundler-friendliness. Don't rely on `version.ts`'s runtime-read behavior in the shipped artifact — the version is baked in at build time. Bump versions via `scripts/bump-version.ts`, not by hand.

## Demos

`demos/*` are runnable example eve agents (the official Vercel Weather and Real Estate demos) wired
to boot under Watt through this capability. Each is a Watt app (`watt.json` with
`module: @platformatic/eve`); they are workspace members (`packages: demos/*`) but link the
capability via `@platformatic/eve: "file:../.."`, **not** `workspace:*`. Install and build once at
the repo root (`pnpm install && npm run build`), then run a demo with `pnpm dev` (`wattpm dev`) from
its directory.

Each demo's `agent/agent.ts` resolves its model without hard-requiring Vercel AI Gateway: AI Gateway
key → gateway string; else `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` → that provider directly (lazy
`@ai-sdk/*` import); else `mockModel()` from `eve/evals` so the demo runs offline. **Landmine:** each
demo needs its empty `pnpm-workspace.yaml` marker — see `AGENTS.md`.

## Test infrastructure

`test/helper.ts` is the backbone. Tests build throwaway Eve apps in temp dirs:

- **`prepareEveApplication(root)`** scaffolds a minimal Eve agent (`agent/agent.ts` using `mockModel` from `eve/evals`, `instructions.md`, a fake `.eve/nitro/workflow/steps.mjs`) — this is how tests avoid calling a real LLM.
- **`ensureDependencies(paths)`** symlinks resolved packages (and their bins) into the temp app's `node_modules` instead of running a real install — fast, offline.
- **`swapVersion(t, pkg, version)`** temporarily rewrites a dependency's `package.json` version (restored in `t.after`) to test the version-satisfaction check.
- **`runWithSilentOutput`** suppresses stdout/stderr unless verbose env vars are set.

Because these tests spawn servers, mutate shared package.json files, and manipulate `process.env`, they run **serially** — keep `--test-concurrency=1`.
