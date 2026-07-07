import { schemaComponents as basicSchemaComponents } from '@platformatic/basic'
import { schemaComponents as utilsSchemaComponents } from '@platformatic/foundation'
import type { JSONSchemaType } from 'ajv'
import type { PlatformaticEveConfig } from './config.ts'
import { name, version } from './version.ts'

export const packageJson: Record<string, unknown> = { name, version }
export { version }

const eve = {
  type: 'object',
  properties: {
    outputDirectory: {
      type: 'string',
      default: '.output'
    }
  },
  default: {},
  additionalProperties: false
} as const

export const schemaComponents: { eve: JSONSchemaType<object> } = { eve: eve as JSONSchemaType<object> }

export const schema = {
  $id: `https://schemas.platformatic.dev/@platformatic/eve/${version}.json`,
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Platformatic Eve Config',
  type: 'object',
  properties: {
    $schema: {
      type: 'string'
    },
    module: {
      type: 'string'
    },
    logger: utilsSchemaComponents.logger,
    server: utilsSchemaComponents.server,
    watch: basicSchemaComponents.watch,
    application: basicSchemaComponents.buildableApplication,
    runtime: utilsSchemaComponents.wrappedRuntime,
    eve
  },
  additionalProperties: false
} as unknown as JSONSchemaType<PlatformaticEveConfig>
