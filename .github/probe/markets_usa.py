"""Read-only: federal construction totals per market from USAspending.gov (public API). FY2026 (Oct 2025 - Sep 2026). Totals only."""
import json, urllib.request, datetime

API = "https://api.usaspending.gov/api/v2"
UA = {"Content-Type": "application/json", "User-Agent": "ContraxBot/1.0 (+https://www.contrax.company)"}
FY = [{"start_date": "2025-10-01", "end_date": "2026-09-30"}]
MARKETS = {
    "hampton-roads": ("VA", ["710", "810", "550", "740", "800", "650", "700", "199", "095", "830"]),
    "san-diego": ("CA", ["073"]),
    "san-antonio": ("TX", ["029"]),
}

def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers=UA, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

def filters(st, counties, naics, home_state=False, time=FY):
    f = {"award_type_codes": ["A", "B", "C", "D"], "place_of_performance_locations": [{"country": "USA", "state": st, "county": c} for c in counties], "time_period": time, "naics_codes": {"require": naics}}
    if home_state:
        f["recipient_locations"] = [{"country": "USA", "state": st}]
    return f

def recipients(st, counties, naics, home_state=False):
    out, page = {}, 1
    while page <= 15:
        d = post("/search/spending_by_category/recipient/", {"filters": filters(st, counties, naics, home_state), "limit": 100, "page": page})
        for r in d.get("results", []):
            out[(r.get("name") or "").upper()] = float(r.get("amount") or 0)
        if not d.get("page_metadata", {}).get("hasNext"):
            break
        page += 1
    return out

for slug, (st, counties) in MARKETS.items():
    print("=== market", slug)
    try:
        allr = recipients(st, counties, ["23"])
        home = recipients(st, counties, ["23"], True)
        tot, inn = sum(allr.values()), sum(home.values())
        outn = [n for n in allr if n not in home]
        print(f"construction: total={tot:.0f} companies={len(allr)} out_of_state={tot-inn:.0f} share={round(100*(tot-inn)/tot) if tot else 0} out_firms={len(outn)}")
    except Exception as e:
        print("construction ERR", str(e)[:200])
    try:
        d = post("/search/spending_by_category/awarding_subagency/", {"filters": filters(st, counties, ["23"]), "limit": 4})
        print("buyers:", " | ".join(f"{r['name']}={float(r['amount']):.0f}" for r in d.get("results", [])))
    except Exception as e:
        print("buyers ERR", str(e)[:200])
    try:
        today = datetime.date(2026, 11, 10)
        until = today.replace(year=today.year + 1)
        n, amt, page, seen = 0, 0.0, 1, set()
        while page <= 10:
            d = post("/search/spending_by_award/", {"filters": filters(st, counties, ["23"], time=[{"start_date": "2023-10-01", "end_date": "2026-09-30"}]), "fields": ["Award ID", "Award Amount", "End Date"], "limit": 100, "page": page, "sort": "Award Amount", "order": "desc"})
            for r in d.get("results", []):
                e = r.get("End Date")
                if not e or r.get("Award ID") in seen:
                    continue
                seen.add(r.get("Award ID"))
                dt = datetime.date.fromisoformat(e[:10])
                if today <= dt <= until:
                    n += 1
                    amt += float(r.get("Award Amount") or 0)
            if not d.get("page_metadata", {}).get("hasNext"):
                break
            page += 1
        print(f"ending: count={n} value={amt:.0f} checked={len(seen)}")
    except Exception as e:
        print("ending ERR", str(e)[:200])
