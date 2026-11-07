// Debug helper: print the full saved event log of one Session.
import { assistantText, createZooworkClient, toolCall } from '@zoowork-ai/sdk'
import { readApiKey } from '../src/config.js'
import { loadAgentState } from '../src/state.js'

const sessionId = process.argv[2]
if (!sessionId) throw new Error('usage: npm run events -- <session_id>')
const state = await loadAgentState()
if (!state?.agentId) throw new Error('Run npm run setup first')
const client = createZooworkClient({ apiKey: readApiKey() })
const events = await client.listAllEvents(state.agentId, sessionId)
for (const ev of events) {
  const call = toolCall(ev)
  const at = ev.createdAt?.slice(11, 19) ?? ''
  if (call?.phase === 'start')
    console.log(
      `${at} [tool:start] ${call.toolName} ${JSON.stringify(call.args ?? {}).slice(0, 700)}`,
    )
  else if (call?.phase === 'end')
    console.log(
      `${at} [tool:end] ${call.toolName} err=${call.isError ?? false} ${(call.resultPreview ?? '').slice(0, 1200)}`,
    )
  else if (ev.eventType === 'agent.assistant') console.log(`${at} [assistant] ${assistantText(ev)}`)
  else if (!['agent.item', 'agent.thinking', 'agent.lifecycle'].includes(ev.eventType)) {
    console.log(`${at} [${ev.eventType}] ${JSON.stringify(ev.payload).slice(0, 800)}`)
  }
}
