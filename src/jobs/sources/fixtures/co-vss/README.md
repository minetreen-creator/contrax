# Colorado VSS fixtures (`co_vss`)

Verbatim JSON response from Colorado Vendor Self Service
(https://prd.co.cgiadvantage.com/PRDVSS1X1/Advantage4), captured 2026-10-01
with the same requests `fetchCoVssBids` makes. No login:

1. GET the VSS home page and read its embedded `session_info`;
2. POST the pageOpen action for `vss.page.VVSSX10019` (Published
   Solicitations, filter "Open");
3. POST the grid's `show_lines` action with `genericParam_1: "500"`, echoing
   the step-2 response's `session_info`, `checksum` and `viewState`.

| File | Response to | Grid rows |
|---|---|---|
| `open-solicitations-2026-10-01.json` | step 3 | 56 (`rows_total` 56, no "+") |

The session ids in the file expired with the capture session.

md5:

```
02ea76ac836fee03c57ef5d83888efec  open-solicitations-2026-10-01.json
```
