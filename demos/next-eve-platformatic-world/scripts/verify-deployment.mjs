import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP_NAME = 'next-eve-platformatic-world'
const NAMESPACE = process.env.NEXT_EVE_NAMESPACE ?? 'platformatic'
const EXPECTED_CONTEXT = process.env.NEXT_EVE_KUBERNETES_CONTEXT ?? 'k3d-plt-skew-protection'
const TIMEOUT_MS = readPositiveIntegerEnvironment('NEXT_EVE_TIMEOUT_MS', 600_000)
const STAGE_COUNT = readPositiveIntegerEnvironment('NEXT_EVE_STAGES', 3)
if (STAGE_COUNT > 8) throw new Error('NEXT_EVE_STAGES must not exceed 8')
const EXPECTED_OPERATIONS = [
  ['POST /campaigns/velocity/plan', 'Campaign API'],
  ['QUERY audience_graph', 'Audience service'],
  ['POST /inventory/reservations', 'Inventory API'],
  ['POST /creative/render', 'Creative engine'],
  ['POST /channels/schedule', 'Channel scheduler'],
  ['POST /campaigns/velocity/publish', 'Campaign API']
]
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEMO_DIR = resolve(SCRIPT_DIR, '..')
const ROOT_DIR = resolve(DEMO_DIR, '../..')
const DESK_ROOT = resolve(process.env.NEXT_EVE_DESK_ROOT ?? join(homedir(), 'Programmazione/Work/Platformatic/desk'))
const reusedVersion = process.env.NEXT_EVE_REUSE_VERSION
const runLabel = `r${Date.now().toString(36)}`
const version = reusedVersion ?? `${runLabel}-v1`
const image = `plt.localreg/plt-local/${APP_NAME}:${version}`
const baseUrl = normalizeBaseUrl(process.argv[2] ?? `https://svcs.gw.plt/${APP_NAME}`)
const report = {
  runLabel,
  version,
  image,
  baseUrl,
  startedAt: new Date().toISOString(),
  success: false
}

try {
  await preflight()
  if (reusedVersion === undefined) {
    const npmrc = await resolveNpmrc()
    await buildImage(npmrc)
    await deployVersion()
  }
  await waitForDeployment()
  report.route = await waitForRoute()

  const page = await retryRequest(new URL(`${baseUrl}/`))
  assertStatus(page, 200, 'Next page')
  if (!page.body.includes('One brief.') || !page.body.includes('Campaign live.') || !page.body.includes('Current action')) {
    throw new Error('Next page did not contain the campaign launch markers')
  }
  report.assets = await validatePageAssets(page.body)

  const health = await retryRequest(new URL(`${baseUrl}/eve/v1/health`))
  assertStatus(health, 200, 'Eve health')

  const workflowStartedAt = Date.now()
  const create = await retryRequest(new URL(`${baseUrl}/eve/v1/session`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: STAGE_COUNT === 6
        ? 'Launch the Velocity running shoe campaign across Europe.'
        : `next-eve-diagnostic:${STAGE_COUNT}`
    })
  })
  if (![200, 202].includes(create.statusCode)) {
    throw new Error(`Eve session creation returned HTTP ${create.statusCode}: ${create.body}`)
  }
  const createBody = JSON.parse(create.body)
  const sessionId = readHeader(create.headers['x-eve-session-id']) ?? createBody.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('Session creation did not return a session ID')
  }

  const events = await readSession(sessionId)
  const executions = validateSession(events, STAGE_COUNT)
  report.workflowDurationMs = Date.now() - workflowStartedAt
  const continuationToken = createBody.continuationToken
  if (typeof continuationToken !== 'string' || continuationToken.length === 0) {
    throw new Error('Session creation did not return a continuation token')
  }
  const continuation = await retryRequest(new URL(`${baseUrl}/eve/v1/session/${encodeURIComponent(sessionId)}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'status', continuationToken })
  })
  if (![200, 202].includes(continuation.statusCode)) {
    throw new Error(`Eve session continuation returned HTTP ${continuation.statusCode}: ${continuation.body}`)
  }
  const continuationEvents = await readSession(sessionId, events.length)
  validateContinuation(continuationEvents)
  report.sessionId = sessionId
  report.executions = executions
  report.eventCount = events.length
  report.continuationEventCount = continuationEvents.length
  report.success = true

  console.log('\nNext plus Eve deployment verification passed:')
  console.log(`  Next page: ${baseUrl}/`)
  console.log(`  Eve health: ${baseUrl}/eve/v1/health`)
  console.log(`  Session: ${sessionId}`)
  console.log(`  Workflow callback completed through Next on ${version}`)
} catch (error) {
  report.error = errorMessage(error)
  process.exitCode = 1
  console.error(`\nNext plus Eve deployment verification failed: ${report.error}`)
} finally {
  report.completedAt = new Date().toISOString()
  await writeReport(report)
}

async function preflight () {
  await access(join(DESK_ROOT, 'lib/deploy.js'))
  const context = (await captureCommand('kubectl', ['config', 'current-context'])).trim()
  if (context !== EXPECTED_CONTEXT) {
    throw new Error(`Expected Kubernetes context ${EXPECTED_CONTEXT}, found ${context}`)
  }
  await runCommand('docker', ['info'], { quiet: true })
  await runCommand('kubectl', [
    '--namespace', NAMESPACE,
    'rollout', 'status', 'deployment/workflow',
    `--timeout=${Math.ceil(TIMEOUT_MS / 1000)}s`
  ])
  await runCommand('kubectl', [
    '--namespace', NAMESPACE,
    'get', 'deployment/icc', 'deployment/machinist'
  ], { quiet: true })
}

async function resolveNpmrc () {
  const candidates = [
    process.env.NEXT_EVE_NPMRC,
    resolve(DEMO_DIR, '../workflow-distribution-agent/.npmrc'),
    join(homedir(), '.npmrc')
  ].filter(value => value !== undefined)
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  throw new Error('No npmrc found. Set NEXT_EVE_NPMRC to the private registry configuration')
}

async function buildImage (npmrc) {
  console.log(`Building ${image}`)
  await runCommand('docker', [
    'build',
    `--tag=${image}`,
    `--file=${join(DEMO_DIR, 'Dockerfile')}`,
    `--build-arg=NEXT_EVE_BUILD_VERSION=${version}`,
    `--secret=id=npmrc,src=${npmrc}`,
    DEMO_DIR
  ], { cwd: DEMO_DIR })
}

async function deployVersion () {
  const { createDeployment, createService } = await import(pathToFileURL(join(DESK_ROOT, 'lib/deploy.js')).href)
  const runDir = await mkdtemp(join(DEMO_DIR, '.desk-run-'))
  const context = { runDir }
  const options = {
    context,
    version,
    isWorkflow: true,
    hostname: undefined,
    minReplicas: 1,
    maxReplicas: 1
  }
  try {
    await createDeployment(APP_NAME, image, NAMESPACE, {
      PORT: '3042',
      EVE_NEXT_PRODUCTION_PORT: '4274'
    }, false, options)
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

async function waitForDeployment () {
  await runCommand('kubectl', [
    '--namespace', NAMESPACE,
    'rollout', 'status', `deployment/${APP_NAME}-${version}`,
    `--timeout=${Math.ceil(TIMEOUT_MS / 1000)}s`
  ])
}

async function waitForRoute () {
  const deadline = Date.now() + TIMEOUT_MS
  const expectedBackend = `${APP_NAME}-${version}`
  let detail = 'route not found'
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
      const defaultRule = route.spec?.rules?.find(rule =>
        (rule.matches ?? []).some(match => (match.headers ?? []).length === 0)
      )
      const backend = defaultRule?.backendRefs?.[0]?.name
      if (accepted && resolved && backend === expectedBackend) {
        return { backend, conditions }
      }
      detail = `accepted=${accepted}, resolved=${resolved}, backend=${backend}`
    } catch (error) {
      detail = errorMessage(error)
    }
    await delay(1_000)
  }
  throw new Error(`Timed out waiting for HTTPRoute: ${detail}`)
}

async function retryRequest (url, options = { method: 'GET' }) {
  let lastError
  for (let attempt = 1; attempt <= 60; attempt++) {
    try {
      const response = await requestBuffer(url, options)
      if ([502, 503, 504].includes(response.statusCode)) {
        throw new Error(`HTTP ${response.statusCode}: ${response.body}`)
      }
      return response
    } catch (error) {
      lastError = error
      await delay(500)
    }
  }
  throw lastError
}

function readSession (sessionId, startIndex = 0) {
  const url = new URL(`${baseUrl}/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=${startIndex}`)
  return new Promise((resolvePromise, rejectPromise) => {
    const events = []
    let buffer = ''
    let settled = false
    let response
    const request = createRequest(url, { method: 'GET' }, incoming => {
      response = incoming
      if ((incoming.statusCode ?? 0) < 200 || (incoming.statusCode ?? 0) >= 300) {
        return fail(new Error(`Stream returned HTTP ${incoming.statusCode}`))
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
            if (['session.waiting', 'session.completed', 'session.failed'].includes(event.type)) {
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
        if (!settled) fail(new Error('Stream ended before a session boundary'))
      })
    })
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error('Stream timed out')))
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

function validateSession (events, stageCount) {
  const failure = events.find(event => ['session.failed', 'turn.failed', 'step.failed'].includes(event.type))
  if (failure !== undefined) throw new Error(`${failure.type}: ${JSON.stringify(failure.data)}`)
  const results = events.filter(event =>
    event.type === 'action.result' &&
    event.data?.status === 'completed' &&
    event.data?.result?.toolName === 'probe_execution'
  ).map(event => event.data.result.output)
  if (results.length !== stageCount) throw new Error(`Expected ${stageCount} probe results, received ${results.length}`)
  const expectedPodPrefix = `${APP_NAME}-${version}-`
  for (const [index, result] of results.entries()) {
    if (result.stage !== index + 1) throw new Error(`Unexpected stage order at result ${index + 1}`)
    if (result.deploymentVersion !== version || result.buildVersion !== version) {
      throw new Error(`Stage ${result.stage} executed version ${result.deploymentVersion}/${result.buildVersion}`)
    }
    if (typeof result.pod !== 'string' || !result.pod.startsWith(expectedPodPrefix)) {
      throw new Error(`Stage ${result.stage} executed on unexpected pod ${result.pod}`)
    }
    if (typeof result.metricLabel !== 'string' || typeof result.metricValue !== 'string') {
      throw new Error(`Stage ${result.stage} did not return campaign metrics`)
    }
    const expectedOperation = EXPECTED_OPERATIONS[index]
    if (expectedOperation !== undefined && (result.action !== expectedOperation[0] || result.system !== expectedOperation[1])) {
      throw new Error(`Stage ${result.stage} returned unexpected operation ${result.action}/${result.system}`)
    }
    if (expectedOperation === undefined && (typeof result.action !== 'string' || typeof result.system !== 'string')) {
      throw new Error(`Stage ${result.stage} did not return operation metadata`)
    }
  }
  if (!events.some(event => event.type === 'session.waiting')) {
    throw new Error('Missing session.waiting boundary')
  }
  return results
}

function validateContinuation (events) {
  const failure = events.find(event => ['session.failed', 'turn.failed', 'step.failed'].includes(event.type))
  if (failure !== undefined) throw new Error(`Continuation ${failure.type}: ${JSON.stringify(failure.data)}`)
  if (!events.some(event => event.type === 'message.completed')) {
    throw new Error('Continued session did not complete a message')
  }
  if (!events.some(event => event.type === 'session.waiting')) {
    throw new Error('Continued session did not return to session.waiting')
  }
}

async function validatePageAssets (html) {
  const publicPath = new URL(baseUrl).pathname.replace(/\/+$/, '')
  const paths = [...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)]
    .map(match => match[1])
    .filter((value, index, values) => values.indexOf(value) === index)
  if (paths.length === 0) throw new Error('Next page did not reference any static assets')
  for (const path of paths) {
    if (!path.startsWith(`${publicPath}/_next/static/`)) {
      throw new Error(`Next asset is missing the public base path: ${path}`)
    }
    const response = await retryRequest(new URL(path, `${baseUrl}/`))
    assertStatus(response, 200, `Next asset ${path}`)
  }
  return paths
}

function requestBuffer (url, { method = 'GET', headers, body } = {}) {
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
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error('Request timed out')))
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

function assertStatus (response, expected, label) {
  if (response.statusCode !== expected) {
    throw new Error(`${label} returned HTTP ${response.statusCode}: ${response.body}`)
  }
}

async function runCommand (command, args, { cwd = ROOT_DIR, quiet = false } = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: quiet ? 'ignore' : 'inherit' })
    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      if (code === 0) return resolvePromise()
      rejectPromise(new Error(`${command} exited with ${code ?? signal}`))
    })
  })
}

function captureCommand (command, args, { quiet = false } = {}) {
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
  const directory = join(DEMO_DIR, '.deployment-results')
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

function readPositiveIntegerEnvironment (name, defaultValue) {
  const value = process.env[name]
  if (value === undefined) return defaultValue
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
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
