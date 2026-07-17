import { eveChannel } from 'eve/channels/eve'
import { bearerTokenAuth } from '../lib/bearer-token-auth.ts'

export default eveChannel({
  auth: [bearerTokenAuth()]
})
