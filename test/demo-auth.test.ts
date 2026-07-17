import { deepStrictEqual, equal, match, throws } from 'node:assert'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { type AuthFn } from 'eve/channels/auth'

const helpers = [
  'weather-assistant',
  'real-estate-agent',
  'workflow-distribution-agent',
  'workflow-skew-protection-agent',
  'next-eve-platformatic-world'
]

test('demo bearer authentication', async t => {
  const originalToken = process.env.EVE_BEARER_TOKEN
  t.after(() => {
    if (originalToken === undefined) {
      delete process.env.EVE_BEARER_TOKEN
    } else {
      process.env.EVE_BEARER_TOKEN = originalToken
    }
  })

  for (const demo of helpers) {
    await t.test(demo, async () => {
      const path = resolve(`demos/${demo}/agent/lib/bearer-token-auth.ts`)
      const { bearerTokenAuth } = await import(pathToFileURL(path).href)

      delete process.env.EVE_BEARER_TOKEN
      throws(() => bearerTokenAuth(), /EVE_BEARER_TOKEN must be set/)

      process.env.EVE_BEARER_TOKEN = 'expected-demo-token'
      const authenticate = bearerTokenAuth() as AuthFn<Request>

      for (const authorization of [
        undefined,
        'Basic ZGVtbzpwYXNzd29yZA==',
        'Bearer wrong-demo-token',
        'Bearer expected-demo-token-extra'
      ]) {
        await assertUnauthorized(authenticate, authorization)
      }

      deepStrictEqual(await authenticate(requestWithAuthorization('Bearer expected-demo-token')), {
        attributes: {},
        authenticator: 'demo-bearer',
        principalId: 'eve-demo',
        principalType: 'service'
      })
    })
  }
})

async function assertUnauthorized (authenticate: AuthFn<Request>, authorization?: string): Promise<void> {
  try {
    await authenticate(requestWithAuthorization(authorization))
    throw new Error('Authentication unexpectedly succeeded')
  } catch (error) {
    if (!(error instanceof Error) || !('response' in error) || !(error.response instanceof Response)) {
      throw error
    }

    equal(error.response.status, 401)
    match(error.response.headers.get('www-authenticate') ?? '', /^Bearer$/)
    equal(error.response.headers.get('cache-control'), 'no-store')
    const body = await error.response.text()
    equal(body.includes('expected-demo-token'), false)
    equal(body.includes('wrong-demo-token'), false)
  }
}

function requestWithAuthorization (authorization?: string): Request {
  return new Request('http://localhost/eve/v1/session', {
    headers: authorization === undefined ? undefined : { authorization }
  })
}
