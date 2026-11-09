#!/usr/bin/env bash
# Read-only: fetch public terms-of-use pages and print their text.
UA="ContraxBot/1.0 (+https://www.contrax.company)"
fetch() {
  echo "=================== $1"
  curl -sL -m 30 -A "$UA" "$1" -o /tmp/p.html -w "HTTP %{http_code} %{size_download}B\n"
  python3 - <<'PY'
import re,html
t=open('/tmp/p.html',encoding='utf-8',errors='ignore').read()
t=re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>',' ',t)
t=html.unescape(re.sub(r'<[^>]+>',' ',t))
t=re.sub(r'\s+',' ',t)
print(t[:12000])
PY
}
fetch "https://sam.gov/api/prod/content/v1/content?pageName=terms-of-use"
fetch "https://sam.gov/about/terms-of-use"
fetch "https://open.gsa.gov/api/entity-api/"
fetch "https://open.gsa.gov/api/sam-entity-extracts-api/"
fetch "https://catalog.data.gov/dataset/system-for-award-management-sam-public-extract-entity-registration"
fetch "https://search.certify.sba.gov/"
fetch "https://www.sba.gov/federal-contracting/contracting-guide/prime-subcontracting"
