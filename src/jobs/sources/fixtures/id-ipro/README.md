# id-ipro fixture

`open-events-2026-10-06.json.gz` is the verbatim JSON response (gzipped) of

```
GET https://sms-idaho-prd.tam.inforgov.com/fsm/SupplyManagementSupplier/list/SourcingEvent.HomeEvents?pageop=load&pagesize=200&pagepanel=XiSupplyManagementSupplierPage.Main.OpenEvents&csk.SupplierGroup=LUMA
```

made with the cookies from the public IPRO supplier home page, which is the same
call that page's "Browse Open Events" panel makes. Captured 2026-10-06 with no
login and no CAPTCHA: 15 open events. Used by `../../id-ipro.test.ts`.
