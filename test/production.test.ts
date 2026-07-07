import { deepStrictEqual, equal, ok } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { request } from 'undici'
import {
  createApplication,
  createTemporaryDirectory,
  prepareChildServer,
  prepareEveApplication,
  runWithSilentOutput
} from './helper.ts'

test('starts Eve production mode directly', async t => {
  const root = await createTemporaryDirectory(t)
  const originalHost = process.env.HOST
  process.env.HOST = 'preserved-host'
  t.after(() => {
    if (typeof originalHost === 'undefined') {
      delete process.env.HOST
    } else {
      process.env.HOST = originalHost
    }
  })

  await prepareEveApplication(root)
  const buildCapability = await createApplication(root, {}, { isProduction: true })
  await runWithSilentOutput(() => buildCapability.build())

  const capability = await createApplication(
    root,
    { eve: { outputDirectory: '.output' } },
    { isProduction: true, serverConfig: { hostname: '127.0.0.1', port: 0 } }
  )
  t.after(() => capability.stop())

  const url = await runWithSilentOutput(() => capability.start({ listen: true }))
  ok(url?.startsWith('http://127.0.0.1:'))
  equal(process.env.HOST, 'preserved-host')

  const response = await capability.inject({ url: '/eve/v1/health' })
  const body = JSON.parse(response.body)

  equal(response.statusCode, 200)
  equal(body.ok, true)
  equal(body.status, 'ready')
  ok(body.workflowId.startsWith('workflow//eve//'))

  await new Promise<void>((resolve, reject) => {
    capability.inject({ url: '/eve/v1/health' }, (err, response) => {
      if (err) {
        reject(err)
        return
      }

      equal(response.statusCode, 200)
      resolve()
    })
  })

  capability.runtimeConfig = { gracefulShutdown: { closeConnections: false } }
  capability.setClosing()
})

test('starts Eve production mode with a child process command', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)
  const server = await prepareChildServer(root)

  const capability = await createApplication(
    root,
    {
      application: {
        commands: {
          production: `node ${server}`
        }
      }
    },
    {
      applicationId: 'test',
      isProduction: true,
      serverConfig: { hostname: '127.0.0.1', port: 0 },
      runtimeConfig: { gracefulShutdown: { application: 1000 } },
      workerId: 0
    }
  )
  t.after(() => capability.stop())

  await capability.start({ listen: true })
  const url = capability.url
  const response = await request(`${url}/child-prod`)

  equal(response.statusCode, 200)
  deepStrictEqual(await response.body.json(), { mode: 'unknown', url: '/child-prod' })
})

test('starts Eve production mode with HTTPS options', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)

  const buildCapability = await createApplication(root, {}, { isProduction: true })
  await runWithSilentOutput(() => buildCapability.build())

  const key = await readFile(new URL('./fixtures/https.key', import.meta.url), 'utf-8')
  const cert = await readFile(new URL('./fixtures/https.crt', import.meta.url), 'utf-8')
  const capability = await createApplication(
    root,
    {},
    {
      isProduction: true,
      serverConfig: {
        hostname: '127.0.0.1',
        https: {
          key,
          cert: [cert]
        },
        port: 0
      }
    }
  )
  t.after(() => capability.stop())

  const url = await runWithSilentOutput(() => capability.start({ listen: true }))
  const response = await capability.inject({ url: '/eve/v1/health' })

  ok(url?.startsWith('https://127.0.0.1:'))
  equal(response.statusCode, 200)
})
