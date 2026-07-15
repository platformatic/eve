import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'

const evePort = process.env.EVE_NEXT_PRODUCTION_PORT ?? '4274'
const children = new Set()

const eve = start(process.execPath, [join(process.cwd(), '.output/server/index.mjs')], {
  ...process.env,
  HOST: '127.0.0.1',
  PORT: evePort
})

try {
  await Promise.race([
    waitForEve(),
    once(eve, 'exit').then(([code, signal]) => {
      throw new Error(`Eve exited before becoming ready: ${code ?? signal}`)
    })
  ])

  const watt = start(process.execPath, [
    '/usr/local/lib/node_modules/@platformatic/watt-extra/cli.js',
    'start'
  ], process.env)
  const [code, signal] = await once(watt, 'exit')
  stopAll()
  process.exitCode = typeof code === 'number' ? code : signal === 'SIGTERM' ? 0 : 1
} catch (error) {
  stopAll()
  console.error(error)
  process.exitCode = 1
}

function start (command, args, env) {
  const child = spawn(command, args, { env, stdio: 'inherit' })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

async function waitForEve () {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${evePort}/eve/v1/health`)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the embedded Eve server')
}

function stopAll () {
  for (const child of children) child.kill('SIGTERM')
}

process.once('SIGINT', () => {
  stopAll()
  process.exitCode = 0
})
process.once('SIGTERM', () => {
  stopAll()
  process.exitCode = 0
})
