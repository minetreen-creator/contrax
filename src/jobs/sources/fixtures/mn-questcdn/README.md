# mn-questcdn fixture

`admin-postings-2026-10-05.json.gz` is the verbatim JSON response (gzipped) of

```
GET https://qcpi.questcdn.com/cdn/browse_posting/?search_id=&postings_since_last_login=&draw=1&start=0&length=100
```

made with the session cookie from the Minnesota Department of Administration's
public posting page
(`/cdn/posting/?projType=all&provider=6506969&group=6506969&yr=3`), the same
call that page makes to fill its table, captured 2026-10-05 (no login, no
CAPTCHA): 9 open projects. Used by `../../mn-questcdn.test.ts`.
