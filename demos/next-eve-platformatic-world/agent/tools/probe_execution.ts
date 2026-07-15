import { setTimeout as delay } from 'node:timers/promises'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

const PHASES = [
  { phase: 'Campaign brief', action: 'POST /campaigns/velocity/plan', system: 'Campaign API', summary: 'Velocity positioned for urban runners in priority European markets.', metricLabel: 'priority markets', metricValue: '3 markets' },
  { phase: 'Audience intelligence', action: 'QUERY audience_graph', system: 'Audience service', summary: 'High-intent running audiences selected across every launch market.', metricLabel: 'projected audience', metricValue: '2.4M people' },
  { phase: 'Inventory alignment', action: 'POST /inventory/reservations', system: 'Inventory API', summary: 'Regional stock and launch demand are aligned with safety margins.', metricLabel: 'inventory coverage', metricValue: '100% secured' },
  { phase: 'Creative studio', action: 'POST /creative/render', system: 'Creative engine', summary: 'Localized campaign stories are ready for every audience segment.', metricLabel: 'creative variants', metricValue: '12 variants' },
  { phase: 'Channel activation', action: 'POST /channels/schedule', system: 'Channel scheduler', summary: 'Web, mobile, email and social launches are synchronized.', metricLabel: 'connected channels', metricValue: '4 channels' },
  { phase: 'Campaign live', action: 'POST /campaigns/velocity/publish', system: 'Campaign API', summary: 'Velocity is live across Europe with every action durably completed.', metricLabel: 'launch status', metricValue: 'LIVE' }
] as const

export default defineTool({
  description: 'Advance one durable stage of the Velocity campaign launch.',
  inputSchema: z.object({ stage: z.number().int().min(1).max(8) }),
  async execute ({ stage }) {
    const checkpoint = PHASES[stage - 1] ?? {
      phase: `Extended checkpoint ${stage}`,
      action: `EXECUTE campaign_checkpoint_${stage}`,
      system: 'Campaign orchestrator',
      summary: 'Additional campaign action completed.',
      metricLabel: 'campaign action',
      metricValue: 'Complete'
    }
    const durationMs = 3_800 + stage * 180
    await delay(durationMs)
    return {
      stage,
      ...checkpoint,
      durationMs,
      deploymentVersion: process.env.PLT_WORLD_DEPLOYMENT_VERSION ?? 'unknown',
      buildVersion: process.env.NEXT_EVE_BUILD_VERSION ?? 'unknown',
      pod: process.env.HOSTNAME ?? 'unknown',
      runtime: 'eve-next-child',
      workerId: 'eve-child',
      pid: process.pid,
      timestamp: new Date().toISOString()
    }
  }
})
