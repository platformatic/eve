import { ok } from 'node:assert'
import { test } from 'node:test'
import { createApplication, createTemporaryDirectory, prepareEveApplication, runWithSilentOutput } from './helper.ts'

for (const [mode, isProduction] of [
  ['development', false],
  ['production', true]
] as const) {
  test(`collects metrics in ${mode} direct mode`, async t => {
    const root = await createTemporaryDirectory(t)
    await prepareEveApplication(root)
    if (isProduction) {
      const buildCapability = await createApplication(root, {}, { isProduction: true })
      await runWithSilentOutput(() => buildCapability.build())
    }

    const capability = await createApplication(
      root,
      {},
      {
        isProduction,
        metricsConfig: { defaultMetrics: true, httpMetrics: true },
        serverConfig: { hostname: '127.0.0.1', port: 0 }
      }
    )
    t.after(() => capability.stop())

    await runWithSilentOutput(() => capability.start({ listen: true }))
    await capability.inject({ url: '/eve/v1/health' })

    const metrics = await capability.metricsRegistry.metrics()
    ok(metrics.includes('http_request_all_duration_seconds'))
    ok(metrics.includes('http_request_all_summary_seconds'))
  })
}
