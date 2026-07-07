# @platformatic/eve

Platformatic capability for running [Eve](https://vercel.com/eve) applications inside a Platformatic runtime.

It can build an Eve application, run it in development or production mode, expose it through Platformatic gateway metadata, collect Platformatic HTTP metrics, and support custom build/start commands when the default Eve integration is not enough.

## Features

- Runs Eve applications in development mode through Eve's development server.
- Builds Eve applications for production.
- Runs production builds from Eve's Nitro output directory.
- Supports custom `build`, `development`, and `production` commands.
- Propagates Platformatic server options, including host, port, backlog, and HTTPS settings.
- Supports Platformatic base paths and gateway metadata.
- Supports Platformatic request injection and HTTP metrics.
- Prewarms Eve production sandboxes before serving traffic.

## Requirements

- Node.js `>=22.19.0`
- Eve `^0.20.0`

The Eve version check is enforced in development mode. Production mode runs the already-built output.

## Installation

Install the capability and Eve in your application:

```sh
npm install @platformatic/eve eve
```

## Configuration

Create a Platformatic application configuration and set `module` to `@platformatic/eve`:

```json
{
  "$schema": "https://schemas.platformatic.dev/@platformatic/eve/0.0.1.json",
  "module": "@platformatic/eve",
  "server": {
    "hostname": "127.0.0.1",
    "port": 3000
  }
}
```

By default, production mode reads the Eve build from `.output`. You can override it with `eve.outputDirectory`:

```json
{
  "module": "@platformatic/eve",
  "eve": {
    "outputDirectory": "dist/eve"
  }
}
```

To mount the application under a Platformatic gateway prefix, use `application.basePath`:

```json
{
  "module": "@platformatic/eve",
  "application": {
    "basePath": "/api"
  }
}
```

The capability normalizes the base path and exposes it through gateway metadata.

## Getting Started

Create an Eve application in the project root. For example:

```text
.
+-- agent
|   +-- agent.ts
|   +-- instructions.md
+-- package.json
+-- platformatic.json
```

Start the application with Platformatic in development mode. The capability starts Eve's development server and routes requests to it.

Build the application for production with Platformatic. The capability calls Eve's build pipeline and writes the output to `.output` unless configured otherwise.

Start the production application after building. The capability loads `.output/server/index.mjs`, applies Platformatic server options, prewarms Eve sandboxes, and serves the built application.

## Custom Commands

Use `application.commands` when your application needs a custom command instead of the built-in Eve integration:

```json
{
  "module": "@platformatic/eve",
  "application": {
    "commands": {
      "build": "npm run build:eve",
      "development": "npm run dev:eve",
      "production": "npm run start:eve"
    }
  }
}
```

When a custom command is configured:

- `build` runs `application.commands.build`.
- development startup runs `application.commands.development`.
- production startup runs `application.commands.production`.

The command is managed as a child process by Platformatic.

## Programmatic Usage

```js
import { create } from '@platformatic/eve'

const app = await create(process.cwd(), {
  server: {
    hostname: '127.0.0.1',
    port: 3000
  }
})

await app.build()
await app.start({ listen: true })

const response = await app.inject({ url: '/eve/v1/health' })
console.log(response.statusCode, response.body)

await app.stop()
```

The package also exports:

- `loadConfiguration(configOrRoot, sourceOrConfig, context)`
- `transform(config)`
- `EveCapability`
- `schema`, `schemaComponents`, and `version`

## Configuration Reference

### `eve.outputDirectory`

Production build output directory. Defaults to `.output`.

### `application.basePath`

Gateway prefix for the application. The capability ensures a trailing slash in the generated metadata.

### `application.commands.build`

Custom build command.

### `application.commands.development`

Custom development start command.

### `application.commands.production`

Custom production start command.

### `server`

Standard Platformatic server configuration. Hostname, port, backlog, and HTTPS settings are applied to the Eve server.

## License

Apache-2.0 - See [LICENSE](LICENSE) for more information.
