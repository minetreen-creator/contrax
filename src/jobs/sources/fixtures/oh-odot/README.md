# Ohio DOT fixtures (`oh_odot`)

Verbatim copy of ODOT Contract Administration's "Planholders Summary",
https://www.dot.state.oh.us/divisions/contractadmin/contracts/Planholders/bidlist.txt,
captured 2026-10-01 (gzipped). No login. Fixed-width text, CRLF line endings,
one line per (project, planholder); 117 distinct projects at capture time.

The file lists planholder companies with their public business phone numbers
and addresses as ODOT publishes them; the connector reads only the
project-level columns (letting date, project number, county/district, work
type) and ingests none of the company details.

md5 of the uncompressed file:

```
48b474721a6b1786338f45117e45981e  bidlist-2026-10-01.txt
```
