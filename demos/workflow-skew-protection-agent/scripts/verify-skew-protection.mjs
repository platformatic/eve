import { spawn } from 'node:child_process'
import { cp, access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP_NAME = 'workflow-skew-protection-agent'
const NAMESPACE = process.env.SKEW_NAMESPACE ?? 'platformatic'
const EXPECTED_CONTEXT = process.env.SKEW_KUBERNETES_CONTEXT ?? 'k3d-plt-skew-protection'
const COORDINATOR_PORT = readPositiveIntegerEnvironment('SKEW_COORDINATOR_PORT', 39091, 65535)
const OPERATION_TIMEOUT_MS = readPositiveIntegerEnvironment('SKEW_OPERATION_TIMEOUT_MS', 300_000)
const POLL_INTERVAL_MS = 1_000
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEMO_DIR = resolve(SCRIPT_DIR, '..')
const ROOT_DIR = resolve(DEMO_DIR, '../..')
const DESK_ROOT = resolve(process.env.SKEW_DESK_ROOT ?? join(homedir(), 'Programmazione/Work/Platformatic/desk'))
const BASE_URL = normalizeBaseUrl(process.argv[2] ?? `https://svcs.gw.plt/${APP_NAME}`)
const runLabel = readRunLabel(process.env.SKEW_RUN_LABEL ?? `r${Date.now().toString(36)}`)
const oldVersion = `${runLabel}-v1`
const newVersion = `${runLabel}-v2`
const oldImage = `plt.localreg/plt-local/${APP_NAME}:${oldVersion}`
const newImage = `plt.localreg/plt-local/${APP_NAME}:${newVersion}`
const coordinatorUrl = `http://host.k3d.internal:${COORDINATOR_PORT}`
const scenarioIds = {
  inflight: `${runLabel}-inflight`,
  retry: `${runLabel}-retry`,
  between: `${runLabel}-between`,
  control: `${runLabel}-control`
}
const report = {
  runLabel,
  baseUrl: BASE_URL,
  oldVersion,
  newVersion,
  startedAt: new Date().toISOString(),
  scenarios: {},
  commands: [],
  coordinatorEvents: [],
  success: false
}

let buildContext
let coordinator

try {
  coordinator = await createCoordinator(COORDINATOR_PORT)
  console.log(`Coordinator listening on port ${COORDINATOR_PORT}`)

  await preflight()
  await runCommand('npm', ['run', 'build'], { cwd: ROOT_DIR })
  buildContext = await createBuildContext()
  const npmrc = await resolveNpmrc()

  await buildImage(buildContext, oldImage, oldVersion, npmrc)
  await buildImage(buildContext, newImage, newVersion, npmrc)

  console.log(`\nDeploying old version ${oldVersion}`)
  await deployVersion(oldVersion, oldImage)
  await waitForDeployment(oldVersion)
  await waitForRoute({ defaultVersion: oldVersion })

  console.log('\nStarting old-version scenarios')
  const betweenFirstTurn = await sendTurn({ message: `skew-between:${scenarioIds.between}:before` })
  const betweenFirstEvents = await waitForBoundaries(betweenFirstTurn.sessionId, 0, 1)
  validateScenario('between-before', betweenFirstEvents, oldVersion, scenarioIds.between, [1])

  const inflightTurn = await sendTurn({ message: `skew-inflight:${scenarioIds.inflight}` })
  const retryTurn = await sendTurn({ message: `skew-retry:${scenarioIds.retry}` })
  await coordinator.waitFor('entered', scenarioIds.inflight, 1, 1, OPERATION_TIMEOUT_MS)
  await coordinator.waitFor('entered', scenarioIds.retry, 1, 1, OPERATION_TIMEOUT_MS)
  assertCoordinatorVersion(coordinator.eventsFor(scenarioIds.inflight), oldVersion)
  assertCoordinatorVersion(coordinator.eventsFor(scenarioIds.retry), oldVersion)

  console.log(`\nDeploying new version ${newVersion} while old-version steps are blocked`)
  await deployVersion(newVersion, newImage)
  await waitForDeployment(newVersion)
  const skewRoute = await waitForRoute({ defaultVersion: newVersion, retainedVersion: oldVersion })
  await assertDeploymentReady(oldVersion)

  console.log('\nProving new work uses the new default version')
  const controlTurn = await sendTurn({ message: `skew-control:${scenarioIds.control}` })
  const controlEvents = await waitForBoundaries(controlTurn.sessionId, 0, 1)
  const controlExecutions = validateScenario('control', controlEvents, newVersion, scenarioIds.control, [1])

  console.log('\nReleasing old-version in-flight steps')
  coordinator.release(scenarioIds.inflight, 1)
  coordinator.release(scenarioIds.retry, 1)

  const inflightEvents = await waitForBoundaries(inflightTurn.sessionId, 0, 1)
  const retryEvents = await waitForBoundaries(retryTurn.sessionId, 0, 1)
  const inflightExecutions = validateScenario('inflight', inflightEvents, oldVersion, scenarioIds.inflight, [1, 2])
  const retryExecutions = validateScenario('retry', retryEvents, oldVersion, scenarioIds.retry, [1, 2])
  await coordinator.waitFor('entered', scenarioIds.retry, 1, 2, OPERATION_TIMEOUT_MS)
  await coordinator.waitFor('crashed', scenarioIds.retry, 1, 1, OPERATION_TIMEOUT_MS)
  assertCoordinatorVersion(coordinator.eventsFor(scenarioIds.inflight), oldVersion)
  assertCoordinatorVersion(coordinator.eventsFor(scenarioIds.retry), oldVersion)

  console.log('\nContinuing the old session through the new default ingress')
  const betweenSecondTurn = await sendTurn({
    sessionId: betweenFirstTurn.sessionId,
    continuationToken: betweenFirstTurn.continuationToken,
    message: `skew-between:${scenarioIds.between}:after`
  })
  await waitForBoundaries(betweenSecondTurn.sessionId, betweenFirstEvents.length, 1)
  const betweenEvents = await waitForBoundaries(betweenSecondTurn.sessionId, 0, 2)
  const betweenExecutions = validateScenario('between', betweenEvents, oldVersion, scenarioIds.between, [1, 2])
  assertCoordinatorVersion(coordinator.eventsFor(scenarioIds.between), oldVersion)

  report.scenarios = {
    inflight: { sessionId: inflightTurn.sessionId, executions: inflightExecutions },
    retry: { sessionId: retryTurn.sessionId, executions: retryExecutions },
    between: { sessionId: betweenSecondTurn.sessionId, executions: betweenExecutions },
    control: { sessionId: controlTurn.sessionId, executions: controlExecutions }
  }
  report.route = skewRoute
  report.success = true

  console.log('\nSkew protection verification passed:')
  console.log(`  In-flight workflow stayed on ${oldVersion}`)
  console.log(`  Crashed step retried on ${oldVersion}`)
  console.log(`  Persisted session resumed on ${oldVersion}`)
  console.log(`  New control session ran on ${newVersion}`)
} catch (error) {
  report.error = errorMessage(error)
  process.exitCode = 1
  console.error(`\nSkew protection verification failed: ${report.error}`)
} finally {
  coordinator?.releaseAll()
  if (coordinator !== undefined) {
    report.coordinatorEvents = coordinator.events
    await coordinator.close()
  }
  if (buildContext !== undefined) await rm(buildContext, { recursive: true, force: true })
  report.completedAt = new Date().toISOString()
  await writeReport(report)
}

async function preflight () {
  await access(join(DESK_ROOT, 'lib/deploy.js'))
  await access(join(ROOT_DIR, 'package.json'))
  await access(join(DEMO_DIR, 'Dockerfile'))

  const context = (await captureCommand('kubectl', ['config', 'current-context'])).trim()
  if (context !== EXPECTED_CONTEXT) {
    throw new Error(`Expected Kubernetes context ${EXPECTED_CONTEXT}, found ${context}`)
  }

  await runCommand('docker', ['info'], { quiet: true })
  await runCommand('kubectl', [
    '--namespace', NAMESPACE,
    'get', 'deployment/icc', 'deployment/workflow', 'deployment/machinist'
  ], { quiet: true })
}

async function createBuildContext () {
  const context = await mkdtemp(join(tmpdir(), 'eve-skew-build-'))
  const appDirectory = join(context, 'app')
  const eveDirectory = join(context, 'eve-package')
  await mkdir(eveDirectory, { recursive: true })
  await cp(DEMO_DIR, appDirectory, {
    recursive: true,
    filter: source => {
      const path = relative(DEMO_DIR, source)
      const first = path.split('/')[0]
      return !['node_modules', 'dist', '.eve', '.workflow-data', '.generated', '.output', '.skew-results'].includes(first)
    }
  })
  await cp(join(ROOT_DIR, 'package.json'), join(eveDirectory, 'package.json'))
  await cp(join(ROOT_DIR, 'dist'), join(eveDirectory, 'dist'), { recursive: true })
  await cp(join(ROOT_DIR, 'LICENSE'), join(eveDirectory, 'LICENSE'))
  await cp(join(ROOT_DIR, 'README.md'), join(eveDirectory, 'README.md'))
  return context
}

async function resolveNpmrc () {
  const candidates = [
    process.env.SKEW_NPMRC,
    resolve(DEMO_DIR, '../workflow-distribution-agent/.npmrc'),
    join(homedir(), '.npmrc')
  ].filter(value => value !== undefined)

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  throw new Error('No npmrc found. Set SKEW_NPMRC to the private registry configuration')
}

async function buildImage (context, image, version, npmrc) {
  console.log(`\nBuilding ${image}`)
  await runCommand('docker', [
    'build',
    `--tag=${image}`,
    `--file=${join(DEMO_DIR, 'Dockerfile')}`,
    `--build-arg=SKEW_BUILD_VERSION=${version}`,
    `--secret=id=npmrc,src=${npmrc}`,
    context
  ])
}

async function deployVersion (version, image) {
  const { createDeployment, createService } = await import(pathToFileURL(join(DESK_ROOT, 'lib/deploy.js')).href)
  const runDir = await mkdtemp(join(tmpdir(), 'eve-skew-desk-'))
  const context = { runDir }
  const env = { PORT: '3042', SKEW_COORDINATOR_URL: coordinatorUrl }
  const options = {
    context,
    version,
    isWorkflow: true,
    hostname: undefined,
    minReplicas: 1,
    maxReplicas: 1
  }

  try {
    await createDeployment(APP_NAME, image, NAMESPACE, env, false, options)
    await createService(APP_NAME, image, NAMESPACE, false, {
      context,
      version,
      isWorkflow: true,
      headless: false
    })
  } finally {
    await rm(runDir, { recursive: true, force: true })
  }
}

async function waitForDeployment (version) {
  await runCommand('kubectl', [
    '--namespace', NAMESPACE,
    'rollout', 'status', `deployment/${APP_NAME}-${version}`,
    `--timeout=${Math.ceil(OPERATION_TIMEOUT_MS / 1000)}s`
  ])
}

async function assertDeploymentReady (version) {
  const deployment = JSON.parse(await captureCommand('kubectl', [
    '--namespace', NAMESPACE,
    'get', `deployment/${APP_NAME}-${version}`,
    '-o', 'json'
  ]))
  if ((deployment.status?.readyReplicas ?? 0) < 1) {
    throw new Error(`Old deployment ${version} is not Ready during the skew window`)
  }
}

async function waitForRoute ({ defaultVersion, retainedVersion }) {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS
  let lastReason = 'HTTPRoute not found'

  while (Date.now() < deadline) {
    try {
      const route = JSON.parse(await captureCommand('kubectl', [
        '--namespace', NAMESPACE,
        'get', `httproute/${APP_NAME}`,
        '-o', 'json'
      ], { quiet: true }))
      const conditions = route.status?.parents?.flatMap(parent => parent.conditions ?? []) ?? []
      const accepted = conditions.some(condition => condition.type === 'Accepted' && condition.status === 'True')
      const resolved = conditions.some(condition => condition.type === 'ResolvedRefs' && condition.status === 'True')
      const backends = route.spec?.rules?.flatMap(rule => rule.backendRefs ?? []).map(ref => ref.name) ?? []
      const defaultRule = route.spec?.rules?.find(rule =>
        (rule.matches ?? []).some(match => (match.headers ?? []).length === 0)
      )
      const defaultBackend = defaultRule?.backendRefs?.[0]?.name
      const expectedDefault = `${APP_NAME}-${defaultVersion}`
      const expectedRetained = retainedVersion === undefined ? undefined : `${APP_NAME}-${retainedVersion}`

      if (
        accepted &&
        resolved &&
        defaultBackend === expectedDefault &&
        (expectedRetained === undefined || backends.includes(expectedRetained))
      ) {
        return { defaultBackend, backends: [...new Set(backends)], conditions }
      }
      lastReason = `accepted=${accepted}, resolved=${resolved}, default=${defaultBackend}, backends=${backends.join(',')}`
    } catch (error) {
      lastReason = errorMessage(error)
    }
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for HTTPRoute: ${lastReason}`)
}

async function sendTurn ({ sessionId, continuationToken, message }) {
  const path = sessionId === undefined
    ? '/eve/v1/session'
    : `/eve/v1/session/${encodeURIComponent(sessionId)}`
  const body = { message }
  if (continuationToken !== undefined) body.continuationToken = continuationToken

  let lastError
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const response = await requestBuffer(new URL(`${BASE_URL}${path}`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      if ([502, 503, 504].includes(response.statusCode)) {
        throw new Error(`HTTP ${response.statusCode}: ${response.body}`)
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Session turn returned HTTP ${response.statusCode}: ${response.body}`)
      }
      const parsed = JSON.parse(response.body)
      const returnedSessionId = readHeader(response.headers['x-eve-session-id']) ?? parsed.sessionId ?? sessionId
      if (typeof returnedSessionId !== 'string' || returnedSessionId.length === 0) {
        throw new Error('Session turn did not return a session ID')
      }
      const returnedToken = typeof parsed.continuationToken === 'string'
        ? parsed.continuationToken
        : continuationToken
      if (typeof returnedToken !== 'string' || returnedToken.length === 0) {
        throw new Error('Session turn did not return a continuation token')
      }
      return { sessionId: returnedSessionId, continuationToken: returnedToken }
    } catch (error) {
      lastError = error
      await delay(250)
    }
  }
  throw lastError
}

async function waitForBoundaries (sessionId, startIndex, boundaryCount) {
  const url = new URL(
    `${BASE_URL}/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=${startIndex}`
  )
  let lastError

  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      return await readNdjsonUntilBoundary(url, boundaryCount)
    } catch (error) {
      lastError = error
      await delay(250)
    }
  }
  throw lastError
}

function readNdjsonUntilBoundary (url, expectedBoundaries) {
  return new Promise((resolvePromise, rejectPromise) => {
    const events = []
    let buffer = ''
    let boundaries = 0
    let settled = false
    let response

    const request = createRequest(url, { method: 'GET' }, incoming => {
      response = incoming
      if ((incoming.statusCode ?? 0) < 200 || (incoming.statusCode ?? 0) >= 300) {
        const chunks = []
        incoming.on('data', chunk => chunks.push(chunk))
        incoming.on('end', () => fail(new Error(
          `Stream returned HTTP ${incoming.statusCode}: ${Buffer.concat(chunks).toString('utf8')}`
        )))
        return
      }

      incoming.setEncoding('utf8')
      incoming.on('data', chunk => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        try {
          for (const line of lines) {
            if (line.trim().length === 0) continue
            const event = JSON.parse(line)
            events.push(event)
            if (isBoundary(event)) boundaries++
            if (boundaries >= expectedBoundaries) {
              settled = true
              incoming.destroy()
              request.destroy()
              resolvePromise(events)
              return
            }
          }
        } catch (error) {
          fail(error)
        }
      })
      incoming.on('aborted', () => fail(new Error('Stream was aborted')))
      incoming.on('error', fail)
      incoming.on('end', () => {
        if (!settled) fail(new Error(`Stream ended after ${boundaries}/${expectedBoundaries} boundaries`))
      })
    })

    request.setTimeout(OPERATION_TIMEOUT_MS, () => request.destroy(new Error('Stream timed out')))
    request.on('error', fail)
    request.end()

    function fail (error) {
      if (settled) return
      settled = true
      response?.destroy()
      request.destroy()
      rejectPromise(error)
    }
  })
}

function validateScenario (label, events, expectedVersion, scenarioId, expectedStages) {
  const failure = events.find(event => ['session.failed', 'turn.failed', 'step.failed'].includes(event.type))
  if (failure !== undefined) {
    throw new Error(`${label} failed with ${failure.type}: ${JSON.stringify(failure.data)}`)
  }

  const byCallId = new Map()
  for (const event of events) {
    if (
      event.type === 'action.result' &&
      event.data?.status === 'completed' &&
      event.data?.result?.kind === 'tool-result' &&
      event.data.result.toolName === 'probe_skew_execution' &&
      event.data.result.output?.scenarioId === scenarioId
    ) {
      byCallId.set(event.data.result.callId, event.data.result.output)
    }
  }
  const executions = [...byCallId.values()].sort((left, right) => left.stage - right.stage)
  if (executions.length !== expectedStages.length) {
    throw new Error(`${label} expected ${expectedStages.length} executions, received ${executions.length}`)
  }
  for (const [index, execution] of executions.entries()) {
    if (execution.stage !== expectedStages[index]) {
      throw new Error(`${label} expected stage ${expectedStages[index]}, received ${execution.stage}`)
    }
    assertExecutionVersion(execution, expectedVersion, label)
  }
  return executions
}

function assertExecutionVersion (execution, expectedVersion, label) {
  if (execution.deploymentVersion !== expectedVersion) {
    throw new Error(`${label} executed deployment ${execution.deploymentVersion}, expected ${expectedVersion}`)
  }
  if (execution.buildVersion !== expectedVersion) {
    throw new Error(`${label} executed build ${execution.buildVersion}, expected ${expectedVersion}`)
  }
  const expectedPodPrefix = `${APP_NAME}-${expectedVersion}-`
  if (typeof execution.pod !== 'string' || !execution.pod.startsWith(expectedPodPrefix)) {
    throw new Error(`${label} ran on pod ${execution.pod}, expected prefix ${expectedPodPrefix}`)
  }
}

function assertCoordinatorVersion (events, expectedVersion) {
  for (const event of events) {
    const identity = event.identity ?? event
    if (identity.deploymentVersion !== undefined) {
      assertExecutionVersion(identity, expectedVersion, `${event.kind} ${event.scenarioId} stage ${event.stage}`)
    }
  }
}

async function createCoordinator (port) {
  const events = []
  const releases = new Set()
  const crashClaims = new Set()

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      if (request.method === 'GET' && url.pathname.startsWith('/release/')) {
        const [, , scenarioId, stage] = url.pathname.split('/')
        return json(response, 200, { released: releases.has(`${scenarioId}:${stage}`) })
      }
      if (request.method !== 'POST') return json(response, 404, { error: 'not found' })

      const body = await readJsonBody(request)
      if (url.pathname === '/events/entered') {
        const attempt = events.filter(event =>
          event.kind === 'entered' && event.scenarioId === body.scenarioId && event.stage === body.stage
        ).length + 1
        events.push({ kind: 'entered', receivedAt: new Date().toISOString(), attempt, ...body })
        return json(response, 200, { attempt })
      }
      if (url.pathname === '/events/claim-crash') {
        const key = `${body.scenarioId}:${body.stage}`
        const crash = !crashClaims.has(key)
        crashClaims.add(key)
        return json(response, 200, { crash })
      }
      if (url.pathname === '/events/crashed' || url.pathname === '/events/completed') {
        const kind = basename(url.pathname)
        events.push({ kind, receivedAt: new Date().toISOString(), ...body })
        return json(response, 200, { ok: true })
      }
      return json(response, 404, { error: 'not found' })
    } catch (error) {
      return json(response, 500, { error: errorMessage(error) })
    }
  })

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, '0.0.0.0', resolvePromise)
  })

  return {
    events,
    release (scenarioId, stage) {
      releases.add(`${scenarioId}:${stage}`)
    },
    releaseAll () {
      for (const event of events) releases.add(`${event.scenarioId}:${event.stage}`)
    },
    eventsFor (scenarioId) {
      return events.filter(event => event.scenarioId === scenarioId)
    },
    async waitFor (kind, scenarioId, stage, count, timeout) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const matches = events.filter(event =>
          event.kind === kind && event.scenarioId === scenarioId && event.stage === stage
        )
        if (matches.length >= count) return matches
        await delay(100)
      }
      throw new Error(`Timed out waiting for ${count} ${kind} event(s) for ${scenarioId} stage ${stage}`)
    },
    close () {
      return new Promise((resolvePromise, rejectPromise) => {
        server.close(error => error === undefined ? resolvePromise() : rejectPromise(error))
      })
    }
  }
}

function readJsonBody (request) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('error', rejectPromise)
    request.on('end', () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        rejectPromise(error)
      }
    })
  })
}

function json (response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function requestBuffer (url, { method, headers, body }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = createRequest(url, { method, headers }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('error', rejectPromise)
      response.on('end', () => resolvePromise({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }))
    })
    request.setTimeout(OPERATION_TIMEOUT_MS, () => request.destroy(new Error('Request timed out')))
    request.on('error', rejectPromise)
    request.end(body)
  })
}

function createRequest (url, options, callback) {
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  return request(url, {
    ...options,
    ...(url.protocol === 'https:' ? { rejectUnauthorized: false } : {})
  }, callback)
}

function isBoundary (event) {
  return ['session.waiting', 'session.completed', 'session.failed'].includes(event.type)
}

async function runCommand (command, args, { cwd = ROOT_DIR, quiet = false } = {}) {
  report.commands.push({ command, args, cwd })
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: quiet ? 'ignore' : 'inherit'
    })
    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      if (code === 0) return resolvePromise()
      rejectPromise(new Error(`${command} exited with ${code ?? signal}`))
    })
  })
}

function captureCommand (command, args, { quiet = false } = {}) {
  report.commands.push({ command, args, cwd: ROOT_DIR })
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: ROOT_DIR, env: process.env })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', rejectPromise)
    child.on('exit', code => {
      if (code === 0) return resolvePromise(Buffer.concat(stdout).toString('utf8'))
      const detail = Buffer.concat(stderr).toString('utf8').trim()
      if (!quiet && detail.length > 0) console.error(detail)
      rejectPromise(new Error(`${command} exited with ${code}: ${detail}`))
    })
  })
}

async function writeReport (contents) {
  const directory = join(DEMO_DIR, '.skew-results')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${runLabel}.json`)
  await writeFile(path, `${JSON.stringify(contents, null, 2)}\n`)
  console.log(`Report written to ${path}`)
}

function normalizeBaseUrl (value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL must use HTTP or HTTPS')
  return value.replace(/\/+$/, '')
}

function readPositiveIntegerEnvironment (name, defaultValue, maximum = Number.MAX_SAFE_INTEGER) {
  const value = process.env[name]
  if (value === undefined) return defaultValue
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum || String(parsed) !== value) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`)
  }
  return parsed
}

function readRunLabel (value) {
  if (!/^[a-z0-9]{2,20}$/.test(value)) {
    throw new Error('SKEW_RUN_LABEL must contain 2-20 lowercase letters or digits')
  }
  return value
}

function readHeader (value) {
  return Array.isArray(value) ? value[0] : value
}

function delay (milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
}

function errorMessage (error) {
  return error instanceof Error ? error.message : String(error)
}
