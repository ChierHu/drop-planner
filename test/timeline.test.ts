import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeToolStart, parseArtifactResult, parseCatalogCount } from '../src/timeline.js'

describe('describeToolStart', () => {
  it('turns raw tool calls into merchandiser-readable steps with a phase', () => {
    assert.deepEqual(
      describeToolStart('web_fetch', { url: 'https://girlfriend.com/products.json?limit=250' }),
      {
        label: 'Pulled the live product catalog',
        detail: 'girlfriend.com',
        phase: 'recon',
      },
    )
    assert.equal(
      describeToolStart('web_search', { query: 'spring 2027 activewear trends' }).phase,
      'trends',
    )
    assert.equal(
      describeToolStart('image_generate', { prompt: 'Sage jacket flat lay' }).phase,
      'visuals',
    )
    assert.equal(
      describeToolStart('exec', {
        command: 'python3 /workspace/kit/pack.py /workspace/drops/run_1',
      }).phase,
      'pack',
    )
    assert.deepEqual(
      describeToolStart('exec', {
        command: 'cd /workspace/drops/run_1 && python3 /workspace/kit/pack.py . --check',
      }),
      {
        label: 'Checked the buy math against the brief',
        phase: 'plan',
      },
    )
    assert.equal(
      describeToolStart('exec', {
        command: 'python3 /workspace/kit/catalog.py analyze c.json s.json',
      }).phase,
      'recon',
    )
    assert.equal(describeToolStart('submit_drop_plan', {}).phase, 'signoff')
    assert.equal(
      describeToolStart('memory_create', { content: 'x' }).label,
      'Saved brand notes to memory',
    )
  })

  it('recognises the Seedance teaser generation', () => {
    assert.deepEqual(
      describeToolStart('exec', {
        command:
          'cd /skills/chameleon-seedance && timeout 900 python3 scripts/chameleon_generate.py --prompt x',
      }),
      { label: 'Generating the Seedance teaser video', phase: 'signoff' },
    )
  })

  it('names the ZooWork skill the agent is reading', () => {
    assert.deepEqual(
      describeToolStart('read', { path: '/home/user/skills/chameleon-seedance/SKILL.md' }),
      {
        label: 'Read the chameleon-seedance skill',
        phase: 'other',
      },
    )
  })

  it('keeps unknown tools visible instead of hiding them', () => {
    const step = describeToolStart('some_new_tool', {})
    assert.equal(step.phase, 'other')
    assert.match(step.label, /some_new_tool/)
  })
})

describe('parseCatalogCount', () => {
  it('reads the product count from the kit output', () => {
    assert.equal(
      parseCatalogCount('CATALOG SUMMARY for https://kotn.com: 1,000 products\nCategory | n'),
      1000,
    )
    assert.equal(
      parseCatalogCount('saved 250 products to /workspace/drops/run_1/catalog.json'),
      250,
    )
    assert.equal(parseCatalogCount('exec completed: exitCode=0'), undefined)
  })
})

describe('parseArtifactResult', () => {
  it('extracts the published URL from an artifact_publish result', () => {
    const preview =
      '{"artifactId":"art_1","url":"https://a.zoowork.ai/artifacts/art_1/jacket.png","fileName":"jacket.png","contentType":"image/png","size":10,"status":"published"}'
    assert.deepEqual(parseArtifactResult(preview), {
      artifactId: 'art_1',
      url: 'https://a.zoowork.ai/artifacts/art_1/jacket.png',
      fileName: 'jacket.png',
      contentType: 'image/png',
    })
  })

  it('returns undefined for results that are not publish receipts', () => {
    assert.equal(parseArtifactResult('Error: file not found'), undefined)
  })
})
