#!/usr/bin/env bash
# Read-only: print the Restricted Data Use and Privacy sections of SAM.gov's terms.
UA="ContraxBot/1.0 (+https://www.contrax.company)"
curl -sL -m 30 -A "$UA" "https://sam.gov/about/terms-of-use" -o /tmp/p.html
python3 - <<'PY'
import re,html
t=open('/tmp/p.html',encoding='utf-8',errors='ignore').read()
t=re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>',' ',t)
t=html.unescape(re.sub(r'<[^>]+>',' ',t))
t=re.sub(r'\s+',' ',t)
i=t.find('Privacy Policy', 2000)
print(len(t)); print(t[12000:30000])
PY
