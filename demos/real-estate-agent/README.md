# Real Estate Agent

The flagship eve demo — a Brooklyn real-estate sales assistant — running on
Platformatic Watt through [`@platformatic/eve`](../../README.md).

It shows the parts of eve a real product uses: several typed tools over a shared
data layer, and a cron **schedule** that produces a daily "your viewings today"
digest.

## Structure

```
real-estate-agent/
├── watt.json                          # Watt app config — module: @platformatic/eve
├── package.json
├── tsconfig.json
├── pnpm-workspace.yaml                # eve dev-runtime source-root marker (see note below)
├── lib/store.ts                       # in-memory listings + viewings, shared by tools
└── agent/
    ├── instructions.md                # the always-on system prompt
    ├── agent.ts                       # model selection (gateway / direct provider / mock)
    ├── channels/eve.ts                # HTTP entry point + auth
    ├── tools/
    │   ├── search_listings.ts         # filter listings
    │   ├── get_listing.ts             # one listing by id
    │   ├── book_viewing.ts            # schedule a showing
    │   └── list_client_viewings.ts    # a day's / client's schedule
    └── schedules/
        └── daily_viewings_digest.ts   # weekday 08:00 "viewings today" digest
```

The store is seeded with six listings and two viewings booked for *today*, so the
schedule and the "viewings today" query have something to show immediately.

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
cd demos/real-estate-agent
cp .env.sample .env  # set EVE_BEARER_TOKEN to a long, random value
pnpm dev
```

With no API keys set it runs offline on eve's `mockModel()`, which drives
`search_listings` and `list_client_viewings`. Add a key (see
[`.env.sample`](./.env.sample)) for the full conversational experience.

Then, in another terminal:

```sh
set -a; . ./.env; set +a

# Search
curl -i -X POST http://127.0.0.1:3042/eve/v1/session \
  -H "authorization: Bearer $EVE_BEARER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"message":"Show me 2-bed listings in Park Slope under $1.5M"}'

# The daily digest question
curl -i -X POST http://127.0.0.1:3042/eve/v1/session \
  -H "authorization: Bearer $EVE_BEARER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"message":"What viewings do we have today?"}'
```

Each response carries an `x-eve-session-id` header; stream it with:

```sh
curl -H "authorization: Bearer $EVE_BEARER_TOKEN" \
  http://127.0.0.1:3042/eve/v1/session/<sessionId>/stream
```

`EVE_BEARER_TOKEN` protects all session routes, including local requests. The
health route and scheduled workflow delivery remain public.

## The daily digest schedule

`agent/schedules/daily_viewings_digest.ts` runs every weekday at 08:00 (`0 8 * * 1-5`)
and asks the agent to compile the day's viewings. It's a fire-and-forget
`markdown` schedule, so the framework runs the agent on the prompt and the agent
calls `list_client_viewings` itself. In `wattpm dev`, eve exposes the schedule so
you can trigger it on demand rather than waiting for the cron.

## Production build

```sh
pnpm build   # wattpm build -> eve build pipeline, output in .output
pnpm start   # wattpm start -> serves the built agent
```

> The listings/viewings store is in-memory for the demo; a real deployment would
> back these tools with a database (or Platformatic DB) and eve's durable session
> state on Vercel.

## Provenance and license

An **original reconstruction** of the real-estate scenario described in Vercel's
[eve launch blog](https://vercel.com/blog/introducing-eve) (property listings,
client bookings, and a daily "viewings today" digest). There is no upstream
source for it in [`vercel/eve`](https://github.com/vercel/eve) — this demo is
faithful to the described scenario, not to any published code.

© Platformatic Inc., licensed under **Apache-2.0** (see
[`../../LICENSE`](../../LICENSE)).
