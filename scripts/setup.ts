import { agentResource } from '../src/agent-definition.js'
import { readApiKey, readModel } from '../src/config.js'
import { uploadKit } from '../src/kit.js'
import { loadAgentState, newAgentState, saveAgentState } from '../src/state.js'
import { createClient, ensureAgent } from '../src/zoowork.js'

const client = createClient(readApiKey())
const state = (await loadAgentState()) ?? newAgentState()
await saveAgentState(state)
const model = readModel()
const agentId = await ensureAgent(
  client,
  agentResource({ instance: state.instance, ...(model ? { model } : {}) }),
  state,
)
state.kitHash = await uploadKit(client, agentId, state.kitHash)
await saveAgentState(state)
console.log(`Drop Planner agent ready: ${agentId}`)
