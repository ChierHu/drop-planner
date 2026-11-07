import { ConfigError } from './errors.js'

/** Reads the server-side Platform Project key. Never send it to the browser or the sandbox. */
export function readApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.ZOOWORK_API_KEY?.trim()
  if (!apiKey || !apiKey.startsWith('zwp_live_') || apiKey.length <= 9) {
    throw new ConfigError(
      'platform_project_key_required',
      'Set ZOOWORK_API_KEY (zwp_live_...) in .env. Create one at https://platform.zoowork.ai -> API keys.',
    )
  }
  return apiKey
}

/** Optional model alias override; undefined means "use the platform default". */
export function readModel(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const model = env.ZOOWORK_MODEL?.trim()
  return model ? model : undefined
}

export function readPort(env: NodeJS.ProcessEnv = process.env): number {
  const port = Number(env.PORT ?? 4700)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new ConfigError('invalid_port', `PORT must be an integer between 1024 and 65535`)
  }
  return port
}
