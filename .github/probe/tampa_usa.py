"""Read-only: Tampa Bay federal construction totals from USAspending.gov (public API, no key).
Tampa Bay = Hillsborough (057), Pinellas (103), Pasco (101), Hernando (053) counties, FL. FY2026 (Oct 2025 - Sep 2026).
Prints totals only."""
import json, urllib.request, datetime

API = "https://api.usaspending.gov/api/v2"
UA = {"Content-Type": "application/json", "User-Agent": "ContraxBot/1.0 (+https://www.contrax.company)"}
COUNTIES = [{"country": "USA", "state": "FL", "county": c} for c in ("057", "103", "101", "053")]
FY = [{"start_date": "2025-10-01", "end_date": "2026-09-30"}]
CONTRACTS = ["A", "B", "C", "D"]
GROUPS = {
    "all construction (NAICS 23)": ["23"],
    "buildings / general contractors (2361/2362)": ["2361", "2362"],
    "heavy & civil (2371-2379)": ["2371", "2372", "2373", "2379"],
    "specialty trades (2381-2389)": ["2381", "2382", "2383", "2389"],
    "HVAC & plumbing (238220)": ["238220"],
    "electrical (238210)": ["238210"],
    "roofing (238160)": ["238160"],
    "facilities support (561210)": ["561210"],
}


def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers=UA, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def filters(naics, fl_only=False, time=FY):
    f = {"award_type_codes": CONTRACTS, "place_of_performance_locations": COUNTIES, "time_period": time, "naics_codes": {"require": naics}}
    if fl_only:
        f["recipient_locations"] = [{"country": "USA", "state": "FL"}]
    return f


def recipients(naics, fl_only=False):
    out, page = {}, 1
    while page <= 10:
        d = post("/search/spending_by_category/recipient/", {"filters": filters(naics, fl_only), "limit": 100, "page": page})
        for r in d.get("results", []):
            out[(r.get("name") or "").upper()] = float(r.get("amount") or 0)
        if not d.get("page_metadata", {}).get("hasNext"):
            break
        page += 1
    return out


for label, naics in GROUPS.items():
    try:
        allr = recipients(naics)
        flr = recipients(naics, True)
        tot, fl = sum(allr.values()), sum(flr.values())
        out_names = [n for n in allr if n not in flr]
        print(f"{label}: ${tot/1e6:,.1f}M across {len(allr)} companies; out-of-state firms ${ (tot-fl)/1e6:,.1f}M ({round(100*(tot-fl)/tot) if tot else 0}%) across {len(out_names)} companies")
    except Exception as e:
        print(label, "ERR", str(e)[:200])

# Top buyers for construction.
try:
    d = post("/search/spending_by_category/awarding_subagency/", {"filters": filters(["23"]), "limit": 6})
    print("top buyers:", "; ".join(f"{r['name']} ${float(r['amount'])/1e6:,.1f}M" for r in d.get("results", [])))
except Exception as e:
    print("buyers ERR", str(e)[:200])

# Construction contracts ending in the next 12 months (awards active in the last 3 fiscal years).
try:
    today = datetime.date(2026, 11, 9)
    until = today.replace(year=today.year + 1)
    n, amt, page, seen = 0, 0.0, 1, set()
    while page <= 10:
        d = post("/search/spending_by_award/", {
            "filters": filters(["23"], time=[{"start_date": "2023-10-01", "end_date": "2026-09-30"}]),
            "fields": ["Award ID", "Award Amount", "End Date"], "limit": 100, "page": page, "sort": "Award Amount", "order": "desc",
        })
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
    print(f"construction contracts ending in next 12 months (top {len(seen)} by size checked): {n} worth ${amt/1e6:,.1f}M")
except Exception as e:
    print("ending ERR", str(e)[:200])
