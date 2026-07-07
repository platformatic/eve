import { equal, ok } from 'node:assert'
import { test } from 'node:test'
import { request } from 'undici'
import {
  createApplication,
  createTemporaryDirectory,
  prepareChildServer,
  prepareEveApplication,
  runWithSilentOutput
} from './helper.ts'

test('uses backlog option in production direct mode', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)
  const buildCapability = await createApplication(root, {}, { isProduction: true })
  await runWithSilentOutput(() => buildCapability.build())

  const capability = await createApplication(
    root,
    {},
    {
      isProduction: true,
      serverConfig: { backlog: 100, hostname: '127.0.0.1', port: 0 }
    }
  )
  t.after(() => capability.stop())

  await runWithSilentOutput(() => capability.start({ listen: true }))
  const response = await capability.inject({ url: '/eve/v1/health' })
  const body = JSON.parse(response.body)

  equal(response.statusCode, 200)
  equal(body.ok, true)
  ok(body.workflowId.startsWith('workflow//eve//'))
})

for (const [mode, isProduction] of [
  ['development', false],
  ['production', true]
] as const) {
  test(`uses backlog option in ${mode} child process mode`, async t => {
    const root = await createTemporaryDirectory(t)
    await prepareEveApplication(root)
    const server = await prepareChildServer(root)

    const capability = await createApplication(
      root,
      {
        application: {
          commands: {
            [mode]: `node ${server}`
          }
        }
      },
      {
        applicationId: 'test',
        isProduction,
        serverConfig: { backlog: 100, hostname: '127.0.0.1', port: 0 },
        runtimeConfig: { gracefulShutdown: { application: 1000 } },
        workerId: 0
      }
    )
    t.after(() => capability.stop())

    await capability.start({ listen: true })
    const url = capability.url
    const response = await request(`${url}/backlog`)

    equal(((await response.body.json()) as { backlog: number }).backlog, 100)
  })
}
