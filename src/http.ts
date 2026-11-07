import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join } from 'node:path'
import { parseBrief } from './brief.js'
import { BriefValidationError, DropPlannerError, RunStateError } from './errors.js'
import type { Run } from './run-types.js'
import type { RunManager } from './runs.js'
import type { RunStore } from './store.js'

const STATIC: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/style.css': 'style.css',
}
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 64 * 1024) throw new DropPlannerError('body_too_large', 'Request body is too large')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new DropPlannerError('invalid_json', 'Request body must be JSON')
  }
}

function summary(run: Run) {
  return {
    id: run.id,
    createdAt: run.createdAt,
    status: run.status,
    storeUrl: run.brief.storeUrl,
    dropName: run.plan?.drop_name,
    cost: run.totals?.cost,
    budget: run.brief.budget,
  }
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function purchaseOrdersCsv(run: Run): string {
  const rows: Array<Array<string | number>> = [
    [
      'po_number',
      'sku',
      'style',
      'colorway',
      'size',
      'units',
      'unit_landed_cost',
      'line_cost',
      'issued_at',
    ],
  ]
  for (const po of run.purchaseOrders ?? []) {
    for (const line of po.lines) {
      rows.push([
        po.poNumber,
        po.sku,
        po.name,
        line.colorway,
        line.size,
        line.units,
        po.unitCost,
        line.units * po.unitCost,
        po.issuedAt,
      ])
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function createAppServer(opts: {
  manager: RunManager
  store: RunStore
  publicDir: string
  info: { agentId: string; model: string }
}): Server {
  const { manager, store, publicDir, info } = opts
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      try {
        if (req.method === 'GET' && STATIC[path]) {
          const file = STATIC[path] as string
          const body = await readFile(join(publicDir, file))
          res.writeHead(200, {
            'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
            'cache-control': 'no-store',
          })
          res.end(body)
          return
        }
        if (req.method === 'GET' && path === '/api/health')
          return send(res, 200, { ok: true, ...info })
        if (req.method === 'GET' && path === '/api/runs')
          return send(res, 200, { runs: store.list().map(summary) })
        if (req.method === 'POST' && path === '/api/runs') {
          const brief = parseBrief(await readJson(req), new Date())
          return send(res, 201, await manager.start(brief))
        }
        const match = /^\/api\/runs\/(run_[0-9a-f]{8})(\/[a-z-.]+)?$/.exec(path)
        if (match) {
          const runId = match[1] as string
          const action = match[2] ?? ''
          const run = store.get(runId)
          if (!run) throw new RunStateError('run_not_found', 'Run not found')
          if (req.method === 'GET' && action === '') return send(res, 200, run)
          if (req.method === 'GET' && action === '/purchase-orders.csv') {
            res.writeHead(200, {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': `attachment; filename="${runId}-purchase-orders.csv"`,
            })
            res.end(purchaseOrdersCsv(run))
            return
          }
          if (req.method === 'POST' && action === '/decision') {
            const body = (await readJson(req)) as { decision?: unknown; notes?: unknown }
            const decision =
              body.decision === 'approve'
                ? 'approve'
                : body.decision === 'changes'
                  ? 'changes'
                  : undefined
            const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : ''
            if (!decision)
              throw new DropPlannerError('invalid_decision', 'decision must be approve or changes')
            if (decision === 'changes' && !notes)
              throw new DropPlannerError('notes_required', 'Say what should change')
            return send(
              res,
              200,
              await manager.decide(runId, decision, notes, 'merchandising-lead'),
            )
          }
          if (req.method === 'POST' && action === '/stop')
            return send(res, 200, await manager.stop(runId))
          if (req.method === 'POST' && action === '/watch')
            return send(res, 200, await manager.triggerWatch(runId))
        }
        send(res, 404, { error: 'not_found' })
      } catch (error) {
        if (error instanceof BriefValidationError)
          return send(res, 400, { error: error.code, issues: error.issues })
        if (error instanceof RunStateError)
          return send(res, error.code === 'run_not_found' ? 404 : 409, {
            error: error.code,
            message: error.message,
          })
        if (error instanceof DropPlannerError)
          return send(res, 400, { error: error.code, message: error.message })
        console.error(error)
        send(res, 500, {
          error: 'internal_error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  })
}
