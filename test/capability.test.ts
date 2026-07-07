import { equal, rejects } from 'node:assert'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { EveCapability } from '../src/index.ts'
import { createApplication, createTemporaryDirectory, prepareEveApplication, runWithSilentOutput } from './helper.ts'

test('returns existing URL without starting again', async () => {
  const capability = new EveCapability('/tmp', {})
  capability.url = 'http://127.0.0.1:1234'

  equal(await capability.start({ listen: true }), 'http://127.0.0.1:1234')
})

test('returns gateway metadata', () => {
  const capability = new EveCapability('/tmp', {})

  equal(capability.getMeta().gateway.tcp, false)
  equal(capability.getMeta().gateway.needsRootTrailingSlash, false)

  capability.setBasePath('/base')

  equal(capability.getMeta().gateway.prefix, '/base')
  equal(capability.getMeta().gateway.wantsAbsoluteUrls, true)
})

test('stops and marks closing before startup', async () => {
  const capability = new EveCapability('/tmp', {})

  capability.setClosing()
  await capability.stop()

  equal(capability.closing, true)
})

test('initializes application base path metadata', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)

  const capability = await createApplication(root, { application: { basePath: '/api' } }, { isProduction: true })

  await capability.init()

  equal(capability.getMeta().gateway.prefix, '/api/')
  equal(capability.getMeta().gateway.wantsAbsoluteUrls, true)
})

test('cancels production listener when loading built server fails', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)
  await mkdir(resolve(root, '.output'), { recursive: true })

  const capability = await createApplication(
    root,
    {},
    { isProduction: true, serverConfig: { hostname: '127.0.0.1', port: 0 } }
  )

  await rejects(
    runWithSilentOutput(() => capability.start({ listen: true })),
    /ENOENT/
  )
})
