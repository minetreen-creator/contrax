"""Read-only: count active SAM.gov registrants in Tampa Bay construction trades from the PUBLIC extract.
Prints counts only (no names). Columns per the official Public V2 layout (1-based)."""
import sys, collections

f = sys.argv[1]
ZIPS = ("335", "336", "337", "346")  # Tampa, St. Petersburg/Clearwater, Pasco/Hernando
TRADES = {"general / buildings (236)": ("236",), "heavy & civil (237)": ("237",), "specialty trades (238)": ("238",),
          "HVAC & plumbing (238220)": ("238220",), "electrical (238210)": ("238210",), "roofing (238160)": ("238160",)}
c = collections.Counter()
shapes = []
with open(f, encoding="utf-8", errors="replace") as fh:
    for line in fh:
        p = line.rstrip("\n").split("|")
        if len(p) < 120:
            continue
        g = lambda i: p[i - 1].strip()
        if g(6) != "A" or g(19) != "FL" or not g(20)[:3] in ZIPS:
            continue
        naics = [x[:6] for x in g(35).split("~") if x[:6].isdigit()]
        if len(shapes) < 3 and naics:
            shapes.append(g(35)[:40])
        if not any(n.startswith(("236", "237", "238")) for n in naics):
            continue
        small = any(x[:6].startswith(("236", "237", "238")) and x[6:7] == "Y" for x in g(35).split("~"))
        bus = set(x for x in g(32).split("~") if x)
        sba = set(x[:2] for x in g(118).split("~") if x)
        c["construction registrants"] += 1
        if small: c["small business in a construction code"] += 1
        if "QF" in bus: c["service-disabled veteran-owned (SDVOSB)"] += 1
        if "A5" in bus: c["veteran-owned (incl. SDVOSB)"] += 1
        if "8W" in bus or "A2" in bus: c["woman-owned"] += 1
        if "A6" in sba: c["SBA 8(a)"] += 1
        if "XX" in sba: c["SBA HUBZone"] += 1
        for label, pre in TRADES.items():
            if any(n.startswith(pre) for n in naics):
                c[label] += 1
                if "A5" in bus: c[label + " - veteran-owned"] += 1
print("NAICS string shapes:", shapes)
for k, v in c.most_common():
    print(f"{k}: {v}")
