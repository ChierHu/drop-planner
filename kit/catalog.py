#!/usr/bin/env python3
"""Drop Planner kit: fetch and summarise a Shopify store's public product catalog.

  python3 catalog.py fetch <store_url> <out.json>      # public /products.json, paged, polite
  python3 catalog.py analyze <catalog.json> <out.json> # assortment + price architecture summary
  python3 catalog.py list <catalog.json> [category]    # products with price, colors, sizes, sell-outs
"""
import collections
import datetime as dt
import json
import statistics
import sys
import time
import urllib.error
import urllib.request

UA = "DropPlannerKit/0.1 (merchandising research; contact via store owner)"
SIZE_ORDER = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "1X", "2X", "3X", "4X", "OS", "ONE SIZE"]
BANDS = [(0, 25), (25, 50), (50, 75), (75, 100), (100, 150), (150, 250), (250, 500), (500, 10**9)]


def fetch(store, out_path, max_pages=4):
    store = store.rstrip("/")
    products = []
    for page in range(1, max_pages + 1):
        url = f"{store}/products.json?limit=250&page={page}"
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = json.load(resp)
        except urllib.error.HTTPError as err:
            if products:
                print(f"stopped at page {page}: HTTP {err.code}; keeping {len(products)} products")
                break
            print(f"FETCH_FAILED HTTP {err.code} for {url}. Fall back to web_fetch.", file=sys.stderr)
            sys.exit(2)
        except (urllib.error.URLError, ValueError) as err:
            if products:
                break
            print(f"FETCH_FAILED {err} for {url}. Fall back to web_fetch.", file=sys.stderr)
            sys.exit(2)
        batch = data.get("products", []) if isinstance(data, dict) else []
        products.extend(batch)
        if len(batch) < 250:
            break
        time.sleep(1.5)
    if not products:
        print("FETCH_FAILED no products returned. Fall back to web_fetch.", file=sys.stderr)
        sys.exit(2)
    with open(out_path, "w") as fh:
        json.dump({"store": store, "fetched_at": dt.datetime.utcnow().isoformat() + "Z", "products": products}, fh)
    print(f"saved {len(products)} products to {out_path}")


def price_of(product):
    prices = [float(v.get("price") or 0) for v in product.get("variants", []) if v.get("price")]
    return statistics.median(prices) if prices else None


def option_values(product, names):
    out = []
    for opt in product.get("options", []) or []:
        if str(opt.get("name", "")).strip().lower() in names:
            out.extend(str(v).strip() for v in opt.get("values", []) if str(v).strip())
    return out


def size_key(size):
    s = size.upper().replace("-", "").strip()
    if s in SIZE_ORDER:
        return (0, SIZE_ORDER.index(s), s)
    try:
        return (1, float(s.split("/")[0]), s)
    except ValueError:
        return (2, 0, s)


def product_rows(products, store):
    rows = []
    for p in products:
        variants = p.get("variants", []) or []
        rows.append({
            "title": p.get("title"),
            "type": (p.get("product_type") or "Uncategorised").strip() or "Uncategorised",
            "price": price_of(p),
            "colors": option_values(p, {"color", "colour"})[:6],
            "sizes": option_values(p, {"size"})[:12],
            "sold_out": sum(1 for v in variants if v.get("available") is False),
            "variants": len(variants),
            "url": f"{store}/products/{p.get('handle')}" if store and p.get("handle") else None,
            "image": (p.get("images") or [{}])[0].get("src") if p.get("images") else None,
        })
    return rows


def list_products(catalog_path, category=None, limit=60):
    with open(catalog_path) as fh:
        raw = json.load(fh)
    rows = product_rows(raw.get("products", []), raw.get("store", ""))
    if category:
        rows = [r for r in rows if category.lower() in r["type"].lower() or category.lower() in (r["title"] or "").lower()]
    rows.sort(key=lambda r: (r["type"], r["price"] or 0))
    print(f"{len(rows)} products" + (f" matching '{category}'" if category else ""))
    for r in rows[:limit]:
        print(f"- [{r['type']}] {r['title']} | ${r['price']} | colors: {', '.join(r['colors']) or '-'} | "
              f"sizes: {','.join(r['sizes']) or '-'} | sold out {r['sold_out']}/{r['variants']} | {r['url']}")
    if len(rows) > limit:
        print(f"... {len(rows) - limit} more (narrow with a category argument)")


def analyze(catalog_path, out_path):
    with open(catalog_path) as fh:
        raw = json.load(fh)
    store = raw.get("store", "")
    products = raw.get("products", raw if isinstance(raw, list) else [])
    by_type = collections.defaultdict(list)
    colors, sizes, tags = collections.Counter(), collections.Counter(), collections.Counter()
    sizes_by_type = collections.defaultdict(collections.Counter)
    band_counts = collections.Counter()
    rows = []
    for p in products:
        ptype = (p.get("product_type") or "Uncategorised").strip() or "Uncategorised"
        price = price_of(p)
        variants = p.get("variants", []) or []
        sold_out = sum(1 for v in variants if v.get("available") is False)
        on_sale = any(v.get("compare_at_price") and float(v["compare_at_price"]) > float(v.get("price") or 0) for v in variants)
        image = (p.get("images") or [{}])[0].get("src") if p.get("images") else None
        row = {
            "title": p.get("title"),
            "type": ptype,
            "price": price,
            "url": f"{store}/products/{p.get('handle')}" if store and p.get("handle") else None,
            "image": image,
            "published_at": p.get("published_at"),
            "variants": len(variants),
            "sold_out_variants": sold_out,
            "on_sale": on_sale,
        }
        rows.append(row)
        by_type[ptype].append(row)
        for c in option_values(p, {"color", "colour"}):
            colors[c] += 1
        for s in option_values(p, {"size"}):
            sizes[s] += 1
            sizes_by_type[ptype][s] += 1
        for t in p.get("tags", []) or []:
            if isinstance(t, str) and len(t) < 40:
                tags[t] += 1
        if price is not None:
            for lo, hi in BANDS:
                if lo <= price < hi:
                    band_counts[f"${lo}-{hi if hi < 10**9 else '+'}"] += 1
                    break

    types = []
    for ptype, items in sorted(by_type.items(), key=lambda kv: -len(kv[1])):
        prices = [r["price"] for r in items if r["price"] is not None]
        variants = sum(r["variants"] for r in items) or 1
        types.append({
            "type": ptype,
            "products": len(items),
            "price_min": min(prices) if prices else None,
            "price_median": round(statistics.median(prices), 2) if prices else None,
            "price_max": max(prices) if prices else None,
            "sold_out_variant_share": round(sum(r["sold_out_variants"] for r in items) / variants, 3),
            "on_sale_share": round(sum(1 for r in items if r["on_sale"]) / len(items), 3),
            "size_scale": [s for s, _ in sorted(sizes_by_type[ptype].items(), key=lambda kv: size_key(kv[0]))][:14],
            "example": {k: items[0][k] for k in ("title", "price", "url", "image")},
        })
    newest = sorted([r for r in rows if r["published_at"]], key=lambda r: r["published_at"], reverse=True)[:12]
    demand = sorted([r for r in rows if r["variants"] >= 3], key=lambda r: r["sold_out_variants"] / r["variants"], reverse=True)[:10]
    reference_images = []
    seen_types = set()
    for r in newest + rows:
        if r["image"] and r["type"] not in seen_types:
            reference_images.append({"type": r["type"], "title": r["title"], "image": r["image"]})
            seen_types.add(r["type"])
        if len(reference_images) >= 8:
            break
    summary = {
        "store": store,
        "products": len(products),
        "types": types[:20],
        "price_bands": dict(sorted(band_counts.items(), key=lambda kv: float(kv[0].split("-")[0].strip("$")))),
        "top_colors": colors.most_common(25),
        "size_scale": [s for s, _ in sorted(sizes.items(), key=lambda kv: size_key(kv[0]))][:20],
        "top_tags": tags.most_common(25),
        "newest": [{k: r[k] for k in ("title", "type", "price", "url", "published_at")} for r in newest],
        "sell_out_signal": [{k: r[k] for k in ("title", "type", "price", "sold_out_variants", "variants")} for r in demand],
        "reference_images": reference_images,
    }
    with open(out_path, "w") as fh:
        json.dump(summary, fh, indent=2)

    print(f"CATALOG SUMMARY for {store}: {len(products)} products")
    print("Category | n | min / median / max | sold-out variant share | on-sale share | size scale")
    for t in types[:12]:
        print(f"- {t['type']} | {t['products']} | {t['price_min']} / {t['price_median']} / {t['price_max']} | "
              f"{t['sold_out_variant_share']:.0%} | {t['on_sale_share']:.0%} | {','.join(t['size_scale'][:9])}")
    print("Price bands:", ", ".join(f"{k}: {v}" for k, v in summary["price_bands"].items()))
    print("Top colors:", ", ".join(f"{c} ({n})" for c, n in summary["top_colors"][:15]))
    print("Newest:", "; ".join(f"{r['title']} ${r['price']}" for r in summary["newest"][:8]))
    print("Sell-out signal (most sold-out variants):", "; ".join(
        f"{r['title']} {r['sold_out_variants']}/{r['variants']}" for r in summary["sell_out_signal"][:6]))
    print("Products by category (title $price | colors | sold-out variants):")
    by = collections.defaultdict(list)
    for r in product_rows(products, store):
        by[r["type"]].append(r)
    for t in types[:10]:
        items = sorted(by[t["type"]], key=lambda r: -(r["sold_out"] / r["variants"]) if r["variants"] else 0)[:6]
        print(f"  {t['type']}: " + "; ".join(
            f"{r['title']} ${r['price']} [{', '.join(r['colors'][:3]) or '-'}] {r['sold_out']}/{r['variants']}" for r in items))
    print("Reference images:")
    for ref in reference_images:
        print(f"  {ref['type']}: {ref['image']}")
    print(f"Full summary JSON: {out_path}")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "list":
        list_products(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    elif len(sys.argv) == 4 and sys.argv[1] in {"fetch", "analyze"}:
        (fetch if sys.argv[1] == "fetch" else analyze)(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        sys.exit(1)
