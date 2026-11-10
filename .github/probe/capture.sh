#!/usr/bin/env bash
# Read-only capture of two Texas city bid portals as ContraxBot. Stops on bot challenges (403/429/"Just a moment").
UA="ContraxBot/1.0 (+https://www.contrax.company/bot)"
OUT=src/jobs/sources/fixtures/tx-cities
mkdir -p "$OUT"
fetch() { # name url
  local name="$1" url="$2"
  local code
  code=$(curl -sL -m 45 -A "$UA" -H "Accept: text/html,application/json;q=0.9,*/*;q=0.8" -o "$OUT/$name" -w "%{http_code}" "$url")
  local size=$(wc -c < "$OUT/$name")
  local title=$(grep -o "<title>[^<]*" "$OUT/$name" | head -1 | cut -c8-90)
  local chall=""; grep -qiE "just a moment|cf-chl|challenge-platform|captcha" "$OUT/$name" && chall=" CHALLENGE"
  echo "$code ${size}B $name $url | $title$chall"
  if [ "$code" != "200" ] || [ -n "$chall" ]; then rm -f "$OUT/$name"; fi
}
# Laredo: Cit-E-Bid and the city's purchasing pages
fetch laredo-purchasing.html "https://www.cityoflaredo.com/departments/purchasing"
fetch laredo-purchasing2.html "https://www.cityoflaredo.com/government/departments/purchasing"
fetch laredo-citebid.html "https://www.citebid.com/laredo"
fetch laredo-citebid2.html "https://laredo.citebid.com/"
fetch laredo-citebid3.html "https://www.cit-e-bid.com/laredo"
fetch laredo-home.html "https://www.cityoflaredo.com/"
# New Braunfels: Workday Spend public portal (SPA) and the city's purchasing page
fetch nb-purchasing.html "https://newbraunfels.gov/531/Purchasing"
fetch nb-workday.html "https://city-of-new-braunfels.public-portal.us.workdayspend.com/"
fetch nb-workday-api.json "https://city-of-new-braunfels.public-portal.us.workdayspend.com/api/public/v1/events?page=1"
fetch nb-workday-api2.json "https://city-of-new-braunfels.public-portal.us.workdayspend.com/api/events?status=open"
# Links found on the purchasing pages that point at bid systems
for f in "$OUT"/laredo-*.html "$OUT"/nb-purchasing.html; do
  [ -f "$f" ] || continue
  echo "== links in $(basename "$f")"
  grep -oiE 'href="[^"]*(bid|solicit|procure|purchas|citebid|workday|rfp|rfq)[^"]*"' "$f" | sort -u | head -25
done
# Script/API hints inside the Workday SPA shell
if [ -f "$OUT/nb-workday.html" ]; then
  echo "== workday shell hints"
  grep -oE '(src|href)="[^"]+\.js[^"]*"' "$OUT/nb-workday.html" | head -10
  grep -oE '"/api[^"]{0,80}"' "$OUT/nb-workday.html" | sort -u | head -20
fi
ls -l "$OUT"
