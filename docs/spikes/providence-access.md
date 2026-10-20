# Providence public-access spike

Goal: establish whether Providence's official BidNet listing exposes public bid links that can support an ingestion connector.

Run from the repository root with Node 20+:

```sh
node scripts/spikes/providence-access.mjs --file /path/to/saved-response.html
```

For a future permitted public access check, the optional `--live` flag makes exactly one ordinary HTTPS request to the Providence BidNet listing. It does not follow redirects or retry. Do not use repeated live runs, alternate networks, browser automation, proxy services, header impersonation, CAPTCHA solvers or weakened TLS to overcome an access denial.

The spike reports response status, content type, a body fingerprint, public link count and outcome. It prints no HTML, cookies or session URLs. Finding links alone does not verify dates, completeness, attachment handling or ingestion readiness.

## Findings — October 8, 2026

- The city's current-bids page was readable in the research browser and listed school renovations, electrical work, HVAC, snow services and other procurement opportunities.
- A direct request to the city page returned a ModSecurity 406 request-blocked response.
- The official alternate Providence BidNet listing returned a 403 Forbidden HTML response. The saved response was analyzed offline; the denied request was not repeated by this spike.
- The browser access attempt to BidNet was denied by automatic approval review. No browser collector, network-path workaround or production sync has been added.
- The linked Rochambeau Fire Station notice is a sale of city property and should be excluded from contract procurement ingestion.

Decision: public automated access is not established. Before registering a production source, obtain a permitted feed/API or export from the publisher. A supplied public export can be parsed and validated for a one-time import without bypassing site access controls. Do not fabricate a successful sync or register an always-failing connector.

This spike has no database credentials, no bid writes, no scheduled job and no application changes.
