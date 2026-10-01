# Cal eProcure fixture (`ca_eprocure`)

`event-inquiry-2026-10-01.html.gz` is the gzip of the verbatim HTML returned on
2026-10-01 by the public PeopleSoft "Response Bid Inquiry" component behind
https://caleprocure.ca.gov/pages/Events-BS3/event-search.aspx:

`GET https://caleprocure.ca.gov/psc/psfpd1/SUPPLIER/ERP/c/AUC_MANAGE_BIDS.AUC_RESP_INQ_AUC.GBL?Page=AUC_RESP_INQ_AUC&Action=U`

(no login; the first response is a 302 that sets session cookies, followed with
those cookies). The grid holds 354 rows, all status "Posted".

md5 of the uncompressed HTML: `1c566056024db1fa9e9ca778303b9f69` (1,114,956 bytes).
