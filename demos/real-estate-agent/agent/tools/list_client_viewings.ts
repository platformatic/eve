import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { getListing, listViewings, todayISODate } from '../../lib/store.ts'

export default defineTool({
  description:
    'List booked viewings, optionally filtered by date and/or client email. Omit `date` to use today. Used for the daily "your viewings today" digest.',
  inputSchema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date as YYYY-MM-DD; defaults to today'),
    clientEmail: z.string().email().optional().describe("Filter to one client's email")
  }),
  async execute ({ date, clientEmail }) {
    const resolvedDate = date ?? todayISODate()
    const viewings = listViewings({ date: resolvedDate, clientEmail }).map(viewing => ({
      ...viewing,
      listingAddress: getListing(viewing.listingId)?.address ?? '(unknown listing)'
    }))

    return {
      date: resolvedDate,
      count: viewings.length,
      viewings
    }
  }
})
