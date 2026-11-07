import { createZooworkClient } from '@zoowork-ai/sdk'
import { readApiKey } from '../src/config.js'
import { loadAgentState } from '../src/state.js'

const state = await loadAgentState()
if (!state?.agentId) throw new Error('Run npm run setup first')
const client = createZooworkClient({ apiKey: readApiKey() })
const skills = await client.listAgentSkills(state.agentId)
for (const s of skills) {
  const row = s as unknown as Record<string, unknown>
  console.log(
    `${row.skill_id}  ${row.name}  v${row.version}  scope=${row.scope}  eligible=${row.eligible}  ${String(row.description ?? '').slice(0, 160)}`,
  )
}
