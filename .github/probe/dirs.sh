#!/usr/bin/env bash
# Read-only: Texas web_name.csv (active CMBL/HUB vendors): counts only, no names or contacts printed.
UA="ContraxBot/1.0 (+https://www.contrax.company/bot)"
B=https://comptroller.texas.gov/auto-data/purchasing
cd /tmp
for f in web_name.csv vnr_clas.csv; do code=$(curl -sL -m 300 -A "$UA" -o "$f" -w "%{http_code}" "$B/$f"); echo "=== $f HTTP $code $(wc -c < $f)B $(wc -l < $f) lines"; head -1 "$f" | cut -c1-500; done
python3 - <<'PY'
import csv,collections
rows=list(csv.DictReader(open('/tmp/web_name.csv',encoding='latin-1',errors='replace')))
print('vendors',len(rows))
keys=list(rows[0].keys()); print('cols',keys)
def k(name):
    return next((x for x in keys if x and name in x.upper()),None)
hs=k('HUB_STATUS') or k('HUB STATUS'); eth=k('ETHNIC'); sdv=k('SDV'); st=k('STATE'); web=k('EMAIL') or k('INTERNET'); desc=k('DESC')
print('hub status',collections.Counter(r[hs] for r in rows).most_common(8))
hub=[r for r in rows if r[hs].strip()=='A']
print('active HUB',len(hub),'| in TX',sum(1 for r in hub if r[st].strip()=='TX'))
print('sdv',collections.Counter(r[sdv] for r in hub).most_common(4))
import re
kw={'construction':r'construct|contractor|remodel|roof|concrete|paving|demolition|carpent|drywall|framing|masonry|excavat|general contract','hvac':r'hvac|air condition|heating|mechanical|plumb|refriger','electrical':r'electric','janitorial':r'janitor|custodial|cleaning','landscaping':r'landscap|lawn|mow|tree|irrigation','security':r'security guard|security service|patrol','trucking':r'trucking|hauling|freight','it':r'software|it services|information technology|computer|network'}
for t,p in kw.items(): print(' trade',t,sum(1 for r in hub if re.search(p,r[desc] or '',re.I)))
print('desc empty',sum(1 for r in hub if not (r[desc] or '').strip()))
for city in ['SAN ANTONIO','HOUSTON','DALLAS','AUSTIN']:
    c=k('CITY'); print(' city',city,sum(1 for r in hub if r[c].strip().upper()==city))
PY
python3 - <<'PY'
import csv,collections
rows=list(csv.reader(open('/tmp/vnr_clas.csv',encoding='latin-1',errors='replace')))
print('class rows',len(rows),'top classes',collections.Counter(r[1] for r in rows[1:]).most_common(15))
PY
