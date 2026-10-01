# Texas ESBD fixtures (`tx_esbd`)

Responses from the public ESBD list service,
`POST https://www.txsmartbuy.gov/app/extensions/CPA/CPAMain/1.0.0/services/ESBD.Service.ss`,
captured 2026-10-01 ~15:27Z with browser-like headers and the same JSON body the
https://www.txsmartbuy.gov/esbd page sends (`{"lines":[],"page":N,"urlRoot":"esbd","status":S}`).
No auth.

Each response also carries an `agencies` array (the 411-entry buyer dropdown). It
is removed from these files to keep them small; `lines`, `page`, `recordsPerPage`
and `totalRecordsFound` are verbatim.

| File | Body | totalRecordsFound | lines |
|---|---|---|---|
| `posted-page1-2026-10-01.json` | status `1`, page 1 | 482 | 24 (Posted + Addendum Posted) |
| `addendum-page1-2026-10-01.json` | status `6`, page 1 | 134 | 24 (Addendum Posted) |
| `closed-page1-2026-10-01.json` | status `5`, page 1 | 21406 | 24 (Closed) |
| `keyword-vehicles-2026-10-01.json` | status `1`, keyword `vehicles` | 5 | 5 |
