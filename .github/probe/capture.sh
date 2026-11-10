#!/usr/bin/env bash
# Read-only: New Braunfels open solicitations on Beacon (the list the city's purchasing page links), one call as ContraxBot.
UA="Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)"
OUT=src/jobs/sources/fixtures/tx-beacon
mkdir -p "$OUT"
Q='query ListSolicitations($agencyTag: String, $status: String, $start: Int, $pageSize: Int) { solicitations(agencyTag: $agencyTag, status: $status, start: $start, pageSize: $pageSize) { total data { id title refnum dueDate type status } } }'
BODY=$(python3 -c "import json,sys;print(json.dumps({'operationName':'ListSolicitations','query':sys.argv[1],'variables':{'agencyTag':'city-of-new-braunfels','status':'open','start':0,'pageSize':100}}))" "$Q")
code=$(curl -s -m 45 -A "$UA" -H "Content-Type: application/json" -X POST -d "$BODY" -o "$OUT/new-braunfels.json" -w "%{http_code}" https://www.beaconbid.com/api/gql)
echo "HTTP $code $(wc -c < "$OUT/new-braunfels.json")B"
python3 -c "
import json
d=json.load(open('$OUT/new-braunfels.json'))
s=d.get('data',{}).get('solicitations') or {}
print('total', s.get('total'), 'errors', d.get('errors'))
for x in (s.get('data') or [])[:15]: print(' -', x.get('refnum'), '|', (x.get('title') or '')[:80], '|', x.get('dueDate'), '|', x.get('type'))
" || { cat "$OUT/new-braunfels.json" | head -c 600; rm -f "$OUT/new-braunfels.json"; }
