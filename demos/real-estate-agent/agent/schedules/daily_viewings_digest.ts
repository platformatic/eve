import { defineSchedule } from 'eve/schedules'

// Fire-and-forget schedule: every weekday at 08:00 the framework runs the agent
// on this prompt. The agent calls `list_client_viewings` for today and composes
// the "your viewings today" digest. The schedule name comes from the filename.
//
// In `wattpm dev` you can also trigger it on demand instead of waiting for the
// cron — see the demo README.
export default defineSchedule({
  cron: '0 8 * * 1-5',
  markdown: [
    'Produce the daily "your viewings today" digest for the sales team.',
    'List every viewing booked for today, grouped and ordered by time, and for each one give the time, the client name, and the property address.',
    'If there are no viewings today, say the day is clear.'
  ].join(' ')
})
