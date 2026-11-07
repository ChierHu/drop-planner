// Debug helper: send one message to the app's Agent (new Session, or SESSION=<id> to continue) and print events.
import {
  assistantText,
  createZooworkClient,
  isRunFinished,
  runOutcome,
  toolCall,
  type SessionEvent,
} from '@zoowork-ai/sdk'
import { readApiKey } from '../src/config.js'
import { loadAgentState } from '../src/state.js'

const message = process.argv.slice(2).join(' ').trim()
const state = await loadAgentState()
if (!state?.agentId) throw new Error('Run npm run setup first')
const agentId = state.agentId
const client = createZooworkClient({ apiKey: readApiKey() })
let sessionId = process.env.SESSION
let cursor = process.env.CURSOR
if (!sessionId) {
  if (!message) throw new Error('usage: npm run ask -- "<message>"')
  const session = await client.createSession(agentId, {
    metadata: { source: 'drop-planner-ask' },
    initial_events: [{ type: 'user.message', content: message }],
  })
  sessionId = session.session_id
} else if (message) {
  await client.postEvents(agentId, sessionId, [{ type: 'user.message', content: message }])
}
console.log(`session ${sessionId}`)
const started = Date.now()
const print = (ev: SessionEvent) => {
  const t = ((Date.now() - started) / 1000).toFixed(0).padStart(4)
  const call = toolCall(ev)
  if (call?.phase === 'start')
    console.log(
      `${t}s [tool:start] ${call.toolName} ${JSON.stringify(call.args ?? {}).slice(0, 500)}`,
    )
  else if (call?.phase === 'end')
    console.log(
      `${t}s [tool:end] ${call.toolName} err=${call.isError ?? false} ${(call.resultPreview ?? '').slice(0, 800)}`,
    )
  else if (call?.phase === 'blocked')
    console.log(`${t}s [tool:blocked] ${call.toolName} ${JSON.stringify(ev.payload)}`)
  else if (ev.eventType === 'agent.assistant') console.log(`${t}s [assistant] ${assistantText(ev)}`)
  else if (
    !['agent.item', 'agent.thinking', 'agent.lifecycle', 'user.message'].includes(ev.eventType)
  ) {
    console.log(`${t}s [${ev.eventType}] ${JSON.stringify(ev.payload).slice(0, 600)}`)
  }
}
let done = false
let skipFinished = Boolean(process.env.SESSION) && !cursor
for (let attempt = 0; attempt < 40 && !done; attempt += 1) {
  try {
    for await (const ev of client.streamEvents(agentId, sessionId, cursor ? { cursor } : {})) {
      cursor = ev.cursor ?? cursor
      print(ev)
      if (isRunFinished(ev)) {
        if (skipFinished) {
          skipFinished = false
          continue
        }
        console.log(`outcome: ${runOutcome(ev)}  cursor: ${cursor}`)
        done = true
        break
      }
    }
  } catch (error) {
    console.log(`[stream error] ${(error as Error).message}`)
  }
  if (!done) await new Promise((r) => setTimeout(r, 1500))
}
