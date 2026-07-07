import { deepStrictEqual, equal, ok } from 'node:assert'
import { test } from 'node:test'
import { request } from 'undici'
import {
  createApplication,
  createTemporaryDirectory,
  prepareChildServer,
  prepareEveApplication,
  runWithSilentOutput
} from './helper.ts'

test('starts Eve development mode directly', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)

  const capability = await createApplication(
    root,
    {},
    { isProduction: false, serverConfig: { hostname: '127.0.0.1', port: 0 } }
  )
  t.after(() => capability.stop())

  const url = await runWithSilentOutput(() => capability.start({ listen: true }))
  const response = await capability.inject({ url: '/eve/v1/health' })
  const body = JSON.parse(response.body)

  equal(response.statusCode, 200)
  equal(body.ok, true)
  equal(body.status, 'ready')
  ok(body.workflowId.startsWith('workflow//eve//'))
  ok(url?.startsWith('http://127.0.0.1:'))
  equal(url, capability.url)
})

test('starts Eve development mode with a child process command', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)
  const server = await prepareChildServer(root)

  const capability = await createApplication(
    root,
    {
      application: {
        commands: {
          development: `node ${server}`
        }
      }
    },
    {
      applicationId: 'test',
      isProduction: false,
      serverConfig: { hostname: '127.0.0.1', port: 0 },
      runtimeConfig: { gracefulShutdown: { application: 1000 } },
      workerId: 0
    }
  )
  t.after(() => capability.stop())

  await capability.start({ listen: true })
  const url = capability.url
  const response = await request(`${url}/child-dev`)

  equal(response.statusCode, 200)
  deepStrictEqual(await response.body.json(), { mode: 'unknown', url: '/child-dev' })
})
