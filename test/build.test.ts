import { equal } from 'node:assert'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  createApplication,
  createTemporaryDirectory,
  prepareBuildCommand,
  prepareEveApplication,
  runWithSilentOutput
} from './helper.ts'

test('builds an Eve application directly', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)

  const capability = await createApplication(root, {}, { isProduction: true })

  const outputDirectory = await runWithSilentOutput(() => capability.build())

  equal(outputDirectory, resolve(root, '.output'))
  await access(resolve(root, '.output/server/index.mjs'))
})

test('builds an Eve application with a child process command', async t => {
  const root = await createTemporaryDirectory(t)
  await prepareEveApplication(root)
  const command = await prepareBuildCommand(root)

  const capability = await createApplication(
    root,
    {
      application: {
        commands: {
          build: `node ${command}`
        }
      }
    },
    { applicationId: 'test', isProduction: true, workerId: 0 }
  )

  await capability.build()
  equal(await readFile(resolve(root, 'child-built'), 'utf8'), '')
})
