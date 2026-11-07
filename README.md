# Drop Planner

**An autonomous merchandising agent that turns a one-paragraph brief into a buy-ready capsule drop.**
Built for the Fashion & Finance AI Hackathon (AI Tinkerers NYC × ZooWork, Nov 7 2026). Fashion track.

Give it a Shopify store and an open-to-buy budget. Drop Planner reads the brand's live catalog, studies its
product photography, researches the launch season, designs a capsule with real buy math, renders every style
on-brand, builds the line sheet PDF and buy-plan workbook, and issues purchase orders once the buy passes the
app's guardrails and the merchandiser's sign-off. Then a weekly ZooWork Schedule keeps watching the drop.

One brief in, about 4 minutes of autonomous work, and you get:

- a **capsule plan**: styles, roles (hero/core/trend), colorways, size curves, retail price anchored to a real
  comparable product, landed cost and units;
- **concept renders** for every style, generated from the brand's own product photos as references;
- a **line sheet PDF** and a **buy plan XLSX** (live formulas) published as ZooWork artifacts;
- **purchase orders** (one per style, colour/size lines, CSV export) issued only after approval;
- a weekly **Drop Watch** that re-checks the catalog, comparables and trends and recommends
  hold / re-price / re-buy / cut for each style.

## Who it is for

A merchandiser or founder at a DTC fashion brand planning the next drop. Today that job takes days: pulling
the assortment into a spreadsheet, eyeballing price architecture, collecting trend reports, briefing a designer
for concept sketches, building a line sheet and an OTB plan, then raising POs. Drop Planner does the first draft
of all of it end to end, and the human stays in charge of the money.

## How it runs on ZooWork Managed Agents

```
Browser (brief form, live timeline, sign-off)
   │  polls /api/runs/:id
   ▼
Node app (TypeScript)  ──createSession / postEvents / streamEvents (resumable cursor)──►  ZooWork Managed Agents
   │  guardrails + POs                                                                       │
   │◄──── agent.custom_tool_use: submit_drop_plan ───────────────────────────────────────────┤  Agent "Drop Planner"
   │───── resolveCustomToolCall (issues | approved + PO numbers | change request) ──────────►│  claude-sonnet-5-5, thinking medium
   │───── createSchedule / triggerSchedule (weekly Drop Watch on the same Session) ─────────►│  persona: SOUL.md, AGENTS.md, TOOLS.md
   ▼                                                                                          ▼
.local/runs/*.json                                         sandbox /workspace: kit/*.py, drops/<run>/…
```

| ZooWork capability                      | How Drop Planner uses it                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent** (versioned config)            | One agent with a merchandising playbook in `AGENTS.md`, voice in `SOUL.md`, kit and schema notes in `TOOLS.md`; `tool_policy` denies tools the job doesn't need. |
| **Sessions + event stream**             | One Session per brief. The app streams events with a persisted cursor (survives restarts) and turns every tool call into a readable step.                        |
| **Sandbox + `exec`**                    | Runs the uploaded kit: `catalog.py` (public catalog pull and assortment analysis), `pack.py` (guardrail check, XLSX, HTML→PDF with the sandbox's Chromium).      |
| **Files (`uploadFile`)**                | `npm run setup` copies `kit/` into the agent's persistent `/workspace/kit`.                                                                                      |
| **`web_fetch` / `web_search`**          | Catalog fallback and cited trend research for the launch season.                                                                                                 |
| **`image` (vision)**                    | Reads the brand's product photography to write brand DNA.                                                                                                        |
| **`image_generate` + `sessions_yield`** | One concept render per style, in parallel, using the brand's photos as reference images.                                                                         |
| **`artifact_publish`**                  | Renders, `line_sheet.pdf` and `buy_plan.xlsx` become shareable artifact URLs the UI shows live.                                                                  |
| **Application-executed custom tool**    | `submit_drop_plan`: the app recomputes every number, enforces the brief, and holds the buy for a human (or the auto-approval policy).                            |
| **Agent memory**                        | Brand DNA and each drop's outcome are saved (`memory_create`) and recalled on the next brief for that brand.                                                     |
| **Agent Database (`agent_db`)**         | Every plan is logged into `drops` and `drop_styles` tables.                                                                                                      |
| **Schedules**                           | After approval, a weekly cron Schedule (`drop-watch-<run>`) runs a Drop Watch turn in the same Session; the UI can trigger it on demand.                         |
| **Global skills**                       | Optional Seedance teaser video of the hero style via the `chameleon-seedance` skill.                                                                             |

## Guardrails (the app, not the model, owns the money)

`submit_drop_plan` input is parsed and checked in TypeScript (`src/plan.ts`, unit tested):

- total landed cost ≤ open-to-buy budget;
- blended initial margin (IMU) ≥ target, and no style more than 10 points under target;
- every style ≥ the minimum order quantity;
- exactly the requested number of styles, unique SKU codes, whole-number units;
- every calendar milestone on or before launch.

A failed check goes back to the agent as a tool error listing every issue, and the agent revises and
resubmits on its own. A passing plan shows a sign-off card with the KPIs. **Approve** issues POs and returns
the PO numbers to the agent. **Request changes** sends your notes back, and the agent re-plans, re-renders
the changed styles and resubmits. With the auto-approval policy, a buy that passes every guardrail is approved
automatically.

## Run it

Requirements: Node.js 22.12+, a ZooWork Platform Project key with credits.

```bash
npm install
cp .env.example .env        # set ZOOWORK_API_KEY=zwp_live_...
npm run setup               # create/start the agent and upload the sandbox kit (idempotent)
npm run dev                 # http://localhost:4700
```

Optional: set `ZOOWORK_MODEL` to any selectable alias from `npm run probe` (default `litellm/claude-sonnet-5-5`)
and rerun `npm run setup`.

| Script                                        | What it does                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run dev`                                 | Build the browser bundle and start the app on `PORT` (default 4700).                                 |
| `npm run setup`                               | Create or update the ZooWork agent, start it, upload `kit/`.                                         |
| `npm run probe`                               | List models and the organization balance.                                                            |
| `npm run ask -- "<message>"`                  | Send one message to the agent in a new Session and print the event stream.                           |
| `npm run events -- <session_id>`              | Print a Session's saved event log.                                                                   |
| `npm run cleanup`                             | Delete Drop Watch schedules (they fire weekly and spend credits). Add `-- --stop` to stop the agent. |
| `npm test` / `npm run lint` / `npm run build` | Unit tests, ESLint, TypeScript build.                                                                |

## Project layout

```
src/
  brief.ts            brief validation and the Session's first message
  plan.ts             plan parsing, buy math, guardrails, purchase orders
  timeline.ts         tool call → merchandiser-readable step mapping
  watch.ts            weekly Drop Watch schedule definition
  runs.ts             RunManager: sessions, event stream, custom tool, sign-off, schedules
  agent-definition.ts agent resource and the submit_drop_plan tool schema
  persona.ts          SOUL.md / AGENTS.md / TOOLS.md playbook
  http.ts             JSON API and static files
kit/                  sandbox scripts uploaded to /workspace/kit
web/app.ts            browser UI (compiled to public/app.js)
test/                 node:test unit tests
```

## Notes

- Catalog data comes from the store's public `products.json`. The kit identifies itself with an honest
  User-Agent and falls back to `web_fetch` if the store declines.
- Purchase orders are records inside this app (PO numbers, lines, CSV). Sending them to a factory or ERP is the
  next integration step.
- Drop Watch schedules keep running weekly until deleted: run `npm run cleanup` when you are done.
