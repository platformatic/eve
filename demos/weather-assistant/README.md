# Weather Assistant

The eve quickstart agent, running on Platformatic Watt through
[`@platformatic/eve`](../../README.md).

One agent, one typed tool (`get_weather`). This is the smallest demo that proves
the Watt + capability wiring works end to end.

## Structure

```
weather-assistant/
├── watt.json                 # Watt app config — module: @platformatic/eve
├── package.json
├── tsconfig.json
├── pnpm-workspace.yaml       # eve dev-runtime source-root marker (see note below)
└── agent/
    ├── instructions.md       # the always-on system prompt
    ├── agent.ts              # model selection (gateway / direct provider / mock)
    ├── channels/eve.ts       # HTTP entry point + auth
    └── tools/get_weather.ts  # one file = one tool
```

> **Why is there a `pnpm-workspace.yaml` here?** This demo lives *inside* the
> `@platformatic/eve` repository. In `pnpm dev`, eve stages a snapshot of its
> "source root" — the nearest ancestor with a `.git` or `pnpm-workspace.yaml`.
> Without this marker it would pick the repo root and try to copy the whole repo
> into `<demo>/.eve/`, which fails (`cp` can't copy a directory into itself). The
> marker pins eve's source root to this demo. Because pnpm also treats this nested
> file as a root when you run `pnpm` from here, the demo links the capability via
> `file:../..` (not `workspace:*`), which resolves in that rooting. Don't delete it.

## Run it

Install and build once at the repo root (the demos are workspace members), then
run this demo from its directory:

```sh
# once, at the repo root
pnpm install && npm run build

# this demo
cd demos/weather-assistant
pnpm dev
```

With no API keys set it runs offline on eve's `mockModel()`, which still calls
`get_weather`. Add a key (see [`.env.sample`](./.env.sample)) for live answers.

Then, in another terminal:

```sh
curl -i -X POST http://127.0.0.1:3042/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"What is the weather in Brooklyn?"}'
```

The response carries an `x-eve-session-id` header. Stream that session:

```sh
curl http://127.0.0.1:3042/eve/v1/session/<sessionId>/stream
```

## Production build

```sh
pnpm build   # wattpm build -> eve build pipeline, output in .output
pnpm start   # wattpm start -> serves the built agent
```

## Provenance and license

Adapted from the upstream `apps/fixtures/weather-agent` example in
[`vercel/eve`](https://github.com/vercel/eve/tree/main/apps/fixtures/weather-agent),
re-wired to run on Platformatic Watt via `@platformatic/eve`.

Licensed under **Apache-2.0** — the same license as upstream `vercel/eve` and as
this repository (see [`../../LICENSE`](../../LICENSE) and [`../../NOTICE`](../../NOTICE)).
As a derivative work, the original © Vercel, Inc. and contributors is retained.
