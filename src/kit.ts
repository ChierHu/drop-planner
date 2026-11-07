import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ZooworkClient } from '@zoowork-ai/sdk'
import { hashOf } from './zoowork.js'

export const KIT_FILES = ['catalog.py', 'pack.py', 'html2pdf.cjs'] as const

export async function readKit(dir = 'kit'): Promise<Array<{ name: string; content: string }>> {
  return Promise.all(
    KIT_FILES.map(async (name) => ({ name, content: await readFile(join(dir, name), 'utf8') })),
  )
}

/** Copies the kit into the Agent's persistent /workspace/kit when its content changed. */
export async function uploadKit(
  client: ZooworkClient,
  agentId: string,
  previousHash?: string,
): Promise<string> {
  const files = await readKit()
  const hash = hashOf(files)
  if (hash === previousHash) return hash
  for (const file of files) {
    const result = await client.uploadFile(agentId, `kit/${file.name}`, file.content)
    console.log(`uploaded ${result.path} (${result.size} bytes)`)
  }
  return hash
}
