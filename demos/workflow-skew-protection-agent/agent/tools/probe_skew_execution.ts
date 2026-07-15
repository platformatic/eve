import { getApplicationId, getWorkerId } from '@platformatic/globals'
import { setTimeout as delay } from 'node:timers/promises'
import { threadId } from 'node:worker_threads'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

const POLL_INTERVAL_MS = 200
const COORDINATOR_TIMEOUT_MS = 240_000

interface ExecutionIdentity {
  deploymentVersion: string
  buildVersion: string
  pod: string
  applicationId: string
  workerId: number
  threadId: number
  pid: number
}

export default defineTool({
  description: 'Record and coordinate a skew-protection test stage.',
  inputSchema: z.object({
    scenarioId: z.string().regex(/^[a-z0-9-]+$/),
    stage: z.number().int().min(1).max(2),
    behavior: z.enum(['normal', 'hold', 'hold-crash'])
  }),
  async execute ({ scenarioId, stage, behavior }, { callId, session }) {
    const identity = getExecutionIdentity()
    const event = { scenarioId, stage, behavior, callId, sessionId: session.id, identity }
    const entered = await coordinatorRequest('/events/entered', { method: 'POST', body: event })

    if (behavior !== 'normal') {
      await waitForRelease(scenarioId, stage)
    }

    if (behavior === 'hold-crash') {
      const claim = await coordinatorRequest('/events/claim-crash', { method: 'POST', body: event }) as { crash: boolean }
      if (claim.crash) {
        await coordinatorRequest('/events/crashed', { method: 'POST', body: { ...event, attempt: entered.attempt } })
        process.exit(86)
      }
    }

    const result = {
      scenarioId,
      stage,
      behavior,
      callId,
      attempt: entered.attempt,
      ...identity
    }
    await coordinatorRequest('/events/completed', { method: 'POST', body: result })
    return result
  }
})

function getExecutionIdentity (): ExecutionIdentity {
  return {
    deploymentVersion: process.env.PLT_WORLD_DEPLOYMENT_VERSION ?? 'unknown',
    buildVersion: process.env.SKEW_BUILD_VERSION ?? 'unknown',
    pod: process.env.HOSTNAME ?? 'unknown',
    applicationId: getApplicationId(),
    workerId: Number(getWorkerId()),
    threadId,
    pid: process.pid
  }
}

async function waitForRelease (scenarioId: string, stage: number): Promise<void> {
  const deadline = Date.now() + COORDINATOR_TIMEOUT_MS
  while (Date.now() < deadline) {
    const state = await coordinatorRequest(
      `/release/${encodeURIComponent(scenarioId)}/${stage}`,
      { method: 'GET' }
    ) as { released: boolean }
    if (state.released) return
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for release of ${scenarioId} stage ${stage}`)
}

async function coordinatorRequest (
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown }
): Promise<any> {
  const baseUrl = process.env.SKEW_COORDINATOR_URL
  if (baseUrl === undefined) throw new Error('SKEW_COORDINATOR_URL is not configured')

  const response = await fetch(new URL(path, baseUrl), {
    method: options.method,
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) {
    throw new Error(`Coordinator ${options.method} ${path} returned HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}
