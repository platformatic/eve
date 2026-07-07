import type { ConfigurationOptions } from '@platformatic/foundation'
import { createDirectory } from '@platformatic/foundation'
import { existsSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { EveCapability, PlatformaticEveConfig } from '../src/index.ts'
import { create } from '../src/index.ts'

const defaultDependencies = ['typescript']

export async function createApplication (
  root: string,
  config: PlatformaticEveConfig = {},
  context: ConfigurationOptions = {}
): Promise<EveCapability> {
  const level =
    process.env.PLT_TESTS_DEBUG === 'true' ? 'debug' : process.env.PLT_TESTS_VERBOSE === 'true' ? 'info' : 'fatal'

  return create(
    root,
    {
      ...config,
      logger: {
        ...config.logger,
        level
      }
    },
    context
  )
}

export async function runWithSilentOutput<T> (fn: () => Promise<T>): Promise<T> {
  if (process.env.PLT_TESTS_VERBOSE === 'true' || process.env.PLT_TESTS_DEBUG === 'true') {
    return fn()
  }

  const stdoutWrite = process.stdout.write
  const stderrWrite = process.stderr.write

  try {
    process.stdout.write = (() => true) as typeof process.stdout.write
    process.stderr.write = (() => true) as typeof process.stderr.write
    return await fn()
  } finally {
    process.stdout.write = stdoutWrite
    process.stderr.write = stderrWrite
  }
}

export async function createTemporaryDirectory (t: TestContext): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'plt-eve-'))
  t.after(() => {
    process.once('exit', () => {
      rmSync(root, { recursive: true, force: true })
    })
  })
  return root
}

export async function prepareEveApplication (root: string): Promise<void> {
  await mkdir(resolve(root, 'agent'), { recursive: true })
  await mkdir(resolve(root, '.eve/nitro/workflow'), { recursive: true })
  await writeFile(resolve(root, 'package.json'), JSON.stringify({ type: 'module', dependencies: { eve: '0.20.0' } }))
  await writeFile(
    resolve(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'esnext' } })
  )
  await writeFile(resolve(root, 'agent/instructions.md'), 'You are a deterministic test assistant.\n')
  await writeFile(resolve(root, '.eve/nitro/workflow/steps.mjs'), '')
  await writeFile(
    resolve(root, 'agent/agent.ts'),
    `import { defineAgent } from 'eve'
import { mockModel } from 'eve/evals'

export default defineAgent({
  model: mockModel('Hello from Eve'),
  modelContextWindowTokens: 100000
})
`
  )
  await ensureDependencies([root])
}

export async function prepareChildServer (root: string): Promise<string> {
  const file = resolve(root, 'child-server.mjs')

  await writeFile(
    file,
    `import { tracingChannel } from 'node:diagnostics_channel'
import { createServer } from 'node:http'

let backlog

tracingChannel('net.server.listen').subscribe({
  asyncStart ({ options }) {
    backlog = options.backlog
  }
})

const server = createServer(async (req, res) => {
  if (req.url === '/fetch') {
    const response = await fetch(process.env.EVE_TEST_FETCH_URL)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, body: await response.json() }))
    return
  }

  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({
    backlog,
    mode: process.env.NODE_ENV ?? 'unknown',
    url: req.url
  }))
})

server.listen(0)
`
  )

  return file
}

export async function prepareBuildCommand (root: string): Promise<string> {
  const file = resolve(root, 'build-command.mjs')

  await writeFile(
    file,
    `import { writeFile } from 'node:fs/promises'

await writeFile('child-built', '')
`
  )

  return file
}

export async function ensureDependencies (paths: string[]): Promise<void> {
  const require = createRequire(import.meta.url)

  for (const path of paths) {
    const binFolder = resolve(path, 'node_modules/.bin')
    await createDirectory(binFolder)

    const packageJsonPath = resolve(path, 'package.json')
    const { dependencies, devDependencies } = existsSync(packageJsonPath)
      ? JSON.parse(await readFile(packageJsonPath, 'utf-8'))
      : {}

    const allDeps = Array.from(
      new Set([...Object.keys(dependencies ?? {}), ...Object.keys(devDependencies ?? {}), ...defaultDependencies])
    )

    for (const dep of allDeps) {
      const moduleRoot = resolve(path, 'node_modules', dep)
      let resolved = require.resolve(dep)

      while (!existsSync(resolve(resolved, 'package.json'))) {
        const parent = dirname(resolved)

        if (parent === resolved) {
          throw new Error(`Cannot resolve package root for ${dep}`)
        }

        resolved = parent
      }

      if (dep.includes('/')) {
        await createDirectory(resolve(path, 'node_modules', dirname(dep)))
      }

      try {
        await symlink(resolved, moduleRoot, 'dir')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw err
        }
      }

      const { bin } = JSON.parse(await readFile(resolve(moduleRoot, 'package.json'), 'utf-8'))

      for (const [name, destination] of Object.entries(bin ?? {})) {
        try {
          await symlink(resolve(moduleRoot, destination as string), resolve(binFolder, name), 'file')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw err
          }
        }
      }
    }
  }
}

export async function swapVersion (t: TestContext, pkg: string, newVersion = '1.0.0'): Promise<void> {
  const packageJson = fileURLToPath(import.meta.resolve(`${pkg}/package.json`))
  const originalContents = await readFile(packageJson, 'utf-8')
  const newContents = JSON.parse(originalContents)

  newContents.version = newVersion
  await writeFile(packageJson, JSON.stringify(newContents))
  t.after(() => writeFile(packageJson, originalContents))
}
