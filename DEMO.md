# Demo script and submission copy

## 2-minute demo video

Before recording: `npm run dev`, open http://localhost:4700, and keep one finished run in "Recent drops" as a
fallback. A fresh run takes about 4 minutes, so speed up the middle of the recording.

1. **The job (10 s).** "Planning a drop takes a merchandiser days: pull the assortment, check price
   architecture, research trends, brief concepts, build the line sheet and the open-to-buy, then raise POs.
   Drop Planner does all of it from one brief, on ZooWork Managed Agents."
2. **The brief (10 s).** Store `girlfriend.com`, launch date, $60,000 open-to-buy, 68% margin, 6 styles,
   MOQ 150, "I approve the buy", weekly watch on. Click **Plan the drop**.
3. **Autonomy (45 s, sped up).** Narrate the live activity feed as the stepper advances:
   - live catalog pulled in the ZooWork sandbox and analyzed by the kit (price architecture, size scale,
     sell-out signal);
   - the vision model reads the brand's product photos into brand DNA, which is saved to agent memory;
   - cited trend searches for the launch season;
   - the capsule plan is written and math-checked;
   - six concept renders generated in parallel from the brand's own photos, appearing live;
   - line sheet PDF and buy-plan XLSX built in the sandbox and published as artifacts;
   - plan logged to the agent database, then submitted for sign-off.
4. **Guardrails and sign-off (20 s).** The app recomputes the buy itself: within budget, IMU above target,
   MOQ met, calendar before launch. Show the KPIs. Optional: type "swap the trend style for a second legging
   colorway" and click **Request changes**. The agent revises and resubmits on its own. Then click **Approve
   buy & issue POs**.
5. **Deliverables (20 s).** PO table and CSV, the line sheet PDF (cover, trend board, style pages, buy
   summary), the XLSX with live formulas.
6. **It keeps working (10 s).** A Drop Watch ZooWork Schedule now runs every Monday in the same Session.
   Click **Run Drop Watch now** to show it re-checking comparables and trends.
7. **Platform (5 s).** "Agent, sessions and resumable events, sandbox kit, vision, image generation,
   artifacts, a custom tool with human sign-off, memory, agent DB and schedules, all on ZooWork."

## Submission copy

**Name:** Drop Planner

**Track:** Fashion

**One-liner:** An autonomous merchandising agent that turns a brief into a buy-ready capsule drop: live
catalog recon, cited trends, on-brand concept renders, line sheet, open-to-buy plan, and purchase orders
behind app-side guardrails and human sign-off.

**What it does:** A merchandiser enters a Shopify store, launch date, open-to-buy budget and margin target.
The ZooWork agent pulls the live catalog in its sandbox and analyzes price architecture, size scales and
sell-outs. It reads the brand's product photography with a vision model and saves brand DNA to memory, then
researches the season with cited sources. It designs N styles with comparable-anchored pricing, colorways and
size curves, renders each style with image generation using the brand's own photos as references, and builds
a line sheet PDF and a buy-plan workbook. It logs the plan to its database and submits it through a custom
tool. The app recomputes every number and enforces budget, margin, MOQ and calendar guardrails. Failed checks
bounce back to the agent, which fixes them itself. A human approves or requests changes, approval issues
purchase orders, and a weekly ZooWork Schedule keeps watching the drop.

**ZooWork features used:** Managed Agent with persona docs and tool policy; Sessions with resumable SSE event
stream; sandbox `exec` with an uploaded kit; `web_fetch`, `web_search`; `image` vision; `image_generate` with
reference images and `sessions_yield`; `artifact_publish`; application-executed custom tool with human
approval; agent memory; Agent Database; Schedules; Seedance skill (optional teaser).
