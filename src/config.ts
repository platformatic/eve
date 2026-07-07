export interface PlatformaticEveConfig {
  $schema?: string
  module?: string
  logger?: Record<string, unknown>
  server?: Record<string, unknown>
  watch?: Record<string, unknown> | boolean | string
  application?: {
    basePath?: string
    outputDirectory?: string
    include?: string[]
    commands?: {
      install?: string
      build?: string
      development?: string
      production?: string
    }
    entrypointPort?: number
    changeDirectoryBeforeExecution?: boolean
    preferLocalCommands?: boolean
    processSpawner?: string
  }
  runtime?: Record<string, unknown>
  eve?: {
    outputDirectory?: string
  }
}
