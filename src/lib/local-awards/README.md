County names and FIPS codes: Census Bureau 2025 Gazetteer county file. Retrieved 2026-10-17.

Source: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip

ZIP SHA-256: 4c90d0f805779923b5958ab13d0c1e9b99fe4932b786bfcf75dd739bb2dcb4ea

Generated counties.json preserves the Census NAME (including Virginia independent cities), USPS and GEOID fields. No ZIP-to-county inference is used.

## Calculation and validation

The widget uses county-level **place of performance**, not recipient headquarters. Contract types A/B/C/D only. Each action is included once as returned by the transaction search API, preserving negative and zero actions. Award IDs are used for *grouping*, never to discard amendments. Unique recipients are counted by nonempty UEI; missing UEIs remain in dollar totals but not recipient counts.

Every completed fetch is independently reconciled to the paginated NAICS category endpoint with `spending_level: transactions` and identical filters. Any mismatch larger than category rounding (half a cent per NAICS category, since USAspending rounds each category's sum to the cent; at least 1 cent) or any pagination/timeout failure prevents publication of replacement data. Dollars are accumulated as integer cents. Source record totals can be lifetime amounts; displayed award rankings aggregate actions *inside the selected county and date window*.

Live captures from 2026-10-17 use 2025-10-17 through 2026-10-16 inclusive:

| FIPS | Place | Actions | Negative actions | Distinct UEIs | Net obligations | Reconciliation delta |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 51570 | Colonial Heights city | 35 | 2 | 1 | $15,675,952.37 | $0.00 |
| 51760 | Richmond city | 1,417 | 123 | 274 | $303,930,564.15 | $0.00 |
| 51730 | Petersburg city | 46 | 9 | 22 | $18,924,380.29 | $0.00 |

Verbatim transaction/category responses and exact filters are in fixtures/*.json.gz. These are live API cross-checks against the endpoints used by Advanced Search, not a claim that the visual Advanced Search UI was manually operated. See the top three aggregated award IDs in each captured summary for independent record checks.

Cold reads have a 45-second budget and never return partial figures. A scheduled GitHub worker refreshes up to 20 requested counties hourly, with snapshots refreshed after 20 hours, and seeds the three validation cities on first production push. A failed refresh can serve a dated prior snapshot for up to seven days; without one the UI says figures are being prepared/unavailable, never zero. Large counties exceeding the 50,000-action safety cap are unavailable in this first version. No ZIP inference is shipped.

All nine leading award identities were also retrieved from `/api/v2/awards/{generated_unique_award_id}/`; their recipient names and generated IDs match. Captured identity/lifetime-value checks are in fixtures/award-spotchecks.json. For example, Richmond's leading Phlow contract has a $696,665,953.98 lifetime obligation but only $105,274,409.10 of obligations in the selected window and county. The widget uses the latter.
