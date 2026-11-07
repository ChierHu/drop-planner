import { createZooworkClient } from '@zoowork-ai/sdk'
import { readApiKey } from '../src/config.js'

const client = createZooworkClient({ apiKey: readApiKey() })
const models = await client.listModels()
for (const m of models) {
  const row = m as unknown as Record<string, unknown>
  console.log(
    [
      row.model,
      row.selectable === false ? '(not selectable)' : '',
      JSON.stringify(row.default_for ?? []),
      JSON.stringify(row.input ?? []),
      JSON.stringify((row.thinking as Record<string, unknown> | undefined)?.levels ?? []),
      row.display_name ?? '',
    ].join('  '),
  )
}
const balance = await (client as unknown as { getBalance?: () => Promise<unknown> }).getBalance?.()
console.log('balance:', JSON.stringify(balance))
