import { defineAgent } from 'eve'
import { mockModel, type MockModelRequest } from 'eve/evals'

interface ProbeResult {
  stage: number
  phase?: string
  summary?: string
  metricLabel?: string
  metricValue?: string
}

const REQUEST_PATTERN = /^next-eve-diagnostic:(\d+)$/i
const CAMPAIGN_PATTERN = /^launch the velocity running shoe campaign across europe\.?$/i
const MAX_STAGES = 8

function diagnosticResponder (request: MockModelRequest) {
  const userMessage = request.lastUserMessage?.trim() ?? ''
  const match = userMessage.match(REQUEST_PATTERN)
  const isCampaignLaunch = CAMPAIGN_PATTERN.test(userMessage)
  if (match === null && !isCampaignLaunch) return 'The campaign studio is ready for a new launch brief.'

  const stageCount = isCampaignLaunch ? 6 : Number.parseInt(match?.[1] ?? '', 10)
  if (!Number.isSafeInteger(stageCount) || stageCount < 1 || stageCount > MAX_STAGES) {
    return `Stages must be an integer from 1 to ${MAX_STAGES}.`
  }

  const results = request.toolResults
    .filter(result => result.name === 'probe_execution')
    .map(result => result.output as ProbeResult)
    .filter(result => Number.isInteger(result.stage) && result.stage >= 1 && result.stage <= stageCount)
    .sort((left, right) => left.stage - right.stage)
  const nextStage = Array.from({ length: stageCount }, (_, index) => index + 1)
    .find(stage => !results.some(result => result.stage === stage))

  if (nextStage !== undefined && request.tools.some(tool => tool.name === 'probe_execution')) {
    return { toolCalls: [{ name: 'probe_execution', input: { stage: nextStage } }] }
  }

  return [
    'CAMPAIGN IS LIVE',
    `Velocity is now active across ${results.find(result => result.stage === 1)?.metricValue ?? 'selected markets'}.`,
    ...results.map(result => `${result.metricValue ?? 'Complete'} - ${result.metricLabel ?? result.phase ?? 'Campaign step'}`),
    'Every action was coordinated and durably completed.'
  ].join('\n')
}

export default defineAgent({
  model: mockModel(diagnosticResponder),
  modelContextWindowTokens: 200_000,
  experimental: {
    workflow: {
      world: '@platformatic/next-eve-world'
    }
  }
})
