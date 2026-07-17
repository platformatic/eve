# Next.js with embedded Eve and Platformatic World

This demo runs plain `eve` inside a Next.js project through the official `withEve()` integration. Next is hosted by Platformatic Watt, while Eve runs as the internal Nitro process managed by the Next integration.

```text
Watt / @platformatic/next :3042
├── Next UI and assets
├── /eve/v1/*                         -> Eve Nitro :4274
└── /.well-known/workflow/v1/*        -> Eve Nitro :4274
                                             |
                                             v
                                      Platformatic World
```

The second rewrite is specific to self-hosting. `withEve()` proxies the Eve session API, but Platformatic World delivers queue messages to `/.well-known/workflow/v1/flow`.

The Eve world is exposed as the local package `@platformatic/next-eve-world`. Eve statically imports custom worlds from its generated compile directory, so a named package is required instead of a root-relative module path.

In a direct `next start`, `withEve()` starts the production Eve child while evaluating the Next config. `@platformatic/next` starts from its build manifest and does not evaluate that config side effect again. The container entrypoint therefore uses `scripts/start-container.mjs` to start the same Eve build on loopback, wait for its health route, and then start Watt. Starting Eve outside the Platformatic application worker is important because the worker intercepts application server sockets. Both processes remain in the same project and pod.

## Campaign launch UI

The home page is a marketing-oriented campaign launch experience built with `useEveAgent()` from `eve/react`. The default prompt launches the fictional Velocity running shoe campaign across Europe through six real persisted actions:

- campaign brief and target markets;
- audience, inventory, creative and channel activation;
- progressive business metrics;
- live campaign status;
- a visible `ICC -> Watt -> Next.js -> Eve -> Platformatic World` stack;
- collapsible runtime proof with session, deployment, pod and event data.

The default campaign run is paced to roughly 25-30 seconds. The timing is deliberate so each durable action and business result is visible during a short presentation.

Session events and the cursor are stored in browser `localStorage`, so a refresh restores the conversation.
The bearer token is entered before the campaign UI mounts and stays only in
browser memory, so a refresh requires entering it again. It is never stored with
the session or exposed through a `NEXT_PUBLIC_*` variable.
The Docker build sets `NEXT_PUBLIC_BASE_PATH=/next-eve-platformatic-world`. Next uses it as `assetPrefix`, and `useEveAgent()` uses the same value as its API host. Local builds leave it empty unless explicitly configured.

## Local build

```sh
pnpm install
cp .env.sample .env  # set EVE_BEARER_TOKEN to a long, random value
pnpm build
pnpm start
```

The build order is important: `eve build` must produce `.output/server/index.mjs` before Next starts in production.

## Automated deployment

With the Desk skew-protection cluster running and selected as the current Kubernetes context:

```sh
pnpm verify:deployment https://svcs.gw.plt/next-eve-platformatic-world
```

The verifier builds an immutable image, deploys it with Desk's workflow-aware primitives, waits for ICC routing, checks every browser asset and the Eve health route, starts a real campaign session, and validates persisted actions, business metrics, deployment identity and session continuation.

Generated reports are written under `.deployment-results/` and are ignored by Git.

Optional settings:

```text
NEXT_EVE_DESK_ROOT
NEXT_EVE_KUBERNETES_CONTEXT
NEXT_EVE_NAMESPACE
NEXT_EVE_NPMRC
NEXT_EVE_REUSE_VERSION
NEXT_EVE_STAGES
NEXT_EVE_TIMEOUT_MS
```

`EVE_BEARER_TOKEN` is required and is passed to the deployment by the verifier.
It protects Eve session routes; the Next page, static assets, health route, and
workflow delivery callback remain public.
