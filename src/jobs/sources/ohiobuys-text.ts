import { paDate } from './pa-emarketplace-csv';
import { mapCategory } from '../../lib/trade-classification';
import type { RawBid } from './sam-gov';

/** Review a copy of the public table. Checkbox labels do not encode checked state. */
export function reviewOhioText(text: string, now = new Date()) {
  const blocks = text.replace(/\r/g, '').split(/^Edit /m).slice(1);
  const rows: RawBid[] = [], skipped: Record<string, number> = {};
  const seen = new Set<string>();
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  for (const block of blocks) {
    const fields = block.split('\n')[0].split('\t').map(s => s.trim());
    const [ , id, title, , , end, , commodity] = fields;
    const status = block.match(/(?:^|[\t\n])(Open for Bidding|Under Evaluation|Cancelled|Closed)(?=[\t\n]|$)/m);
    const type = block.match(/(?:^|\n)(Quick Quote|Request for Quote \(RFQ\)|Invitation To Bid \(ITB\)|Request For Proposal \(RFP\) \(Double Envelope\))\s*(?:\n|$)/m)?.[1];
    const due = paDate(end ?? '');
    if (!id?.match(/^SRC\d+$/) || !title || !status || fields.length < 8) { skip('malformed'); continue; }
    if (status[1] !== 'Open for Bidding') { skip('not_open'); continue; }
    if (!type) { skip('non_bid_or_qualification'); continue; }
    if (!due.iso) { skip(due.reason ?? 'invalid_date'); continue; }
    if (new Date(due.iso) <= now) { skip('expired'); continue; }
    if (seen.has(id)) { skip('duplicate'); continue; }
    const marker = block.indexOf('MBE Set Aside');
    const statusPosition = status.index! + status[0].indexOf(status[1]);
    const agency = block.slice(marker + 'MBE Set Aside'.length, statusPosition).trim().replace(/\s+/g, ' ');
    if (marker < 0 || !agency) { skip('missing_agency'); continue; }
    seen.add(id);
    rows.push({external_id:`ohiobuys:${id}`, solicitation_number:id, title, agency,
      description:`${title}. Commodity: ${commodity}. Solicitation type: ${type}.`,
      location:'Ohio', category:mapCategory('',title,commodity), due_date:due.iso,
      estimated_value:'',
      source_url:'https://ohiobuys.ohio.gov/page.aspx/en/rfp/request_browse_public',
      source_label:'ohiobuys', notice_type:type});
  }
  return {fetched:blocks.length, rows, skipped};
}
