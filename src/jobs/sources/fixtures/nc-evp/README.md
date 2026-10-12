# North Carolina eVP open solicitations fixture (`nc_evp`)

The public list behind https://evp.nc.gov/solicitations/, captured 2026-10-11
with the page's own "Solicitation Status = Open" filter (`metaFilter: "3=0"`,
pageSize 500). No login.

| File | Source | Notes |
|---|---|---|
| `open-solicitations-2026-10-11.json.gz` | POST https://evp.nc.gov/_services/entity-grid-data.json/863ea987-6d3e-ed11-9daf-001dd805ec0b | 260 open listings |

The live response is ~10 MB because every attribute carries its full metadata.
The fixture keeps the same shape (`MoreRecords`, `ItemCount`, `Records[].Id`,
`Records[].Attributes[]` with `Name` / `Value` / `FormattedValue`) but only the
attributes the reader uses: `statuscode`, `evp_opendate`, `owningbusinessunit`
(`Id`, `Name`), `evp_posteddate`, `evp_solicitationid`, `evp_name`,
`evp_solicitationnbr`, `evp_description`. Values are unchanged.
