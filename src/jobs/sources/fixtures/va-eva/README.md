# eVA fixtures (`va_eva`)

Verbatim responses from eVA's public opportunity search endpoint,
`https://mvendor.cgieva.com/Vendor/public/solrconnect.jsp`, captured on
2026-10-01 around 12:24Z with browser-like headers (the same request the public
"All Opportunities" page makes). No auth.

| File | Query | numFound | docs |
|---|---|---|---|
| `open-page1-rows25-2026-10-01.json` | `fq=status:("Open")`, `sort=pubdate desc,id desc`, `rows=25` | 582 | 25 |
| `airport-port-2026-10-01.json` | open + `agencyname:("Norfolk Airport Authority" OR "Virginia Port Authority")` | 3 | 3 |
| `non-open-sample-2026-10-01.json` | `status:("Closed" OR "Awarded" OR "Cancelled")`, `rows=5` | 222651 | 5 |

md5:

```
a6c8d2aa6151f2cd559b8f12825d0dcb  open-page1-rows25-2026-10-01.json
987d040f0596c7cbb4c4b826f5b3093b  airport-port-2026-10-01.json
1cfc2019deef70e132dcd3fa0e7be319  non-open-sample-2026-10-01.json
```
