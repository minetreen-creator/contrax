/** City of Omaha notices on the shared Douglas County IonWave portal.
 * Current-public board + public details, no login. County bids stay excluded.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import type { RawBid } from "./sam-gov";
import { SourceUnreachableError } from "../fetch-failure";
export const OMAHA_SOURCE = "ne_omaha_ionwave";
export const OMAHA_ORIGIN = "https://douglascountypurchasing.ionwave.net";
export const OMAHA_LIST_URL = `${OMAHA_ORIGIN}/SourcingEvents.aspx?SourceType=1`;
const fail: (s: string) => never = (s: string): never => { throw new SourceUnreachableError(OMAHA_SOURCE,[s]); };
const decode = (s: string) => s.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n));
const text = (s: string) => decode(s.replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();
export interface OmahaItem { id: string; number: string; title: string; type: string; close: string }
export function readOmahaPage(html: string): { items: OmahaItem[]; total: number; pages: number } {
  if (!html.includes("Current Bid Opportunities")) fail("missing current-bid board");
  const count = html.match(/<strong>(\d+)<\/strong>\s*items in\s*<strong>(\d+)<\/strong>\s*pages/i);
  if (!count) fail("missing bid count");
  const raw = html.match(/"_clientKeyValues":(\{.*?\}),"_controlToFocus"/s)?.[1];
  let keys: Record<string,{BidID:string}> = {};
  if(raw) { try { keys=JSON.parse(raw); } catch { fail("invalid bid identities"); } }
  const items: OmahaItem[]=[];
  for(const match of html.matchAll(/<tr class="rg(?:Alt)?Row"[^>]*id="ctl00_mainContent_rgBidList_ctl00__(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells=[...match[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m=>text(m[1]));
    const id=keys[match[1]]?.BidID;
    if(cells.length!==7 || !/^\d+$/.test(id??"") || !cells[1] || !cells[2]) fail("bid row shape changed");
    items.push({id,number:cells[1],title:cells[2],type:cells[3],close:cells[6]});
  }
  const total=+count[1], pages=+count[2];
  if((total>0 && !items.length) || items.length>total || (total>0 && !pages)) fail("incomplete bid list");
  return {items,total,pages};
}
/** CT means Central local time; round-trip IANA conversion preserves DST.
 * Ambiguous fall-back times choose the earlier instant; nonexistent times fail.
 */
export function omahaClose(value: string): string | null {
  const m=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM) \(CT\)$/);
  if(!m || +m[4]<1 || +m[4]>12) return null;
  const target={year:+m[3],month:+m[1],day:+m[2],hour:+m[4]%12+(m[7]==="PM"?12:0),minute:+m[5],second:+m[6]};
  const local=Date.UTC(target.year,target.month-1,target.day,target.hour,target.minute,target.second);
  const format=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",second:"numeric",hourCycle:"h23"});
  for(const hours of [5,6]) {
    const date=new Date(local+hours*3600000);
    const parts=Object.fromEntries(format.formatToParts(date).map(p=>[p.type,+p.value]));
    if(Object.entries(target).every(([key,v])=>parts[key]===v)) return date.toISOString();
  }
  return null;
}
const field=(html:string,name:string)=>text(html.match(new RegExp(`<span\\b[^>]*id="ctl00_mainContent_${name}"[^>]*>([\\s\\S]*?)<\\/span>`))?.[1]??"");
export function mapOmahaDetails(items: OmahaItem[], details: Map<string,string>, now=Date.now()): FetchResult {
  const rows:RawBid[]=[], skipped:Record<string,number>={}, skippedRows:{id:string;reason:string}[]=[];
  const skip=(id:string,reason:string)=>{skipped[reason]=(skipped[reason]??0)+1;skippedRows.push({id,reason});};
  const seen=new Set<string>();
  for(const item of items) {
    if(seen.has(item.id)){skip(item.id,"duplicate");continue;} seen.add(item.id);
    if(!/^CI-/.test(item.number)){skip(item.id,"outside_city_scope");continue;}
    const html=details.get(item.id);
    if(!html || !html.includes("Bid Opportunity Detail")) fail(`missing public detail ${item.id}`);
    const type=field(html,"lblType"), status=field(html,"lblStatus"), number=field(html,"lblNumber");
    if(!number.startsWith(item.number+" (") || !/^City - (?:Request for Bid|Request for Proposal)/i.test(type)) fail(`city identity/type mismatch ${item.id}`);
    if(status!=="Issued"){skip(item.id,"not_open");continue;}
    const close=field(html,"lblClose"), due=omahaClose(close);
    if(!due || close!==item.close) fail(`deadline mismatch or invalid CT time ${item.id}`);
    if(Date.parse(due)<=now){skip(item.id,"closed");continue;}
    const notes=text(html.match(/<tr\b[^>]*id="ctl00_mainContent_trNotes"[^>]*>([\s\S]*?)<\/tr>/)?.[1]??"").replace(/^Notes\s*/,"");
    const description=`${type}. ${notes} Published close: ${close} (America/Chicago). Consult the official bid and attachments for requirements and amendments.`;
    rows.push({external_id:`omahaionwave-${item.id}`,title:item.title,agency:"City of Omaha",location:"Omaha, NE",description,category:mapCategory("",item.title,description),due_date:due,source_url:`${OMAHA_ORIGIN}/PublicDetail.aspx?bidID=${item.id}&SourceType=1`,estimated_value:"",notice_type:type,solicitation_number:item.number,set_aside:null,naics_code:null,psc:null});
  }
  return {rows,skipped,skippedRows};
}
export function omahaNextPageForm(html:string): URLSearchParams {
  const params=new URLSearchParams();
  for(const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag=m[0], name=tag.match(/\bname="([^"]+)"/i)?.[1];
    if(!name || !/\btype="hidden"/i.test(tag))continue;
    params.set(decode(name),decode(tag.match(/\bvalue="([^"]*)"/i)?.[1]??""));
  }
  const next=[...html.matchAll(/<input\b[^>]*>/gi)].find(m=>/title="Next Page"/.test(m[0]));
  const name=next?.[0].match(/name="([^"]+)"/)?.[1];
  if(!name || !params.has("__VIEWSTATE") || /onclick="return false;"/.test(next![0])) fail("missing usable pagination control");
  params.set(decode(name)," ");
  return params;
}
export async function fetchOmahaBids(now=Date.now()): Promise<FetchResult> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
  const cookies=new Map<string,string>();
  const request=async(url:string,init:RequestInit={})=>{
    const response=await fetch(url,{...init,signal:controller.signal,headers:{...init.headers,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join("; ")}});
    for(const c of response.headers.getSetCookie()) {const pair=c.split(";")[0],i=pair.indexOf("=");if(i>0)cookies.set(pair.slice(0,i),pair.slice(i+1));}
    if(!response.ok)fail(`HTTP ${response.status}`);
    return response.text();
  };
  try {
    let html=await request(OMAHA_LIST_URL), page=readOmahaPage(html);
    const total=page.total,pages=page.pages,items=[...page.items];
    if(pages>30)fail("pagination safety bound exceeded");
    for(let p=1;p<pages;p++) {
      html=await request(OMAHA_LIST_URL,{method:"POST",body:omahaNextPageForm(html),headers:{"Content-Type":"application/x-www-form-urlencoded"}});
      page=readOmahaPage(html);
      if(page.total!==total || page.pages!==pages || page.items.some(i=>items.some(old=>old.id===i.id)))fail("pagination changed or repeated page");
      items.push(...page.items);
    }
    if(items.length!==total)fail(`only ${items.length} of ${total} current bids`);
    const details=new Map<string,string>();
    for(const item of items.filter(i=>/^CI-/.test(i.number))) {
      await new Promise(resolve=>setTimeout(resolve,2000));
      details.set(item.id,await request(`${OMAHA_ORIGIN}/PublicDetail.aspx?bidID=${item.id}&SourceType=1`));
    }
    const result=mapOmahaDetails(items,details,now);
    console.log(`  ${OMAHA_SOURCE}: ${result.rows.length} Omaha bids; listed ${total}; skipped ${JSON.stringify(result.skipped)}`);
    return result;
  } catch(error) {if(error instanceof SourceUnreachableError)throw error;return fail(`request failed: ${(error as Error).name}`);} finally {clearTimeout(timer);}
}
