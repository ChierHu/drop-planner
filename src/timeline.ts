export type Phase = 'recon' | 'brand' | 'trends' | 'plan' | 'visuals' | 'pack' | 'signoff' | 'other'

export const PHASES: ReadonlyArray<{ id: Phase; label: string }> = [
  { id: 'recon', label: 'Catalog recon' },
  { id: 'brand', label: 'Brand DNA' },
  { id: 'trends', label: 'Trend research' },
  { id: 'plan', label: 'Capsule & buy plan' },
  { id: 'visuals', label: 'Concept renders' },
  { id: 'pack', label: 'Line sheet' },
  { id: 'signoff', label: 'Sign-off & POs' },
]

export interface StepDescription {
  label: string
  detail?: string
  phase: Phase
}

export interface PublishedArtifact {
  artifactId: string
  url: string
  fileName: string
  contentType: string
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value : ''
}

function host(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 80)
  }
}

function base(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function clip(value: string, max = 140): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function isCatalogUrl(url: string): boolean {
  return /products\.json|\/collections\/|\/products\//.test(url)
}

function describeExec(command: string): StepDescription {
  if (/chameleon_generate|seedance/i.test(command) && /generate/i.test(command)) {
    return { label: 'Generating the Seedance teaser video', phase: 'signoff' }
  }
  if (/catalog\.py\s+fetch|products\.json/.test(command)) {
    return { label: 'Pulled the live product catalog', detail: clip(command, 90), phase: 'recon' }
  }
  if (/catalog\.py/.test(command)) {
    return { label: 'Analyzed assortment & price architecture', phase: 'recon' }
  }
  if (/pack\.py[^\n]*--check/.test(command)) {
    return { label: 'Checked the buy math against the brief', phase: 'plan' }
  }
  if (/pack\.py/.test(command)) {
    return { label: 'Built the line sheet & buy plan workbook', phase: 'pack' }
  }
  return { label: 'Ran a command in the sandbox', detail: clip(command, 90), phase: 'other' }
}

/** Maps a raw tool call to a step a merchandiser can follow. Unknown tools stay visible. */
export function describeToolStart(
  toolName: string,
  args: Record<string, unknown> = {},
): StepDescription {
  switch (toolName) {
    case 'web_fetch': {
      const url = str(args, 'url')
      return isCatalogUrl(url)
        ? { label: 'Pulled the live product catalog', detail: host(url), phase: 'recon' }
        : { label: 'Read a source', detail: host(url), phase: 'trends' }
    }
    case 'web_search':
      return { label: `Searched “${clip(str(args, 'query'), 90)}”`, phase: 'trends' }
    case 'web_image_search':
      return { label: `Image search “${clip(str(args, 'query'), 90)}”`, phase: 'trends' }
    case 'image':
      return { label: 'Studied product imagery', detail: clip(str(args, 'prompt')), phase: 'brand' }
    case 'image_generate':
      return {
        label: 'Rendering a concept image',
        detail: clip(str(args, 'prompt')),
        phase: 'visuals',
      }
    case 'sessions_yield':
      return { label: 'Waiting for renders to finish', phase: 'visuals' }
    case 'exec':
      return describeExec(str(args, 'command'))
    case 'write': {
      const path = str(args, 'path')
      return /plan\.json$/.test(path)
        ? { label: 'Drafted the capsule plan', detail: base(path), phase: 'plan' }
        : { label: `Wrote ${base(path) || 'a file'}`, phase: 'other' }
    }
    case 'read': {
      const path = str(args, 'path')
      const skill = /\/([^/]+)\/SKILL\.md$/.exec(path)?.[1]
      return skill
        ? { label: `Read the ${skill} skill`, phase: 'other' }
        : { label: `Read ${base(path) || 'a file'}`, phase: 'other' }
    }
    case 'edit':
    case 'apply_patch':
      return { label: `Edited ${base(str(args, 'path')) || 'a file'}`, phase: 'other' }
    case 'artifact_publish':
      return { label: `Published ${base(str(args, 'path')) || 'a file'}`, phase: 'pack' }
    case 'memory_search':
      return { label: 'Recalled brand memory', detail: clip(str(args, 'query')), phase: 'brand' }
    case 'memory_create':
    case 'memory_update':
      return {
        label: 'Saved brand notes to memory',
        detail: clip(str(args, 'content')),
        phase: 'brand',
      }
    case 'agent_db':
      return {
        label: 'Logged the drop in the plan database',
        detail: clip(str(args, 'sql'), 90),
        phase: 'pack',
      }
    case 'submit_drop_plan':
      return { label: 'Submitted the buy for sign-off', phase: 'signoff' }
    case 'sessions_spawn':
      return { label: 'Started a sub-agent', detail: clip(str(args, 'task')), phase: 'other' }
    case 'cron':
      return { label: 'Scheduled a follow-up check', phase: 'signoff' }
    case 'message':
      return { label: 'Sent a message', phase: 'signoff' }
    case 'pdf':
      return { label: 'Read a PDF', phase: 'other' }
    default:
      return { label: `Used ${toolName}`, phase: 'other' }
  }
}

/** Reads an artifact_publish receipt out of a tool result preview. */
export function parseArtifactResult(preview: string): PublishedArtifact | undefined {
  const start = preview.indexOf('{')
  const end = preview.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(preview.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  if (typeof record.artifactId !== 'string' || typeof record.url !== 'string') return undefined
  return {
    artifactId: record.artifactId,
    url: record.url,
    fileName: typeof record.fileName === 'string' ? record.fileName : base(record.url),
    contentType:
      typeof record.contentType === 'string' ? record.contentType : 'application/octet-stream',
  }
}
