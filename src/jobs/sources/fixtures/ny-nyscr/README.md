# NYS Contract Reporter fixtures (`ny_nyscr`)

Verbatim HTML from the public NYS Contract Reporter search,
`GET https://www.nyscr.ny.gov/Ads/Search?Status=Open&Top=100&Skip=<n>`,
captured 2026-10-01 (gzipped), the requests `fetchNyNyscrBids` makes. No
login. The page reported "Opportunities: 798".

| File | Skip | Ads |
|---|---|---|
| `open-skip0-2026-10-01.html.gz` … `open-skip600-…` | 0–600 | 100 each |
| `open-skip700-2026-10-01.html.gz` | 700 | 98 |

md5 of the uncompressed pages:

```
09e1a2094f5b240d1f4c567b013d2f36  skip0
6f7c1d71c921620f05305a844d23ba01  skip100
880e5a06d7888004913923c948109e56  skip200
c0a6cb35beb466562b60622cb345a83e  skip300
91ddb7b60c528a23f78625e4c4498263  skip400
5694a31cc73acda4c505d67fc359643a  skip500
d00fdb5539e424b733b0369fb61383be  skip600
533be94c31cecd9f24461db98147106f  skip700
```
