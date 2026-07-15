# Skew protection test results

This document records the first complete deployment skew test for the Eve workflow skew-protection demo.

## Scope

The test verifies that a durable workflow created by deployment `v1` never executes application code from `v2` after `v2` becomes active.

It covers four paths:

| Scenario | Deployment transition | Expected execution |
| --- | --- | --- |
| In-flight | `v2` deploys while a `v1` step is blocked | The blocked step and its continuation execute on `v1` |
| Retry | A `v1` worker exits after `v2` becomes active | The retry and continuation execute on `v1` |
| Between | Stage 1 completes on `v1`; the session resumes through the default `v2` ingress | Stage 2 executes on `v1` |
| Control | A new session starts after `v2` becomes active | The session executes on `v2` |

The verifier checks three version signals for every successful execution:

- `deploymentVersion`, from `PLT_WORLD_DEPLOYMENT_VERSION`;
- `buildVersion`, baked into the image at build time;
- the pod name, which includes the versioned Kubernetes Deployment name.

The coordinator records attempts before the step returns, so a worker exit remains observable even when Eve cannot persist an `action.result` for that attempt.

## Validated run

- Date: 2026-07-14
- Run label: `rmrk9t1ni`
- Old version: `rmrk9t1ni-v1`
- New version: `rmrk9t1ni-v2`
- Base URL: `https://svcs.gw.plt/workflow-skew-protection-agent`
- Kubernetes context: `k3d-plt-skew-protection`

### In-flight step

- Session: `wrun_01KXFPSAKRSTXR6KG6VGQ3CV4P`
- Stage 1 entered before the `v2` rollout and completed after it.
- Stages 1 and 2 both reported deployment and build `rmrk9t1ni-v1`.
- Both stages ran on pod `workflow-skew-protection-agent-rmrk9t1ni-v1-7f775979bc-lh582`.

### Retried step

- Session: `wrun_01KXFPSAMDXGE0ZZZWZ8YBWPZG`
- Stage 1 attempt 1 ran on `v1`, worker 0, then exited intentionally.
- Stage 1 attempt 2 ran on `v1`, worker 1, and completed.
- Stage 2 also ran on `v1`, worker 1.
- No attempt reached a `v2` pod.

### Between steps

- Session: `wrun_01KXFPS9XB86RDM0P2RRBZMQ1N`
- Stage 1 completed on `v1` and the session reached `session.waiting`.
- The verifier deployed `v2` and continued the same session through the default ingress without a `v1` cookie or `x-deployment-id` header.
- Stage 2 still executed on `v1`.

### New-session control

- Session: `wrun_01KXFPSMFFTVE112FDTZ3JC533`
- The session started after `v2` became the default backend.
- Stage 1 reported deployment and build `rmrk9t1ni-v2` and ran on a `v2` pod.

The machine-readable report is generated under `.skew-results/<run-label>.json`. The directory is ignored by Git because reports contain cluster-specific pod and session identifiers.

## Final cluster state

At the end of the validated run:

- `workflow-skew-protection-agent-rmrk9t1ni-v1` was Ready with one replica.
- `workflow-skew-protection-agent-rmrk9t1ni-v2` was Ready with one replica.
- The HTTPRoute retained explicit `v1` cookie and `x-deployment-id` backends.
- The HTTPRoute default backend was `v2`.
- The Workflow Service was Ready with one replica.
- The Workflow HPA had `minReplicas=1` and `maxReplicas=1`.

The verifier intentionally leaves both application versions running for post-test inspection.

## Automatic orchestration

The complete run is started with:

```sh
pnpm verify:skew https://svcs.gw.plt/workflow-skew-protection-agent
```

The script performs these operations without an interactive checkpoint:

1. Checks Docker, Kubernetes context, ICC, Machinist, and Workflow resources.
2. Builds the local Eve capability.
3. Creates a narrow temporary Docker context that preserves the demo's `@platformatic/eve: file:../..` dependency.
4. Builds two image tags with distinct immutable build markers.
5. Deploys `v1` through Desk's workflow-aware deployment functions.
6. Starts the old-version sessions and waits until both controlled steps have entered.
7. Deploys `v2` and waits for its Deployment and ICC-managed HTTPRoute.
8. Proves that a new session reaches `v2`.
9. Releases the blocked `v1` steps and verifies the controlled retry.
10. Continues the persisted session through the new default ingress.
11. Replays durable streams and validates stage order and version identity.
12. Writes a JSON report and returns a non-zero exit code on failure.

Set `SKEW_RUN_LABEL` only when deliberately resuming or repairing an existing test deployment. Normal runs generate unique labels so Desk and ICC version history remains immutable.

## Operational findings

### Watt Extra CLI symlink

The tested `@platformatic/watt-extra@latest` CLI compares `import.meta.url` with `pathToFileURL(process.argv[1])`. Invoking the globally installed `watt-extra` symlink makes those paths differ, so the CLI exits with code 0 without starting Watt.

The demo invokes the real CLI file instead:

```dockerfile
CMD [ "node", "/usr/local/lib/node_modules/@platformatic/watt-extra/cli.js", "start" ]
```

### Application port

Desk Services target application port 3042. Without an explicit `PORT=3042`, Watt listens on port 3000 while readiness still succeeds through the separate metrics port. Envoy then returns 503 with `connection refused`.

The Docker image and deployment environment both set `PORT=3042`.

### Workflow hot-reload replicas

The skew profile mounts one Platformatic World checkout into every Workflow Service pod. If the HPA scales Workflow above one replica while dependencies need installation, all pods can run `pnpm install` concurrently against the same `node_modules` directory. The observed result was repeated `EPERM` failures and a Workflow Service with no endpoints.

The profile should keep Workflow at one replica for this local hot-reload setup. The validated cluster uses `minReplicas=1` and `maxReplicas=1`.

### Workflow startup probe window

When the shared checkout requires a full Linux dependency installation, the normal liveness probe can kill Workflow before `pnpm install` completes. Recovery required one startup with an extended liveness delay, followed by restoration of the profile value after dependencies were ready.

### ICC registration depends on Workflow availability

If an application first reports its instance metadata while the Workflow Service has no endpoints, ICC can still create application routing while failing to create the Workflow application binding and queue handler. Requests then fail with:

```text
Forbidden: app ID mismatch
```

Restarting the application after Workflow recovers causes Watt Extra to resend instance metadata. ICC then registers the application, Kubernetes binding, and versioned queue handler.

The test environment must therefore have a Ready Workflow Service before the first version is deployed.

### Image build cache

The version-specific Docker `ARG` and `ENV` must be placed after dependency installation and application compilation. Placing them near the start of the Dockerfile invalidates every expensive layer for `v2`.

With the current Dockerfile, the second image reuses all build layers and differs only in final image configuration.

## Test limitations

- The between-step scenario uses two turns of the same durable Eve session. It does not yet cover a Workflow SDK sleep or webhook hook inside one workflow function.
- The retry scenario terminates a Watt worker thread, not the Kubernetes pod.
- The test validates routing through observed execution identity. It does not query every underlying `workflow_queue_messages.deployment_version` row directly.
- The test does not exercise force-expiration while a step is in flight.
- The test leaves version draining and expiration lifecycle validation to a separate test.
- The test verifies at-least-once retry behavior; it does not claim exactly-once tool side effects.

## Related Platformatic World risks

The passing result proves strict version routing when queue messages contain the correct original deployment version and the old handler remains available. It does not remove these known risks:

- queue enqueue currently trusts the caller-provided deployment ID instead of deriving and validating it against the persisted run;
- webhook resume correctness depends on the SDK preserving the original run deployment;
- no-route retry exhaustion and dead-letter handling can leave workflows non-terminal;
- force-expiration can race with an HTTP dispatch already in flight;
- Kubernetes deployment-version discovery can silently fall back to `local`.

These require separate Platformatic World tests and fixes.
