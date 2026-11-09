#!/usr/bin/env bash
# Read-only: learn the SAM.gov PUBLIC entity extract format. Never prints the key or any person's name.
set -u
UA="ContraxBot/1.0 (+https://www.contrax.company)"
[ -n "${SAM_API_KEY:-}" ] && echo "key present (${#SAM_API_KEY} chars)" || { echo "NO KEY"; exit 0; }
# 1) The layout file linked from the extracts API docs.
curl -sL -m 60 -A "$UA" https://open.gsa.gov/api/sam-entity-extracts-api/ -o /tmp/doc.html
curl -sL -m 60 -A "$UA" "https://open.gsa.gov/api/sam-entity-extracts-api/v1/SAM%20Master%20Extract%20Mapping%20v6.0%20Public%20File%20V2%20Layout.xlsx" -o /tmp/layout.xlsx
ls -l /tmp/layout.xlsx
pip install -q openpyxl >/dev/null 2>&1
python3 - <<'PY'
import openpyxl
wb=openpyxl.load_workbook('/tmp/layout.xlsx',read_only=True)
for ws in wb.worksheets:
    print('=== sheet',ws.title)
    for i,row in enumerate(ws.iter_rows(values_only=True)):
        vals=[str(v)[:60] for v in row if v is not None]
        if vals: print(' | '.join(vals)[:220])
        if i>400: break
PY
# 2) One extract download (counts as one API call).
curl -sL -m 900 -A "$UA" -D /tmp/h.txt -o /tmp/extract.bin \
  "https://api.sam.gov/data-services/v1/extracts?api_key=${SAM_API_KEY}&fileType=ENTITY&sensitivity=PUBLIC&frequency=MONTHLY&charset=UTF8"
grep -iE "^(HTTP|content-type|content-disposition|content-length|x-ratelimit)" /tmp/h.txt | sed -E "s/api_key=[^&]*/api_key=REDACTED/g"
ls -l /tmp/extract.bin; file /tmp/extract.bin
head -c 600 /tmp/extract.bin | tr -c '[:print:]\n' '.' ; echo
if file /tmp/extract.bin | grep -qi zip; then
  mkdir -p /tmp/x && cd /tmp/x && unzip -o -q /tmp/extract.bin && ls -l
  f=$(ls /tmp/x | head -1)
  wc -l "$f"
  head -1 "$f" | cut -c1-200
  python3 - "$f" <<'PY'
import sys,collections
f=sys.argv[1]
n=0; cnt=collections.Counter()
with open(f,encoding='utf-8',errors='replace') as fh:
    first=fh.readline()
    rows=[]
    for line in fh:
        parts=line.rstrip('\n').split('|')
        cnt[len(parts)]+=1
        if len(rows)<3 and len(parts)>50: rows.append(parts)
        n+=1
print('records',n,'field counts',cnt.most_common(3))
# Show each field index with a value shape only (digits->9, letters->A), so no names are printed.
import re
for r in rows[:2]:
    print('----')
    for i,v in enumerate(r):
        shape=re.sub(r'[A-Za-z]','A',re.sub(r'\d','9',v))[:40]
        print(i, len(v), shape)
PY
fi
