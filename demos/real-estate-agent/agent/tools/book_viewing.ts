import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { bookViewing, getListing } from '../../lib/store.ts'

export default defineTool({
  description: 'Book a property viewing for a client. Fails if the listing id is unknown.',
  inputSchema: z.object({
    listingId: z.string().min(1).describe('The listing to view, e.g. "L-101"'),
    clientName: z.string().min(1).describe("The client's full name"),
    clientEmail: z.string().email().describe("The client's email address"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Viewing date as YYYY-MM-DD'),
    time: z.string().regex(/^\d{2}:\d{2}$/).describe('Viewing time as HH:mm (24-hour)'),
    notes: z.string().optional().describe('Optional notes for the viewing')
  }),
  async execute (input) {
    const listing = getListing(input.listingId)
    if (!listing) {
      return { booked: false as const, reason: `No listing with id "${input.listingId}".` }
    }

    const viewing = bookViewing(input)
    return {
      booked: true as const,
      viewing,
      listingAddress: listing.address
    }
  }
})
