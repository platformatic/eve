import { createWorld as createPlatformaticWorld } from '@platformatic/world'

export function createWorld () {
  const world = createPlatformaticWorld()

  return {
    ...world,
    specVersion: 4,
    queue (queueName, message, options) {
      const normalizedQueueName = queueName.replace(
        /^__[a-z][a-z0-9]*_(wkf_(?:workflow|step)_.+)$/,
        '__$1'
      )
      return world.queue(normalizedQueueName, message, options)
    }
  }
}
