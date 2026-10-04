# ct-webprocure fixture

`open-sols-2026-10-04.json.gz` holds every record returned on 2026-10-04 by

```
GET https://webprocure.proactiscloud.com/wp-full-text-search/search/sols
    ?customerid=51&q=*&from=<0,10,…>&sort=r&f=ps%3DOpen&oids=
```

(no login, no CAPTCHA; `hits` = 171, one bid repeated across pages), trimmed to
the fields the parser reads (`creatorOrg` / `ownerOrg` reduced to name + oid).
Used by `../../ct-webprocure.test.ts`.
