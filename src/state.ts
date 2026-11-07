import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ConfigError } from './errors.js'

/** Local record of the one Agent this app owns, so setup is idempotent. */
export interface AgentState {
  version: 1
  instance: string
  agentId?: string
  configHash?: string
  kitHash?: string
}

export const STATE_PATH = '.local/agent.json'

export function newAgentState(): AgentState {
  return { version: 1, instance: randomUUID() }
}

export async function loadAgentState(path: string = STATE_PATH): Promise<AgentState | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const parsed = JSON.parse(raw) as Partial<AgentState>
  if (parsed.version !== 1 || typeof parsed.instance !== 'string') {
    throw new ConfigError('invalid_state', `${path} is not a Drop Planner state file`)
  }
  return parsed as AgentState
}

export async function saveAgentState(state: AgentState, path: string = STATE_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  await rename(temp, path)
}
