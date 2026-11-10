#!/usr/bin/env bash
# Read-only: Texas Comptroller HUB directory downloads (layout and a count). Prints field names and value shapes only.
UA="ContraxBot/1.0 (+https://www.contrax.company/bot)"
B=https://comptroller.texas.gov
cd /tmp
for f in hub_name.txt web_name_doc.txt vnr_clas.txt; do echo "=== doc $f"; curl -sL -m 45 -A "$UA" "$B/purchasing/downloads/$f" | head -c 4000; echo; done
for f in hub_name.csv hub_clas.csv; do
  code=$(curl -sL -m 120 -A "$UA" -o "$f" -w "%{http_code}" "$B/auto-data/purchasing/$f"); echo "=== $f HTTP $code $(wc -c < $f)B $(wc -l < $f) lines"
  head -1 "$f" | cut -c1-600
  python3 - "$f" <<'PY'
import csv,sys,re,collections
f=sys.argv[1]
rows=list(csv.reader(open(f,encoding='latin-1',errors='replace')))
print('rows',len(rows),'cols',collections.Counter(len(r) for r in rows).most_common(3))
for r in rows[1:3]:
    print(' shape:', [re.sub(r'[A-Za-z]','A',re.sub(r'\d','9',v))[:18] for v in r])
PY
done
