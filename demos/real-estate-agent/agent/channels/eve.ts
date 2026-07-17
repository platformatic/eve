import { eveChannel } from 'eve/channels/eve'
import { bearerTokenAuth } from '../lib/bearer-token-auth.ts'

// The HTTP entry point for the agent. eve serves `/eve/v1/session` from this
// channel, and the @platformatic/eve capability routes Watt traffic to it.
export default eveChannel({
  auth: [bearerTokenAuth()]
})
