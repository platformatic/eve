import { equal, ok } from 'node:assert'
import { test } from 'node:test'
import { createApplication, createTemporaryDirectory, prepareEveApplication, runWithSilentOutput } from './helper.ts'

test('logger options are available in direct mode', async t => {
  const originalVerbose = process.env.PLT_TESTS_VERBOSE
  process.env.PLT_TESTS_VERBOSE = 'true'
  t.after(() => {
    if (typeof originalVerbose === 'undefined') {
      delete process.env.PLT_TESTS_VERBOSE
    } else {
      process.env.PLT_TESTS_VERBOSE = originalVerbose
    }
  })

  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)

  const capability = await createApplication(
    root,
    {},
    { isProduction: false, serverConfig: { hostname: '127.0.0.1', port: 0 } }
  )
  t.after(() => capability.stop())

  await runWithSilentOutput(() => capability.start({ listen: true }))
  const response = await capability.inject({ url: '/eve/v1/health' })

  equal(response.statusCode, 200)
  equal(capability.logger.level, 'info')
  ok(capability.logger.info)
})
