import { defineAgent } from 'eve'
import { mockModel, type MockModelRequest } from 'eve/evals'

type ProbeBehavior = 'normal' | 'hold' | 'hold-crash'

interface ProbeResult {
  scenarioId: string
  stage: number
  behavior: ProbeBehavior
}

interface RequestPlan {
  scenarioId: string
  phase: string
  stages: Array<{ stage: number; behavior: ProbeBehavior }>
}

const REQUEST_PATTERN = /^skew-(inflight|retry|control|between):([a-z0-9-]+)(?::(before|after))?$/i

function skewResponder (req: MockModelRequest) {
  const plan = parseRequest(req.lastUserMessage?.trim())
  if (plan === undefined) {
    return 'Use a supported skew test request.'
  }

  const results = req.toolResults
    .filter(result => result.name === 'probe_skew_execution')
    .map(result => result.output as ProbeResult)
    .filter(result => result.scenarioId === plan.scenarioId)

  const next = plan.stages.find(expected => !results.some(result => result.stage === expected.stage))
  if (next !== undefined && req.tools.some(tool => tool.name === 'probe_skew_execution')) {
    return {
      toolCalls: [{
        name: 'probe_skew_execution',
        input: {
          scenarioId: plan.scenarioId,
          stage: next.stage,
          behavior: next.behavior
        }
      }]
    }
  }

  const executions = plan.stages
    .map(expected => results.find(result => result.stage === expected.stage))
    .filter(result => result !== undefined)

  return JSON.stringify({
    ok: executions.length === plan.stages.length,
    scenarioId: plan.scenarioId,
    phase: plan.phase,
    executions
  })
}

function parseRequest (message: string | undefined): RequestPlan | undefined {
  const match = message?.match(REQUEST_PATTERN)
  if (match === undefined || match === null) return undefined

  const kind = match[1].toLowerCase()
  const scenarioId = match[2]
  const phase = match[3]?.toLowerCase()

  if (kind === 'inflight' && phase === undefined) {
    return { scenarioId, phase: kind, stages: [{ stage: 1, behavior: 'hold' }, { stage: 2, behavior: 'normal' }] }
  }
  if (kind === 'retry' && phase === undefined) {
    return { scenarioId, phase: kind, stages: [{ stage: 1, behavior: 'hold-crash' }, { stage: 2, behavior: 'normal' }] }
  }
  if (kind === 'control' && phase === undefined) {
    return { scenarioId, phase: kind, stages: [{ stage: 1, behavior: 'normal' }] }
  }
  if (kind === 'between' && phase === 'before') {
    return { scenarioId, phase, stages: [{ stage: 1, behavior: 'normal' }] }
  }
  if (kind === 'between' && phase === 'after') {
    return { scenarioId, phase, stages: [{ stage: 2, behavior: 'normal' }] }
  }

  return undefined
}

export default defineAgent({
  model: mockModel(skewResponder),
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
