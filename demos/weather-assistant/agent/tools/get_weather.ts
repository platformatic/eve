import { defineTool } from 'eve/tools'
import { z } from 'zod'

// The runtime tool name comes from the filename, so the model sees `get_weather`.

const CONDITIONS = ['Sunny', 'Partly cloudy', 'Overcast', 'Light rain', 'Windy', 'Foggy']

export default defineTool({
  description: 'Get the current weather for a city. Returns mocked data for this demo.',
  inputSchema: z.object({
    city: z.string().min(1).describe('The city to look up, e.g. "Brooklyn"')
  }),
  async execute ({ city }) {
    // Deterministic pseudo-weather derived from the city name, so the demo is
    // reproducible offline and never calls a real weather service.
    const seed = [...city.toLowerCase()].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)

    return {
      city,
      condition: CONDITIONS[seed % CONDITIONS.length],
      temperatureF: 55 + (seed % 35),
      humidity: 40 + (seed % 50),
      source: 'mock'
    }
  }
})
