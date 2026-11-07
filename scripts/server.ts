import { resolve } from 'node:path'
import { DEFAULT_MODEL } from '../src/agent-definition.js'
import { readApiKey, readModel, readPort } from '../src/config.js'
import { ConfigError } from '../src/errors.js'
import { createAppServer } from '../src/http.js'
import { RunManager } from '../src/runs.js'
import { loadAgentState } from '../src/state.js'
import { RunStore } from '../src/store.js'
import { createClient } from '../src/zoowork.js'

const state = await loadAgentState()
if (!state?.agentId)
  throw new ConfigError(
    'run_setup_first',
    'Run `npm run setup` to create and start the ZooWork agent first',
  )
const client = createClient(readApiKey())
const agent = await client.getAgent(state.agentId)
if (agent.status?.desired_state !== 'running') {
  await client.startAgent(state.agentId)
  await client.waitUntilRunning(state.agentId, { timeoutMs: 60_000 })
}
const store = new RunStore(resolve('.local/runs'))
await store.load()
const manager = new RunManager(client, state.agentId, store)
manager.resumeAll()
const port = readPort()
const model = readModel() ?? DEFAULT_MODEL
const server = createAppServer({
  manager,
  store,
  publicDir: resolve('public'),
  info: { agentId: state.agentId, model },
})
server.listen(port, '127.0.0.1', () =>
  console.log(`Drop Planner: http://localhost:${port}  (agent ${state.agentId}, ${model})`),
)
const shutdown = async () => {
  manager.close()
  server.close()
  await store.flushAll()
  process.exit(0)
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
