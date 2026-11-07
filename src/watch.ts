import type { ScheduleInput } from '@zoowork-ai/sdk'
import type { DropBrief } from './brief.js'

export const WATCH_CRON = { kind: 'cron', expr: '0 9 * * 1', tz: 'America/New_York' } as const
export const WATCH_LABEL = 'Mondays 09:00 New York'

/** The scheduled turn: a weekly post-buy check that recommends, but never changes, the buy. */
export function watchMessage(runId: string, dropName: string, brief: DropBrief): string {
  const workdir = `/workspace/drops/${runId}`
  return [
    `DROP WATCH (scheduled weekly check) for "${dropName}" launching ${brief.launchDate}, run ${runId}.`,
    `WORKDIR is ${workdir}; the approved plan is ${workdir}/plan.json. Narrate each step in one short line.`,
    `1. Make WORKDIR/watch/<today's date>/ and re-pull the live catalog with python3 /workspace/kit/catalog.py fetch ${brief.storeUrl} and analyze into that folder.`,
    `2. Compare with plan.json: new arrivals that overlap our styles, price moves on each style's comparable product, and changes in the sell-out signal for our categories.`,
    `3. Run at most 2 web searches to check momentum on the drop's three trends.`,
    `4. Write watch.md in that folder with one recommendation per style (hold / re-price / re-buy / cut) and one line of evidence each, then artifact_publish it.`,
    `5. memory_create (scope agent) one line with the most important change for this brand.`,
    `Reply with the per-style recommendations as a short list. Do not call submit_drop_plan and do not change purchase orders.`,
  ].join('\n')
}

export function watchSchedule(
  runId: string,
  sessionId: string,
  dropName: string,
  brief: DropBrief,
): ScheduleInput & {
  payload: { kind: 'agentTurn'; message: string }
} {
  return {
    schedule_id: `drop-watch-${runId}`,
    schedule: { ...WATCH_CRON },
    payload: { kind: 'agentTurn', message: watchMessage(runId, dropName, brief) },
    sessionTarget: `session:${sessionId}`,
    enabled: true,
  }
}
