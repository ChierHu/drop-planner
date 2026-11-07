import { createHash } from 'node:crypto'
import { createZooworkClient, type AgentResource, type ZooworkClient } from '@zoowork-ai/sdk'
import { PlatformError } from './errors.js'
import { saveAgentState, type AgentState } from './state.js'

export function createClient(apiKey: string): ZooworkClient {
  return createZooworkClient({ apiKey })
}

export function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

/** PUT rejects `skills`; every other resource section can be re-declared. */
function updatableSections(resource: AgentResource): Record<string, unknown> {
  const sections: Record<string, unknown> = { ...resource }
  delete sections.skills
  return sections
}

/**
 * Creates the app's Agent once (idempotency key bound to this checkout's instance id),
 * re-declares its configuration only when it changed, then starts it.
 */
export async function ensureAgent(
  client: ZooworkClient,
  resource: AgentResource,
  state: AgentState,
): Promise<string> {
  const configHash = hashOf(resource)
  if (!state.agentId) {
    const created = await client.createAgent({ resource }, `drop-planner:${state.instance}`)
    if (!created.agent_id)
      throw new PlatformError('invalid_create_receipt', 'createAgent returned no agent_id')
    state.agentId = created.agent_id
    state.configHash = configHash
    await saveAgentState(state)
  } else if (state.configHash !== configHash) {
    await client.updateAgent(state.agentId, updatableSections(resource))
    state.configHash = configHash
    await saveAgentState(state)
  }
  await client.startAgent(state.agentId)
  await client.waitUntilRunning(state.agentId, { timeoutMs: 60_000 })
  return state.agentId
}
