# County Bonfire board captures

Each tenant's public endpoint
https://<tenant>.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
was retrieved twice on 2026-10-27 by a GitHub Actions job (6 s apart, the shared reader's
headers) and written here byte-for-byte. Both fetches matched for every tenant.
The portal page title was read to confirm the buyer. No login, detail pages or documents.
These are capture counts, not standing coverage claims. No redactions.

harriscountytx | title=Portal — Open Opportunities - Harris County | open=34 | same=true | sha=6e612097c0895bc1
hillsboroughcounty | title=Portal — Open Opportunities - Hillsborough County | open=20 | same=true | sha=6983602b2bdedb14
forsythco | title=Portal — Open Opportunities - Forsyth County, GA | open=8 | same=true | sha=258db7e6859be258
columbiacountyga | title=Portal — Open Opportunities - Columbia County, Georgia | open=5 | same=true | sha=406ae6456d6c304a
monroecounty-fl | title=Portal — Open Opportunities - Monroe County, FL | open=6 | same=true | sha=163bf7b911baefef
mcgtn | title=Portal — Open Opportunities - Montgomery County, TN | open=2 | same=true | sha=a1793908e3770ebe
co-hood-tx | title=Portal — Open Opportunities - Hood County | open=1 | same=true | sha=e0a14699abfe1ebf
parkercountytx | title=Portal — Open Opportunities - Parker County, Texas | open=2 | same=true | sha=266f1d0c475828d4
cityofalpharetta | title=Portal — Open Opportunities - City of Alpharetta, Georgia | open=2 | same=true | sha=537a78e1b3fbc283
dentoncounty | title=Portal — Open Opportunities - Denton County | open=3 | same=true | sha=1ef666e5732633fa

Arizona boards, captured 2026-10-27 by the same job pattern (owner: "we need arizona sources"):
bonfire | yumaaz | title=Portal — Open Opportunities - City of Yuma, AZ | open=4 | same=true
bonfire | buckeyeaz | title=Portal — Open Opportunities - City of Buckeye | open=1 | same=true
bonfire | maricopa | title=Portal — Open Opportunities - Maricopa County Community Colleges | open=5 | same=true
bonfire | prescottvalleyaz | title=Portal — Open Opportunities - Prescott Valley, AZ | open=2 | same=true
bonfire | peoriaaz | title=Portal — Open Opportunities - City of Peoria, AZ | open=2 | same=true
bonfire | scottsdaleaz | title=Portal — Open Opportunities - City of Scottsdale, AZ | open=5 | same=true
bonfire | goodyearaz | title=Portal — Open Opportunities - City of Goodyear | open=1 | same=true
bonfire | pinalcountyaz | title=Portal — Open Opportunities - Pinal County | open=0 | same=true
bonfire | sedonaaz | title=Portal — Open Opportunities - City of Sedona | open=0 | same=true
pinalcountyaz and sedonaaz had no open projects, so no capture file is kept for them.

Missouri boards, captured 2026-10-27 by the same job pattern (owner: "what do we have for MO?"):
bonfire | kcmo | title=Portal — Open Opportunities - Kansas City, MO | open=7 | same=true
bonfire | stlouiscountymo | title=Portal — Open Opportunities - St. Louis County | open=9 | same=true
bonfire | jacksongov | title=Portal — Open Opportunities - Jackson County | open=12 | same=true
bonfire | jeffersoncitymo | title=Portal — Open Opportunities - Jefferson City, MO | open=5 | same=true
bonfire | slps | title=Portal — Open Opportunities - Saint Louis Public Schools | open=0 | same=true
slps had no open projects, so no capture file is kept for it.

## Port Authority of NY & NJ, 2026-10-28

`panynj/`: the public open-opportunities list at
https://panynj.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData,
retrieved twice 6 s apart by a GitHub Actions job and written byte-for-byte.
89 open projects; 3 are not competitions (an information-only page, a notice of
intent to release an RFP, and a development lease offering) and are skipped.
Read by src/jobs/sources/nj-panynj-bonfire.ts, which places each row by the
facility its title names.

More boards, captured 2026-10-30 by the same job pattern (owner: "we need those bonfire counties", "what about SC").
Open projects per tenant; both fetches matched for every tenant. Tenants with 0 open are scheduled with no file.
harfordcountymd 5, mdstad 1, bouldercounty 11, akronohio 6, cincinnati-oh 6, westerville 3, galvestoncountytx 4,
cityoflewisville 3, cochise 5, bannockcounty 1, bernco 1, rocklandgov 6, alleghenycountydhs 1, cobbk12 14,
fairfaxcountyeda 1, charlestoncounty 2; lubbock, reevescounty, cityofhutchins, meridiancity, muskegoncounty and
solanocounty had 0 open. No other South Carolina county guess (Richland, Greenville, Horry, Spartanburg, Berkeley,
Dorchester, Lexington, York, Beaufort, Anderson, Columbia, North Charleston, Rock Hill) is a Bonfire tenant.

North Carolina, Georgia and West Virginia, captured 2026-10-30 (owner: "and NC", "and GA", "then WVA").
About 120 likely tenant names were tried; these are real tenants: wake 1, charlottenc 29, chathamcountyga 12,
floydcountyga 2, roswellgov 3, marshall (Marshall University) 1; pauldingk12 had 0 open. Both fetches matched.

Florida, captured 2026-10-30 (owner: "Yes" to a Florida board hunt). About 130 likely tenant names were tried;
real tenants: pascocountyfl 4, indianriver 1, talgov 6, fau 1, ucf 2, leeschools 1; sunrisefl, plantation,
duvalschools, fgcu and jaxport had 0 open. Both fetches matched.

Indiana, captured 2026-10-30 (owner: "sure" to an Indiana board hunt). About 100 likely tenant names were tried;
real tenants: indygo (IndyGo, Indianapolis' transit agency) 4 open; fwcs (Fort Wayne Community Schools) 0 open.
