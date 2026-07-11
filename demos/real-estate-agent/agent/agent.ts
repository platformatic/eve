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

  return mockModel(realEstateResponder)
}

/**
 * Deterministic offline model. It recognizes a couple of intents so the demo's
 * tools actually run without a live LLM:
 *
 *   - "viewings today" / "digest"  -> list_client_viewings
 *   - anything else                -> search_listings (with parsed filters)
 *
 * A real model handles the full range of requests; this just keeps the offline
 * path useful.
 */
function realEstateResponder (req: MockModelRequest) {
  const search = req.toolResults.find(r => r.name === 'search_listings')
  if (search) {
    const out = search.output as { count: number, listings: Array<{ address: string, neighborhood: string, priceUSD: number }> }
    if (out.count === 0) {
      return 'I couldn’t find any listings matching that. Want to widen the price or neighborhood?'
    }
    const lines = out.listings
      .map(l => `• ${l.address} (${l.neighborhood}) — $${l.priceUSD.toLocaleString('en-US')}`)
      .join('\n')
    return `Here ${out.count === 1 ? 'is' : 'are'} ${out.count} matching ${out.count === 1 ? 'listing' : 'listings'}:\n${lines}\n\n(Offline mock — set AI_GATEWAY_API_KEY or a provider key for full conversational answers.)`
  }

  const viewings = req.toolResults.find(r => r.name === 'list_client_viewings')
  if (viewings) {
    const out = viewings.output as { date: string, count: number, viewings: Array<{ time: string, clientName: string, listingAddress: string }> }
    if (out.count === 0) {
      return `No viewings booked for ${out.date} — the day is clear.`
    }
    const lines = out.viewings.map(v => `• ${v.time} — ${v.clientName} at ${v.listingAddress}`).join('\n')
    return `Your viewings for ${out.date}:\n${lines}`
  }

  const message = req.lastUserMessage ?? ''

  if (/\b(today|digest|schedule|viewings?)\b/i.test(message) && req.tools.some(t => t.name === 'list_client_viewings')) {
    return { toolCalls: [{ name: 'list_client_viewings', input: {} }] }
  }

  if (req.tools.some(t => t.name === 'search_listings')) {
    const input: Record<string, unknown> = {}

    const neighborhood = message.match(/\b(?:in|near|around)\s+([A-Za-z .'-]+?)(?:\s+(?:under|below|for|with|that|,|$))/i)
    if (neighborhood) {
      input.neighborhood = neighborhood[1].trim().replace(/[?.!,]+$/, '')
    }

    const price = message.match(/(?:under|below|up to|max(?:imum)?)\s*\$?\s*([\d.,]+)\s*(k|m|million|thousand)?/i)
    if (price) {
      let amount = Number(price[1].replace(/,/g, ''))
      const unit = price[2]?.toLowerCase()
      if (unit === 'k' || unit === 'thousand') amount *= 1_000
      if (unit === 'm' || unit === 'million') amount *= 1_000_000
      if (Number.isFinite(amount) && amount > 0) input.maxPriceUSD = amount
    }

    const beds = message.match(/(\d+)\s*(?:\+|or more)?\s*(?:bed|bedroom|br)\b/i)
    if (beds) input.minBeds = Number(beds[1])

    return { toolCalls: [{ name: 'search_listings', input }] }
  }

  return 'I can search listings, book viewings, and summarize a client’s schedule. Try: "Show me 2-bed condos in Park Slope under $1.5M".'
}

export default defineAgent({
  description: 'A real-estate sales assistant that manages listings, books viewings, and prepares a daily viewings digest.',
  model: await resolveModel(),
  // Set explicitly so the offline mock never needs an AI Gateway catalog lookup.
  modelContextWindowTokens: 200_000
})
