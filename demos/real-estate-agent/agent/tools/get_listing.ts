import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { getListing } from '../../lib/store.ts'

export default defineTool({
  description: 'Get the full details for a single listing by its id (e.g. "L-101").',
  inputSchema: z.object({
    listingId: z.string().min(1).describe('The listing id, e.g. "L-101"')
  }),
  async execute ({ listingId }) {
    const listing = getListing(listingId)
    if (!listing) {
      return { found: false as const, listingId }
    }
    return { found: true as const, listing }
  }
})
