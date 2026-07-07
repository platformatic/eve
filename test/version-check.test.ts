import { rejects } from 'node:assert'
import { test } from 'node:test'
import { createApplication, createTemporaryDirectory, prepareEveApplication, swapVersion } from './helper.ts'

test('checks Eve version in development mode', async t => {
  await swapVersion(t, 'eve', '0.19.0')
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)

  const capability = await createApplication(root, {}, { isProduction: false })

  await rejects(capability.start({ listen: true }), /eve version 0.19.0 is not supported/)
})

test('does not check Eve version in production mode', async t => {
  await swapVersion(t, 'eve', '0.19.0')
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)

  const capability = await createApplication(root, {}, { isProduction: true })

  await capability.init()
})
