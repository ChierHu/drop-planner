import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseBrief } from '../src/brief.js'
import { PlanValidationError } from '../src/errors.js'
import { buildPurchaseOrders, computeTotals, validatePlan } from '../src/plan.js'

const brief = parseBrief(
  {
    storeUrl: 'https://brand.example',
    launchDate: '2027-03-15',
    budget: 20000,
    targetMarginPct: 65,
    skuCount: 3,
  },
  new Date('2026-11-07T12:00:00Z'),
)

function sku(code: string, retail: number, cost: number, units: Record<string, number>) {
  return {
    sku: code,
    name: `Style ${code}`,
    category: 'Leggings',
    role: 'core',
    description: 'A legging.',
    materials: '79% recycled polyester, 21% spandex',
    trend: 'Quiet utility',
    retail_price: retail,
    landed_cost: cost,
    buy: [{ colorway: 'Black', sizes: units }],
  }
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    drop_name: 'Test Drop',
    thesis: 'A tight capsule.',
    brand_dna: ['Recycled fabrics'],
    trends: [
      { name: 'Quiet utility', insight: 'Pockets everywhere', sources: ['https://a.example'] },
    ],
    skus: [
      sku('A-1', 100, 30, { S: 100, M: 150, L: 50 }),
      sku('A-2', 80, 24, { S: 50, M: 100, L: 50 }),
      sku('A-3', 60, 20, { XS: 25, S: 50, M: 50 }),
    ],
    calendar: [
      { date: '2026-11-20', milestone: 'Issue POs' },
      { date: '2027-03-15', milestone: 'Launch' },
    ],
    ...overrides,
  }
}

describe('computeTotals', () => {
  it('sums style-colour-size units into cost, retail value and margins', () => {
    const totals = computeTotals(validatePlan(plan(), brief), brief)
    assert.equal(totals.units, 300 + 200 + 125)
    assert.equal(totals.cost, 300 * 30 + 200 * 24 + 125 * 20)
    assert.equal(totals.retailValue, 300 * 100 + 200 * 80 + 125 * 60)
    // Initial margin = 1 - cost/retail value.
    assert.ok(Math.abs(totals.initialMarginPct - (1 - 16300 / 53500) * 100) < 1e-9)
    // 65% sells at full price, the rest at 40% off.
    const revenue = 53500 * (0.65 + 0.35 * 0.6)
    assert.ok(Math.abs(totals.projectedRevenue - revenue) < 1e-6)
    assert.ok(Math.abs(totals.projectedGrossMargin - (revenue - 16300)) < 1e-6)
    assert.equal(totals.bySku.length, 3)
  })
})

describe('validatePlan', () => {
  it('accepts a plan inside budget, margin and MOQ guardrails', () => {
    assert.equal(validatePlan(plan(), brief).skus.length, 3)
  })

  it('rejects an over-budget buy with a message the agent can act on', () => {
    const fat = plan({
      skus: [
        sku('A-1', 100, 30, { S: 400, M: 400 }),
        sku('A-2', 80, 24, { M: 300 }),
        sku('A-3', 60, 20, { M: 200 }),
      ],
    })
    assert.throws(
      () => validatePlan(fat, brief),
      (error: unknown) =>
        error instanceof PlanValidationError && error.issues.some((issue) => /budget/i.test(issue)),
    )
  })

  it('rejects blended margin below target, styles under MOQ, duplicate SKUs and wrong SKU count', () => {
    const bad = plan({
      skus: [sku('A-1', 100, 60, { M: 120 }), sku('A-1', 80, 24, { M: 40 })],
    })
    assert.throws(
      () => validatePlan(bad, brief),
      (error: unknown) => {
        if (!(error instanceof PlanValidationError)) return false
        const text = error.issues.join(' | ')
        return (
          /margin/i.test(text) &&
          /minimum/i.test(text) &&
          /duplicate/i.test(text) &&
          /3 SKUs/.test(text)
        )
      },
    )
  })

  it('rejects malformed shapes such as negative units or cost above retail', () => {
    assert.throws(
      () => validatePlan(plan({ skus: [sku('A-1', 50, 70, { M: 100 })] }), brief),
      PlanValidationError,
    )
    assert.throws(
      () => validatePlan(plan({ skus: [sku('A-1', 50, 10, { M: -5 })] }), brief),
      PlanValidationError,
    )
    assert.throws(() => validatePlan({ drop_name: 'x' }, brief), PlanValidationError)
  })

  it('rejects calendar milestones after launch', () => {
    const late = plan({ calendar: [{ date: '2027-04-01', milestone: 'Photoshoot' }] })
    assert.throws(() => validatePlan(late, brief), PlanValidationError)
  })
})

describe('colorway hex', () => {
  it('keeps a valid #rrggbb swatch per colorway and drops anything else', () => {
    const input = plan()
    const skus = input.skus as Array<{ buy: Array<Record<string, unknown>> }>
    const first = skus[0]?.buy[0]
    const second = skus[1]?.buy[0]
    if (!first || !second) throw new Error('fixture changed')
    first.hex = '#9CAF88'
    second.hex = 'sage'
    const parsed = validatePlan(input, brief)
    assert.equal(parsed.skus[0]?.buy[0]?.hex, '#9caf88')
    assert.equal(parsed.skus[1]?.buy[0]?.hex, undefined)
  })
})

describe('buildPurchaseOrders', () => {
  it('issues one PO per style with colour-size lines and deterministic numbers', () => {
    const pos = buildPurchaseOrders(
      validatePlan(plan(), brief),
      'run_7f3a',
      new Date('2026-11-07T15:00:00Z'),
    )
    assert.equal(pos.length, 3)
    assert.equal(pos[0]?.poNumber, 'PO-261107-7F3A-01')
    assert.equal(pos[0]?.units, 300)
    assert.equal(pos[0]?.cost, 9000)
    assert.deepEqual(pos[0]?.lines[0], { colorway: 'Black', size: 'S', units: 100 })
  })
})
