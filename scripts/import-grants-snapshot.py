"""Convert an official Simpler.Grants.gov CSV into the server-only snapshot."""
import csv, json, pathlib, sys, gzip, base64
fields = ['opportunity_id','opportunity_number','opportunity_title','opportunity_status','agency_code','agency_name','post_date','close_date','forecasted_close_date','updated_at','estimated_total_program_funding','award_floor','award_ceiling','applicant_types','applicant_eligibility_description','funding_categories','summary_description','url']
with open(sys.argv[1], encoding='utf-8-sig', newline='') as f:
    reader = csv.DictReader(f)
    missing = set(fields) - set(reader.fieldnames or [])
    if missing: raise ValueError(f'Missing columns: {sorted(missing)}')
    rows = [{k: row[k] for k in fields} for row in reader]
ids = [r['opportunity_id'] for r in rows]
if len(set(ids)) != len(ids) or '' in ids: raise ValueError('Missing or duplicate opportunity IDs')
for r in rows:
    if r['url'] != 'https://simpler.grants.gov/opportunity/' + r['opportunity_id']:
        raise ValueError('Unexpected opportunity URL')
output = pathlib.Path(sys.argv[3])
packed = gzip.compress(json.dumps(rows, ensure_ascii=False, separators=(',',':')).encode(), mtime=0)
output.write_text(json.dumps({'downloadedAt':sys.argv[2], 'recordCount':len(rows), 'recordsGzipBase64':base64.b64encode(packed).decode()}, separators=(',',':'))+'\n')
print(f'Imported {len(rows)} unique opportunities')
