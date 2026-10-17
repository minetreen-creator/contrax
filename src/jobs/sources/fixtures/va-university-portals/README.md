# Virginia public-university portal captures, 2026-10-17

Official discovery links:
- VT: https://www.procurement.vt.edu/supplier-resources.html links to CustomerOrg=VATech on bids.sciquest.com. The older Bonfire link in its 2024 contracts is no longer used here.
- Mason: https://fiscal.gmu.edu/purchasing/do-business-with-mason/view-current-solicitation-opportunities/ links to gmu.bonfirehub.com.
- NSU: https://vascupp.org/contracts/custodial-services-8 links to nsu.bonfirehub.com/publicContracts/172095. This is evidence of the tenant, not an open bid; only the tenant's open-project list is ingested.

Public capture URLs:
- https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=VATech
- https://gmu.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
- https://nsu.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData

Capture counts: VT 5 open, GMU 0, NSU 0. None is a current janitorial bid.
These are point-in-time source counts, not net new database rows or coverage promises.
VT HTML is gzip-compressed verbatim; the two public Bonfire responses are verbatim JSON. No redactions. Shared readers do not retain buyer contact emails in rows.
VT prints EDT/EST on deadlines; shared parsing retains those instants. Bonfire dates are UTC as established by the shared reader.

gmu-open-2026-10-17.json: SHA256 15633c14378754a41193e203d6ad19a187354f52b3e2c0df051ae5a803dfc12a
vt-open-2026-10-17.html.gz: SHA256 2a1488ccc67ee30462faeb9f97b69937deb152206869cf01a709e46cc9743e51
nsu-open-2026-10-17.json: SHA256 15633c14378754a41193e203d6ad19a187354f52b3e2c0df051ae5a803dfc12a
