import { mapCategory } from "~/lib/trade-classification";
import { SourceUnreachableError } from "../fetch-failure";
import type { FetchResult } from "../runner";
import type { RawBid } from "./sam-gov";

export const BOSTON_URL = "https://www.boston.gov/bid-listings";
const SOURCE = "ma_boston";
function fail(detail: string): never { throw new SourceUnreachableError(SOURCE, [detail]); }
function text(html: string) {
  return html.replace(/<[^>]*>/g," ").replace(/&(?:amp|nbsp|quot|apos|lt|gt);/g,x=>({"&amp;":"&","&nbsp;":" ","&quot;":'"',"&apos;":"'","&lt;":"<","&gt;":">"}[x]!))
    .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>String.fromCodePoint(v[0].toLowerCase()==="x"?parseInt(v.slice(1),16):Number(v))).replace(/\s+/g," ").trim();
}
/** Boston's published closing time is local America/New_York, not fixed EST. */
export function bostonDeadline(value: string): string | null {
  const m=value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2})(am|pm)$/i);
  if(!m || +m[4]<1 || +m[4]>12 || +m[5]>59) return null;
  const target={year:+m[3],month:+m[1],day:+m[2],hour:+m[4]%12+(m[6].toLowerCase()==="pm"?12:0),minute:+m[5]};
  const local=Date.UTC(target.year,target.month-1,target.day,target.hour,target.minute);
  const fmt=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",hourCycle:"h23"});
  const matches=[4,5].map(offset=>new Date(local+offset*3600000)).filter(d=>{
    const parts=Object.fromEntries(fmt.formatToParts(d).map(p=>[p.type,Number(p.value)]));
    return Object.entries(target).every(([k,v])=>parts[k]===v);
  });
  return matches.length===1 ? matches[0].toISOString() : null;
}

export function parseBostonPage(html: string, page: number, now=Date.now()): FetchResult & { next: number | null } {
  if(!/<h1[^>]*>\s*Bids and RFPs\s*<\/h1>/i.test(html)) fail("public board heading missing");
  const pager=html.match(/<nav\b[^>]*class="pager"[^>]*>[\s\S]*?<\/nav>/i)?.[0] ?? "";
  const current=pager.match(/<li[^>]*class="[^"]*is-active[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i)?.[1];
  if((pager || page>0) && (!current || Number(new URL(current,BOSTON_URL).searchParams.get("page"))!==page)) fail("pagination page mismatch");
  const nextTag=[...pager.matchAll(/<a\b[^>]*>/gi)].find(m=>/rel="next"/.test(m[0]))?.[0];
  const nextUrl=nextTag?.match(/href="([^"]+)"/)?.[1];
  const next=nextUrl ? Number(new URL(text(nextUrl),BOSTON_URL).searchParams.get("page")) : null;
  if(next!==null && (!Number.isInteger(next) || next!==page+1)) fail("invalid next page");
  const blocks=html.split(/<div class="views-row">/).slice(1);
  if(!blocks.length && !/class="views-empty"[\s\S]*?no (?:open |current )?(?:bids|results|rfps)/i.test(html)) fail("missing bids or explicit empty-board message");
  const rows:RawBid[]=[],skipped:Record<string,number>={},skippedRows:{id:string;reason:string}[]=[];
  for(const block of blocks) {
    const titleLink=block.match(/<div class="n-li-t"><a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if(!titleLink) fail("bid title/link shape changed");
    const url=new URL(text(titleLink[1]),BOSTON_URL);
    if(url.origin!==new URL(BOSTON_URL).origin || !/^\/bid-listings\/[a-z0-9-]+$/.test(url.pathname)) fail("unexpected bid link");
    const title=text(titleLink[2]); if(!title) fail("empty title");
    const printed=text(block.match(/<span class="dl-t">Due:<\/span>\s*<span class="dl-d">([^<]+)<\/span>/i)?.[1] ?? "");
    const due=bostonDeadline(printed); if(!due) fail(`invalid closing time on ${url.pathname}`);
    const id=`boston-${url.pathname.split("/").pop()}`;
    if(Date.parse(due)<=now) {skipped.closed=(skipped.closed??0)+1;skippedRows.push({id,reason:"closed"});continue;}
    const number=text(block.match(/field-name-field-event-project-number[\s\S]*?<div>\s*([^<]+)/)?.[1] ?? "");
    const department=text(block.match(/class="di-tt">\s*<img[^>]*alt="([^"]+)"/)?.[1] ?? "");
    const description=`City of Boston public bid notice${department?` — ${department}`:""}. Closing: ${printed} Boston local time (America/New_York). See the official notice for full scope, documents, submission instructions and amendments; Supplier Portal registration may be required for electronic bids.`;
    rows.push({external_id:id,title,agency:"City of Boston",description,location:"Boston, MA",category:mapCategory("",title,description),due_date:due,estimated_value:"",source_url:url.href,solicitation_number:number || null,notice_type:null,set_aside:null,naics_code:null,psc:null});
  }
  return {rows,skipped,skippedRows,next};
}

export async function fetchBostonBids(now=Date.now(), fetchPage: typeof fetch=fetch): Promise<FetchResult> {
  const result:FetchResult={rows:[],skipped:{},skippedRows:[]};const seen=new Set<string>();
  let page:number|null=0;
  try {
    while(page!==null) {
      if(page>=20) fail("pagination exceeded 20 pages; refusing partial success");
      const response=await fetchPage(page===0?BOSTON_URL:`${BOSTON_URL}?page=${page}`,{signal:AbortSignal.timeout(30000)});
      if(!response.ok) fail(`HTTP ${response.status} on page ${page}`);
      const parsed=parseBostonPage(await response.text(),page,now);
      for(const row of parsed.rows) {
        if(seen.has(row.external_id)) {result.skipped.duplicate=(result.skipped.duplicate??0)+1;result.skippedRows.push({id:row.external_id,reason:"duplicate"});}
        else {seen.add(row.external_id);result.rows.push(row);}
      }
      for(const [reason,count] of Object.entries(parsed.skipped)) result.skipped[reason]=(result.skipped[reason]??0)+count;
      result.skippedRows.push(...parsed.skippedRows);page=parsed.next;
    }
    console.log(`  ${SOURCE}: ${result.rows.length} open public-board notices; ${JSON.stringify(result.skipped)}`);
    return result;
  } catch(error) {if(error instanceof SourceUnreachableError) throw error;return fail(`fetch/parse failed: ${(error as Error).message}`);}
}
