import { transform as basicTransform, resolve, validationOptions } from '@platformatic/basic'
import type { Configuration, ConfigurationOptions } from '@platformatic/foundation'
import { kMetadata, loadConfiguration as utilsLoadConfiguration } from '@platformatic/foundation'
import { EveCapability } from './capability.ts'
import type { PlatformaticEveConfig } from './config.ts'
import { schema } from './schema.ts'

export type { PlatformaticEveConfig } from './config.ts'

export interface EveContext {}

export type EveConfiguration = Configuration<PlatformaticEveConfig>

export async function transform (
  config: EveConfiguration,
  _schema?: object,
  _options?: ConfigurationOptions
): Promise<EveConfiguration> {
  config = (await basicTransform(config)) as EveConfiguration
  config.watch = { enabled: false }

  return config
}

export async function loadConfiguration (
  configOrRoot: string | PlatformaticEveConfig,
  sourceOrConfig?: string | PlatformaticEveConfig,
  context?: ConfigurationOptions
): Promise<EveConfiguration> {
  const { root, source } = await resolve(configOrRoot as string, sourceOrConfig as string, 'application')

  return utilsLoadConfiguration(source as string | Record<string, unknown>, context?.schema ?? schema, {
    validationOptions,
    transform,
    replaceEnv: true,
    root,
    ...context
  }) as Promise<EveConfiguration>
}

export async function create (
  configOrRoot: string | PlatformaticEveConfig,
  sourceOrConfig?: string | PlatformaticEveConfig,
  context?: ConfigurationOptions
): Promise<EveCapability> {
  const config = await loadConfiguration(configOrRoot, sourceOrConfig, context)
  return new EveCapability(config[kMetadata].root, config, context)
}

export * from './capability.ts'
export { packageJson, schema, schemaComponents, version } from './schema.ts'
