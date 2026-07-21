import { defineAgent } from 'eve'
import { mockModel, type MockModelRequest } from 'eve/evals'

interface ProbeResult {
  stage: number
  pod: string
  applicationId: string
  workerId: number
  threadId: number
  pid: number
  crashRecovery?: {
    pod: string
    applicationId: string
    workerId: number
    threadId: number
    pid: number
  }
}

const REQUEST_PATTERN = /^distribution-test:(\d+)(:crash)?$/i
const MAX_STAGES = 32

function distributionResponder (req: MockModelRequest) {
  const match = req.lastUserMessage?.trim().match(REQUEST_PATTERN)
  if (!match) {
    return `Use distribution-test:<stages> or distribution-test:<stages>:crash, where stages is an integer from 1 to ${MAX_STAGES}.`
  }

  const stageCount = Number.parseInt(match[1], 10)
  const crash = match[2] !== undefined
  if (!Number.isSafeInteger(stageCount) || stageCount < 1 || stageCount > MAX_STAGES) {
    return `The stage count must be an integer from 1 to ${MAX_STAGES}.`
  }

  const results = req.toolResults
    .filter(result => result.name === 'probe_execution')
    .map(result => result.output as ProbeResult)
    .filter(result => Number.isSafeInteger(result.stage) && result.stage >= 1 && result.stage <= stageCount)
    .sort((left, right) => left.stage - right.stage)

  const completedStages = new Set(results.map(result => result.stage))
  const nextStage = Array.from({ length: stageCount }, (_, index) => index + 1).find(
    stage => !completedStages.has(stage)
  )

  if (nextStage !== undefined && req.tools.some(tool => tool.name === 'probe_execution')) {
    return {
      toolCalls: [{ name: 'probe_execution', input: { stage: nextStage, crash } }]
    }
  }

  return JSON.stringify({
    ok: results.length === stageCount,
    requestedStages: stageCount,
    completedStages: results.length,
    crash,
    executions: results
  })
}

export default defineAgent({
  model: mockModel(distributionResponder),
  modelContextWindowTokens: 200_000,
  // eve >= 0.24 takes the world from here, not from WORKFLOW_TARGET_WORLD.
  // Without it the build silently bundles the in-memory world and runs are
  // never persisted to the workflow service.
  experimental: {
    workflow: {
      world: '@platformatic/world'
    }
  }
})
