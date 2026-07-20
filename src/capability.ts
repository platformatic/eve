import {
  buildAdditionalServerOptions,
  cleanBasePath,
  ensureTrailingSlash,
  errors,
  getServerUrl,
  importFile,
  injectViaRequest,
  BaseCapability as PlatformaticBaseCapability,
  resolvePackageViaCJS,
  type BaseContext,
  type BaseOptions,
  type InjectViaRequestResponse
} from '@platformatic/basic'
import { sanitizeHTTPSOptions } from '@platformatic/foundation'
import inject, { type InjectOptions as LMRInjectOptions, type Response } from 'light-my-request'
import { tracingChannel } from 'node:diagnostics_channel'
import { readFile } from 'node:fs/promises'
import { type Server } from 'node:http'
import { dirname, resolve as resolvePath } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { satisfies } from 'semver'
import type { PlatformaticEveConfig } from './config.ts'
import { version } from './schema.ts'
import type { DevelopmentServer, EveNitroHost, EvePrewarm, InjectOptions, OriginalEnvironment } from './types.ts'

const UnsupportedVersion = errors.UnsupportedVersion as unknown as new (...arg: unknown[]) => Error
const BaseCapability = PlatformaticBaseCapability as unknown as new (
  type: string,
  version: string,
  root: string,
  config: PlatformaticEveConfig,
  context?: BaseOptions<BaseContext> | object
) => any

export const supportedVersions = '>=0.20.0 <0.26.0'

export class EveCapability extends BaseCapability {
  #eve?: string
  #developmentServer?: DevelopmentServer
  #server?: Server & { closeHttp2Sessions?: () => void }
  #dispatcher?: Parameters<typeof inject>[0]
  #basePath?: string

  constructor (root: string, config: PlatformaticEveConfig, context?: object) {
    super('eve', version, root, config, context)

    this.subprocessTerminationSignal = 'SIGKILL'
  }

  async init (): Promise<void> {
    await super.init()

    this.#eve = dirname(resolvePackageViaCJS(this.root, 'eve/package.json'))
    const evePackage = JSON.parse(await readFile(resolvePath(this.#eve, 'package.json'), 'utf-8')) as {
      version: string
    }

    if (!this.isProduction && !satisfies(evePackage.version, supportedVersions)) {
      throw new UnsupportedVersion('eve', evePackage.version, supportedVersions)
    }

    this.#basePath = this.config.application?.basePath
      ? ensureTrailingSlash(cleanBasePath(this.config.application.basePath))
      : undefined

    this.registerGlobals({ basePath: this.#basePath })
  }

  async start ({ listen }: { listen: boolean }): Promise<string | undefined> {
    if (this.url) {
      return this.url
    }

    if (!this.#eve) {
      await this.init()
    }

    await super._start({ listen })

    const command = this.config.application?.commands?.[this.isProduction ? 'production' : 'development']

    if (command) {
      await this.startWithCommand(command)
      return this.url
    }

    if (this.isProduction) {
      await this.#startProduction()
    } else {
      await this.#startDevelopment()
    }

    await this._collectMetrics()

    return this.url
  }

  async stop (): Promise<void> {
    await super.stop()

    if (this.childManager) {
      return this.stopCommand()
    }

    if (this.#developmentServer) {
      await this.#developmentServer.close()
      await sleep(1000)
      this.#developmentServer = undefined
    }

    /* c8 ignore next 3 */
    if (!this.#server?.listening) {
      return
    }

    await this._closeServer(this.#server)
    this.#server = undefined
  }

  async build (): Promise<string | undefined> {
    if (!this.#eve) {
      await this.init()
    }

    const command = this.config.application?.commands?.build

    if (command) {
      await this.buildWithCommand(command, this.#basePath)
      return
    }

    const { buildApplication } = await this.#importEveNitroHost()

    // eve 0.24.0 made the options argument required; older versions ignore it.
    return buildApplication(this.root, { skipVercelSandboxPrewarm: false })
  }

  inject (injectParams: InjectOptions): Promise<InjectViaRequestResponse>
  inject (
    injectParams: InjectOptions,
    onInject: (err: Error | null, res: Response | InjectViaRequestResponse) => void
  ): Promise<void>
  async inject (
    injectParams: InjectOptions,
    onInject?: (err: Error | null, res: Response | InjectViaRequestResponse) => void
  ): Promise<InjectViaRequestResponse | void> {
    if (!this.#dispatcher) {
      return injectViaRequest(
        this.url,
        injectParams,
        onInject as (error: Error | null, response?: InjectViaRequestResponse) => unknown
      ) as Promise<InjectViaRequestResponse | void | undefined>
    }

    const res = await inject(this.#dispatcher, injectParams as LMRInjectOptions)

    if (onInject) {
      onInject(null, res)
      return
    }

    const { statusCode, headers, body, payload, rawPayload } = res
    return { statusCode, headers: headers as Record<string, string | string[] | undefined>, body, payload, rawPayload }
  }

  getMeta () {
    const hasBasePath = this.basePath || this.#basePath

    return {
      gateway: {
        tcp: typeof this.url !== 'undefined',
        url: this.url,
        prefix: this.basePath ?? this.#basePath,
        wantsAbsoluteUrls: !!hasBasePath,
        needsRootTrailingSlash: false
      }
    }
  }

  /* c8 ignore start - hard to test */
  setClosing (): void {
    super.setClosing()

    if (!this.#server) {
      return
    }

    const closeConnections =
      (this.runtimeConfig as { gracefulShutdown?: { closeConnections?: boolean } })?.gracefulShutdown
        ?.closeConnections !== false

    if (!closeConnections) {
      return
    }

    this.#server.on('request', (req, res) => {
      if (this.closing && !res.headersSent && req.httpVersionMajor !== 2) {
        res.setHeader('Connection', 'close')
      }
    })

    if (this.#server.closeHttp2Sessions) {
      this.#server.closeHttp2Sessions()
    }
  }
  /* c8 ignore stop - hard to test */

  async #startDevelopment (): Promise<void> {
    const { createDevelopmentServer } = await this.#importEveNitroHost()
    /* c8 ignore next - else */
    let { hostname, port } = (this.serverConfig as { hostname?: string; port?: number | string }) ?? {}
    hostname ||= '127.0.0.1'
    port ||= 0

    this.#developmentServer = createDevelopmentServer(this.root, {
      existing: 'reject',
      host: hostname,
      port
    })

    const handle = await this.#developmentServer.start()
    this.url = handle.url
  }

  async #startProduction (): Promise<void> {
    const config = this.config
    /* c8 ignore next - else */
    const outputDirectory = resolvePath(this.root, config.eve?.outputDirectory ?? '.output')
    this.verifyOutputDirectory(outputDirectory)

    const { prewarmBuiltAppSandboxes } = await this.#importEvePrewarm()
    await prewarmBuiltAppSandboxes({
      appRoot: this.root,
      /* c8 ignore next - hard to test */
      log: message => (this.logger as { info: (message: string) => void }).info(message)
    })

    const serverOptions = this.serverConfig as
      { hostname?: string; port?: number | string; https?: Parameters<typeof sanitizeHTTPSOptions>[0] } | undefined
    const serverPromise = this.#createServerListener(serverOptions, await buildAdditionalServerOptions(serverOptions))

    const originalEnvironment: OriginalEnvironment = new Map()

    try {
      const httpsOptions = await sanitizeHTTPSOptions(serverOptions?.https)
      this.#setProductionEnvironment(originalEnvironment, serverOptions, httpsOptions)
      await this.#importProductionNitro(outputDirectory)

      this.#server = await serverPromise
      this.#dispatcher = this.#server.listeners('request')[0] as Parameters<typeof inject>[0]
      this.url = getServerUrl(this.#server)
      /* c8 ignore next 4 - hard to test */
    } catch (err) {
      serverPromise.cancel()
      throw err
    } finally {
      this.#restoreEnvironment(originalEnvironment)
    }
  }

  #createServerListener (
    serverOptions: { hostname?: string; port?: number | string } | undefined,
    additionalOptions: object
  ): Promise<Server & { closeHttp2Sessions?: () => void }> & { cancel: () => void } {
    const channel = tracingChannel('net.server.listen') as unknown as {
      subscribe: (subscriber: object) => void
      unsubscribe: (subscriber: object) => void
    }

    let server: Server | undefined
    let settled = false
    const expectedHost = serverOptions?.hostname
    const expectedPort = serverOptions?.port

    const promise = new Promise<Server>((resolve, reject) => {
      const subscriber = {
        asyncStart: ({ server: candidate, options }: { server?: Server; options?: Record<string, unknown> }) => {
          /* c8 ignore next 7 - hard to test */
          if (
            !candidate ||
            (expectedHost && options?.host !== expectedHost) ||
            (expectedPort && options?.port !== expectedPort)
          ) {
            return
          }

          /* c8 ignore next - else */
          Object.assign(options ?? {}, additionalOptions)
          server = candidate

          /* c8 ignore next 7 - hard to test */
          candidate.once('error', error => {
            if (!settled) {
              settled = true
              channel.unsubscribe(subscriber)
              reject(error)
            }
          })

          candidate.once('listening', () => {
            if (!settled) {
              settled = true
              channel.unsubscribe(subscriber)
              resolve(candidate)
            }
          })
        }
      }

      channel.subscribe(subscriber)
    }) as Promise<Server & { closeHttp2Sessions?: () => void }> & { cancel: () => void }

    /* c8 ignore next 3 - hard to test */
    promise.cancel = () => {
      server?.close()
    }

    return promise
  }

  #setProductionEnvironment (
    originalEnvironment: OriginalEnvironment,
    serverOptions: { hostname?: string; port?: number | string } | undefined,
    httpsOptions: Awaited<ReturnType<typeof sanitizeHTTPSOptions>>
  ): void {
    for (const key of [
      'HOST',
      'NITRO_HOST',
      'NITRO_PORT',
      'PORT',
      'NITRO_SHUTDOWN_DISABLED',
      'NITRO_SHUTDOWN_FORCE',
      'NITRO_SSL_CERT',
      'NITRO_SSL_KEY'
    ]) {
      originalEnvironment.set(key, process.env[key])
    }

    /* c8 ignore next - else */
    const host = serverOptions?.hostname ?? '0.0.0.0'
    /* c8 ignore next - else */
    const port = serverOptions?.port ?? 0

    process.env.HOST = String(host)
    process.env.NITRO_HOST = String(host)
    process.env.NITRO_PORT = String(port)
    process.env.PORT = String(port)
    process.env.NITRO_SHUTDOWN_DISABLED = 'true'
    process.env.NITRO_SHUTDOWN_FORCE = 'false'

    if (httpsOptions?.cert && httpsOptions?.key) {
      process.env.NITRO_SSL_CERT = this.#serializeCertificateValue(httpsOptions.cert)
      process.env.NITRO_SSL_KEY = this.#serializeCertificateValue(httpsOptions.key)
    }
  }

  #restoreEnvironment (originalEnvironment: OriginalEnvironment): void {
    for (const [key, value] of originalEnvironment) {
      if (typeof value === 'undefined') {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }

  #serializeCertificateValue (value: string | Buffer | Array<string | Buffer>): string {
    if (Array.isArray(value)) {
      return value.map(item => item.toString()).join('\n')
    }

    return value.toString()
  }

  #importProductionNitro (outputDirectory: string): Promise<unknown> {
    return importFile(resolvePath(outputDirectory, 'server/index.mjs'))
  }

  async #importEveNitroHost (): Promise<EveNitroHost> {
    return import(pathToFileURL(resolvePath(this.#eve!, 'dist', 'src', 'internal', 'nitro', 'host.js')).href)
  }

  async #importEvePrewarm (): Promise<EvePrewarm> {
    return import(pathToFileURL(resolvePath(this.#eve!, 'dist', 'src', 'execution', 'sandbox', 'prewarm.js')).href)
  }
}
