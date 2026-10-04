# mo-movers fixture

`open-abstracts-2026-10-04.json.gz` is the verbatim JSON response (gzipped) of

```
GET https://ewqg.fa.us8.oraclecloud.com/fscmRestApi/resources/latest/supplierNegotiationAbstracts
    ?finder=RowFinderByBU;ProcurementBUId=300000005255687
    &q=CloseDate>'2026-10-04T00:00:00'&limit=500&onlyData=true
```

captured 2026-10-04 (no login, no CAPTCHA): 76 abstracts closing after that date
(56 Active, 16 Amended, 4 Canceled). Used by `../../mo-movers.test.ts`.
