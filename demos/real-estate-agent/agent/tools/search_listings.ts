import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { searchListings } from '../../lib/store.ts'

export default defineTool({
  description: 'Search the property listings by neighborhood, price ceiling, minimum bedrooms, and/or type.',
  inputSchema: z.object({
    neighborhood: z.string().optional().describe('Neighborhood name, e.g. "Park Slope"'),
    maxPriceUSD: z.number().positive().optional().describe('Maximum price in US dollars'),
    minBeds: z.number().int().nonnegative().optional().describe('Minimum number of bedrooms'),
    type: z.enum(['condo', 'house', 'townhouse', 'loft']).optional().describe('Property type')
  }),
  async execute (query) {
    const results = searchListings(query)
    return {
      count: results.length,
      listings: results
    }
  }
})
