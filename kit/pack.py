#!/usr/bin/env python3
"""Drop Planner kit: check a capsule plan and build the line sheet + buy plan workbook.

  python3 pack.py <workdir> --check   # guardrail check only (exit 1 on failure)
  python3 pack.py <workdir>           # check, then write buy_plan.xlsx, line_sheet.html, line_sheet.pdf

Reads <workdir>/brief.json and <workdir>/plan.json (schema in TOOLS.md).
"""
import base64
import html
import io
import json
import os
import subprocess
import sys
from urllib.parse import urlparse

KIT = os.path.dirname(os.path.abspath(__file__))


def load(workdir):
    with open(os.path.join(workdir, "brief.json")) as fh:
        brief = json.load(fh)
    with open(os.path.join(workdir, "plan.json")) as fh:
        plan = json.load(fh)
    return brief, plan


def units_of(sku):
    return sum(int(u) for c in sku.get("buy", []) for u in c.get("sizes", {}).values())


def totals(plan, brief):
    rows = []
    for s in plan["skus"]:
        u = units_of(s)
        rows.append({
            "sku": s["sku"], "name": s["name"], "category": s.get("category", ""), "role": s.get("role", ""),
            "units": u, "cost": u * s["landed_cost"], "retail_value": u * s["retail_price"],
            "margin_pct": (1 - s["landed_cost"] / s["retail_price"]) * 100,
        })
    units = sum(r["units"] for r in rows)
    cost = sum(r["cost"] for r in rows)
    retail = sum(r["retail_value"] for r in rows)
    st = brief.get("sell_through_pct", 65) / 100
    md = brief.get("markdown_pct", 40) / 100
    revenue = retail * (st + (1 - st) * (1 - md))
    return {
        "rows": rows, "units": units, "cost": cost, "retail_value": retail,
        "imu_pct": (1 - cost / retail) * 100 if retail else 0,
        "revenue": revenue, "gross_margin": revenue - cost,
        "mmu_pct": (revenue - cost) / revenue * 100 if revenue else 0,
        "budget_used_pct": cost / brief["budget"] * 100,
    }


def check(plan, brief, t):
    issues = []
    target = brief["target_margin_pct"]
    if len(plan["skus"]) != brief["sku_count"]:
        issues.append(f"needs exactly {brief['sku_count']} SKUs, has {len(plan['skus'])}")
    codes = [s["sku"] for s in plan["skus"]]
    for code in sorted({c for c in codes if codes.count(c) > 1}):
        issues.append(f"duplicate SKU code {code}")
    if t["cost"] > brief["budget"]:
        issues.append(f"landed cost ${t['cost']:,.0f} exceeds budget ${brief['budget']:,.0f} by ${t['cost'] - brief['budget']:,.0f}")
    if t["imu_pct"] + 1e-9 < target:
        issues.append(f"blended initial margin {t['imu_pct']:.1f}% is below target {target}%")
    for r in t["rows"]:
        if r["margin_pct"] + 1e-9 < target - 10:
            issues.append(f"{r['sku']} margin {r['margin_pct']:.1f}% under per-SKU floor {target - 10}%")
        if r["units"] < brief.get("min_units_per_style", 1):
            issues.append(f"{r['sku']} buys {r['units']} units, below MOQ {brief['min_units_per_style']}")
    for s in plan["skus"]:
        if s["landed_cost"] >= s["retail_price"]:
            issues.append(f"{s['sku']} landed_cost must be below retail_price")
    for c in plan.get("calendar", []):
        if c["date"] > brief["launch_date"]:
            issues.append(f"calendar '{c['milestone']}' ({c['date']}) is after launch {brief['launch_date']}")
    return issues


def print_table(t, brief):
    print(f"{'SKU':<14}{'units':>7}{'cost':>12}{'retail value':>14}{'margin':>8}")
    for r in t["rows"]:
        print(f"{r['sku']:<14}{r['units']:>7}{r['cost']:>12,.0f}{r['retail_value']:>14,.0f}{r['margin_pct']:>7.1f}%")
    print(f"TOTAL units {t['units']:,} | landed cost ${t['cost']:,.0f} of ${brief['budget']:,.0f} budget "
          f"({t['budget_used_pct']:.1f}%) | retail value ${t['retail_value']:,.0f} | IMU {t['imu_pct']:.1f}% | "
          f"projected revenue ${t['revenue']:,.0f} | projected GM ${t['gross_margin']:,.0f} ({t['mmu_pct']:.1f}%)")


def write_xlsx(workdir, plan, brief, t):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head = Font(bold=True, color="FFFFFF")
    fill = PatternFill("solid", fgColor="1F1B16")
    money = '"$"#,##0.00'
    money0 = '"$"#,##0'

    ws = wb.active
    ws.title = "Summary"
    summary = [
        ("Brand", plan.get("brand") or brief.get("brand") or brief.get("store_url")),
        ("Drop", plan["drop_name"]),
        ("Launch date", brief["launch_date"]),
        ("Thesis", plan.get("thesis", "")),
        ("Open-to-buy budget", brief["budget"]),
        ("Landed cost (buy)", t["cost"]),
        ("Budget used", t["budget_used_pct"] / 100),
        ("Units", t["units"]),
        ("Retail value", t["retail_value"]),
        ("Initial margin (IMU)", t["imu_pct"] / 100),
        (f"Projected revenue ({brief.get('sell_through_pct', 65)}% full price, rest at {brief.get('markdown_pct', 40)}% off)", t["revenue"]),
        ("Projected gross margin $", t["gross_margin"]),
        ("Projected maintained margin", t["mmu_pct"] / 100),
    ]
    for i, (k, v) in enumerate(summary, start=1):
        ws.cell(row=i, column=1, value=k).font = Font(bold=True)
        cell = ws.cell(row=i, column=2, value=v)
        if k in {"Open-to-buy budget", "Landed cost (buy)", "Retail value", "Projected gross margin $"} or k.startswith("Projected revenue"):
            cell.number_format = money0
        if k in {"Budget used", "Initial margin (IMU)", "Projected maintained margin"}:
            cell.number_format = "0.0%"
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    ws.column_dimensions["A"].width = 58
    ws.column_dimensions["B"].width = 70

    bp = wb.create_sheet("Buy plan")
    headers = ["SKU", "Style", "Category", "Role", "Colorway", "Size", "Units", "Unit landed cost", "Line cost", "Retail price", "Line retail value"]
    bp.append(headers)
    for c in range(1, len(headers) + 1):
        bp.cell(row=1, column=c).font = head
        bp.cell(row=1, column=c).fill = fill
    r = 2
    for s in plan["skus"]:
        for cw in s["buy"]:
            for size, units in cw["sizes"].items():
                bp.append([s["sku"], s["name"], s.get("category", ""), s.get("role", ""), cw["colorway"], size, int(units),
                           s["landed_cost"], f"=G{r}*H{r}", s["retail_price"], f"=G{r}*J{r}"])
                for col in (8, 9, 10, 11):
                    bp.cell(row=r, column=col).number_format = money
                r += 1
    bp.append(["TOTAL", "", "", "", "", "", f"=SUM(G2:G{r - 1})", "", f"=SUM(I2:I{r - 1})", "", f"=SUM(K2:K{r - 1})"])
    for col in (1, 7, 9, 11):
        bp.cell(row=r, column=col).font = Font(bold=True)
    for col in (9, 11):
        bp.cell(row=r, column=col).number_format = money0
    bp.freeze_panes = "A2"
    for i, w in enumerate([14, 30, 16, 8, 16, 8, 8, 16, 14, 12, 16], start=1):
        bp.column_dimensions[get_column_letter(i)].width = w

    st = wb.create_sheet("Styles")
    st.append(["SKU", "Style", "Category", "Role", "Units", "Landed cost", "Retail value", "Initial margin", "Trend", "Comparable"])
    for c in range(1, 11):
        st.cell(row=1, column=c).font = head
        st.cell(row=1, column=c).fill = fill
    for row, s in zip(t["rows"], plan["skus"]):
        comp = s.get("comparable") or {}
        st.append([row["sku"], row["name"], row["category"], row["role"], row["units"], row["cost"], row["retail_value"],
                   row["margin_pct"] / 100, s.get("trend", ""), f"{comp.get('title', '')} ${comp.get('price', '')}" if comp else ""])
        n = st.max_row
        st.cell(row=n, column=6).number_format = money0
        st.cell(row=n, column=7).number_format = money0
        st.cell(row=n, column=8).number_format = "0.0%"
    for i, w in enumerate([14, 30, 16, 8, 8, 14, 14, 12, 24, 40], start=1):
        st.column_dimensions[get_column_letter(i)].width = w

    cal = wb.create_sheet("Calendar")
    cal.append(["Date", "Milestone"])
    for c in plan.get("calendar", []):
        cal.append([c["date"], c["milestone"]])
    cal.column_dimensions["A"].width = 14
    cal.column_dimensions["B"].width = 70

    tr = wb.create_sheet("Trends")
    tr.append(["Trend", "Insight", "Sources"])
    for x in plan.get("trends", []):
        tr.append([x["name"], x["insight"], "\n".join(x.get("sources", []))])
    tr.column_dimensions["A"].width = 26
    tr.column_dimensions["B"].width = 80
    tr.column_dimensions["C"].width = 60

    path = os.path.join(workdir, "buy_plan.xlsx")
    wb.save(path)
    return path


def image_src(sku, workdir):
    path = sku.get("image_path")
    if path and not os.path.isabs(path):
        path = os.path.join(workdir, path)
    if path and os.path.exists(path):
        try:
            from PIL import Image
            img = Image.open(path).convert("RGB")
            img.thumbnail((900, 1125))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=82)
            return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        except Exception as err:  # fall back to the published URL
            print(f"warning: could not embed {path}: {err}")
    return sku.get("image_url") or ""


def esc(value):
    return html.escape(str(value if value is not None else ""))


def write_html(workdir, plan, brief, t):
    brand = plan.get("brand") or brief.get("brand") or urlparse(brief.get("store_url", "")).hostname or ""
    hero = next((s for s in plan["skus"] if s.get("role") == "hero"), plan["skus"][0])
    kpis = [("Styles", len(plan["skus"])), ("Units", f"{t['units']:,}"), ("Landed cost", f"${t['cost']:,.0f}"),
            ("Budget used", f"{t['budget_used_pct']:.0f}%"), ("Retail value", f"${t['retail_value']:,.0f}"),
            ("IMU", f"{t['imu_pct']:.1f}%"), ("Proj. gross margin", f"${t['gross_margin']:,.0f}")]
    trends = "".join(
        f"<div class='trend'><h3>{esc(x['name'])}</h3><p>{esc(x['insight'])}</p><p class='src'>"
        + " · ".join(f"<a href='{esc(u)}'>{esc(urlparse(u).hostname or u)}</a>" for u in x.get("sources", []))
        + "</p></div>" for x in plan.get("trends", []))
    dna = "".join(f"<li>{esc(b)}</li>" for b in plan.get("brand_dna", []))
    cards = []
    for s, row in zip(plan["skus"], t["rows"]):
        size_names = []
        for cw in s["buy"]:
            for k in cw["sizes"]:
                if k not in size_names:
                    size_names.append(k)
        size_head = "".join(f"<th>{esc(k)}</th>" for k in size_names)
        size_rows = "".join(
            f"<tr><td>{esc(cw['colorway'])}</td>" + "".join(f"<td>{cw['sizes'].get(k, 0)}</td>" for k in size_names)
            + f"<td><b>{sum(cw['sizes'].values())}</b></td></tr>" for cw in s["buy"])
        comp = s.get("comparable") or {}
        comp_html = f"<p class='comp'>Price anchor: {esc(comp.get('title'))} at ${esc(comp.get('price'))}</p>" if comp else ""
        cards.append(f"""
        <section class='card'>
          <div class='img'>{f"<img src='{image_src(s, workdir)}'>" if image_src(s, workdir) else "<div class='noimg'>Render pending</div>"}</div>
          <div class='info'>
            <div class='eyebrow'>{esc(s['sku'])} · {esc(s.get('category'))} · <span class='role {esc(s.get('role'))}'>{esc(s.get('role'))}</span></div>
            <h2>{esc(s['name'])}</h2>
            <p>{esc(s.get('description'))}</p>
            <p class='mat'>{esc(s.get('materials'))}</p>
            <p class='trendtag'>Trend: {esc(s.get('trend'))}</p>
            <div class='nums'><div><span>Retail</span><b>${s['retail_price']:,.2f}</b></div><div><span>Landed cost</span><b>${s['landed_cost']:,.2f}</b></div>
              <div><span>Margin</span><b>{row['margin_pct']:.1f}%</b></div><div><span>Units</span><b>{row['units']:,}</b></div></div>
            <table class='sizes'><tr><th>Colorway</th>{size_head}<th>Total</th></tr>{size_rows}</table>
            {comp_html}
          </div>
        </section>""")
    pages = []
    for i in range(0, len(cards), 2):
        pages.append(f"<div class='page cards'>{''.join(cards[i:i + 2])}</div>")
    buy_rows = "".join(
        f"<tr><td>{esc(r['sku'])}</td><td>{esc(r['name'])}</td><td>{esc(r['role'])}</td><td>{r['units']:,}</td>"
        f"<td>${r['cost']:,.0f}</td><td>${r['retail_value']:,.0f}</td><td>{r['margin_pct']:.1f}%</td></tr>" for r in t["rows"])
    cal = "".join(f"<li><b>{esc(c['date'])}</b> {esc(c['milestone'])}</li>" for c in plan.get("calendar", []))
    doc = f"""<!doctype html><html><head><meta charset='utf-8'><title>{esc(brand)} · {esc(plan['drop_name'])} line sheet</title>
<style>
@page {{ size: Letter landscape; margin: 0.35in; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; font-family: 'Noto Sans', 'Helvetica Neue', Arial, sans-serif; color: #1f1b16; background: #f6f2ec; font-size: 11px; }}
.page {{ width: 10.3in; min-height: 7.7in; padding: 0.35in 0.45in; page-break-after: always; background: #fbf8f3; margin: 0 auto 0.3in; }}
h1, h2, h3 {{ font-family: 'Noto Serif', Georgia, serif; font-weight: 500; margin: 0; }}
.cover {{ display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 0.4in; }}
.cover h1 {{ font-size: 46px; line-height: 1.02; margin: 8px 0 14px; }}
.eyebrow {{ text-transform: uppercase; letter-spacing: .14em; font-size: 9.5px; color: #7a6f63; }}
.thesis {{ font-size: 14px; line-height: 1.45; max-width: 5in; }}
.cover img {{ width: 100%; height: 6.6in; object-fit: cover; border-radius: 4px; }}
.kpis {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 22px; }}
.kpis div {{ border-top: 1px solid #1f1b16; padding-top: 6px; }}
.kpis span {{ display: block; color: #7a6f63; font-size: 9px; text-transform: uppercase; letter-spacing: .1em; }}
.kpis b {{ font-size: 18px; font-weight: 500; font-family: 'Noto Serif', Georgia, serif; }}
.trends {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 16px; }}
.trend {{ border-top: 2px solid #1f1b16; padding-top: 8px; }} .trend h3 {{ font-size: 18px; margin-bottom: 6px; }}
.trend p {{ line-height: 1.45; }} .src a {{ color: #7a6f63; }}
ul.dna {{ columns: 2; line-height: 1.6; padding-left: 16px; }}
.cards {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0.3in; }}
.card {{ display: grid; grid-template-columns: 2.1in 1fr; gap: 14px; align-content: start; }}
.card .img img, .noimg {{ width: 2.1in; height: 2.62in; object-fit: cover; border-radius: 3px; background: #ece5db; }}
.noimg {{ display: flex; align-items: center; justify-content: center; color: #7a6f63; }}
.card h2 {{ font-size: 20px; margin: 4px 0 6px; }} .card p {{ margin: 0 0 6px; line-height: 1.4; }}
.mat, .comp, .trendtag {{ color: #7a6f63; font-size: 10px; }}
.role {{ padding: 1px 6px; border-radius: 8px; background: #ece5db; }} .role.hero {{ background: #1f1b16; color: #fbf8f3; }}
.nums {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0; }}
.nums span {{ display: block; font-size: 8.5px; color: #7a6f63; text-transform: uppercase; letter-spacing: .08em; }}
.nums b {{ font-size: 13px; font-weight: 600; }}
table {{ border-collapse: collapse; width: 100%; }} th, td {{ border-bottom: 1px solid #e3dbcf; padding: 3px 5px; text-align: left; font-size: 10px; }}
th {{ font-weight: 600; color: #7a6f63; text-transform: uppercase; font-size: 8.5px; letter-spacing: .06em; }}
.summary {{ display: grid; grid-template-columns: 1.4fr 1fr; gap: 0.35in; margin-top: 14px; }}
ol.cal {{ list-style: none; padding: 0; line-height: 1.9; }} ol.cal b {{ display: inline-block; width: 92px; }}
@media print {{ body {{ background: #fbf8f3; }} .page {{ margin: 0; }} }}
</style></head><body>
<div class='page cover'>
  <div>
    <div class='eyebrow'>{esc(brand)} · Line sheet · Launch {esc(brief['launch_date'])}</div>
    <h1>{esc(plan['drop_name'])}</h1>
    <p class='thesis'>{esc(plan.get('thesis'))}</p>
    <div class='kpis'>{''.join(f"<div><span>{k}</span><b>{v}</b></div>" for k, v in kpis)}</div>
  </div>
  <div>{f"<img src='{image_src(hero, workdir)}'>" if image_src(hero, workdir) else ''}</div>
</div>
<div class='page'>
  <div class='eyebrow'>Why this drop</div><h2 style='font-size:28px;margin:6px 0 4px'>Trend board</h2>
  <div class='trends'>{trends}</div>
  <h3 style='margin-top:26px;font-size:18px'>Brand DNA we design to</h3><ul class='dna'>{dna}</ul>
</div>
{''.join(pages)}
<div class='page'>
  <div class='eyebrow'>Buy plan & calendar</div><h2 style='font-size:28px;margin:6px 0 4px'>Open-to-buy: ${t['cost']:,.0f} of ${brief['budget']:,.0f}</h2>
  <div class='summary'>
    <table><tr><th>SKU</th><th>Style</th><th>Role</th><th>Units</th><th>Landed cost</th><th>Retail value</th><th>IMU</th></tr>{buy_rows}
      <tr><td colspan='3'><b>Total</b></td><td><b>{t['units']:,}</b></td><td><b>${t['cost']:,.0f}</b></td><td><b>${t['retail_value']:,.0f}</b></td><td><b>{t['imu_pct']:.1f}%</b></td></tr></table>
    <div><p>Projection: {brief.get('sell_through_pct', 65)}% full-price sell-through, remainder at {brief.get('markdown_pct', 40)}% off →
      revenue <b>${t['revenue']:,.0f}</b>, gross margin <b>${t['gross_margin']:,.0f}</b> ({t['mmu_pct']:.1f}%).</p>
      <ol class='cal'>{cal}</ol></div>
  </div>
</div>
</body></html>"""
    path = os.path.join(workdir, "line_sheet.html")
    with open(path, "w") as fh:
        fh.write(doc)
    return path


def write_pdf(html_path):
    pdf_path = html_path[:-5] + ".pdf"
    try:
        subprocess.run(["node", os.path.join(KIT, "html2pdf.cjs"), html_path, pdf_path], check=True, timeout=180,
                       capture_output=True, text=True)
        return pdf_path
    except Exception as err:
        detail = getattr(err, "stderr", "") or str(err)
        print(f"warning: PDF export failed ({str(detail)[-300:]}); publish line_sheet.html instead")
        return None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    workdir = sys.argv[1]
    brief, plan = load(workdir)
    t = totals(plan, brief)
    print_table(t, brief)
    issues = check(plan, brief, t)
    if issues:
        print("CHECK FAILED:")
        for i in issues:
            print(f"  - {i}")
    else:
        print("CHECK PASSED")
    if "--check" in sys.argv:
        sys.exit(1 if issues else 0)
    xlsx = write_xlsx(workdir, plan, brief, t)
    html_path = write_html(workdir, plan, brief, t)
    pdf = write_pdf(html_path)
    print(f"WROTE {xlsx}")
    print(f"WROTE {html_path}")
    if pdf:
        print(f"WROTE {pdf}")


if __name__ == "__main__":
    main()
