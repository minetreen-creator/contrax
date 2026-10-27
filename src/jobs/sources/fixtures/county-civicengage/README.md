# County/city CivicEngage board captures

Each board's bare public URL https://<host>/bids.aspx was retrieved twice on 2026-10-27
(6 s apart, the shared reader's headers) by a GitHub Actions job and written here
byte-for-byte. No query-param variants, detail pages or logins. 122 candidate sites
in VA, MD, NC, FL, GA and TX were tried; these 18 had open competitive bids.
Petersburg, VA (all Emergency / Sole Source notices) and Poquoson, VA (award
notices only) were left out. Capture counts, not coverage claims. No redactions.

VA | www.hopewellva.gov | rows=7 | parsed=7 | skipped={} | final=https://www.hopewellva.gov/bids.aspx | site=Hopewell, VA
VA | www.danville-va.gov | rows=29 | parsed=29 | skipped={} | final=https://www.danville-va.gov/bids.aspx | site=City of Danville
VA | www.salemva.gov | rows=7 | parsed=7 | skipped={} | final=https://www.salemva.gov/bids.aspx | site=Salem, VA
VA | www.pittsylvaniacountyva.gov | rows=3 | parsed=3 | skipped={} | final=https://www.pittsylvaniacountyva.gov/bids.aspx | site=Pittsylvania County, VA
VA | www.williamsburgva.gov | rows=3 | parsed=3 | skipped={} | final=https://www.williamsburgva.gov/bids.aspx | site=Williamsburg, VA
MD | www.hagerstownmd.org | rows=1 | parsed=1 | skipped={} | final=https://www.hagerstownmd.org/bids.aspx | site=Hagerstown, MD
MD | www.qac.org | rows=1 | parsed=1 | skipped={} | final=https://www.qac.org/bids.aspx | site=Queen Anne&#39;s County, MD
MD | www.collegeparkmd.gov | rows=2 | parsed=2 | skipped={} | final=https://www.collegeparkmd.gov/bids.aspx | site=City of College Park, Maryland
NC | www.highpointnc.gov | rows=4 | parsed=4 | skipped={} | final=https://www.highpointnc.gov/bids.aspx | site=High Point, NC
NC | www.pittcountync.gov | rows=2 | parsed=2 | skipped={} | final=https://www.pittcountync.gov/bids.aspx | site=Pitt County, NC
FL | www.baycountyfl.gov | rows=2 | parsed=2 | skipped={} | final=https://www.baycountyfl.gov/bids.aspx | site=Bay County, FL
FL | www.titusville.com | rows=4 | parsed=4 | skipped={} | final=https://www.titusville.com/bids.aspx | site=Titusville, FL
GA | www.hallcounty.org | rows=2 | parsed=2 | skipped={} | final=https://www.hallcounty.org/bids.aspx | site=Hall County, GA
GA | www.barrowga.org | rows=7 | parsed=7 | skipped={} | final=https://www.barrowga.org/bids.aspx | site=Barrow County, GA
TX | www.leaguecitytx.gov | rows=5 | parsed=5 | skipped={} | final=https://www.leaguecitytx.gov/bids.aspx | site=League City
TX | www.longviewtexas.gov | rows=2 | parsed=2 | skipped={} | final=https://www.longviewtexas.gov/bids.aspx | site=Longview, TX
TX | www.midlandtexas.gov | rows=6 | parsed=6 | skipped={} | final=https://www.midlandtexas.gov/bids.aspx | site=Midland, TX
TX | www.odessa-tx.gov | rows=3 | parsed=3 | skipped={} | final=https://www.odessa-tx.gov/bids.aspx | site=Odessa, TX

Arizona boards, captured 2026-10-27 by the same job pattern:
civic | www.lhcaz.gov | rows=5 | parsed=5 | skipped={} | final=https://www.lhcaz.gov/bids.aspx | site=Lake Havasu City, AZ
civic | www.casagrandeaz.gov | rows=3 | parsed=3 | skipped={} | final=https://www.casagrandeaz.gov/bids.aspx | site=Casa Grande, AZ
civic | www.douglasaz.gov | rows=6 | parsed=6 | skipped={} | final=https://www.douglasaz.gov/bids.aspx | site=Douglas, AZ

Missouri boards, captured 2026-10-27 by the same job pattern:
civic | www.springfieldmo.gov | rows=26 | parsed=26 | skipped={} | final=https://www.springfieldmo.gov/bids.aspx | site=Springfield, MO
civic | www.sccmo.org | rows=11 | parsed=11 | skipped={} | final=https://www.sccmo.org/bids.aspx | site=St Charles County, MO
civic | www.stcharlescitymo.gov | rows=8 | parsed=8 | skipped={} | final=https://www.stcharlescitymo.gov/bids.aspx | site=St. Charles, MO
civic | www.libertymissouri.gov | rows=2 | parsed=2 | skipped={} | final=https://www.libertymissouri.gov/bids.aspx | site=Liberty
civic | www.ozarkmissouri.com | rows=2 | parsed=2 | skipped={} | final=https://www.ozarkmissouri.com/bids.aspx | site=City of Ozark
civic | www.ballwin.mo.us | rows=1 | parsed=1 | skipped={} | final=https://www.ballwin.mo.us/bids.aspx | site=Ballwin, MO
Jefferson County (jeffcomo.org -> jeffcomo.gov) and Festus (-> http://www.festusmo.gov) redirected, so they were not captured.
