// Drop Planner front door: brief form, live run timeline, sign-off and deliverables.
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
  buy: Array<{ colorway: string; sizes: Record<string, number> }>
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
interface Totals {
  units: number
  cost: number
  retailValue: number
  initialMarginPct: number
  projectedRevenue: number
  projectedGrossMargin: number
  maintainedMarginPct: number
  budgetUsedPct: number
  bySku: Array<{ sku: string; units: number; cost: number; retailValue: number; marginPct: number }>
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
  plan?: Plan
  totals?: Totals
  approval?: {
    status: 'pending' | 'approved' | 'changes_requested' | 'expired'
    decidedBy?: string
    notes?: string
  }
  purchaseOrders?: PurchaseOrder[]
  finalText?: string
  finishedAt?: string
  watch?: {
    scheduleId?: string
    label?: string
    lastTriggeredAt?: string
    error?: string
    lastReport?: string
    lastReportUrl?: string
    lastReportAt?: string
  }
}
interface RunSummary {
  id: string
  createdAt: string
  status: Status
  storeUrl: string
  dropName?: string
  cost?: number
  budget: number
}

const PHASES: Array<[Phase, string]> = [
  ['recon', 'Catalog recon'],
  ['brand', 'Brand DNA'],
  ['trends', 'Trend research'],
  ['plan', 'Capsule & buy'],
  ['visuals', 'Concept renders'],
  ['pack', 'Line sheet'],
  ['signoff', 'Sign-off & POs'],
]
const STATUS_LABEL: Record<Status, string> = {
  starting: 'Starting',
  running: 'Agent working',
  awaiting_approval: 'Waiting for your sign-off',
  done: 'Drop ready',
  failed: 'Failed',
  stopped: 'Stopped',
}

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
// Minimal, escape-first markdown for agent narration: bold, inline code, links, bullets, line breaks.
function md(text: string): string {
  const inline = (line: string): string =>
    esc(line)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(
        /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>',
      )
      .replace(
        /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener">link</a>',
      )
  const out: string[] = []
  let list: string[] = []
  let rows: string[][] = []
  const flush = () => {
    if (list.length) {
      out.push(`<ul>${list.map((i) => `<li>${i}</li>`).join('')}</ul>`)
      list = []
    }
    if (rows.length) {
      const [head, ...body] = rows
      out.push(
        `<table class="t"><tr>${(head ?? []).map((c) => `<th>${inline(c)}</th>`).join('')}</tr>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</table>`,
      )
      rows = []
    }
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
      list.push(inline(bullet[1] ?? ''))
      continue
    }
    flush()
    if (line) out.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`)
  }
  flush()
  return out.join('')
}
const usd = (n: number | undefined): string =>
  n === undefined ? '—' : `$${Math.round(n).toLocaleString('en-US')}`
const pct = (n: number | undefined): string => (n === undefined ? '—' : `${n.toFixed(1)}%`)
const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

let currentId: string | undefined
let currentRun: Run | undefined
let pollTimer: number | undefined
let feedPinnedToBottom = true

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

function elapsed(from: string, to?: string): string {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function phaseStates(run: Run): Record<Phase, 'done' | 'active' | 'pending'> {
  const order = PHASES.map(([p]) => p)
  const states = Object.fromEntries(order.map((p) => [p, 'pending'])) as Record<
    Phase,
    'done' | 'active' | 'pending'
  >
  if (run.status === 'done') {
    order.forEach((p) => (states[p] = 'done'))
    return states
  }
  let latest = -1
  for (const step of run.steps) latest = Math.max(latest, order.indexOf(step.phase))
  if (run.status === 'awaiting_approval') latest = order.indexOf('signoff')
  order.forEach((p, i) => {
    if (i < latest) states[p] = 'done'
    else if (i === latest) states[p] = 'active'
  })
  return states
}

function feedHtml(run: Run): string {
  type Entry = { at: string; html: string }
  const entries: Entry[] = []
  // Collapse runs of identical housekeeping steps (e.g. a file rewritten several times) into one line.
  const steps: Array<Step & { repeat: number }> = []
  for (const s of run.steps) {
    const last = steps.at(-1)
    if (last && s.phase === 'other' && last.phase === 'other' && last.label === s.label) {
      last.repeat += 1
      last.status = s.status
      continue
    }
    steps.push({ ...s, repeat: 1 })
  }
  for (const s of steps) {
    const icon =
      s.status === 'running'
        ? '<span class="spin"></span>'
        : s.status === 'done'
          ? '✓'
          : s.status === 'blocked'
            ? '⊘'
            : '✕'
    const minor = s.phase === 'other' ? ' minor' : ''
    const label = s.repeat > 1 ? `${s.label} ×${s.repeat}` : s.label
    entries.push({
      at: s.startedAt,
      html: `<div class="item${minor}${s.status === 'error' ? ' error' : ''}"><span class="icon">${icon}</span><div>${esc(label)}${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ''}</div><span class="time">${elapsed(run.createdAt, s.startedAt)}</span></div>`,
    })
  }
  for (const n of run.notes)
    entries.push({
      at: n.at,
      html: `<div class="note">${md(n.text.length > 900 ? `${n.text.slice(0, 900)}…` : n.text)}</div>`,
    })
  for (const r of run.guardrailRejections)
    entries.push({
      at: r.at,
      html: `<div class="item error"><span class="icon">!</span><div>Guardrails bounced the plan<div class="detail">${esc(r.issues.join(' · '))}</div></div><span class="time">${elapsed(run.createdAt, r.at)}</span></div>`,
    })
  entries.sort((a, b) => a.at.localeCompare(b.at))
  return (
    entries.map((e) => e.html).join('') || '<p class="detail">Waiting for the agent to start…</p>'
  )
}

function signoffHtml(run: Run): string {
  const t = run.totals
  const plan = run.plan
  if (!t || !plan || run.approval?.status !== 'pending') return ''
  const b = run.brief
  return `<section class="card signoff">
    <p class="eyebrow">Buy ready for sign-off · passed every app guardrail</p>
    <h3>${esc(plan.drop_name)}: ${usd(t.cost)} of ${usd(b.budget)} open-to-buy</h3>
    <div class="kpis">
      <div><span>Units</span><b>${t.units.toLocaleString('en-US')}</b></div>
      <div><span>Landed cost</span><b>${usd(t.cost)}</b></div>
      <div><span>Budget used</span><b>${pct(t.budgetUsedPct)}</b></div>
      <div><span>Initial margin</span><b>${pct(t.initialMarginPct)}</b></div>
      <div><span>Projected revenue</span><b>${usd(t.projectedRevenue)}</b></div>
      <div><span>Projected gross margin</span><b>${usd(t.projectedGrossMargin)}</b></div>
    </div>
    <ul class="checks">
      <li>Within ${usd(b.budget)} budget</li><li>IMU ≥ ${b.targetMarginPct}% target</li>
      <li>Exactly ${b.skuCount} styles</li><li>Every style ≥ ${b.minUnitsPerStyle} units</li>
      <li>Per-style margin floor</li><li>Calendar lands by ${esc(b.launchDate)}</li>
    </ul>
    <div class="decide">
      <button id="approve-btn">Approve buy & issue ${plan.skus.length} POs</button>
      <textarea id="change-notes" placeholder="Or request changes, e.g. swap the trend jacket for a second legging colorway"></textarea>
      <button class="ghost" id="changes-btn">Request changes</button>
    </div>
  </section>`
}

function capsuleHtml(run: Run): string {
  const plan = run.plan
  if (!plan) {
    const renders = run.artifacts.filter((a) => a.contentType.startsWith('image/'))
    if (!renders.length) return ''
    return `<section class="card"><h3>Concept renders</h3><div class="renders">${renders.map((a) => `<a href="${esc(a.url)}" target="_blank"><img src="${esc(a.url)}" alt="${esc(a.fileName)}"></a>`).join('')}</div></section>`
  }
  const bySku = new Map(run.totals?.bySku.map((r) => [r.sku, r]) ?? [])
  const cards = plan.skus.map((s) => {
    const row = bySku.get(s.sku)
    const img = s.image_url
      ? `<img src="${esc(s.image_url)}" alt="${esc(s.name)}" loading="lazy">`
      : '<div class="ph">Render pending</div>'
    return `<article class="sku">${img}
      <div class="meta">${esc(s.sku)} · ${esc(s.category)} <span class="role ${esc(s.role)}">${esc(s.role)}</span></div>
      <h4>${esc(s.name)}</h4>
      <div class="nums">${usd(s.retail_price)} retail · ${usd(s.landed_cost)} cost · ${pct(row?.marginPct)}<br>${row?.units.toLocaleString('en-US') ?? '—'} units · ${s.buy.map((c) => esc(c.colorway)).join(', ')}</div>
    </article>`
  })
  return `<section class="card"><h3>The capsule</h3><p class="thesis">${esc(plan.thesis)}</p><div class="capsule">${cards.join('')}</div></section>`
}

function videoHtml(run: Run): string {
  const videos = run.artifacts.filter((a) => a.contentType.startsWith('video/'))
  if (!videos.length) return ''
  return `<section class="card"><p class="eyebrow">Seedance teaser · ZooWork skill</p><h3>Launch teaser</h3>${videos
    .map(
      (v) => `<video class="teaser" src="${esc(v.url)}" controls muted loop playsinline></video>`,
    )
    .join('')}</section>`
}

function filesHtml(run: Run): string {
  const files = run.artifacts.filter(
    (a) => !a.contentType.startsWith('image/') && !a.contentType.startsWith('video/'),
  )
  const plan = run.plan
  const links: Array<[string, string, string]> = files.map((a) => [
    a.url,
    a.fileName,
    a.fileName.split('.').pop()?.toUpperCase() ?? 'FILE',
  ])
  for (const [url, name] of [
    [plan?.line_sheet_url, 'Line sheet'],
    [plan?.buy_plan_url, 'Buy plan workbook'],
    [plan?.video_url, 'Teaser video'],
  ] as const) {
    if (url && !links.some(([u]) => u === url))
      links.push([url, name, url.split('.').pop()?.slice(0, 4).toUpperCase() ?? 'FILE'])
  }
  if (run.purchaseOrders?.length)
    links.push([`/api/runs/${run.id}/purchase-orders.csv`, 'Purchase orders', 'CSV'])
  if (!links.length) return ''
  return `<section class="card"><h3>Deliverables</h3><div class="files">${links.map(([u, n, e]) => `<a class="file" href="${esc(u)}" target="_blank" rel="noopener"><span class="ext">${esc(e)}</span>${esc(n)}</a>`).join('')}</div></section>`
}

function posHtml(run: Run): string {
  if (!run.purchaseOrders?.length) return ''
  const rows = run.purchaseOrders
    .map(
      (p) =>
        `<tr><td>${esc(p.poNumber)}</td><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${p.units.toLocaleString('en-US')}</td><td>${usd(p.cost)}</td></tr>`,
    )
    .join('')
  const total = run.purchaseOrders.reduce((s, p) => s + p.cost, 0)
  return `<section class="card"><p class="eyebrow">Approved by ${esc(run.approval?.decidedBy ?? '')}</p><h3>Purchase orders issued</h3>
    <table class="t"><tr><th>PO</th><th>SKU</th><th>Style</th><th>Units</th><th>Landed cost</th></tr>${rows}<tr><td colspan="4"><b>Total</b></td><td><b>${usd(total)}</b></td></tr></table></section>`
}

function watchHtml(run: Run): string {
  const w = run.watch
  if (!w) return ''
  if (w.error)
    return `<section class="card"><h3>Drop Watch</h3><p class="err">Could not create the weekly schedule: ${esc(w.error)}</p></section>`
  const idle = run.status === 'done' || run.status === 'failed' || run.status === 'stopped'
  return `<section class="card watch"><p class="eyebrow">ZooWork Schedule · ${esc(w.scheduleId)}</p>
    <h3>Drop Watch runs ${esc(w.label)}</h3>
    <p>Every week the agent re-pulls the live catalog, checks comparables, sell-outs and trend momentum, and recommends hold / re-price / re-buy / cut per style.${w.lastTriggeredAt ? ` Last triggered ${new Date(w.lastTriggeredAt).toLocaleString()}.` : ''}</p>
    ${idle ? '<button class="ghost small" id="watch-btn">Run Drop Watch now</button>' : ''}
    ${w.lastReport ? `<details class="report" open><summary>Latest watch report${w.lastReportAt ? ` · ${new Date(w.lastReportAt).toLocaleString()}` : ''}</summary><div class="final">${md(w.lastReport)}</div>${w.lastReportUrl ? `<a class="file" href="${esc(w.lastReportUrl)}" target="_blank" rel="noopener"><span class="ext">MD</span>watch.md</a>` : ''}</details>` : ''}</section>`
}

function trendsHtml(run: Run): string {
  const plan = run.plan
  if (!plan) return ''
  const trends = plan.trends
    .map(
      (t) =>
        `<div class="trend"><b>${esc(t.name)}</b><div>${esc(t.insight)}</div><div class="src">${t.sources.map((s) => `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(host(s))}</a>`).join(' · ')}</div></div>`,
    )
    .join('')
  const dna = plan.brand_dna.map((d) => `<li>${esc(d)}</li>`).join('')
  const cal = plan.calendar
    .map((c) => `<tr><td>${esc(c.date)}</td><td>${esc(c.milestone)}</td></tr>`)
    .join('')
  return `<section class="card"><h3>Why this drop</h3>${trends}<h3 style="margin-top:14px">Brand DNA</h3><ul>${dna}</ul><h3 style="margin-top:14px">Calendar</h3><table class="t">${cal}</table></section>`
}

function renderRun(run: Run): void {
  const view = $('run-view')
  const feed = view.querySelector<HTMLElement>('.feed')
  if (feed) feedPinnedToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40
  const notes = (document.getElementById('change-notes') as HTMLTextAreaElement | null)?.value ?? ''
  const states = phaseStates(run)
  const live =
    run.status === 'running' || run.status === 'starting' || run.status === 'awaiting_approval'
  const rejections =
    run.guardrailRejections.length && run.status !== 'done'
      ? `<div class="alert"><b>Guardrails bounced submission ${run.guardrailRejections.length} of ${run.submissions}.</b> The agent is revising.<ul>${(run.guardrailRejections.at(-1)?.issues ?? []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`
      : ''
  view.innerHTML = `
    <div class="run-head">
      <div>
        <p class="eyebrow">${esc(run.brief.brandName ?? host(run.brief.storeUrl))} · launch ${esc(run.brief.launchDate)} · ${usd(run.brief.budget)} open-to-buy · ${run.brief.targetMarginPct}% IMU target · ${run.brief.approvalMode === 'auto' ? 'auto-approval policy' : 'manual sign-off'}</p>
        <h1>${esc(run.plan?.drop_name ?? 'Planning the drop…')}</h1>
      </div>
      <div class="head-actions"><span class="status ${run.status}" data-since="${esc(run.createdAt)}" data-until="${esc(run.finishedAt ?? '')}">${STATUS_LABEL[run.status]} · ${elapsed(run.createdAt, run.finishedAt)}</span>
        ${live ? '<button class="ghost small" id="stop-btn">Stop</button>' : ''}</div>
    </div>
    <div class="stepper">${PHASES.map(([p, label]) => `<div class="${states[p]}">${esc(label)}</div>`).join('')}</div>
    ${run.error ? `<p class="err">${esc(run.error)}</p>` : ''}
    <div class="grid">
      <section class="feed"><h3>Agent activity</h3>${feedHtml(run)}</section>
      <div class="out">
        ${rejections}${signoffHtml(run)}${posHtml(run)}${watchHtml(run)}${videoHtml(run)}${capsuleHtml(run)}${filesHtml(run)}
        ${run.status === 'done' && run.finalText ? `<section class="card"><h3>Agent summary</h3><div class="final">${md(run.finalText)}</div></section>` : ''}
        ${trendsHtml(run)}
      </div>
    </div>`
  const newFeed = view.querySelector<HTMLElement>('.feed')
  if (newFeed && feedPinnedToBottom) newFeed.scrollTop = newFeed.scrollHeight
  const notesBox = document.getElementById('change-notes') as HTMLTextAreaElement | null
  if (notesBox && notes) notesBox.value = notes
  document
    .getElementById('stop-btn')
    ?.addEventListener('click', () => void act(`/api/runs/${run.id}/stop`, {}))
  document.getElementById('watch-btn')?.addEventListener('click', () => {
    void act(`/api/runs/${run.id}/watch`, {}).then(() => {
      if (pollTimer) window.clearTimeout(pollTimer)
      void poll()
    })
  })
  document
    .getElementById('approve-btn')
    ?.addEventListener(
      'click',
      () => void act(`/api/runs/${run.id}/decision`, { decision: 'approve', notes: '' }),
    )
  document.getElementById('changes-btn')?.addEventListener('click', () => {
    const text =
      (document.getElementById('change-notes') as HTMLTextAreaElement | null)?.value.trim() ?? ''
    if (!text) {
      alertInline('Write what should change first.')
      return
    }
    void act(`/api/runs/${run.id}/decision`, { decision: 'changes', notes: text })
  })
}

function alertInline(message: string): void {
  const box = document.getElementById('change-notes') as HTMLTextAreaElement | null
  if (box) {
    box.placeholder = message
    box.focus()
  }
}

async function act(path: string, body: unknown): Promise<void> {
  document
    .querySelectorAll<HTMLButtonElement>('.decide button, #stop-btn, #watch-btn')
    .forEach((b) => (b.disabled = true))
  try {
    const run = await api<Run>(path, { method: 'POST', body: JSON.stringify(body) })
    currentRun = run
    renderRun(run)
  } catch (error) {
    alertInline((error as Error).message)
  }
}

// Avoid re-rendering (and resetting scroll/inputs) when nothing changed.
function signature(run: Run): string {
  return JSON.stringify([
    run.watch?.scheduleId,
    run.status,
    run.steps.length,
    run.steps.filter((s) => s.status === 'running').length,
    run.notes.length,
    run.artifacts.length,
    run.approval?.status,
    run.guardrailRejections.length,
    run.plan?.drop_name,
    run.purchaseOrders?.length,
    run.watch?.lastTriggeredAt,
  ])
}

// Ticks the elapsed-time pill without re-rendering the page (keeps focus in the change-request box).
window.setInterval(() => {
  const pill = document.querySelector<HTMLElement>('.status[data-since]')
  if (!pill || !currentRun) return
  pill.textContent = `${STATUS_LABEL[currentRun.status]} · ${elapsed(pill.dataset.since as string, pill.dataset.until || undefined)}`
}, 1000)

async function poll(): Promise<void> {
  if (!currentId) return
  try {
    const run = await api<Run>(`/api/runs/${currentId}`)
    if (!currentRun || signature(run) !== signature(currentRun) || run.id !== currentRun.id)
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
  if (pollTimer) window.clearTimeout(pollTimer)
  history.replaceState(null, '', `#${id}`)
  document
    .querySelectorAll('#run-list li')
    .forEach((li) => li.classList.toggle('active', (li as HTMLElement).dataset.id === id))
  void poll()
}

async function loadRuns(): Promise<void> {
  const { runs } = await api<{ runs: RunSummary[] }>('/api/runs')
  $('run-list').innerHTML = runs.length
    ? runs
        .map(
          (r) =>
            `<li data-id="${r.id}" class="${r.id === currentId ? 'active' : ''}"><div class="t">${esc(r.dropName ?? host(r.storeUrl))}</div><div class="s">${esc(STATUS_LABEL[r.status])} · ${new Date(r.createdAt).toLocaleString()}${r.cost ? ` · ${usd(r.cost)}` : ''}</div></li>`,
        )
        .join('')
    : '<li class="s">No drops yet</li>'
  document
    .querySelectorAll<HTMLElement>('#run-list li[data-id]')
    .forEach((li) => li.addEventListener('click', () => openRun(li.dataset.id as string)))
}

function initForm(): void {
  const form = $('brief-form') as HTMLFormElement
  const date = form.elements.namedItem('launchDate') as HTMLInputElement
  const launch = new Date(Date.now() + 1000 * 60 * 60 * 24 * 115)
  date.value = launch.toISOString().slice(0, 10)
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
    brief.makeTeaserVideo = data.get('makeTeaserVideo') === 'on'
    brief.weeklyWatch = data.get('weeklyWatch') === 'on'
    const button = $('start-btn') as HTMLButtonElement
    const error = $('form-error')
    button.disabled = true
    error.hidden = true
    void api<Run>('/api/runs', { method: 'POST', body: JSON.stringify(brief) })
      .then(async (run) => {
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

async function init(): Promise<void> {
  initForm()
  try {
    const info = await api<{ agentId: string; model: string }>('/api/health')
    $('agent-info').innerHTML =
      `ZooWork agent <code>${esc(info.agentId)}</code> · <code>${esc(info.model)}</code>`
  } catch {
    $('agent-info').textContent = 'Agent offline'
  }
  await loadRuns()
  const hash = location.hash.slice(1)
  if (/^run_[0-9a-f]{8}$/.test(hash)) openRun(hash)
}

void init()
