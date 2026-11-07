import { BriefValidationError } from './errors.js'

export type ApprovalMode = 'manual' | 'auto'

/** What a merchandiser asks for. Every numeric constraint here is enforced again on the plan. */
export interface DropBrief {
  storeUrl: string
  brandName?: string
  dropTheme?: string
  launchDate: string
  currency: 'USD'
  budget: number
  targetMarginPct: number
  skuCount: number
  sellThroughPct: number
  markdownPct: number
  minUnitsPerStyle: number
  approvalMode: ApprovalMode
  makeTeaserVideo: boolean
  weeklyWatch: boolean
  notes?: string
}

const DAY_MS = 86_400_000

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new BriefValidationError(['brief must be a JSON object'])
  }
  return input as Record<string, unknown>
}

function optionalText(
  raw: Record<string, unknown>,
  key: string,
  max: number,
  issues: string[],
): string | undefined {
  const value = raw[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.trim().length > max) {
    issues.push(`${key} must be text up to ${max} characters`)
    return undefined
  }
  return value.trim() || undefined
}

function numberIn(
  raw: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fallback: number | undefined,
  issues: string[],
  integer = false,
): number {
  const value = raw[key] ?? fallback
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (
    typeof parsed !== 'number' ||
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max ||
    (integer && !Number.isInteger(parsed))
  ) {
    issues.push(`${key} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`)
    return min
  }
  return parsed
}

function normaliseStoreUrl(value: unknown, issues: string[]): string {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push('storeUrl is required (for example https://brand.com)')
    return ''
  }
  const text = value.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('scheme')
    if (!url.hostname.includes('.')) throw new TypeError('host')
    return url.origin
  } catch {
    issues.push('storeUrl must be an http(s) store address such as https://brand.com')
    return ''
  }
}

function launchDateFrom(value: unknown, now: Date, issues: string[]): string {
  const text = typeof value === 'string' ? value.trim() : ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : undefined
  if (!date || Number.isNaN(date.getTime())) {
    issues.push('launchDate must be a date in YYYY-MM-DD form')
    return text
  }
  if (date.getTime() - now.getTime() < 14 * DAY_MS) {
    issues.push('launchDate must be at least 14 days from today so production can be planned')
  }
  return text
}

/** Validates untrusted form input into a brief, collecting every issue before throwing. */
export function parseBrief(input: unknown, now: Date): DropBrief {
  const raw = asRecord(input)
  const issues: string[] = []
  const storeUrl = normaliseStoreUrl(raw.storeUrl, issues)
  const launchDate = launchDateFrom(raw.launchDate, now, issues)
  const budget = numberIn(raw, 'budget', 1_000, 5_000_000, undefined, issues)
  const targetMarginPct = numberIn(raw, 'targetMarginPct', 30, 90, undefined, issues)
  const skuCount = numberIn(raw, 'skuCount', 3, 10, 6, issues, true)
  const sellThroughPct = numberIn(raw, 'sellThroughPct', 20, 100, 65, issues)
  const markdownPct = numberIn(raw, 'markdownPct', 0, 90, 40, issues)
  const minUnitsPerStyle = numberIn(raw, 'minUnitsPerStyle', 1, 10_000, 100, issues, true)
  const approvalMode = raw.approvalMode ?? 'manual'
  if (approvalMode !== 'manual' && approvalMode !== 'auto') {
    issues.push('approvalMode must be "manual" or "auto"')
  }
  const currency = raw.currency ?? 'USD'
  if (currency !== 'USD') issues.push('currency must be USD')
  const brandName = optionalText(raw, 'brandName', 80, issues)
  const dropTheme = optionalText(raw, 'dropTheme', 200, issues)
  const notes = optionalText(raw, 'notes', 2000, issues)
  if (issues.length) throw new BriefValidationError(issues)
  return {
    storeUrl,
    ...(brandName ? { brandName } : {}),
    ...(dropTheme ? { dropTheme } : {}),
    launchDate,
    currency: 'USD',
    budget,
    targetMarginPct,
    skuCount,
    sellThroughPct,
    markdownPct,
    minUnitsPerStyle,
    approvalMode: approvalMode as ApprovalMode,
    makeTeaserVideo: raw.makeTeaserVideo === true,
    weeklyWatch: raw.weeklyWatch === true,
    ...(notes ? { notes } : {}),
  }
}

export function money(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`
}

/** The Session's first message. The playbook in AGENTS.md explains how to execute it. */
export function briefToMessage(brief: DropBrief, runId: string): string {
  const workdir = `/workspace/drops/${runId}`
  const lines = [
    `NEW DROP BRIEF (run ${runId})`,
    `Work autonomously from start to finish by following the Drop Planner playbook in AGENTS.md. Do not ask me questions; make reasonable merchandising assumptions and state them.`,
    '',
    `- Brand store: ${brief.storeUrl}${brief.brandName ? ` (${brief.brandName})` : ''}`,
    `- Drop theme: ${brief.dropTheme ?? 'your call, grounded in the catalog and current trends'}`,
    `- Launch date: ${brief.launchDate}`,
    `- Open-to-buy budget: ${money(brief.budget)} ${brief.currency} (hard cap on total landed cost)`,
    `- Target blended initial margin: ${brief.targetMarginPct}% or better`,
    `- Capsule size: exactly ${brief.skuCount} SKUs (styles)`,
    `- Minimum order: ${brief.minUnitsPerStyle} units per style`,
    `- Projection assumptions: ${brief.sellThroughPct}% full-price sell-through, remainder cleared at ${brief.markdownPct}% off`,
    `- Teaser video: ${brief.makeTeaserVideo ? 'yes, make one short Seedance teaser of the hero SKU after sign-off' : 'no'}`,
    ...(brief.notes ? [`- Merchandiser notes: ${brief.notes}`] : []),
    '',
    `Workspace for this run: ${workdir} (create it; keep every file for this run inside it).`,
    `Finish by calling submit_drop_plan with the final plan; the app enforces the budget, margin, MOQ and calendar guardrails and returns the sign-off decision.`,
  ]
  return lines.join('\n')
}
