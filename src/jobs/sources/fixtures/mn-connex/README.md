# mn-connex fixture

`out-for-bid-2026-10-05.json.gz` is the verbatim JSON response (gzipped) of

```
QUERY https://connex.rtvision.com/api/contract/list-out-for-bid?limit=200
{"includeNullGeometry":true,"dbe":false,"sortColumn":"bidOpening"}
```

the call the public ConneX "Out for Bid Contracts" page (MnDOT State Aid
eAdvert) makes to fill its table, captured 2026-10-05 (no login, no CAPTCHA):
25 Minnesota county and city contracts. Used by `../../mn-connex.test.ts`.
