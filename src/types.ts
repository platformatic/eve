export interface DevelopmentServer {
  start: () => Promise<{ kind: 'started'; appRoot: string; url: string }>
  close: () => Promise<void>
}

export interface EveApplicationBuildOptions {
  profileOutputPath?: string
  publicRoutePrefix?: string
  skipVercelSandboxPrewarm: boolean
  workspaceMember?: boolean
  vercelServiceOutput?: {
    hostOutputDirectory: string
    serviceOutputDirectory: string
  }
}

export interface EveNitroHost {
  buildApplication: (root: string, options: EveApplicationBuildOptions) => Promise<string>
  createDevelopmentServer: (
    root: string,
    options: { existing: 'reject'; host: string; port: number }
  ) => DevelopmentServer
}

export interface EvePrewarm {
  prewarmBuiltAppSandboxes: (options: { appRoot: string; log: (message: string) => void }) => Promise<void>
}

export interface InjectedResponse {
  statusCode: number
  headers: object
  body: string
  payload: string
  rawPayload: Buffer
}

export type OriginalEnvironment = Map<string, string | undefined>

export interface InjectOptions {
  method?: string | undefined
  url: string
  headers?: Record<string, string | string[] | undefined> | undefined
  body?: unknown
}
