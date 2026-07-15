# Workflow skew protection agent

This demo verifies that a durable Eve workflow remains pinned to the deployment version that created it while the next version becomes active.

The verifier runs four scenarios during one automated rollout:

| Scenario | Assertion |
| --- | --- |
| In-flight | A step entered on `v1` completes on `v1` after `v2` becomes active. |
| Retry | A step worker exits after `v2` becomes active and the retry still runs on `v1`. |
| Between | A session waiting after stage 1 resumes through the `v2` default ingress, but stage 2 runs on `v1`. |
| Control | A new session created after the rollout runs on `v2`. |

Each probe reports three independent routing signals:

- `deploymentVersion` from `PLT_WORLD_DEPLOYMENT_VERSION`;
- `buildVersion` baked into the image;
- the Kubernetes pod name belonging to the versioned Deployment.

## Requirements

- The active Kubernetes context must be `k3d-plt-skew-protection`.
- The Desk skew-protection profile infrastructure must already be running.
- Docker must be connected to the local `plt.localreg` registry used by the profile.
- A private-registry npmrc must exist. The verifier checks `SKEW_NPMRC`, the distribution demo's `.npmrc`, then `~/.npmrc`.
- The Desk checkout defaults to `~/Programmazione/Work/Platformatic/desk`; override it with `SKEW_DESK_ROOT`.

## Run

From this directory:

```sh
pnpm verify:skew https://svcs.gw.plt/workflow-skew-protection-agent
```

The verifier performs the following operations without interactive pauses:

1. Builds the Eve capability.
2. Builds immutable `v1` and `v2` application images.
3. Deploys `v1` using Desk's workflow-aware deployment primitives.
4. Starts and blocks the old-version scenarios.
5. Deploys `v2` and waits for ICC to make it the default while retaining `v1`.
6. Releases the blocked steps and resumes the persisted session.
7. Validates durable streams and every attempt observed by the coordinator.

Version labels are unique for every invocation. The verifier leaves Kubernetes resources in place for investigation and writes its report under `.skew-results/`.

Optional settings:

```text
SKEW_COORDINATOR_PORT
SKEW_DESK_ROOT
SKEW_KUBERNETES_CONTEXT
SKEW_NAMESPACE
SKEW_NPMRC
SKEW_OPERATION_TIMEOUT_MS
SKEW_RUN_LABEL
```

The coordinator listens on the host and application pods connect through `host.k3d.internal`.

The first validated run, operational findings, known limitations, and exact evidence are recorded in [SKEW-PROTECTION-RESULTS.md](./SKEW-PROTECTION-RESULTS.md).
