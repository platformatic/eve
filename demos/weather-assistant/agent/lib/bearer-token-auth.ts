import { extractBearerToken, UnauthenticatedError, type AuthFn } from 'eve/channels/auth'

export function bearerTokenAuth (): AuthFn<Request> {
  const expectedToken = process.env.EVE_BEARER_TOKEN
  if (!expectedToken) {
    throw new Error('EVE_BEARER_TOKEN must be set')
  }

  return request => {
    const token = extractBearerToken(request.headers.get('authorization'))

    if (token !== expectedToken) {
      throw new UnauthenticatedError({
        message: 'A valid demo bearer token is required.',
        challenges: [{ scheme: 'Bearer' }]
      })
    }

    return {
      attributes: {},
      authenticator: 'demo-bearer',
      principalId: 'eve-demo',
      principalType: 'service'
    }
  }
}
