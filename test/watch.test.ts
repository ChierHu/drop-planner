import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseBrief } from '../src/brief.js'
import { watchMessage, watchSchedule } from '../src/watch.js'

const brief = parseBrief(
  {
    storeUrl: 'girlfriend.com',
    launchDate: '2027-03-02',
    budget: 60000,
    targetMarginPct: 68,
    weeklyWatch: true,
  },
  new Date('2026-11-07T12:00:00Z'),
)

describe('weekly drop watch', () => {
  it('is opt-in on the brief', () => {
    assert.equal(brief.weeklyWatch, true)
    const plain = parseBrief(
      { storeUrl: 'girlfriend.com', launchDate: '2027-03-02', budget: 60000, targetMarginPct: 68 },
      new Date('2026-11-07T12:00:00Z'),
    )
    assert.equal(plain.weeklyWatch, false)
  })

  it('targets the drop Session every Monday 09:00 New York time with a stable id', () => {
    const input = watchSchedule('run_1a2b3c4d', 'sess_9', 'Trailhead to Studio', brief)
    assert.equal(input.schedule_id, 'drop-watch-run_1a2b3c4d')
    assert.deepEqual(input.schedule, { kind: 'cron', expr: '0 9 * * 1', tz: 'America/New_York' })
    assert.equal(input.sessionTarget, 'session:sess_9')
    assert.equal(input.payload.kind, 'agentTurn')
    assert.equal(input.enabled, true)
  })

  it('tells the agent to re-check catalog, comparables and trends without touching POs', () => {
    const message = watchMessage('run_1a2b3c4d', 'Trailhead to Studio', brief)
    assert.match(message, /\/workspace\/drops\/run_1a2b3c4d/)
    assert.match(message, /catalog\.py/)
    assert.match(message, /hold \/ re-price \/ re-buy \/ cut/)
    assert.match(message, /Do not call submit_drop_plan/)
  })
})
