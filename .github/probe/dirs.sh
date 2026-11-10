#!/usr/bin/env bash
# Read-only: state certification directories (FL DBE, VA SWaM, TX HUB): robots.txt, export links, terms. Stops on blocks.
UA="ContraxBot/1.0 (+https://www.contrax.company/bot)"
get() { # url outfile
  local code; code=$(curl -sL -m 45 -A "$UA" -o "$2" -w "%{http_code}" "$1"); local size=$(wc -c < "$2")
  local chall=""; grep -qiE "just a moment|cf-chl|captcha|access denied" "$2" && chall=" BLOCK?"
  echo "$code ${size}B $1 | $(grep -o '<title>[^<]*' "$2" | head -1 | cut -c8-90)$chall"
}
hint() { # file label
  echo "--- links in $2"; grep -oiE "(href|src)=\"[^\"]*(export|download|csv|xls|excel|txt|zip|api|json|directory|hub)[^\"]*\"" "$1" | sort -u | head -25
  echo "--- terms words in $2"; python3 - "$1" <<'PY'
import re,sys,html
t=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
t=html.unescape(re.sub(r'<[^>]+>',' ',re.sub(r'(?is)<(script|style).*?</\1>',' ',t))); t=re.sub(r'\s+',' ',t)
for m in re.finditer(r'.{0,160}(disclaimer|terms of use|commercial|solicit|marketing|not be used|public information|verify contact|for informational).{0,200}',t,re.I):
    print('  *',m.group(0)[:360])
PY
}
cd /tmp
echo "=== FLORIDA (FDOT UCP DBE)"
get https://fdotxwp02.dot.state.fl.us/robots.txt fl_robots.txt; head -c 400 fl_robots.txt; echo
get https://fdotxwp02.dot.state.fl.us/EqualOpportunityOfficeBusinessDirectory/ fl_home.html; hint fl_home.html fl_home
get https://fdotxwp02.dot.state.fl.us/EqualOpportunityOfficeBusinessDirectory/CustomSearch fl_search.html; hint fl_search.html fl_search
grep -oiE '<(select|input)[^>]*(name|id)="[^"]*"' fl_search.html | head -30
echo "=== VIRGINIA (SBSD SWaM/DBE)"
get https://directory.sbsd.virginia.gov/robots.txt va_robots.txt; head -c 400 va_robots.txt; echo
get https://directory.sbsd.virginia.gov/ va_home.html; hint va_home.html va_home
for js in $(grep -oE 'src="[^"]+\.js"' va_home.html | cut -d'"' -f2 | head -5); do
  u="$js"; case "$u" in http*) ;; /*) u="https://directory.sbsd.virginia.gov$u";; *) u="https://directory.sbsd.virginia.gov/$u";; esac
  get "$u" va_app.js; echo "--- api paths in $u"; grep -oE '"(/|https?://)[^"]{0,60}(api|Api|export|Export|search|Search)[^"]{0,60}"' va_app.js | sort -u | head -25
done
get https://sbsd.virginia.gov/llms.txt va_llms.txt; grep -iE "directory|export|terms" va_llms.txt | head -10
echo "=== TEXAS (Comptroller HUB)"
get https://comptroller.texas.gov/robots.txt tx_robots.txt; grep -iE "disallow|purchasing|data" tx_robots.txt | head -12
get https://comptroller.texas.gov/purchasing/vendor/hub/ tx_hub.html; hint tx_hub.html tx_hub
get https://comptroller.texas.gov/purchasing/downloads/ tx_dl.html; hint tx_dl.html tx_downloads
get https://mycpa.cpa.state.tx.us/tpasscmblsearch/ tx_cmbl.html; hint tx_cmbl.html tx_cmbl
