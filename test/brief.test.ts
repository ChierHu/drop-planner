import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { briefToMessage, parseBrief } from '../src/brief.js'
import { BriefValidationError } from '../src/errors.js'

const now = new Date('2026-11-07T12:00:00Z')
const valid = {
  storeUrl: 'girlfriend.com',
  launchDate: '2027-03-15',
  budget: 60000,
  targetMarginPct: 68,
  skuCount: 6,
}

describe('parseBrief', () => {
  it('normalises the store URL and fills merchandising defaults', () => {
    const brief = parseBrief(valid, now)
    assert.equal(brief.storeUrl, 'https://girlfriend.com')
    assert.equal(brief.currency, 'USD')
    assert.equal(brief.sellThroughPct, 65)
    assert.equal(brief.markdownPct, 40)
    assert.equal(brief.minUnitsPerStyle, 100)
    assert.equal(brief.approvalMode, 'manual')
    assert.equal(brief.makeTeaserVideo, false)
  })

  it('rejects a launch date in the past, a tiny budget and an impossible margin together', () => {
    assert.throws(
      () =>
        parseBrief({ ...valid, launchDate: '2026-01-01', budget: 10, targetMarginPct: 120 }, now),
      (error: unknown) =>
        error instanceof BriefValidationError &&
        error.issues.length === 3 &&
        error.issues.some((issue) => issue.includes('launchDate')),
    )
  })

  it('rejects non-http store URLs and SKU counts outside 3-10', () => {
    assert.throws(
      () => parseBrief({ ...valid, storeUrl: 'ftp://x.com' }, now),
      BriefValidationError,
    )
    assert.throws(() => parseBrief({ ...valid, skuCount: 25 }, now), BriefValidationError)
  })
})

describe('briefToMessage', () => {
  it('embeds the run workspace and every constraint the guardrails will enforce', () => {
    const message = briefToMessage(parseBrief({ ...valid, notes: 'No denim.' }, now), 'run_abc')
    assert.match(message, /\/workspace\/drops\/run_abc/)
    assert.match(message, /\$60,000/)
    assert.match(message, /68%/)
    assert.match(message, /6 SKUs/)
    assert.match(message, /No denim\./)
    assert.match(message, /submit_drop_plan/)
  })
})
