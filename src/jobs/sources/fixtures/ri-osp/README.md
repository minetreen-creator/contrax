# ri_osp fixture

`open-sols-2026-10-06.json.gz`: every open solicitation on Rhode Island's Ocean State
Procures bid board (Proactis WebProcure customer 46), read 2026-10-06 through the board's
own call:

    GET https://webprocure.proactiscloud.com/wp-full-text-search/search/sols
        ?customerid=46&q=*&from=<0,10,…>&sort=od&f=ps=Open&oids=

`hits` = 81; 81 distinct records. Each record is trimmed to the fields the connector reads
(bidid, bidNumber, title, description, openDate, orgBidClassType.description,
creatorOrg.name, ownerOrg.name/timeZone). Nothing else was changed.
