import type { DropBrief } from './brief.js'
import type { DropPlan, PlanTotals, PurchaseOrder } from './plan.js'
import type { Phase, PublishedArtifact } from './timeline.js'

export type RunStatus = 'starting' | 'running' | 'awaiting_approval' | 'done' | 'failed' | 'stopped'

export interface RunStep {
  id: string
  tool: string
  label: string
  detail?: string
  phase: Phase
  status: 'running' | 'done' | 'error' | 'blocked'
  startedAt: string
  endedAt?: string
}

export interface RunNote {
  at: string
  text: string
}

export interface RunArtifact extends PublishedArtifact {
  at: string
}

export interface Approval {
  callId: string
  requestedAt: string
  status: 'pending' | 'approved' | 'changes_requested' | 'expired'
  decidedBy?: string
  notes?: string
  decidedAt?: string
}

export interface DropWatch {
  scheduleId?: string
  label?: string
  createdAt: string
  lastTriggeredAt?: string
  error?: string
  lastReport?: string
  lastReportUrl?: string
  lastReportAt?: string
}

export interface Run {
  id: string
  createdAt: string
  brief: DropBrief
  status: RunStatus
  sessionId?: string
  cursor?: string
  lastSeq?: number
  error?: string
  steps: RunStep[]
  notes: RunNote[]
  artifacts: RunArtifact[]
  guardrailRejections: Array<{ at: string; issues: string[] }>
  submissions: number
  catalogProducts?: number
  plan?: DropPlan
  totals?: PlanTotals
  approval?: Approval
  purchaseOrders?: PurchaseOrder[]
  watch?: DropWatch
  finalText?: string
  finishedAt?: string
  /** When the drop itself was first completed; later scheduled watch turns do not move it. */
  completedAt?: string
}
