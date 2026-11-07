import { randomBytes } from 'node:crypto'
import {
  ZooworkError,
  assistantText,
  customToolUse,
  isRunFinished,
  runOutcome,
  toolCall,
  type SessionEvent,
  type ZooworkClient,
} from '@zoowork-ai/sdk'
import { SUBMIT_TOOL } from './agent-definition.js'
import { briefToMessage, money, type DropBrief } from './brief.js'
import { PlanValidationError, RunStateError } from './errors.js'
import { buildPurchaseOrders, computeTotals, validatePlan } from './plan.js'
import type { Run } from './run-types.js'
import type { RunStore } from './store.js'
import { describeToolStart, parseArtifactResult } from './timeline.js'
import { WATCH_LABEL, watchSchedule } from './watch.js'

const TERMINAL = new Set(['done', 'failed', 'stopped'])

export function isTerminal(run: Run): boolean {
  return TERMINAL.has(run.status)
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Owns every run: one ZooWork Session per brief, one event consumer per Session. */
export class RunManager {
  private readonly watchers = new Map<string, AbortController>()

  constructor(
    private readonly client: ZooworkClient,
    private readonly agentId: string,
    private readonly store: RunStore,
  ) {}

  async start(brief: DropBrief): Promise<Run> {
    const run: Run = {
      id: `run_${randomBytes(4).toString('hex')}`,
      createdAt: nowIso(),
      brief,
      status: 'starting',
      steps: [],
      notes: [],
      artifacts: [],
      guardrailRejections: [],
      submissions: 0,
    }
    this.store.put(run)
    const session = await this.client.createSession(
      this.agentId,
      {
        metadata: { app: 'drop-planner', run_id: run.id, store: brief.storeUrl },
        initial_events: [{ type: 'user.message', content: briefToMessage(brief, run.id) }],
      },
      `drop-planner:session:${run.id}`,
    )
    run.sessionId = session.session_id
    run.status = 'running'
    this.store.put(run)
    this.watch(run)
    return run
  }

  /** Re-attaches to runs that were still in flight when the server stopped. */
  resumeAll(): void {
    for (const run of this.store.list()) {
      if (!isTerminal(run) && run.sessionId) this.watch(run)
    }
  }

  async decide(
    runId: string,
    decision: 'approve' | 'changes',
    notes: string,
    decidedBy: string,
  ): Promise<Run> {
    const run = this.require(runId)
    const approval = run.approval
    if (!approval || approval.status !== 'pending' || !run.plan) {
      throw new RunStateError('no_pending_approval', 'This run has no buy waiting for sign-off')
    }
    if (decision === 'approve') {
      const orders = buildPurchaseOrders(run.plan, run.id, new Date())
      await this.client.resolveCustomToolCall(this.agentId, approval.callId, {
        content: [
          {
            type: 'json',
            value: {
              status: 'approved',
              approved_by: decidedBy,
              reviewer_notes: notes || null,
              purchase_orders: orders.map((o) => ({
                po_number: o.poNumber,
                sku: o.sku,
                units: o.units,
                landed_cost: o.cost,
              })),
              totals: run.totals,
            },
          },
        ],
        resolvedBy: decidedBy,
      })
      run.purchaseOrders = orders
      approval.status = 'approved'
      if (run.brief.weeklyWatch) await this.scheduleWatch(run)
    } else {
      await this.client.resolveCustomToolCall(this.agentId, approval.callId, {
        content: [{ type: 'json', value: { status: 'changes_requested', reviewer_notes: notes } }],
        resolvedBy: decidedBy,
      })
      approval.status = 'changes_requested'
    }
    approval.decidedBy = decidedBy
    approval.decidedAt = nowIso()
    if (notes) approval.notes = notes
    run.status = 'running'
    this.store.put(run)
    return run
  }

  /** Creates the weekly ZooWork Schedule that re-checks the drop in this run's Session. */
  private async scheduleWatch(run: Run): Promise<void> {
    if (!run.sessionId || !run.plan || run.watch?.scheduleId) return
    const input = watchSchedule(run.id, run.sessionId, run.plan.drop_name, run.brief)
    try {
      await this.client.createSchedule(this.agentId, input, `drop-planner:watch:${run.id}`)
      run.watch = { scheduleId: input.schedule_id, label: WATCH_LABEL, createdAt: nowIso() }
    } catch (error) {
      // Recorded on the run and shown in the UI; the approved buy stands either way.
      run.watch = {
        createdAt: nowIso(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** Scheduled turns publish watch.md instead of replying; keep its text for the Drop Watch card. */
  private async captureWatchReport(run: Run, url: string, at: string): Promise<void> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) {
      run.notes.push({
        at,
        text: `Drop Watch report published but could not be read (HTTP ${response.status}).`,
      })
      return
    }
    const text = (await response.text()).slice(0, 6000)
    run.watch = {
      ...run.watch,
      createdAt: run.watch?.createdAt ?? at,
      lastReport: text,
      lastReportUrl: url,
      lastReportAt: at,
    }
  }

  /** Fires the weekly Drop Watch now and follows the scheduled turn live. */
  async triggerWatch(runId: string): Promise<Run> {
    const run = this.require(runId)
    const scheduleId = run.watch?.scheduleId
    if (!scheduleId) throw new RunStateError('no_watch', 'This drop has no Drop Watch schedule')
    if (!isTerminal(run)) throw new RunStateError('busy', 'Wait for the current turn to finish')
    await this.client.triggerSchedule(this.agentId, scheduleId)
    run.watch = {
      ...run.watch,
      createdAt: run.watch?.createdAt ?? nowIso(),
      lastTriggeredAt: nowIso(),
    }
    run.status = 'running'
    delete run.finishedAt
    run.notes.push({ at: nowIso(), text: 'Drop Watch triggered from the ZooWork Schedule.' })
    this.store.put(run)
    this.watch(run)
    return run
  }

  async stop(runId: string): Promise<Run> {
    const run = this.require(runId)
    if (!run.sessionId || isTerminal(run))
      throw new RunStateError('not_running', 'Run is not in progress')
    await this.client.postEvents(this.agentId, run.sessionId, [
      { type: 'user.interrupt', idempotency_key: `drop-planner:interrupt:${run.id}` },
    ])
    return run
  }

  close(): void {
    for (const controller of this.watchers.values()) controller.abort()
    this.watchers.clear()
  }

  private require(runId: string): Run {
    const run = this.store.get(runId)
    if (!run) throw new RunStateError('run_not_found', `No run ${runId}`)
    return run
  }

  private watch(run: Run): void {
    if (this.watchers.has(run.id)) return
    const controller = new AbortController()
    this.watchers.set(run.id, controller)
    void this.consume(run, controller.signal)
      .catch((error: unknown) => {
        run.status = 'failed'
        run.error = error instanceof Error ? error.message : String(error)
        this.store.put(run)
      })
      .finally(() => this.watchers.delete(run.id))
  }

  /** Streams the Session from the saved cursor, reconnecting until the task's final run.finished. */
  private async consume(run: Run, signal: AbortSignal): Promise<void> {
    const sessionId = run.sessionId
    if (!sessionId) throw new RunStateError('no_session', 'Run has no ZooWork session')
    for (let attempt = 0; !signal.aborted && !isTerminal(run); attempt += 1) {
      try {
        for await (const ev of this.client.streamEvents(this.agentId, sessionId, {
          ...(run.cursor ? { cursor: run.cursor } : {}),
          signal,
        })) {
          if (ev.seq !== -1 && run.lastSeq !== undefined && ev.seq <= run.lastSeq) continue
          await this.process(run, ev)
          if (ev.cursor) run.cursor = ev.cursor
          if (ev.seq !== -1) run.lastSeq = ev.seq
          this.store.put(run)
          if (isTerminal(run)) return
        }
        attempt = 0
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof ZooworkError && error.status >= 400 && error.status < 500) throw error
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 15_000)))
    }
  }

  private async process(run: Run, ev: SessionEvent): Promise<void> {
    const at = ev.createdAt ?? nowIso()
    const call = toolCall(ev)
    if (call) {
      const existing = run.steps.find((s) => s.id === call.toolCallId)
      if (call.phase === 'start' && !existing) {
        const d = describeToolStart(call.toolName, call.args ?? {})
        run.steps.push({
          id: call.toolCallId,
          tool: call.toolName,
          label: d.label,
          ...(d.detail ? { detail: d.detail } : {}),
          phase: d.phase,
          status: 'running',
          startedAt: at,
        })
      } else if (existing && call.phase !== 'start') {
        existing.status = call.phase === 'blocked' ? 'blocked' : call.isError ? 'error' : 'done'
        existing.endedAt = at
        if (call.toolName === 'artifact_publish' && call.phase === 'end' && !call.isError) {
          const artifact = parseArtifactResult(call.resultPreview ?? '')
          if (artifact && !run.artifacts.some((a) => a.artifactId === artifact.artifactId)) {
            run.artifacts.push({ ...artifact, at })
            if (artifact.fileName === 'watch.md')
              await this.captureWatchReport(run, artifact.url, at)
          }
        }
      }
      return
    }
    const custom = customToolUse(ev)
    if (custom?.phase === 'requested' && custom.name === SUBMIT_TOOL) {
      await this.handleSubmission(run, custom.callId, custom.input ?? {})
      return
    }
    if (
      custom?.phase === 'resolved' &&
      run.approval?.callId === custom.callId &&
      run.approval.status === 'pending'
    ) {
      run.approval.status = 'expired'
      run.status = 'running'
      return
    }
    if (ev.eventType === 'agent.assistant') {
      const text = assistantText(ev).trim()
      if (text) {
        run.notes.push({ at, text })
        run.finalText = text
      }
      return
    }
    if (ev.eventType === 'agent.error') {
      const message =
        typeof ev.payload.errorMessage === 'string' ? ev.payload.errorMessage : 'Agent error'
      run.notes.push({ at, text: `⚠ ${message}` })
      return
    }
    if (ev.eventType === 'run.started' && isTerminal(run)) {
      run.status = 'running'
      delete run.finishedAt
      return
    }
    if (isRunFinished(ev)) {
      if (ev.payload.turnEndReason === 'yielded') return
      const outcome = runOutcome(ev)
      run.status = outcome === 'succeeded' ? 'done' : outcome === 'aborted' ? 'stopped' : 'failed'
      if (outcome !== 'succeeded') run.error = run.error ?? `Run ${outcome ?? 'ended unexpectedly'}`
      run.finishedAt = at
      for (const step of run.steps)
        if (step.status === 'running') step.status = outcome === 'succeeded' ? 'done' : 'error'
    }
  }

  /** The guardrail: recompute and enforce the brief, then park the buy for sign-off. */
  private async handleSubmission(
    run: Run,
    callId: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    if (run.approval?.callId === callId) return
    run.submissions += 1
    try {
      const plan = validatePlan(input, run.brief)
      run.plan = plan
      run.totals = computeTotals(plan, run.brief)
      run.approval = { callId, requestedAt: nowIso(), status: 'pending' }
      run.status = 'awaiting_approval'
      this.store.put(run)
      if (run.brief.approvalMode === 'auto') {
        await this.decide(
          run.id,
          'approve',
          `Auto-approved by policy: ${money(run.totals.cost)} landed cost within ${money(run.brief.budget)} budget at ${run.totals.initialMarginPct.toFixed(1)}% IMU`,
          'auto-approval-policy',
        )
      }
    } catch (error) {
      if (!(error instanceof PlanValidationError)) throw error
      run.guardrailRejections.push({ at: nowIso(), issues: error.issues })
      await this.client.resolveCustomToolCall(this.agentId, callId, {
        content: [
          {
            type: 'json',
            value: {
              status: 'rejected_by_guardrails',
              issues: error.issues,
              instruction:
                'Fix every issue in plan.json, rerun pack.py --check, then call submit_drop_plan again.',
            },
          },
        ],
        isError: true,
        resolvedBy: 'drop-planner-guardrails',
      })
    }
  }
}
