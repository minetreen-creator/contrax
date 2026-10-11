# DC PASS open solicitations fixture (`dc_pass`)

Verbatim response of DC Open Data's "Solicitations from PASS" layer
(Office of Contracting and Procurement; opendata.dc.gov dataset
b8b18bf60f214460a827f8da7e28daae), captured 2026-10-11. No login.

| File | Source | Notes |
|---|---|---|
| `open-solicitations-2026-10-11.json.gz` | GET https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/19/query?where=CLOSEDATE%3ECURRENT_TIMESTAMP&outFields=*&orderByFields=OBJECT_ID&resultRecordCount=2000&f=json | 32 rows = 21 open solicitations (PASS repeats a solicitation once per commodity code) |

md5 of the uncompressed file:

```
16a29b1d19baead16adbe4fc39711614  open-solicitations-2026-10-11.json
```
