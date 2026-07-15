import { getApplicationId, getWorkerId } from '@platformatic/globals'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { threadId } from 'node:worker_threads'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

const CRASH_PERCENT = 10
const CRASH_EXIT_CODE = 86
const CRASH_MARKER_DIRECTORY = join(tmpdir(), 'eve-workflow-distribution-crashes')

interface ExecutionIdentity {
  pod: string
  applicationId: string
  workerId: number
  threadId: number
  pid: number
}

export default defineTool({
  description: 'Record the pod and Watt worker executing a distribution-test stage.',
  inputSchema: z.object({
    stage: z.number().int().min(1).max(32),
    crash: z.boolean().default(false)
  }),
  async execute ({ stage, crash }, { callId, session }) {
    const identity = getExecutionIdentity()
    const crashRecovery = crash ? await crashOncePerPod(`${session.id}:${callId}`, identity) : undefined

    return {
      stage,
      ...identity,
      ...(crashRecovery === undefined ? {} : { crashRecovery })
    }
  }
})

function getExecutionIdentity (): ExecutionIdentity {
  return {
    pod: process.env.HOSTNAME ?? 'unknown',
    applicationId: getApplicationId(),
    workerId: Number(getWorkerId()),
    threadId,
    pid: process.pid
  }
}

async function crashOncePerPod (callId: string, identity: ExecutionIdentity): Promise<ExecutionIdentity | undefined> {
  const digest = createHash('sha256').update(callId).digest()
  if (digest.readUInt32BE(0) % 100 >= CRASH_PERCENT) {
    return undefined
  }

  await mkdir(CRASH_MARKER_DIRECTORY, { recursive: true })
  const markerPath = join(CRASH_MARKER_DIRECTORY, digest.toString('hex'))

  try {
    const marker = await open(markerPath, 'wx')
    await marker.writeFile(JSON.stringify(identity))
    await marker.sync()
    await marker.close()

    process.exit(CRASH_EXIT_CODE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }

  return JSON.parse(await readFile(markerPath, 'utf8')) as ExecutionIdentity
}
