// Drop Planner front door: a visual, at-a-glance board for one autonomous drop run.
type Phase = 'recon' | 'brand' | 'trends' | 'plan' | 'visuals' | 'pack' | 'signoff' | 'other'
type Status = 'starting' | 'running' | 'awaiting_approval' | 'done' | 'failed' | 'stopped'

interface Step {
  id: string
  tool: string
  label: string
  detail?: string
  phase: Phase
  status: 'running' | 'done' | 'error' | 'blocked'
  startedAt: string
  endedAt?: string
}
interface Note {
  at: string
  text: string
}
interface Artifact {
  artifactId: string
  url: string
  fileName: string
  contentType: string
  at: string
}
interface Colorway {
  colorway: string
  sizes: Record<string, number>
  hex?: string
}
interface Sku {
  sku: string
  name: string
  category: string
  role: string
  description: string
  materials: string
  trend: string
  retail_price: number
  landed_cost: number
  image_url?: string
  comparable?: { title: string; price: number; url?: string }
  buy: Colorway[]
}
interface Plan {
  drop_name: string
  thesis: string
  brand_dna: string[]
  trends: Array<{ name: string; insight: string; sources: string[] }>
  skus: Sku[]
  calendar: Array<{ date: string; milestone: string }>
  line_sheet_url?: string
  buy_plan_url?: string
  video_url?: string
}
interface SkuTotals {
  sku: string
  units: number
  cost: number
  retailValue: number
  marginPct: number
}
interface Totals {
  units: number
  cost: number
  retailValue: number
  initialMarginPct: number
  projectedRevenue: number
  projectedGrossMargin: number
  maintainedMarginPct: number
  budgetUsedPct: number
  bySku: SkuTotals[]
}
interface PurchaseOrder {
  poNumber: string
  sku: string
  name: string
  units: number
  cost: number
}
interface Brief {
  storeUrl: string
  brandName?: string
  launchDate: string
  budget: number
  targetMarginPct: number
  skuCount: number
  minUnitsPerStyle: number
  approvalMode: 'manual' | 'auto'
  sellThroughPct: number
  markdownPct: number
}
interface Watch {
  scheduleId?: string
  label?: string
  lastTriggeredAt?: string
  error?: string
  lastReport?: string
  lastReportUrl?: string
  lastReportAt?: string
}
interface Run {
  id: string
  createdAt: string
  brief: Brief
  status: Status
  error?: string
  steps: Step[]
  notes: Note[]
  artifacts: Artifact[]
  guardrailRejections: Array<{ at: string; issues: string[] }>
  submissions: number
  catalogProducts?: number
  plan?: Plan
  totals?: Totals
  approval?: {
    status: 'pending' | 'approved' | 'changes_requested' | 'expired'
    decidedBy?: string
    notes?: string
  }
  purchaseOrders?: PurchaseOrder[]
  watch?: Watch
  finalText?: string
  finishedAt?: string
  completedAt?: string
}
interface RunSummary {
  id: string
  createdAt: string
  status: Status
  storeUrl: string
  brandName?: string
  dropName?: string
  cost?: number
  budget: number
  thumb?: string
}

// ---------- helpers ----------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} missing`)
  return el as T
}
const esc = (v: unknown): string =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
const num = (n: number): string => Math.round(n).toLocaleString('en-US')
const usd = (n: number | undefined): string => (n === undefined ? '—' : `$${num(n)}`)
const usdShort = (n: number): string =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 10_000
      ? `$${(n / 1000).toFixed(1)}K`
      : usd(n)
const pct = (n: number | undefined, digits = 1): string =>
  n === undefined ? '—' : `${n.toFixed(digits)}%`
const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const shortDate = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const plain = (text: string): string =>
  text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

/** End of the planning run itself (scheduled Drop Watch turns finish later and don't count). */
const doneAt = (run: {
  status: string
  completedAt?: string
  finishedAt?: string
}): string | undefined =>
  run.status === 'done' ? (run.completedAt ?? run.finishedAt) : run.finishedAt

function elapsed(from: string, to?: string): string {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Escape-first markdown for the agent log: bold, code, links, bullets, tables.
function md(text: string): string {
  const inline = (line: string): string =>
    esc(line)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(
        /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>',
      )
  const out: string[] = []
  let list: string[] = []
  let rows: string[][] = []
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((i) => `<li>${i}</li>`).join('')}</ul>`)
    list = []
    if (rows.length) {
      const [head, ...body] = rows
      out.push(
        `<table class="t"><tr>${(head ?? []).map((c) => `<th>${inline(c)}</th>`).join('')}</tr>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</table>`,
      )
    }
    rows = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim())
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
      continue
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      if (rows.length) flush()
      list.push(inline(bullet[1] ?? ''))
      continue
    }
    flush()
    if (line) out.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`)
  }
  flush()
  return out.join('')
}

// ---------- icons (inline, stroke = currentColor) ----------

const svg = (body: string, size = 22): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const ICON = {
  store: svg(
    '<path d="M3 9l1.6-5h14.8L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M10 20v-5h4v5"/>',
  ),
  eye: svg(
    '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  ),
  trend: svg('<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>'),
  grid: svg(
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  ),
  image: svg(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><polyline points="21 15 16 10 5 21"/>',
  ),
  file: svg(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
  ),
  stamp: svg('<circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16.5 9.5"/>'),
  check: svg('<polyline points="20 6 9 17 4 12"/>', 16),
  alert: svg(
    '<path d="M12 3l9.5 17h-19z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r="0.6"/>',
    16,
  ),
  log: svg(
    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    18,
  ),
  calendar: svg(
    '<rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>',
    18,
  ),
  play: svg('<polygon points="7 4 20 12 7 20 7 4"/>', 16),
  flag: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>', 16),
  download: svg(
    '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M4 21h16"/>',
    18,
  ),
  table: svg(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="10" x2="9" y2="20"/>',
    18,
  ),
  video: svg(
    '<rect x="2" y="5" width="14" height="14" rx="2"/><polygon points="22 8 16 12 22 16 22 8"/>',
    18,
  ),
  minus: svg('<line x1="5" y1="12" x2="19" y2="12"/>', 16),
  up: svg('<polyline points="6 15 12 9 18 15"/>', 16),
  x: svg('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>', 16),
}

const PIPELINE: Array<{ id: Phase; label: string; icon: string }> = [
  { id: 'recon', label: 'Catalog', icon: ICON.store },
  { id: 'brand', label: 'Brand DNA', icon: ICON.eye },
  { id: 'trends', label: 'Trends', icon: ICON.trend },
  { id: 'plan', label: 'Capsule', icon: ICON.grid },
  { id: 'visuals', label: 'Renders', icon: ICON.image },
  { id: 'pack', label: 'Line sheet', icon: ICON.file },
  { id: 'signoff', label: 'Sign-off', icon: ICON.stamp },
]
const STATUS_LABEL: Record<Status, string> = {
  starting: 'Starting',
  running: 'Agent working',
  awaiting_approval: 'Needs your sign-off',
  done: 'Drop ready',
  failed: 'Failed',
  stopped: 'Stopped',
}

// ---------- derived data ----------

const isImage = (a: Artifact) => a.contentType.startsWith('image/')
const isVideo = (a: Artifact) => a.contentType.startsWith('video/')
const count = (run: Run, tool: string) => run.steps.filter((s) => s.tool === tool).length

function imageFor(run: Run, sku: Sku): string | undefined {
  return sku.image_url ?? run.artifacts.find((a) => isImage(a) && a.fileName.includes(sku.sku))?.url
}

function phaseStates(run: Run): Record<Phase, 'done' | 'active' | 'pending'> {
  const order = PIPELINE.map((p) => p.id)
  const states = Object.fromEntries(order.map((p) => [p, 'pending'])) as Record<
    Phase,
    'done' | 'active' | 'pending'
  >
  if (run.status === 'done' || run.purchaseOrders?.length) {
    order.forEach((p) => (states[p] = 'done'))
    return states
  }
  let latest = -1
  for (const step of run.steps) latest = Math.max(latest, order.indexOf(step.phase))
  if (run.status === 'awaiting_approval') latest = order.indexOf('signoff')
  order.forEach((p, i) => {
    if (i < latest) states[p] = 'done'
    else if (i === latest)
      states[p] = run.status === 'failed' || run.status === 'stopped' ? 'done' : 'active'
  })
  return states
}

function phaseMetric(run: Run, phase: Phase): string {
  const plan = run.plan
  switch (phase) {
    case 'recon':
      return run.catalogProducts ? `${num(run.catalogProducts)} products` : ''
    case 'brand':
      return plan
        ? `${plan.brand_dna.length} traits`
        : count(run, 'memory_create')
          ? 'in memory'
          : ''
    case 'trends':
      return plan
        ? `${plan.trends.length} trends`
        : count(run, 'web_search')
          ? `${count(run, 'web_search')} searches`
          : ''
    case 'plan':
      return plan ? `${plan.skus.length} styles` : ''
    case 'visuals': {
      const n = run.artifacts.filter(isImage).length
      return n ? `${n} images` : ''
    }
    case 'pack': {
      const docs = run.artifacts.filter((a) => /\.(pdf|xlsx|html)$/i.test(a.fileName)).length
      return docs ? `${docs} files` : ''
    }
    case 'signoff':
      return run.purchaseOrders?.length
        ? `${run.purchaseOrders.length} POs`
        : run.approval?.status === 'pending'
          ? 'your call'
          : ''
    default:
      return ''
  }
}

const SIZE_ORDER = [
  'XXXS',
  'XXS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  'XXL',
  '2XL',
  'XXXL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '1X',
  '2X',
  '3X',
  '4X',
  'OS',
  'ONE SIZE',
]
function sizeRank(size: string, firstSeen: number): number {
  const s = size.toUpperCase().trim()
  const i = SIZE_ORDER.indexOf(s)
  if (i >= 0) return i
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? 100 + n : 1000 + firstSeen
}

function unitsBySize(plan: Plan): Array<{ size: string; units: number }> {
  const totals = new Map<string, number>()
  for (const sku of plan.skus)
    for (const c of sku.buy)
      for (const [size, units] of Object.entries(c.sizes))
        totals.set(size, (totals.get(size) ?? 0) + units)
  const seen = [...totals.keys()]
  return seen
    .map((size, i) => ({ size, units: totals.get(size) ?? 0, rank: sizeRank(size, i) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ size, units }) => ({ size, units }))
}

const COLOR_WORDS: Array<[RegExp, string]> = [
  [/black|onyx|jet/i, '#1f1d1b'],
  [/white|optic/i, '#f6f4ef'],
  [/chalk|ivory|cream|ecru|natural|oat|bone/i, '#ece4d4'],
  [/sage|mint|pistachio/i, '#a3b18f'],
  [/moss|olive|khaki|fern/i, '#6f7b4f'],
  [/forest|pine|green/i, '#3f6249'],
  [/navy|midnight/i, '#22304d'],
  [/indigo|denim/i, '#3e5486'],
  [/blue|sky|cobalt/i, '#5b86c4'],
  [/teal|aqua/i, '#2f7f7a'],
  [/sorbet|peach|coral|apricot/i, '#f0a487'],
  [/pink|blush|rose/i, '#e5aeb6'],
  [/lilac|lavender|violet|purple/i, '#a796c9'],
  [/plum|berry|wine|burgundy|merlot/i, '#6b2e46'],
  [/red|cherry/i, '#b23a35'],
  [/rust|terracotta|clay|brick|sienna/i, '#a9573a'],
  [/orange|tangerine/i, '#df7b3d'],
  [/mustard|ochre|honey|gold/i, '#c99a2e'],
  [/yellow|lemon|butter/i, '#e8cf62'],
  [/coffee|chocolate|espresso|brown|cocoa/i, '#5a3d2e'],
  [/cafe|caramel|camel|tan|sand|birch|beige|stone|taupe|latte/i, '#c4a98a'],
  [/grey|gray|heather|ash|silver|charcoal|graphite/i, '#8a8783'],
]
function swatch(name: string, hex?: string): string {
  if (hex) return hex
  for (const [re, color] of COLOR_WORDS) if (re.test(name)) return color
  return '#b9aea0'
}
function isLight(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 200
}

function colorwayShares(plan: Plan): Array<{ name: string; hex: string; units: number }> {
  const map = new Map<string, { name: string; hex: string; units: number }>()
  for (const sku of plan.skus)
    for (const c of sku.buy) {
      const key = c.colorway.trim().toLowerCase()
      const units = Object.values(c.sizes).reduce((a, b) => a + b, 0)
      const prev = map.get(key)
      if (prev) prev.units += units
      else map.set(key, { name: c.colorway, hex: swatch(c.colorway, c.hex), units })
    }
  return [...map.values()].sort((a, b) => b.units - a.units)
}

type Rec = 'rebuy' | 'reprice' | 'cut' | 'hold'
function parseRecommendations(
  report: string,
  plan: Plan,
): Array<{ sku: Sku; rec: Rec; label: string; why: string }> {
  const out: Array<{ sku: Sku; rec: Rec; label: string; why: string }> = []
  for (const raw of report.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((c) => plain(c))
    const sku = plan.skus.find((s) => cells[0]?.includes(s.sku) || cells[0]?.includes(s.name))
    if (!sku || out.some((o) => o.sku.sku === sku.sku)) continue
    const recCell =
      cells
        .slice(1)
        .find((c) => /hold|keep|re-?price|price|re-?buy|reorder|chase|cut|drop|cancel/i.test(c)) ??
      ''
    const rec: Rec = /re-?buy|reorder|chase/i.test(recCell)
      ? 'rebuy'
      : /cut|drop|cancel/i.test(recCell)
        ? 'cut'
        : /price/i.test(recCell)
          ? 'reprice'
          : 'hold'
    const why = cells.filter((c) => c !== cells[0] && c !== recCell).join(' · ')
    out.push({ sku, rec, label: recCell || 'Hold', why })
  }
  return out
}

// ---------- view pieces ----------

let logOpen = false
let changesOpen = false
let currentId: string | undefined
let currentRun: Run | undefined
let pollTimer: number | undefined

function headerHtml(run: Run): string {
  const live =
    run.status === 'running' || run.status === 'starting' || run.status === 'awaiting_approval'
  const brand = run.brief.brandName ?? host(run.brief.storeUrl)
  return `<div class="run-head">
    <div class="title">
      <p class="eyebrow">${esc(brand)} · launch ${esc(shortDate(run.brief.launchDate))} · ${usdShort(run.brief.budget)} budget · ${run.brief.targetMarginPct}% margin target</p>
      <h1>${esc(run.plan?.drop_name ?? 'Planning the drop…')}</h1>
      ${run.plan ? `<p class="thesis" title="${esc(run.plan.thesis)}">${esc(run.plan.thesis)}</p>` : ''}
    </div>
    <div class="head-actions">
      <span class="status ${run.status}" data-since="${esc(run.createdAt)}" data-until="${esc(doneAt(run) ?? '')}">${STATUS_LABEL[run.status]} · ${elapsed(run.createdAt, doneAt(run))}</span>
      <button class="ghost small" id="log-btn">${ICON.log}<span>Agent log</span><b>${run.steps.length}</b></button>
      ${live ? '<button class="ghost small" id="stop-btn">Stop</button>' : ''}
    </div>
  </div>`
}

function pipelineHtml(run: Run): string {
  const states = phaseStates(run)
  return `<ol class="pipeline">${PIPELINE.map((p) => {
    const metric = phaseMetric(run, p.id)
    return `<li class="${states[p.id]}"><span class="node">${p.icon}</span><span class="pl">${esc(p.label)}</span><span class="pm">${esc(metric) || '&nbsp;'}</span></li>`
  }).join('')}</ol>`
}

function tickerHtml(run: Run): string {
  const rejection = run.guardrailRejections.at(-1)
  const bounced =
    rejection && run.status !== 'done' && !run.approval
      ? `<div class="bounce" data-tip="${esc(rejection.issues.join(' · '))}">${ICON.alert}<span>Guardrails bounced the plan (${rejection.issues.length} issue${rejection.issues.length > 1 ? 's' : ''}). The agent is fixing it.</span></div>`
      : ''
  if (run.status === 'done') {
    const pos = run.purchaseOrders?.length ?? 0
    return `${bounced}<div class="ticker done">${ICON.check}<span>Finished in ${elapsed(run.createdAt, doneAt(run))}${pos ? ` · ${pos} purchase orders issued` : ''}${run.watch?.scheduleId ? ' · weekly watch on' : ''}</span></div>`
  }
  if (run.status === 'failed' || run.status === 'stopped') {
    return `<div class="ticker bad">${ICON.alert}<span>${esc(run.error ?? STATUS_LABEL[run.status])}</span></div>`
  }
  if (run.status === 'awaiting_approval') return bounced
  const step = [...run.steps].reverse().find((s) => s.status === 'running')
  const note = run.notes.at(-1)
  const label = step?.label ?? (note ? plain(note.text).split('. ')[0] : 'Starting the agent…')
  return `${bounced}<div class="ticker live"><span class="spin"></span><span class="now">${esc(label)}</span>${
    note && step ? `<span class="aside">${esc(plain(note.text).slice(0, 110))}</span>` : ''
  }</div>`
}

function meter(value: number, max: number, target?: number): string {
  const w = Math.max(0, Math.min(100, (value / max) * 100))
  const t =
    target === undefined
      ? ''
      : `<i class="target" style="left:${Math.min(100, (target / max) * 100)}%"></i>`
  return `<div class="meter"><span style="width:${w}%"></span>${t}</div>`
}

function signoffHtml(run: Run): string {
  const t = run.totals
  const plan = run.plan
  if (!t || !plan || run.approval?.status !== 'pending') return ''
  const b = run.brief
  const checks = [
    `Under ${usdShort(b.budget)} budget`,
    `Margin ≥ ${b.targetMarginPct}%`,
    `${b.skuCount} styles`,
    `≥ ${num(b.minUnitsPerStyle)} units each`,
    `Ready by ${shortDate(b.launchDate)}`,
  ]
  return `<section class="signoff">
    <div class="so-left">
      <p class="eyebrow">Ready for your sign-off</p>
      <div class="hero-num">${usd(t.cost)}</div>
      ${meter(t.cost, b.budget)}
      <p class="meter-cap">${pct(t.budgetUsedPct, 0)} of ${usd(b.budget)} open-to-buy</p>
    </div>
    <ul class="so-checks">${checks.map((c) => `<li>${ICON.check}<span>${esc(c)}</span></li>`).join('')}</ul>
    <div class="so-actions">
      <button id="approve-btn" class="big">Approve & issue ${plan.skus.length} POs</button>
      <button class="ghost" id="changes-btn">Request changes</button>
      ${
        changesOpen
          ? `<div class="changes-pop" id="changes-pop"><textarea id="change-notes" rows="3" placeholder="e.g. swap the trend style for a second legging colorway"></textarea><button id="send-changes">Send to agent</button></div>`
          : ''
      }
    </div>
  </section>`
}

function kpiHtml(run: Run): string {
  const t = run.totals
  if (!t) return ''
  const b = run.brief
  const approved = run.approval?.status === 'pending' ? '' : 'show-buy'
  return `<section class="kpis ${approved}">
    ${
      approved
        ? `<div class="tile hero-tile"><span class="lbl">Buy committed</span><b class="hero-num">${usd(t.cost)}</b>${meter(t.cost, b.budget)}<span class="cap">${pct(t.budgetUsedPct, 0)} of ${usd(b.budget)} open-to-buy</span></div>`
        : ''
    }
    <div class="tile"><span class="lbl">Units</span><b>${num(t.units)}</b><span class="cap">${run.plan?.skus.length ?? 0} styles</span></div>
    <div class="tile"><span class="lbl">Initial margin</span><b>${pct(t.initialMarginPct)}</b>${meter(t.initialMarginPct, 100, b.targetMarginPct)}<span class="cap">target ${b.targetMarginPct}%</span></div>
    <div class="tile"><span class="lbl">Projected revenue</span><b>${usdShort(t.projectedRevenue)}</b><span class="cap">${b.sellThroughPct}% at full price</span></div>
    <div class="tile"><span class="lbl">Projected gross margin</span><b>${usdShort(t.projectedGrossMargin)}</b><span class="cap">${pct(t.maintainedMarginPct)} after markdowns</span></div>
  </section>`
}

function galleryHtml(run: Run): string {
  const plan = run.plan
  if (plan) {
    const bySku = new Map(run.totals?.bySku.map((r) => [r.sku, r]) ?? [])
    const maxUnits = Math.max(1, ...(run.totals?.bySku.map((r) => r.units) ?? [1]))
    return `<section class="gallery">${plan.skus
      .map((s) => {
        const row = bySku.get(s.sku)
        const img = imageFor(run, s)
        const tip = `${s.name} · ${s.category} · ${num(row?.units ?? 0)} units · ${usd(s.landed_cost)} landed · ${pct(row?.marginPct)} margin · trend: ${s.trend}`
        return `<article class="look" data-tip="${esc(tip)}">
          <div class="pic">${img ? `<img src="${esc(img)}" alt="${esc(s.name)}" loading="lazy">` : '<div class="ph shimmer"></div>'}
            <span class="role ${esc(s.role)}">${esc(s.role)}</span>
            <span class="price">${usd(s.retail_price)}</span></div>
          <div class="cap"><b>${esc(s.name)}</b>
            <div class="sw">${s.buy.map((c) => `<i style="background:${swatch(c.colorway, c.hex)}" class="${isLight(swatch(c.colorway, c.hex)) ? 'light' : ''}" title="${esc(c.colorway)}"></i>`).join('')}<span>${num(row?.units ?? 0)} u</span></div>
            <div class="ubar"><span style="width:${((row?.units ?? 0) / maxUnits) * 100}%"></span></div>
          </div>
        </article>`
      })
      .join('')}</section>`
  }
  const renders = run.artifacts.filter(isImage)
  const states = phaseStates(run)
  if (!renders.length && states.visuals === 'pending') return ''
  const slots = Math.max(run.brief.skuCount, renders.length)
  return `<section class="gallery">${Array.from({ length: slots }, (_, i) => {
    const a = renders[i]
    return `<article class="look"><div class="pic">${a ? `<img src="${esc(a.url)}" alt="${esc(a.fileName)}">` : '<div class="ph shimmer"><span>Rendering…</span></div>'}</div></article>`
  }).join('')}</section>`
}

function budgetBars(run: Run): string {
  const plan = run.plan
  const t = run.totals
  if (!plan || !t) return ''
  const rows = [...t.bySku].sort((a, b) => b.cost - a.cost)
  const max = Math.max(1, ...rows.map((r) => r.cost))
  return `<div class="chart"><h3>Where the budget goes</h3><div class="hbars">${rows
    .map((r) => {
      const sku = plan.skus.find((s) => s.sku === r.sku)
      const img = sku ? imageFor(run, sku) : undefined
      return `<div class="hb" data-tip="${esc(`${sku?.name ?? r.sku}: ${usd(r.cost)} landed cost · ${num(r.units)} units · ${pct(r.marginPct)} margin`)}">
        <span class="thumb">${img ? `<img src="${esc(img)}" alt="">` : ''}</span>
        <span class="nm">${esc(sku?.name ?? r.sku)}</span>
        <span class="track"><span class="bar" style="width:${(r.cost / max) * 100}%"></span><span class="val">${usdShort(r.cost)}</span></span>
      </div>`
    })
    .join('')}</div></div>`
}

function sizeColumns(run: Run): string {
  const plan = run.plan
  if (!plan) return ''
  const sizes = unitsBySize(plan)
  if (!sizes.length) return ''
  const max = Math.max(1, ...sizes.map((s) => s.units))
  const total = sizes.reduce((a, s) => a + s.units, 0)
  return `<div class="chart"><h3>Size curve</h3><div class="cols">${sizes
    .map(
      (
        s,
      ) => `<div class="col" data-tip="${esc(`${s.size}: ${num(s.units)} units (${pct((s.units / total) * 100, 0)})`)}">
        <span class="cv">${s.units === max ? num(s.units) : ''}</span>
        <span class="cbar" style="height:${(s.units / max) * 100}%"></span>
        <span class="cl">${esc(s.size)}</span></div>`,
    )
    .join('')}</div></div>`
}

function paletteHtml(run: Run): string {
  const plan = run.plan
  if (!plan) return ''
  const shares = colorwayShares(plan)
  const total = shares.reduce((a, s) => a + s.units, 0) || 1
  const top = shares.slice(0, 8)
  return `<div class="chart"><h3>Colorway mix</h3>
    <div class="segbar">${top
      .map(
        (s) =>
          `<span class="${isLight(s.hex) ? 'light' : ''}" style="flex:${s.units};background:${s.hex}" data-tip="${esc(`${s.name}: ${num(s.units)} units (${pct((s.units / total) * 100, 0)})`)}"></span>`,
      )
      .join('')}</div>
    <ul class="swatches">${top
      .map(
        (s) =>
          `<li><i class="${isLight(s.hex) ? 'light' : ''}" style="background:${s.hex}"></i><span>${esc(s.name)}</span><b>${pct((s.units / total) * 100, 0)}</b></li>`,
      )
      .join('')}</ul></div>`
}

function storyHtml(run: Run): string {
  const plan = run.plan
  if (!plan) return ''
  const trends = plan.trends
    .slice(0, 3)
    .map(
      (
        t,
        i,
      ) => `<div class="trend" data-tip="${esc(t.insight)}"><span class="tn">${i + 1}</span><div>
        <b>${esc(t.name)}</b><p>${esc(t.insight)}</p>
        <div class="src">${t.sources
          .slice(0, 3)
          .map((s) => `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(host(s))}</a>`)
          .join('')}</div></div></div>`,
    )
    .join('')
  return `<section class="story"><div class="card"><h3>Trends behind the drop</h3><div class="trends">${trends}</div></div>${calendarHtml(run)}</section>`
}

function calendarHtml(run: Run): string {
  const plan = run.plan
  if (!plan?.calendar.length) return ''
  const items = [...plan.calendar].sort((a, b) => a.date.localeCompare(b.date))
  const start = Date.parse(`${items[0]?.date ?? run.brief.launchDate}T12:00:00Z`)
  const end = Math.max(start + 86_400_000, Date.parse(`${run.brief.launchDate}T12:00:00Z`))
  const pos = (d: string) => ((Date.parse(`${d}T12:00:00Z`) - start) / (end - start)) * 100
  // Greedy lanes: two above and two below the line, so labels of close dates never overlap.
  const lanes = [
    { side: 'above', level: 0, last: -Infinity },
    { side: 'below', level: 0, last: -Infinity },
    { side: 'above', level: 1, last: -Infinity },
    { side: 'below', level: 1, last: -Infinity },
  ]
  const GAP = 32
  return `<div class="card"><h3>Road to launch</h3><div class="timeline">
    <div class="line"></div>
    ${items
      .map((c, i) => {
        const x = Math.max(0, Math.min(100, pos(c.date)))
        const isLaunch = c.date === run.brief.launchDate && i === items.length - 1
        const lane =
          lanes.find((l) => x - l.last >= GAP) ?? lanes.reduce((a, b) => (b.last < a.last ? b : a))
        lane.last = x
        const offset = (isLaunch ? 30 : 20) + lane.level * 44
        const shift = x < 12 ? -12 : x > 88 ? -88 : -50
        const labelStyle = `${lane.side === 'above' ? 'bottom' : 'top'}:${offset}px;transform:translateX(${shift}%)`
        return `<div class="ms ${isLaunch ? 'launch' : ''}" style="left:${x}%" data-tip="${esc(`${c.date}: ${c.milestone}`)}">
          <span class="dot">${isLaunch ? ICON.flag : ''}</span><span class="ml" style="${labelStyle}"><b>${esc(shortDate(c.date))}</b>${esc(c.milestone.length > 24 ? `${c.milestone.slice(0, 23)}…` : c.milestone)}</span></div>`
      })
      .join('')}
  </div></div>`
}

function outcomeHtml(run: Run): string {
  const parts: string[] = []
  if (run.purchaseOrders?.length) {
    const total = run.purchaseOrders.reduce((s, p) => s + p.cost, 0)
    parts.push(`<div class="card"><div class="card-head"><h3>Purchase orders</h3><a class="dl" href="/api/runs/${run.id}/purchase-orders.csv">${ICON.download}CSV</a></div>
      <div class="pos">${run.purchaseOrders
        .map((p) => {
          const sku = run.plan?.skus.find((s) => s.sku === p.sku)
          const img = sku ? imageFor(run, sku) : undefined
          return `<div class="po" data-tip="${esc(`${p.poNumber} · ${p.name}`)}">${img ? `<img src="${esc(img)}" alt="">` : ''}<div><span class="pon">${esc(p.poNumber.split('-').slice(-1)[0] ?? p.poNumber)}</span><b>${usdShort(p.cost)}</b><span>${num(p.units)} u</span></div></div>`
        })
        .join('')}</div>
      <p class="cap">${run.purchaseOrders.length} POs · ${usd(total)} · approved by ${esc(run.approval?.decidedBy ?? '')}</p></div>`)
  }
  const files: Array<[string, string, string]> = []
  const pdf =
    run.artifacts.find((a) => /line_sheet\.(pdf|html)$/i.test(a.fileName))?.url ??
    run.plan?.line_sheet_url
  const xlsx = run.artifacts.find((a) => /\.xlsx$/i.test(a.fileName))?.url ?? run.plan?.buy_plan_url
  if (pdf) files.push([pdf, 'Line sheet', ICON.file])
  if (xlsx) files.push([xlsx, 'Buy plan', ICON.table])
  const video = run.artifacts.find(isVideo)
  if (video) files.push([video.url, 'Teaser', ICON.video])
  if (files.length) {
    parts.push(
      `<div class="card"><h3>Deliverables</h3><div class="files">${files
        .map(
          ([u, n, i]) =>
            `<a class="file" href="${esc(u)}" target="_blank" rel="noopener">${i}<span>${esc(n)}</span></a>`,
        )
        .join('')}</div></div>`,
    )
  }
  if (run.watch) parts.push(watchHtml(run))
  if (video) {
    parts.push(
      `<div class="card teaser-card"><h3>Launch teaser</h3><video class="teaser" src="${esc(video.url)}" controls muted loop playsinline></video></div>`,
    )
  }
  return parts.length ? `<section class="outcome">${parts.join('')}</section>` : ''
}

const REC_META: Record<Rec, { cls: string; icon: string; word: string }> = {
  rebuy: { cls: 'good', icon: ICON.up, word: 'Re-buy' },
  reprice: { cls: 'warn', icon: ICON.alert, word: 'Re-price' },
  cut: { cls: 'bad', icon: ICON.x, word: 'Cut' },
  hold: { cls: 'neutral', icon: ICON.minus, word: 'Hold' },
}

function watchHtml(run: Run): string {
  const w = run.watch
  if (!w) return ''
  if (w.error)
    return `<div class="card"><h3>Drop Watch</h3><p class="err">Schedule not created: ${esc(w.error)}</p></div>`
  const idle = run.status === 'done' || run.status === 'failed' || run.status === 'stopped'
  const recs = w.lastReport && run.plan ? parseRecommendations(w.lastReport, run.plan) : []
  return `<div class="card watch">
    <div class="card-head"><h3>Drop Watch</h3>${idle ? `<button class="ghost small" id="watch-btn">${ICON.play}Run now</button>` : ''}</div>
    <p class="sched" data-tip="${esc(`ZooWork Schedule ${w.scheduleId ?? ''}`)}">${ICON.calendar}<span>Every ${esc(w.label ?? 'week')}</span></p>
    ${
      recs.length
        ? `<ul class="recs">${recs
            .map((r) => {
              const m = REC_META[r.rec]
              const img = imageFor(run, r.sku)
              return `<li data-tip="${esc(r.why)}">${img ? `<img src="${esc(img)}" alt="">` : ''}<span class="rn">${esc(r.sku.name)}</span><span class="pill ${m.cls}">${m.icon}${m.word}</span></li>`
            })
            .join('')}</ul>`
        : `<p class="cap">${w.lastTriggeredAt ? 'Checking now…' : 'First check runs next Monday. Tap Run now to check today.'}</p>`
    }
  </div>`
}

function drawerHtml(run: Run): string {
  if (!logOpen) return ''
  type Entry = { at: string; html: string }
  const entries: Entry[] = []
  for (const s of run.steps) {
    const icon =
      s.status === 'running'
        ? '<span class="spin"></span>'
        : s.status === 'done'
          ? '✓'
          : s.status === 'blocked'
            ? '⊘'
            : '✕'
    entries.push({
      at: s.startedAt,
      html: `<div class="item ${s.phase === 'other' ? 'minor' : ''} ${s.status === 'error' ? 'error' : ''}"><span class="icon">${icon}</span><div>${esc(s.label)}${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ''}</div><span class="time">${elapsed(run.createdAt, s.startedAt)}</span></div>`,
    })
  }
  for (const n of run.notes)
    entries.push({ at: n.at, html: `<div class="note">${md(n.text)}</div>` })
  for (const r of run.guardrailRejections)
    entries.push({
      at: r.at,
      html: `<div class="item error"><span class="icon">!</span><div>Guardrails bounced the plan<div class="detail">${esc(r.issues.join(' · '))}</div></div><span class="time">${elapsed(run.createdAt, r.at)}</span></div>`,
    })
  entries.sort((a, b) => a.at.localeCompare(b.at))
  const report = run.watch?.lastReport
    ? `<h4>Latest Drop Watch report</h4><div class="note">${md(run.watch.lastReport)}</div>`
    : ''
  return `<aside class="drawer" id="drawer"><div class="drawer-head"><h3>Agent log</h3><button class="icon-btn" id="close-log" aria-label="Close">✕</button></div>
    <div class="drawer-body">${entries.map((e) => e.html).join('')}${report}</div></aside>`
}

// ---------- render ----------

function renderEmpty(): void {
  $('board').innerHTML = `<div class="empty">
    <p class="eyebrow">One brief in · a buy-ready drop out</p>
    <h1>Your merchandiser that never sleeps.</h1>
    <ol class="pipeline intro">${PIPELINE.map((p) => `<li class="done"><span class="node">${p.icon}</span><span class="pl">${esc(p.label)}</span></li>`).join('')}</ol>
    <button class="big" id="empty-new">Plan a new drop →</button>
  </div>`
  document.getElementById('empty-new')?.addEventListener('click', openModal)
}

function renderRun(run: Run): void {
  const board = $('board')
  const drawerBody = document.querySelector<HTMLElement>('.drawer-body')
  const pinned = drawerBody
    ? drawerBody.scrollHeight - drawerBody.scrollTop - drawerBody.clientHeight < 40
    : true
  const notes = (document.getElementById('change-notes') as HTMLTextAreaElement | null)?.value ?? ''
  board.innerHTML = `${headerHtml(run)}${pipelineHtml(run)}${tickerHtml(run)}${signoffHtml(run)}${kpiHtml(run)}${galleryHtml(run)}
    ${run.plan ? `<section class="charts">${budgetBars(run)}${sizeColumns(run)}${paletteHtml(run)}</section>` : ''}
    ${outcomeHtml(run)}${storyHtml(run)}${drawerHtml(run)}`
  const newDrawer = document.querySelector<HTMLElement>('.drawer-body')
  if (newDrawer && pinned) newDrawer.scrollTop = newDrawer.scrollHeight
  const notesBox = document.getElementById('change-notes') as HTMLTextAreaElement | null
  if (notesBox) notesBox.value = notes
  wire(run)
}

function wire(run: Run): void {
  const on = (id: string, fn: () => void) =>
    document.getElementById(id)?.addEventListener('click', fn)
  on('log-btn', () => {
    logOpen = !logOpen
    renderRun(run)
  })
  on('close-log', () => {
    logOpen = false
    renderRun(run)
  })
  on('stop-btn', () => void act(`/api/runs/${run.id}/stop`, {}))
  on(
    'approve-btn',
    () => void act(`/api/runs/${run.id}/decision`, { decision: 'approve', notes: '' }),
  )
  on('changes-btn', () => {
    changesOpen = !changesOpen
    renderRun(run)
    document.getElementById('change-notes')?.focus()
  })
  on('send-changes', () => {
    const text =
      (document.getElementById('change-notes') as HTMLTextAreaElement | null)?.value.trim() ?? ''
    if (!text) {
      document.getElementById('change-notes')?.focus()
      return
    }
    changesOpen = false
    void act(`/api/runs/${run.id}/decision`, { decision: 'changes', notes: text })
  })
  on('watch-btn', () => {
    void act(`/api/runs/${run.id}/watch`, {}).then(() => {
      if (pollTimer) window.clearTimeout(pollTimer)
      void poll()
    })
  })
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await res.json()) as T & { error?: string; message?: string; issues?: string[] }
  if (!res.ok)
    throw new Error(body.issues?.join('\n') ?? body.message ?? body.error ?? `HTTP ${res.status}`)
  return body
}

async function act(path: string, body: unknown): Promise<void> {
  document
    .querySelectorAll<HTMLButtonElement>('.so-actions button, #stop-btn, #watch-btn')
    .forEach((b) => (b.disabled = true))
  try {
    const run = await api<Run>(path, { method: 'POST', body: JSON.stringify(body) })
    currentRun = run
    renderRun(run)
  } catch (error) {
    window.alert((error as Error).message)
    if (currentRun) renderRun(currentRun)
  }
}

function signature(run: Run): string {
  return JSON.stringify([
    run.status,
    run.steps.length,
    run.steps.filter((s) => s.status === 'running').length,
    run.notes.length,
    run.artifacts.length,
    run.approval?.status,
    run.guardrailRejections.length,
    run.plan?.drop_name,
    run.purchaseOrders?.length,
    run.watch?.scheduleId,
    run.watch?.lastTriggeredAt,
    run.watch?.lastReportAt,
    run.catalogProducts,
  ])
}

async function poll(): Promise<void> {
  if (!currentId) return
  try {
    const run = await api<Run>(`/api/runs/${currentId}`)
    const typing = document.activeElement?.id === 'change-notes'
    if (
      !typing &&
      (!currentRun || run.id !== currentRun.id || signature(run) !== signature(currentRun))
    )
      renderRun(run)
    currentRun = run
    if (run.status === 'done' || run.status === 'failed' || run.status === 'stopped') {
      void loadRuns()
      return
    }
  } catch (error) {
    console.warn(error)
  }
  pollTimer = window.setTimeout(() => void poll(), 1500)
}

function openRun(id: string): void {
  currentId = id
  currentRun = undefined
  logOpen = false
  changesOpen = false
  if (pollTimer) window.clearTimeout(pollTimer)
  history.replaceState(null, '', `#${id}`)
  document
    .querySelectorAll<HTMLElement>('#run-list li')
    .forEach((li) => li.classList.toggle('active', li.dataset.id === id))
  void poll()
}

async function loadRuns(): Promise<void> {
  const { runs } = await api<{ runs: RunSummary[] }>('/api/runs')
  $('run-list').innerHTML = runs.length
    ? runs
        .map(
          (r) => `<li data-id="${r.id}" class="${r.id === currentId ? 'active' : ''}">
            <span class="rt">${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : `<b>${esc((r.brandName ?? host(r.storeUrl)).slice(0, 1).toUpperCase())}</b>`}</span>
            <span class="ri"><b>${esc(r.dropName ?? r.brandName ?? host(r.storeUrl))}</b>
              <span class="rs"><i class="dot ${r.status}"></i>${esc(STATUS_LABEL[r.status])}</span>
              ${r.cost ? `<span class="rm">${meter(r.cost, r.budget)}</span>` : ''}</span></li>`,
        )
        .join('')
    : '<li class="none">No drops yet</li>'
  document
    .querySelectorAll<HTMLElement>('#run-list li[data-id]')
    .forEach((li) => li.addEventListener('click', () => openRun(li.dataset.id as string)))
}

// ---------- new-drop modal ----------

function openModal(): void {
  const dialog = $('new-drop') as HTMLDialogElement
  if (!dialog.open) dialog.showModal()
}

function initModal(): void {
  const dialog = $('new-drop') as HTMLDialogElement
  const form = $('brief-form') as HTMLFormElement
  const date = form.elements.namedItem('launchDate') as HTMLInputElement
  date.value = new Date(Date.now() + 1000 * 60 * 60 * 24 * 115).toISOString().slice(0, 10)
  const bindRange = (name: string, outId: string, suffix: string) => {
    const input = form.elements.namedItem(name) as HTMLInputElement
    const out = $(outId)
    const sync = () => (out.textContent = `${input.value}${suffix}`)
    input.addEventListener('input', sync)
    sync()
  }
  bindRange('targetMarginPct', 'margin-out', '%')
  bindRange('skuCount', 'styles-out', '')
  $('new-btn').addEventListener('click', openModal)
  $('close-modal').addEventListener('click', () => dialog.close())
  $('cancel-modal').addEventListener('click', () => dialog.close())
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const data = new FormData(form)
    const brief: Record<string, unknown> = {}
    for (const [key, value] of data.entries())
      if (typeof value === 'string' && value.trim() !== '') brief[key] = value.trim()
    for (const key of [
      'budget',
      'targetMarginPct',
      'skuCount',
      'minUnitsPerStyle',
      'sellThroughPct',
      'markdownPct',
    ]) {
      if (brief[key] !== undefined) brief[key] = Number(brief[key])
    }
    brief.approvalMode = data.get('autoApprove') === 'on' ? 'auto' : 'manual'
    delete brief.autoApprove
    brief.weeklyWatch = data.get('weeklyWatch') === 'on'
    brief.makeTeaserVideo = data.get('makeTeaserVideo') === 'on'
    const button = $('start-btn') as HTMLButtonElement
    const error = $('form-error')
    button.disabled = true
    error.hidden = true
    void api<Run>('/api/runs', { method: 'POST', body: JSON.stringify(brief) })
      .then(async (run) => {
        dialog.close()
        await loadRuns()
        openRun(run.id)
      })
      .catch((e: Error) => {
        error.textContent = e.message
        error.hidden = false
      })
      .finally(() => (button.disabled = false))
  })
}

// ---------- tooltip + timer ----------

function initTooltip(): void {
  const tip = $('tip')
  document.addEventListener('mousemove', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]')
    const text = target?.dataset.tip
    if (!text) {
      tip.hidden = true
      return
    }
    tip.textContent = text
    tip.hidden = false
    const x = Math.min(window.innerWidth - tip.offsetWidth - 12, event.clientX + 14)
    const y =
      event.clientY + 18 + tip.offsetHeight > window.innerHeight
        ? event.clientY - tip.offsetHeight - 12
        : event.clientY + 18
    tip.style.transform = `translate(${x}px, ${y}px)`
  })
}

window.setInterval(() => {
  const pill = document.querySelector<HTMLElement>('.status[data-since]')
  if (!pill || !currentRun) return
  pill.textContent = `${STATUS_LABEL[currentRun.status]} · ${elapsed(pill.dataset.since as string, pill.dataset.until || undefined)}`
}, 1000)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && logOpen && currentRun) {
    logOpen = false
    renderRun(currentRun)
  }
})

async function init(): Promise<void> {
  initModal()
  initTooltip()
  try {
    const info = await api<{ agentId: string; model: string }>('/api/health')
    $('agent-info').innerHTML = `<i class="dot done"></i>${esc(info.model.replace('litellm/', ''))}`
    $('agent-info').title = `ZooWork agent ${info.agentId}`
  } catch {
    $('agent-info').textContent = 'Agent offline'
  }
  await loadRuns()
  const hash = location.hash.slice(1)
  if (/^run_[0-9a-f]{8}$/.test(hash)) openRun(hash)
  else renderEmpty()
}

void init()
