import { eveChannel } from 'eve/channels/eve'
import { localDev, none } from 'eve/channels/auth'

// The HTTP entry point for the agent. eve serves `/eve/v1/session` from this
// channel, and the @platformatic/eve capability routes Watt traffic to it.
export default eveChannel({
  auth: [
    // Accept loopback requests from `eve dev`, the REPL, and the local Watt server.
    localDev(),
    // Demo fallback: accept every other request anonymously so the agent is
    // reachable through the Watt gateway with a plain curl. `none()` makes the
    // channel public — replace it with a real provider (vercelOidc(), Auth.js,
    // Clerk, ...) before deploying anything real.
    none()
  ]
})
