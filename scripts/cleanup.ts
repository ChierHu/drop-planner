// Removes this app's Drop Watch schedules (they keep firing and spending credits until deleted).
// Pass --stop to also stop the Agent.
import { readApiKey } from '../src/config.js'
import { loadAgentState } from '../src/state.js'
import { createClient } from '../src/zoowork.js'

const state = await loadAgentState()
if (!state?.agentId) throw new Error('No agent recorded in .local/agent.json')
const client = createClient(readApiKey())
for (const schedule of await client.listSchedules(state.agentId)) {
  const id = (schedule as unknown as { schedule_id?: string }).schedule_id
  if (id?.startsWith('drop-watch-')) {
    await client.deleteSchedule(state.agentId, id)
    console.log(`deleted schedule ${id}`)
  }
}
if (process.argv.includes('--stop')) {
  await client.stopAgent(state.agentId)
  console.log(`stopped agent ${state.agentId}`)
}
