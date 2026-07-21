import { defineAgent } from 'eve'
import { mockModel, type MockModelRequest } from 'eve/evals'
import type { LanguageModel } from 'ai'

/**
 * Resolve the model without hard-requiring Vercel AI Gateway.
 *
 *   1. AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN -> route a model string through the gateway
 *   2. ANTHROPIC_API_KEY / OPENAI_API_KEY     -> call that provider's endpoint directly
 *   3. nothing set                            -> deterministic offline mock
 *
 * The provider packages are loaded lazily so the mock and gateway paths never
 * need them installed.
 */
async function resolveModel (): Promise<LanguageModel> {
  const id = process.env.EVE_MODEL

  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
    return id ?? 'anthropic/claude-sonnet-5'
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const { anthropic } = await import('@ai-sdk/anthropic')
    return anthropic(id ?? 'claude-sonnet-5')
  }

  if (process.env.OPENAI_API_KEY) {
    const { openai } = await import('@ai-sdk/openai')
    return openai(id ?? 'gpt-5.4-mini')
  }

  return mockModel(weatherResponder)
}

/**
 * Deterministic offline model: on the first turn it calls `get_weather` for the
 * city named in the message, then turns the tool result into a one-line reply.
 */
function weatherResponder (req: MockModelRequest) {
  const done = req.toolResults.find(r => r.name === 'get_weather')
  if (done) {
    const w = done.output as { city?: string, condition?: string, temperatureF?: number }
    return `It's ${w.condition ?? 'clear'} and about ${w.temperatureF ?? 72}°F in ${w.city ?? 'that city'} right now. (Offline mock — set AI_GATEWAY_API_KEY or a provider key for live answers.)`
  }

  if (req.tools.some(t => t.name === 'get_weather')) {
    const match = req.lastUserMessage?.match(/\b(?:in|for|at)\s+([A-Za-z .'-]+)/i)
    const city = (match?.[1] ?? 'Brooklyn').trim().replace(/[?.!,]+$/, '')
    return { toolCalls: [{ name: 'get_weather', input: { city } }] }
  }

  return 'Ask me about the weather in a city, e.g. "What\'s the weather in Brooklyn?"'
}

export default defineAgent({
  model: await resolveModel(),
  // Set explicitly so the offline mock never needs an AI Gateway catalog lookup.
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
