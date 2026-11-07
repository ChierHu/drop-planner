import type { DropBrief } from './brief.js'
import { money } from './brief.js'
import { PlanValidationError } from './errors.js'

export type SkuRole = 'hero' | 'core' | 'trend'

export interface ColorwayBuy {
  colorway: string
  sizes: Record<string, number>
}

export interface PlanSku {
  sku: string
  name: string
  category: string
  role: SkuRole
  description: string
  materials: string
  trend: string
  retail_price: number
  landed_cost: number
  buy: ColorwayBuy[]
  comparable?: { title: string; price: number; url?: string }
  image_url?: string
}

export interface PlanTrend {
  name: string
  insight: string
  sources: string[]
}

export interface DropPlan {
  drop_name: string
  thesis: string
  brand_dna: string[]
  trends: PlanTrend[]
  skus: PlanSku[]
  calendar: Array<{ date: string; milestone: string }>
  line_sheet_url?: string
  buy_plan_url?: string
  video_url?: string
}

export interface SkuTotals {
  sku: string
  units: number
  cost: number
  retailValue: number
  marginPct: number
}

export interface PlanTotals {
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

export interface PurchaseOrder {
  poNumber: string
  sku: string
  name: string
  unitCost: number
  units: number
  cost: number
  lines: Array<{ colorway: string; size: string; units: number }>
  issuedAt: string
}

const ROLES: readonly SkuRole[] = ['hero', 'core', 'trend']
/** A single SKU may sit this far under the blended target (for example an entry-price core item). */
export const SKU_MARGIN_FLOOR_GAP_PCT = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, where: string, issues: string[], max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    issues.push(`${where} must be non-empty text`)
    return ''
  }
  return value.trim()
}

function positive(value: unknown, where: string, issues: string[]): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    issues.push(`${where} must be a positive number`)
    return 0
  }
  return value
}

function optionalUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\//.test(value) ? value : undefined
}

function parseSku(raw: unknown, index: number, issues: string[]): PlanSku {
  const where = `skus[${index}]`
  if (!isRecord(raw)) {
    issues.push(`${where} must be an object`)
    return {
      sku: '',
      name: '',
      category: '',
      role: 'core',
      description: '',
      materials: '',
      trend: '',
      retail_price: 0,
      landed_cost: 0,
      buy: [],
    }
  }
  const role = ROLES.includes(raw.role as SkuRole) ? (raw.role as SkuRole) : undefined
  if (!role) issues.push(`${where}.role must be one of hero, core, trend`)
  const retail = positive(raw.retail_price, `${where}.retail_price`, issues)
  const cost = positive(raw.landed_cost, `${where}.landed_cost`, issues)
  if (retail > 0 && cost >= retail) issues.push(`${where}.landed_cost must be below retail_price`)
  const buy: ColorwayBuy[] = []
  if (!Array.isArray(raw.buy) || raw.buy.length === 0) {
    issues.push(`${where}.buy must list at least one colorway with units by size`)
  } else {
    raw.buy.forEach((entry: unknown, i: number) => {
      const at = `${where}.buy[${i}]`
      if (!isRecord(entry) || !isRecord(entry.sizes) || Object.keys(entry.sizes).length === 0) {
        issues.push(`${at} must be {colorway, sizes: {size: units}}`)
        return
      }
      const sizes: Record<string, number> = {}
      for (const [size, units] of Object.entries(entry.sizes)) {
        if (typeof units !== 'number' || !Number.isInteger(units) || units < 0) {
          issues.push(`${at}.sizes.${size} must be a whole number of units (0 or more)`)
        } else {
          sizes[size] = units
        }
      }
      buy.push({ colorway: text(entry.colorway, `${at}.colorway`, issues, 80), sizes })
    })
  }
  const comparable =
    isRecord(raw.comparable) &&
    typeof raw.comparable.title === 'string' &&
    typeof raw.comparable.price === 'number'
      ? {
          title: raw.comparable.title,
          price: raw.comparable.price,
          ...(optionalUrl(raw.comparable.url)
            ? { url: optionalUrl(raw.comparable.url) as string }
            : {}),
        }
      : undefined
  const imageUrl = optionalUrl(raw.image_url)
  return {
    sku: text(raw.sku, `${where}.sku`, issues, 40),
    name: text(raw.name, `${where}.name`, issues, 120),
    category: text(raw.category, `${where}.category`, issues, 80),
    role: role ?? 'core',
    description: text(raw.description, `${where}.description`, issues),
    materials: text(raw.materials, `${where}.materials`, issues, 300),
    trend: text(raw.trend, `${where}.trend`, issues, 120),
    retail_price: retail,
    landed_cost: cost,
    buy,
    ...(comparable ? { comparable } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
  }
}

function parseShape(input: unknown): DropPlan {
  const issues: string[] = []
  if (!isRecord(input)) throw new PlanValidationError(['plan must be a JSON object'])
  const skus = Array.isArray(input.skus) ? input.skus.map((raw, i) => parseSku(raw, i, issues)) : []
  if (!Array.isArray(input.skus) || skus.length === 0) issues.push('skus must be a non-empty array')
  const trends: PlanTrend[] = Array.isArray(input.trends)
    ? input.trends.filter(isRecord).map((t, i) => ({
        name: text(t.name, `trends[${i}].name`, issues, 120),
        insight: text(t.insight, `trends[${i}].insight`, issues),
        sources: Array.isArray(t.sources)
          ? t.sources.filter((s): s is string => typeof s === 'string')
          : [],
      }))
    : []
  if (trends.length === 0)
    issues.push('trends must list the trends the drop expresses, with sources')
  const calendar = Array.isArray(input.calendar)
    ? input.calendar.filter(isRecord).map((c, i) => ({
        date: text(c.date, `calendar[${i}].date`, issues, 10),
        milestone: text(c.milestone, `calendar[${i}].milestone`, issues, 200),
      }))
    : []
  if (calendar.length === 0) issues.push('calendar must list the milestones up to launch')
  const brandDna = Array.isArray(input.brand_dna)
    ? input.brand_dna.filter((b): b is string => typeof b === 'string' && b.trim() !== '')
    : []
  const plan: DropPlan = {
    drop_name: text(input.drop_name, 'drop_name', issues, 120),
    thesis: text(input.thesis, 'thesis', issues),
    brand_dna: brandDna,
    trends,
    skus,
    calendar,
    ...(optionalUrl(input.line_sheet_url)
      ? { line_sheet_url: optionalUrl(input.line_sheet_url) as string }
      : {}),
    ...(optionalUrl(input.buy_plan_url)
      ? { buy_plan_url: optionalUrl(input.buy_plan_url) as string }
      : {}),
    ...(optionalUrl(input.video_url) ? { video_url: optionalUrl(input.video_url) as string } : {}),
  }
  if (issues.length) throw new PlanValidationError(issues)
  return plan
}

export function skuUnits(sku: PlanSku): number {
  return sku.buy.reduce((sum, c) => sum + Object.values(c.sizes).reduce((a, b) => a + b, 0), 0)
}

/** Deterministic buy math; the agent's own arithmetic is never trusted. */
export function computeTotals(plan: DropPlan, brief: DropBrief): PlanTotals {
  const bySku = plan.skus.map((sku) => {
    const units = skuUnits(sku)
    return {
      sku: sku.sku,
      units,
      cost: units * sku.landed_cost,
      retailValue: units * sku.retail_price,
      marginPct: (1 - sku.landed_cost / sku.retail_price) * 100,
    }
  })
  const units = bySku.reduce((s, x) => s + x.units, 0)
  const cost = bySku.reduce((s, x) => s + x.cost, 0)
  const retailValue = bySku.reduce((s, x) => s + x.retailValue, 0)
  const st = brief.sellThroughPct / 100
  const projectedRevenue = retailValue * (st + (1 - st) * (1 - brief.markdownPct / 100))
  const projectedGrossMargin = projectedRevenue - cost
  return {
    units,
    cost,
    retailValue,
    initialMarginPct: retailValue > 0 ? (1 - cost / retailValue) * 100 : 0,
    projectedRevenue,
    projectedGrossMargin,
    maintainedMarginPct: projectedRevenue > 0 ? (projectedGrossMargin / projectedRevenue) * 100 : 0,
    budgetUsedPct: (cost / brief.budget) * 100,
    bySku,
  }
}

/**
 * Parses the agent's submit_drop_plan input and applies the merchandising guardrails.
 * Throws PlanValidationError listing every problem so the agent can fix them in one revision.
 */
export function validatePlan(input: unknown, brief: DropBrief): DropPlan {
  const plan = parseShape(input)
  const issues: string[] = []
  if (plan.skus.length !== brief.skuCount) {
    issues.push(
      `The brief asks for exactly ${brief.skuCount} SKUs; the plan has ${plan.skus.length}`,
    )
  }
  const seen = new Set<string>()
  for (const sku of plan.skus) {
    if (seen.has(sku.sku))
      issues.push(`Duplicate SKU code ${sku.sku}; every style needs a unique code`)
    seen.add(sku.sku)
  }
  const totals = computeTotals(plan, brief)
  if (totals.cost > brief.budget) {
    issues.push(
      `Total landed cost ${money(totals.cost)} exceeds the open-to-buy budget of ${money(brief.budget)} by ${money(totals.cost - brief.budget)}`,
    )
  }
  if (totals.initialMarginPct + 1e-9 < brief.targetMarginPct) {
    issues.push(
      `Blended initial margin is ${totals.initialMarginPct.toFixed(1)}%, below the ${brief.targetMarginPct}% target; raise prices or lower landed costs`,
    )
  }
  const floor = brief.targetMarginPct - SKU_MARGIN_FLOOR_GAP_PCT
  for (const row of totals.bySku) {
    if (row.marginPct + 1e-9 < floor) {
      issues.push(
        `${row.sku} margin ${row.marginPct.toFixed(1)}% is under the per-SKU floor of ${floor}%`,
      )
    }
    if (row.units < brief.minUnitsPerStyle) {
      issues.push(
        `${row.sku} buys ${row.units} units, below the minimum of ${brief.minUnitsPerStyle} units per style`,
      )
    }
  }
  for (const entry of plan.calendar) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date))
      issues.push(`Calendar date "${entry.date}" must be YYYY-MM-DD`)
    else if (entry.date > brief.launchDate) {
      issues.push(
        `Calendar milestone "${entry.milestone}" (${entry.date}) falls after the ${brief.launchDate} launch`,
      )
    }
  }
  if (issues.length) throw new PlanValidationError(issues)
  return plan
}

export function buildPurchaseOrders(
  plan: DropPlan,
  runId: string,
  issuedAt: Date,
): PurchaseOrder[] {
  const stamp = issuedAt.toISOString().slice(2, 10).replaceAll('-', '')
  const suffix = runId
    .replace(/[^a-z0-9]/gi, '')
    .slice(-4)
    .toUpperCase()
  return plan.skus.map((sku, index) => {
    const lines = sku.buy.flatMap((c) =>
      Object.entries(c.sizes)
        .filter(([, units]) => units > 0)
        .map(([size, units]) => ({ colorway: c.colorway, size, units })),
    )
    const units = lines.reduce((s, l) => s + l.units, 0)
    return {
      poNumber: `PO-${stamp}-${suffix}-${String(index + 1).padStart(2, '0')}`,
      sku: sku.sku,
      name: sku.name,
      unitCost: sku.landed_cost,
      units,
      cost: units * sku.landed_cost,
      lines,
      issuedAt: issuedAt.toISOString(),
    }
  })
}
