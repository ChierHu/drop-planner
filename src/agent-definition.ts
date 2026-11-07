import type { AgentResource, CustomToolDeclaration } from '@zoowork-ai/sdk'
import { AGENTS_MD, SOUL_MD, TOOLS_MD } from './persona.js'

export const DEFAULT_MODEL = 'litellm/claude-sonnet-5-5'
export const SUBMIT_TOOL = 'submit_drop_plan'

const skuSchema = {
  type: 'object',
  properties: {
    sku: { type: 'string' },
    name: { type: 'string' },
    category: { type: 'string' },
    role: { type: 'string', enum: ['hero', 'core', 'trend'] },
    description: { type: 'string' },
    materials: { type: 'string' },
    trend: { type: 'string' },
    retail_price: { type: 'number' },
    landed_cost: { type: 'number' },
    comparable: {
      type: 'object',
      properties: { title: { type: 'string' }, price: { type: 'number' }, url: { type: 'string' } },
      required: ['title', 'price'],
    },
    buy: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          colorway: { type: 'string' },
          hex: { type: 'string', description: 'Swatch colour of this colorway as #rrggbb' },
          sizes: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
        },
        required: ['colorway', 'sizes'],
      },
    },
    image_url: { type: 'string' },
  },
  required: [
    'sku',
    'name',
    'category',
    'role',
    'description',
    'materials',
    'trend',
    'retail_price',
    'landed_cost',
    'buy',
  ],
}

export const submitDropPlanTool: CustomToolDeclaration = {
  name: SUBMIT_TOOL,
  description:
    'Submit the final capsule plan for merchandising sign-off. The application recomputes every total and enforces the brief guardrails (open-to-buy budget, blended margin target, per-style margin floor, minimum units per style, exact SKU count, calendar before launch). If a guardrail fails, the result lists the issues: fix them and resubmit. Otherwise a human reviewer (or the auto-approval policy in the brief) decides: approval returns the issued purchase order numbers; a change request returns reviewer notes to apply before resubmitting. Wait for the result; never claim purchase orders exist before an approved result.',
  input_schema: {
    type: 'object',
    properties: {
      drop_name: { type: 'string' },
      brand: { type: 'string' },
      thesis: { type: 'string' },
      brand_dna: { type: 'array', items: { type: 'string' } },
      trends: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            insight: { type: 'string' },
            sources: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'insight', 'sources'],
        },
      },
      skus: { type: 'array', items: skuSchema },
      calendar: {
        type: 'array',
        items: {
          type: 'object',
          properties: { date: { type: 'string' }, milestone: { type: 'string' } },
          required: ['date', 'milestone'],
        },
      },
      line_sheet_url: { type: 'string' },
      buy_plan_url: { type: 'string' },
      video_url: { type: 'string' },
    },
    required: ['drop_name', 'thesis', 'brand_dna', 'trends', 'skus', 'calendar'],
  },
  timeoutMs: 45 * 60_000,
}

export function agentResource(opts: { model?: string; instance: string }): AgentResource {
  return {
    name: 'Drop Planner',
    userTimezone: 'America/New_York',
    labels: { app: 'drop-planner', instance: opts.instance },
    model: { primary: opts.model ?? DEFAULT_MODEL, thinking: 'medium' },
    persona: {
      docs: [
        { name: 'SOUL.md', content: SOUL_MD },
        { name: 'AGENTS.md', content: AGENTS_MD },
        { name: 'TOOLS.md', content: TOOLS_MD },
      ],
    },
    custom_tools: [submitDropPlanTool],
    // Channel messaging, browser automation and third-party integrations are outside this agent's job.
    tool_policy: {
      deny: ['message', 'browser', 'composio_tools', 'composio_execute', 'persona_doc_update'],
    },
  }
}
