# @platformatic/eve demos

The official Vercel [eve](https://vercel.com/eve) example agents, packaged to run
inside a [Platformatic Watt](https://platformatic.dev) runtime through the
[`@platformatic/eve`](../README.md) capability instead of on Vercel.

Each demo is a self-contained Watt application whose `watt.json` sets
`module: @platformatic/eve`. Watt boots the eve app through the capability, which
gives you Platformatic's server options, gateway metadata, and HTTP metrics on
top of eve's durable-session runtime.

| Demo | What it shows |
| --- | --- |
| [`weather-assistant`](./weather-assistant) | The eve quickstart: one agent, one typed tool (`get_weather`). The smallest thing that proves the Watt + capability wiring end to end. |
| [`real-estate-agent`](./real-estate-agent) | The flagship demo: a sales assistant with tools for searching listings, booking viewings, and reviewing a client's schedule, plus a cron-driven daily "your viewings today" digest via an eve schedule. |

## Requirements

- Node.js `>= 22.19.0`
- The workspace installed and the capability built once from the repo root:
  `pnpm install && npm run build` in `/` (the repo root).

The demos are registered under `packages:` in the repo-root `pnpm-workspace.yaml`,
so a single `pnpm install` at the root installs them too. Each links the
capability from this repository via `file:../..` — not a published version.

### How the wiring works (two things worth knowing)

- **`file:../..` link.** Each demo depends on `@platformatic/eve` as
  `"file:../.."` rather than `workspace:*`. Watt loads it as the app's `module`.
  The capability ships compiled JS, so build the repo first (`npm run build` in
  `/`) or the demo links an empty `dist/`. Using `file:` (not `workspace:*`) is
  deliberate — see the marker below.
- **The per-demo `pnpm-workspace.yaml` marker.** In `pnpm dev`, eve stages a
  snapshot of its "source root" — the nearest ancestor holding a `.git` or
  `pnpm-workspace.yaml`. Since the demos live inside this repo, without the marker
  eve would root at the repo and try to copy the whole tree into `<demo>/.eve/`,
  which fails. The marker pins eve's source root to the demo. Because pnpm also
  treats that nested `pnpm-workspace.yaml` as a root when you run `pnpm` from the
  demo directory, the demo must link the capability via `file:` — a `workspace:*`
  dep would be unresolvable in that rooting. The marker also carries `allowBuilds`
  so the demo-dir install doesn't fail on ignored native build scripts.

## Running a demo

Install and build once at the repo root, then run any demo from its directory:

```sh
# once, at the repo root — installs the workspace (incl. demos) and builds dist/
pnpm install && npm run build

# then, per demo
cd demos/weather-assistant
pnpm dev          # wattpm dev — starts Watt, which starts the eve app
```

Watt serves the agent's HTTP channel. Start a durable session and stream it:

```sh
# Create a session (returns an x-eve-session-id header + continuationToken body)
curl -i -X POST http://127.0.0.1:3042/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"What is the weather in Brooklyn?"}'

# Attach to the NDJSON event stream for that session id
curl http://127.0.0.1:3042/eve/v1/session/<sessionId>/stream
```

For production: `pnpm build` (runs `wattpm build`, which calls eve's build
pipeline) then `pnpm start`.

## Which model do the demos use?

eve's `model` field accepts any AI SDK `LanguageModel`, so **Vercel AI Gateway is
optional**. Each demo resolves its model automatically, in this order:

1. **Vercel AI Gateway** — if `AI_GATEWAY_API_KEY` (or a `VERCEL_OIDC_TOKEN` from
   `vercel link`) is set, the demo routes a bare model string
   (`anthropic/claude-sonnet-5` by default) through the gateway. One key, every
   provider.
2. **A provider directly, no gateway** — if `ANTHROPIC_API_KEY` or
   `OPENAI_API_KEY` is set, the demo loads `@ai-sdk/anthropic` /
   `@ai-sdk/openai` and calls that provider's own endpoint. eve talks straight
   to the provider (its "external" routing).
3. **Offline mock** — with no key set, the demo uses `mockModel()` from
   `eve/evals`: a deterministic local model that still calls the demo's tools, so
   the wiring runs with zero credentials.

Override the model id with `EVE_MODEL` (e.g. `EVE_MODEL=openai/gpt-5.4-mini`).
See each demo's `.env.sample`.

> The provider packages are declared as `optionalDependencies` and only loaded
> when their key is present — the mock and gateway paths never import them.

## Provenance and license

These are not standalone Vercel repositories. eve ships as the
[`vercel/eve`](https://github.com/vercel/eve) **monorepo**; its examples are
directories inside it. The two demos here have different origins:

| Demo | Origin | Copyright |
| --- | --- | --- |
| `weather-assistant` | **Adapted** from the upstream `apps/fixtures/weather-agent` example in [`vercel/eve`](https://github.com/vercel/eve/tree/main/apps/fixtures/weather-agent), re-wired to run on Watt via `@platformatic/eve`. | © Vercel, Inc. and contributors |
| `real-estate-agent` | **Original reconstruction** of the real-estate scenario described in Vercel's [launch blog](https://vercel.com/blog/introducing-eve) (listings, client bookings, a daily "viewings today" digest). No upstream source exists — it is faithful to the described scenario, not to published code. | © Platformatic Inc. |

**License.** Both demos are distributed under **Apache-2.0**, the same license as
this repository (see [`../LICENSE`](../LICENSE)) and as upstream `vercel/eve`
(also Apache-2.0). The `weather-assistant` demo is a derivative work of
`vercel/eve`; per Apache-2.0 its Vercel copyright attribution is retained above
and this repository's [`NOTICE`](../NOTICE) applies.
