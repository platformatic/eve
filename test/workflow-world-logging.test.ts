import { ok } from 'node:assert'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { createApplication, createTemporaryDirectory, prepareEveApplication, runWithSilentOutput } from './helper.ts'

// Capture what the capability logs at info level during a build.
async function buildCapturingInfo (root: string): Promise<string[]> {
  const capability = await createApplication(root, {}, { isProduction: true })
  const messages: string[] = []
  const logger = capability.logger as unknown as { info: (...args: unknown[]) => void }
  const original = logger.info.bind(logger)

  logger.info = (...args: unknown[]) => {
    // Signature is either (message) or (mergeObject, message).
    const message = args.length > 1 ? args[1] : args[0]
    if (typeof message === 'string') messages.push(message)
    original(...args)
  }

  await runWithSilentOutput(() => capability.build())
  return messages
}

test('reports the bundled local world when the agent configures none', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)

  const messages = await buildCapturingInfo(root)
  const line = messages.find(m => m.startsWith('Eve workflow world:'))

  ok(line, `expected a workflow world line, got: ${JSON.stringify(messages)}`)
  ok(line.includes('local'), `expected the local world to be reported, got: ${line}`)
  // The fallback is the silent one, so it must say how to change it.
  ok(line.includes('experimental.workflow.world'), `expected remediation advice, got: ${line}`)
})

test('reports the configured world when the agent sets one', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)

  // Point the agent at a world other than the default.
  const agentPath = resolve(root, 'agent/agent.ts')
  const agent = await readFile(agentPath, 'utf-8')
  await writeFile(
    agentPath,
    agent.replace(
      'modelContextWindowTokens: 100000',
      `modelContextWindowTokens: 100000,
  experimental: {
    workflow: {
      world: '@workflow/world-local'
    }
  }`
    )
  )

  const messages = await buildCapturingInfo(root)
  const line = messages.find(m => m.startsWith('Eve workflow world:'))

  ok(line, `expected a workflow world line, got: ${JSON.stringify(messages)}`)
  ok(line.includes('@workflow/world-local'), `expected the configured world to be reported, got: ${line}`)
})
