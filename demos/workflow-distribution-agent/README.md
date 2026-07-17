# Workflow Distribution Agent

A deterministic Eve agent for observing workflow execution across multiple
Platformatic Watt workers and Kubernetes pods.

The application starts three static Watt workers per pod. A request such as
`distribution-test:8` executes eight sequential probe stages. Each probe records
the Kubernetes pod and Watt worker that handled it.

Appending `:crash` enables worker crash injection. Ten percent of session/tool
call pairs are selected deterministically. A selected call writes a per-pod
marker and terminates its Watt worker; the queue retry can then continue on a
restarted or different worker. The marker prevents the same call from
repeatedly crashing the same pod.

## Structure

```text
workflow-distribution-agent/
|-- watt.json
|-- world.mjs
|-- package.json
|-- Dockerfile
`-- agent/
    |-- agent.ts
    |-- instructions.md
    |-- channels/eve.ts
    `-- tools/probe_execution.ts
```

## Run locally

Install and build the capability at the repository root, then start the demo:

```sh
pnpm install
npm run build
cd demos/workflow-distribution-agent
cp .env.sample .env  # set EVE_BEARER_TOKEN to a long, random value
pnpm dev
```

Create an eight-stage session:

```sh
set -a; . ./.env; set +a

curl -i -X POST http://127.0.0.1:3042/eve/v1/session \
  -H "authorization: Bearer $EVE_BEARER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"message":"distribution-test:8"}'
```

Read the durable NDJSON stream using the `x-eve-session-id` response header:

```sh
curl -N -H "authorization: Bearer $EVE_BEARER_TOKEN" \
  http://127.0.0.1:3042/eve/v1/session/<sessionId>/stream
```

The token protects session routes, including local requests. Health checks and
workflow delivery callbacks remain public.

Each `probe_execution` result has this shape:

```json
{
  "stage": 1,
  "pod": "workflow-distribution-agent-7d97c55bdd-th748",
  "applicationId": "eve-demo-workflow-distribution-agent",
  "workerId": 2,
  "threadId": 4,
  "pid": 1
}
```

Use `pod` and `workerId` together as the execution identity. Watt workers are
worker threads, so workers in the same pod can share a process ID.

## Kubernetes test

Deploy at least three replicas. The image configures three static Watt workers
per pod and reduces Workflow SDK inline execution so that more stages cross
queue delivery boundaries.

Run multiple sessions concurrently and aggregate the probe results. The test
verifies global pod and worker coverage and reports per-session cross-boundary
execution as a statistical metric.

The distribution verifier runs 100 concurrent 32-stage crash-recovery sessions
and checks the persisted event streams, final results, pod coverage, worker
coverage, and successful recovery of at least one injected crash. It also
reports latency, live-stream duplicates, and cross-boundary rates. Pass the
deployed application base URL as its only argument:

```sh
pnpm verify:distribution https://svcs.gw.plt/workflow-distribution-agent
```

The default profile can be reduced for a smoke test without adding CLI
arguments:

```sh
DISTRIBUTION_SESSION_COUNT=24 DISTRIBUTION_STAGE_COUNT=8 \
  pnpm verify:distribution https://svcs.gw.plt/workflow-distribution-agent
```

The verifier expects at least three pods with all three Watt workers observed
on each pod. Cross-pod and cross-worker execution are statistical metrics, not
pass conditions, because Kubernetes and Watt distribute TCP connections rather
than individual workflow stages. The live stream is used only to wait for the
session boundary; validation uses a fresh replay of the persisted stream.
Results from attempts interrupted after emitting but before committing are
deduplicated by stable tool `callId`, keeping the final attempt and reporting
the discarded count. HTTPS certificate verification is disabled for this
diagnostic so that it can run against development gateways with self-signed
certificates.

## Production build

```sh
pnpm build
pnpm start
```

Licensed under Apache-2.0. See `../../LICENSE` and `../../NOTICE`.
