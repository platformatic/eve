import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const SESSION_COUNT = readPositiveIntegerEnvironment('DISTRIBUTION_SESSION_COUNT', 100)
const STAGE_COUNT = readPositiveIntegerEnvironment('DISTRIBUTION_STAGE_COUNT', 32, 32)
const EXPECTED_PODS = 3
const EXPECTED_WORKERS_PER_POD = 3
const CRASH_PERCENT = 10
const REQUEST_TIMEOUT_MS = 600_000
const FAILURE_EVENTS = new Set(['session.failed', 'step.failed', 'turn.failed'])

if (process.argv.length !== 3) {
  console.error('Usage: node scripts/verify-distribution.mjs <base-url>')
  process.exit(2)
}

const baseUrl = normalizeBaseUrl(process.argv[2])

console.log(
  `Running ${SESSION_COUNT} concurrent crash-recovery sessions with ${STAGE_COUNT} stages ` +
    `and a ${CRASH_PERCENT}% crash selection rate against ${baseUrl}`
)

const settledSessions = await Promise.allSettled(
  Array.from({ length: SESSION_COUNT }, (_, index) => runSession(index + 1))
)
const sessions = []
const failures = []

for (const [index, result] of settledSessions.entries()) {
  if (result.status === 'fulfilled') {
    sessions.push(result.value)
    console.log(`Session ${index + 1}/${SESSION_COUNT} passed (${result.value.sessionId})`)
  } else {
    failures.push(`Session ${index + 1}: ${errorMessage(result.reason)}`)
  }
}

const executions = sessions.flatMap(session => session.executions)
const pods = new Map()

for (const execution of executions) {
  let workers = pods.get(execution.pod)
  if (workers === undefined) {
    workers = new Map()
    pods.set(execution.pod, workers)
  }

  workers.set(execution.workerId, (workers.get(execution.workerId) ?? 0) + 1)
}

console.log('\nExecution distribution:')
for (const [pod, workers] of [...pods.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const counts = [...workers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([workerId, count]) => `worker ${workerId}: ${count}`)
    .join(', ')
  console.log(`  ${pod}: ${counts}`)
}

const durations = sessions.map(session => session.durationMs)
const liveDuplicateCount = sum(sessions.map(session => Math.max(0, session.liveProbeCount - STAGE_COUNT)))
const persistedDuplicateCount = sum(sessions.map(session => session.persistedDuplicateCount))
const crossPodSessions = sessions.filter(
  session => new Set(session.executions.map(execution => execution.pod)).size > 1
)
const crossWorkerSessions = sessions.filter(
  session => new Set(session.executions.map(execution => execution.workerId)).size > 1
)
const crossIdentitySessions = sessions.filter(
  session => new Set(session.executions.map(execution => `${execution.pod}:${execution.workerId}`)).size > 1
)
const crashRecoveries = executions.filter(execution => execution.crashRecovery !== undefined)
const changedIdentityRecoveries = crashRecoveries.filter(
  execution =>
    execution.crashRecovery.pod !== execution.pod || execution.crashRecovery.workerId !== execution.workerId
)

console.log('\nLoad metrics:')
console.log(`  Successful sessions: ${sessions.length}/${SESSION_COUNT}`)
console.log(`  Persisted probe results: ${executions.length}`)
console.log(`  Excess probe results observed on live streams: ${liveDuplicateCount}`)
console.log(`  Persisted retry results deduplicated by callId: ${persistedDuplicateCount}`)
if (durations.length > 0) {
  console.log(
    `  Session latency: p50 ${formatDuration(percentile(durations, 50))}, ` +
      `p95 ${formatDuration(percentile(durations, 95))}, max ${formatDuration(Math.max(...durations))}`
  )
}
console.log(`  Cross-pod sessions: ${formatRatio(crossPodSessions.length, sessions.length)}`)
console.log(`  Cross-worker sessions: ${formatRatio(crossWorkerSessions.length, sessions.length)}`)
console.log(`  Cross pod/worker identity sessions: ${formatRatio(crossIdentitySessions.length, sessions.length)}`)
console.log(`  Recovered injected crashes: ${crashRecoveries.length}`)
console.log(`  Recoveries on a different pod/worker identity: ${changedIdentityRecoveries.length}`)

if (sessions.length !== SESSION_COUNT) {
  failures.push(`Only ${sessions.length}/${SESSION_COUNT} sessions completed successfully`)
}

if (pods.size < EXPECTED_PODS) {
  failures.push(`Expected at least ${EXPECTED_PODS} pods, observed ${pods.size}`)
}

for (const [pod, workers] of pods) {
  if (workers.size < EXPECTED_WORKERS_PER_POD) {
    failures.push(`Expected ${EXPECTED_WORKERS_PER_POD} workers on ${pod}, observed ${workers.size}`)
  }
}

if (crashRecoveries.length === 0) {
  failures.push('No injected worker crash was recovered')
}

if (failures.length > 0) {
  console.error('\nVerification failed:')
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exitCode = 1
} else {
  console.log(
    `\nVerification passed: ${executions.length} stages across ${pods.size} pods and ` +
      `${sum([...pods.values()].map(workers => workers.size))} pod/worker identities.`
  )
}

async function runSession (number) {
  const startedAt = performance.now()
  const createResponse = await requestBuffer(new URL(`${baseUrl}/eve/v1/session`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: `distribution-test:${STAGE_COUNT}:crash` })
  })

  assertSuccess(createResponse, `Session ${number} creation`)

  const sessionId = readSessionId(createResponse)
  if (sessionId === undefined) {
    throw new Error('Creation response did not contain the x-eve-session-id header or a sessionId field')
  }

  const streamUrl = new URL(`${baseUrl}/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=0`)

  try {
    const liveEvents = await readSessionStream(streamUrl)
    const persistedEvents = await readSessionStream(streamUrl)
    const result = validateSession(sessionId, persistedEvents)

    return {
      ...result,
      durationMs: performance.now() - startedAt,
      liveProbeCount: countProbeResults(liveEvents)
    }
  } catch (error) {
    throw new Error(`${sessionId}: ${errorMessage(error)}`, { cause: error })
  }
}

function validateSession (sessionId, events) {
  const failure = events.find(event => FAILURE_EVENTS.has(event.type))
  if (failure !== undefined) {
    throw new Error(`${failure.type}: ${failure.data?.message ?? JSON.stringify(failure.data)}`)
  }

  if (!events.some(event => event.type === 'session.waiting')) {
    throw new Error('Missing session.waiting event')
  }

  const allActionResults = events.filter(
    event =>
      event.type === 'action.result' &&
      event.data?.result?.kind === 'tool-result' &&
      event.data.result.toolName === 'probe_execution'
  )
  const actionResultsByCallId = new Map()
  for (const event of allActionResults) {
    actionResultsByCallId.set(event.data.result.callId, event)
  }
  const actionResults = [...actionResultsByCallId.values()]

  if (actionResults.length !== STAGE_COUNT) {
    throw new Error(`Expected ${STAGE_COUNT} probe results, received ${actionResults.length}`)
  }

  const executions = actionResults.map((event, index) => {
    if (event.data.status !== 'completed' || event.data.result.isError === true) {
      throw new Error(`Probe result ${index + 1} did not complete successfully`)
    }

    const output = event.data.result.output
    validateExecution(output, index + 1)
    return output
  })

  const stages = executions.map(execution => execution.stage)
  const expectedStages = Array.from({ length: STAGE_COUNT }, (_, index) => index + 1)
  if (stages.some((stage, index) => stage !== expectedStages[index])) {
    throw new Error(`Unexpected stage order: ${stages.join(', ')}`)
  }

  const completedMessages = events
    .filter(event => event.type === 'message.completed' && typeof event.data?.message === 'string')
    .map(event => event.data.message)
  const finalMessage = completedMessages.at(-1)
  if (finalMessage === undefined) {
    throw new Error('Missing final message.completed event')
  }

  let finalResult
  try {
    finalResult = JSON.parse(finalMessage)
  } catch {
    throw new Error(`Final message is not valid JSON: ${finalMessage}`)
  }

  if (
    finalResult.ok !== true ||
    finalResult.requestedStages !== STAGE_COUNT ||
    finalResult.completedStages !== STAGE_COUNT ||
    finalResult.crash !== true ||
    !Array.isArray(finalResult.executions) ||
    finalResult.executions.length !== STAGE_COUNT
  ) {
    throw new Error(`Invalid final result: ${finalMessage}`)
  }

  if (JSON.stringify(finalResult.executions) !== JSON.stringify(executions)) {
    throw new Error('Final result executions do not match the streamed probe results')
  }

  return {
    sessionId,
    executions,
    persistedDuplicateCount: allActionResults.length - actionResults.length
  }
}

function countProbeResults (events) {
  return events.filter(
    event =>
      event.type === 'action.result' &&
      event.data?.result?.kind === 'tool-result' &&
      event.data.result.toolName === 'probe_execution'
  ).length
}

function validateExecution (execution, expectedStage) {
  if (execution === null || typeof execution !== 'object') {
    throw new Error(`Stage ${expectedStage} output is not an object`)
  }

  if (execution.stage !== expectedStage) {
    throw new Error(`Expected stage ${expectedStage}, received ${execution.stage}`)
  }

  validateIdentity(execution, `Stage ${expectedStage}`)

  if (execution.crashRecovery !== undefined) {
    validateIdentity(execution.crashRecovery, `Stage ${expectedStage} crashRecovery`)
  }
}

function validateIdentity (identity, label) {
  if (identity === null || typeof identity !== 'object') {
    throw new Error(`${label} identity is not an object`)
  }

  if (typeof identity.pod !== 'string' || identity.pod.length === 0 || identity.pod === 'unknown') {
    throw new Error(`${label} has an invalid pod`)
  }

  if (typeof identity.applicationId !== 'string' || identity.applicationId.length === 0) {
    throw new Error(`${label} has an invalid applicationId`)
  }

  for (const field of ['workerId', 'threadId', 'pid']) {
    if (!Number.isInteger(identity[field])) {
      throw new Error(`${label} has an invalid ${field}`)
    }
  }
}

function normalizeBaseUrl (value) {
  let url
  try {
    url = new URL(value)
  } catch {
    console.error(`Invalid base URL: ${value}`)
    process.exit(2)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    console.error('The base URL must use http or https')
    process.exit(2)
  }

  return value.replace(/\/+$/, '')
}

function readPositiveIntegerEnvironment (name, defaultValue, maximum = Number.MAX_SAFE_INTEGER) {
  const value = process.env[name]
  if (value === undefined) {
    return defaultValue
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum || String(parsed) !== value) {
    console.error(`${name} must be an integer from 1 to ${maximum}`)
    process.exit(2)
  }

  return parsed
}

function readSessionId (response) {
  const header = response.headers['x-eve-session-id']
  if (typeof header === 'string' && header.length > 0) {
    return header
  }

  try {
    const body = JSON.parse(response.body)
    return typeof body.sessionId === 'string' ? body.sessionId : undefined
  } catch {
    return undefined
  }
}

function assertSuccess (response, operation) {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${operation} returned HTTP ${response.statusCode}: ${response.body}`)
  }
}

function requestBuffer (url, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const request = createRequest(url, { method, headers }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        })
      })
    })

    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Request timed out')))
    request.on('error', reject)
    request.end(body)
  })
}

function readNdjsonStream (url) {
  return new Promise((resolve, reject) => {
    const events = []
    let buffer = ''
    let settled = false
    let response

    const request = createRequest(url, { method: 'GET' }, incoming => {
      response = incoming
      if ((incoming.statusCode ?? 0) < 200 || (incoming.statusCode ?? 0) >= 300) {
        const chunks = []
        incoming.on('data', chunk => chunks.push(chunk))
        incoming.on('end', () => {
          const error = new Error(`Stream returned HTTP ${incoming.statusCode}: ${Buffer.concat(chunks).toString('utf8')}`)
          error.statusCode = incoming.statusCode
          fail(error)
        })
        return
      }

      incoming.setEncoding('utf8')
      incoming.on('data', chunk => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.trim().length === 0) continue

          let event
          try {
            event = JSON.parse(line)
          } catch {
            fail(new Error(`Invalid NDJSON event: ${line}`))
            return
          }

          events.push(event)
          if (event.type === 'session.waiting' || event.type === 'session.completed' || event.type === 'session.failed') {
            succeed()
            return
          }
        }
      })
      incoming.on('end', () => {
        if (buffer.trim().length > 0) {
          try {
            events.push(JSON.parse(buffer))
          } catch {
            fail(new Error(`Invalid trailing NDJSON event: ${buffer}`))
            return
          }
        }
        succeed()
      })
      incoming.on('error', fail)
    })

    const timeout = setTimeout(() => fail(new Error('Stream timed out')), REQUEST_TIMEOUT_MS)
    request.on('error', fail)
    request.end()

    function succeed () {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      response?.destroy()
      resolve(events)
    }

    function fail (error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      response?.destroy()
      request.destroy()
      reject(error)
    }
  })
}

async function readSessionStream (url) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS
  let lastError

  while (Date.now() < deadline) {
    try {
      const events = await readNdjsonStream(url)
      if (events.some(event => isSessionBoundary(event.type))) {
        return events
      }
      lastError = new Error('Stream ended before a session boundary')
    } catch (error) {
      if (!isRetryableStreamError(error)) {
        throw error
      }
      lastError = error
    }

    await delay(250)
  }

  throw new Error(`Stream did not reach a session boundary: ${errorMessage(lastError)}`, { cause: lastError })
}

function isSessionBoundary (type) {
  return type === 'session.waiting' || type === 'session.completed' || type === 'session.failed'
}

function isRetryableStreamError (error) {
  if (!(error instanceof Error)) return false
  if ([404, 502, 503, 504].includes(error.statusCode)) return true

  return /aborted|connection|reset|socket|timed out/i.test(error.message)
}

function delay (milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function createRequest (url, options, callback) {
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  return request(url, {
    ...options,
    ...(url.protocol === 'https:' ? { rejectUnauthorized: false } : {})
  }, callback)
}

function errorMessage (error) {
  return error instanceof Error ? error.message : String(error)
}

function sum (values) {
  return values.reduce((total, value) => total + value, 0)
}

function percentile (values, value) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1)
  return sorted[index]
}

function formatDuration (milliseconds) {
  return `${(milliseconds / 1000).toFixed(2)}s`
}

function formatRatio (count, total) {
  const percentage = total === 0 ? 0 : (count / total) * 100
  return `${count}/${total} (${percentage.toFixed(1)}%)`
}
