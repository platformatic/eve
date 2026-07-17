import { eveChannel } from 'eve/channels/eve'
import { bearerTokenAuth } from '../lib/bearer-token-auth'

export default eveChannel({ auth: [bearerTokenAuth()] })
