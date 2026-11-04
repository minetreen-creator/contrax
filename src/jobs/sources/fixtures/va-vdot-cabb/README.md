# va-vdot-cabb fixtures

VDOT's public Construction Advertisement Bulletin Board list,
https://cabb.virginiadot.org/AdProjectInfoList.aspx, read on 2026-11-04 by a GitHub
Actions job running the connector itself: page 1 by GET, pages 2 and 3 by the list's
own "Next" postback. No login, no PDFs, plans or project pages. Written byte-for-byte.
54 advertised projects (20 + 20 + 14), all open at capture. The host has no robots.txt.

The same job counted (aggregates only) 105 open eVA rows posted by VDOT; nearly every
CABB ad is also on eVA as "<order>_<description>" with "Location: Various", which is
why the eVA reader now skips those copies (`isVdotCabbCopy`).
