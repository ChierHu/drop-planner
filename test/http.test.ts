import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseBrief } from '../src/brief.js'
import { purchaseOrdersCsv } from '../src/http.js'
import type { Run } from '../src/run-types.js'

describe('purchaseOrdersCsv', () => {
  it('writes one row per PO line and quotes cells that contain commas or quotes', () => {
    const run: Run = {
      id: 'run_00000001',
      createdAt: '2026-11-07T00:00:00Z',
      brief: parseBrief(
        { storeUrl: 'kotn.com', launchDate: '2027-03-20', budget: 80000, targetMarginPct: 70 },
        new Date('2026-11-07T12:00:00Z'),
      ),
      status: 'done',
      steps: [],
      notes: [],
      artifacts: [],
      guardrailRejections: [],
      submissions: 1,
      purchaseOrders: [
        {
          poNumber: 'PO-261107-0001-01',
          sku: 'KT-01',
          name: 'Camp Shirt, "Linen"',
          unitCost: 20,
          units: 30,
          cost: 600,
          lines: [
            { colorway: 'Sage', size: 'S', units: 10 },
            { colorway: 'Sage', size: 'M', units: 20 },
          ],
          issuedAt: '2026-11-07T15:00:00.000Z',
        },
      ],
    }
    const lines = purchaseOrdersCsv(run).trim().split('\n')
    assert.equal(lines.length, 3)
    assert.equal(
      lines[0],
      'po_number,sku,style,colorway,size,units,unit_landed_cost,line_cost,issued_at',
    )
    assert.equal(
      lines[2],
      'PO-261107-0001-01,KT-01,"Camp Shirt, ""Linen""",Sage,M,20,20,400,2026-11-07T15:00:00.000Z',
    )
  })
})
