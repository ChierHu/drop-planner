import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Run } from './run-types.js'

/** One JSON file per run under .local/runs; small, inspectable and restart-safe. */
export class RunStore {
  private readonly runs = new Map<string, Run>()
  private readonly pending = new Map<string, NodeJS.Timeout>()

  constructor(private readonly dir: string) {}

  async load(): Promise<Run[]> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith('.json')) continue
      const run = JSON.parse(await readFile(join(this.dir, name), 'utf8')) as Run
      this.runs.set(run.id, run)
    }
    return this.list()
  }

  list(): Run[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(id: string): Run | undefined {
    return this.runs.get(id)
  }

  put(run: Run): void {
    this.runs.set(run.id, run)
    this.schedule(run.id)
  }

  /** Coalesces bursts of event updates into one write per run every 500 ms. */
  private schedule(id: string): void {
    if (this.pending.has(id)) return
    this.pending.set(
      id,
      setTimeout(() => {
        this.pending.delete(id)
        void this.flush(id)
      }, 500),
    )
  }

  async flush(id: string): Promise<void> {
    const run = this.runs.get(id)
    if (!run) return
    const path = join(this.dir, `${id}.json`)
    const temp = `${path}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(run, null, 2), { mode: 0o600 })
    await rename(temp, path)
  }

  async flushAll(): Promise<void> {
    for (const [id, timer] of this.pending) {
      clearTimeout(timer)
      this.pending.delete(id)
    }
    await Promise.all([...this.runs.keys()].map((id) => this.flush(id)))
  }
}
