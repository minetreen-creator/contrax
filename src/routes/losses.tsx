import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";
import { TrialGate } from "~/components/TrialGate";
import { recordOutcomeWithValue } from "~/lib/learning";
import {
  getAutopsyAllowanceStatus,
  buildAutopsy,
  consumeAutopsyAllowance,
  isDeeperAutopsyTier,
  type AwardAutopsy,
  type AutopsyAllowanceStatus,
} from "~/lib/award-autopsy";

type Weakness = { weakness: string; severity: string; recurring?: boolean };
type Loss = { id:number; bid_title:string; agency:string; estimated_value:string; awarded_to:string; debrief_notes:string; naics_code:string; weaknesses:Weakness[]; primary_reason:string; severity:string; actionable_fix:string; recurring_count:number; created_at:string; autopsy: AwardAutopsy | null };
type Analysis = Pick<Loss,"primary_reason"|"weaknesses"|"severity"|"actionable_fix"> & { recurring:boolean; recurring_detail:string };
type Summary = { pattern:string; count:number; titles:string[] };
/** Server response for the automatic Award Autopsy run on a logged loss. */
type AutopsyResult = { status:"ok"|"gated"|"none"; autopsy:AwardAutopsy|null; allowance:AutopsyAllowanceStatus };

async function ensureTable() {
  await sql()`CREATE TABLE IF NOT EXISTS bid_losses (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_title TEXT NOT NULL, agency TEXT NOT NULL, estimated_value TEXT, awarded_to TEXT, debrief_notes TEXT, naics_code TEXT, weaknesses JSONB DEFAULT '[]'::jsonb, primary_reason TEXT, severity TEXT, actionable_fix TEXT, recurring_count INTEGER DEFAULT 0, autopsy JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`;
  for (const c of ["estimated_value TEXT", "awarded_to TEXT", "debrief_notes TEXT", "naics_code TEXT", "weaknesses JSONB DEFAULT '[]'::jsonb", "primary_reason TEXT", "severity TEXT", "actionable_fix TEXT", "recurring_count INTEGER DEFAULT 0", "autopsy JSONB"]) { try { await sql.unsafe(`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS ${c}`); } catch {} }
}
function mapLoss(r:any): Loss { const rawAutopsy = r.autopsy ?? null; return {...r, id:Number(r.id), weaknesses:Array.isArray(r.weaknesses)?r.weaknesses:[], recurring_count:Number(r.recurring_count||0), created_at:String(r.created_at), autopsy: rawAutopsy ? (typeof rawAutopsy === "string" ? JSON.parse(rawAutopsy) : rawAutopsy) as AwardAutopsy : null}; }

const getLosses = createServerFn({method:"GET"}).handler(async():Promise<{losses:Loss[]; summary:Summary[]}> => {
  const user=await getCurrentUser(); if(!user) throw new Error("Not authenticated"); await ensureTable();
  const rows=await sql()`SELECT * FROM bid_losses WHERE user_email=${user.email} ORDER BY created_at DESC`;
  const losses=(rows as any[]).map(mapLoss); const counts=new Map<string,{count:number;titles:string[]}>();
  for(const l of losses) for(const w of l.weaknesses) { const key=String(w.weakness||"").trim(); if(!key) continue; const x=counts.get(key.toLowerCase())||{count:0,titles:[]}; x.count++; if(!x.titles.includes(l.bid_title)) x.titles.push(l.bid_title); counts.set(key.toLowerCase(),x); }
  return {losses,summary:[...counts.entries()].filter(([,v])=>v.count>=2).map(([pattern,v])=>({pattern,count:v.count,titles:v.titles}))};
});

export const analyzeLoss = createServerFn({method:"POST"}).validator((d:unknown)=>d as {bidTitle:string;agency:string;estimatedValue:string;awardedTo:string;debriefNotes:string;naicsCode:string}).handler(async({data}):Promise<{loss:Loss;analysis:Analysis}>=>{
  const user=await getCurrentUser(); if(!user) throw new Error("Not authenticated"); await ensureTable();
  const past=await sql()`SELECT bid_title, agency, debrief_notes, weaknesses, primary_reason FROM bid_losses WHERE user_email=${user.email} ORDER BY created_at DESC LIMIT 25`;
  const context=(past as any[]).map(x=>({title:x.bid_title,agency:x.agency,notes:x.debrief_notes,weaknesses:x.weaknesses,reason:x.primary_reason}));
  const prompt=`You are an expert government contracting debrief analyst. Return ONLY valid JSON, no markdown. Analyze this lost bid and compare it with prior losses. JSON shape: {"primary_reason":"short explanation","weaknesses":[{"weakness":"short pattern","severity":"critical|high|medium|low","recurring":true}],"severity":"critical|high|medium|low","actionable_fix":"one concrete action","recurring":true,"recurring_detail":"which prior losses share it"}. Identify 2-5 specific shortcomings, not generic advice.\nCurrent loss: title=${data.bidTitle}; agency=${data.agency}; value=${data.estimatedValue}; winner=${data.awardedTo}; NAICS=${data.naicsCode||"not provided"}; debrief=${data.debriefNotes}\nPrior losses context: ${JSON.stringify(context)}`;
  let parsed:Analysis;
  try { const key=process.env.OPENAI_API_KEY; if(!key) throw new Error("OpenAI API key not configured"); const res=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify({model:"gpt-4o-mini",messages:[{role:"user",content:prompt}],max_tokens:900,temperature:.2})}); if(!res.ok) throw new Error(`OpenAI API error (${res.status})`); const j=await res.json() as any; const m=j.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/); if(!m) throw new Error("Could not parse AI response"); parsed=JSON.parse(m[0]);
  } catch(e) { throw new Error(`Loss analysis failed: ${e instanceof Error?e.message:"AI request failed"}`); }
  const severity=["critical","high","medium","low"].includes(parsed.severity)?parsed.severity:"medium"; const weaknesses=(Array.isArray(parsed.weaknesses)?parsed.weaknesses:[]).slice(0,5).map((w:any)=>({weakness:String(w.weakness||"Unspecified weakness"),severity:["critical","high","medium","low"].includes(w.severity)?w.severity:"medium",recurring:Boolean(w.recurring)}));
  const analysis={primary_reason:String(parsed.primary_reason||"No primary reason identified."),weaknesses,severity,actionable_fix:String(parsed.actionable_fix||"Request a detailed debrief and update your proposal checklist."),recurring:Boolean(parsed.recurring),recurring_detail:String(parsed.recurring_detail||"No matching prior loss pattern identified.")};
  const ins=await sql()`INSERT INTO bid_losses (user_email,bid_title,agency,estimated_value,awarded_to,debrief_notes,naics_code,weaknesses,primary_reason,severity,actionable_fix,recurring_count) VALUES (${user.email},${data.bidTitle},${data.agency},${data.estimatedValue||null},${data.awardedTo||null},${data.debriefNotes||null},${data.naicsCode||null},${JSON.stringify(weaknesses)}::jsonb,${analysis.primary_reason},${severity},${analysis.actionable_fix},${analysis.recurring?1:0}) RETURNING *`;
  // Feed into learning engine
  recordOutcomeWithValue(user.email, data.bidTitle, data.agency, data.naicsCode || "", data.estimatedValue || "", false, data.debriefNotes || "").catch(() => {});
  return {loss:mapLoss(ins[0]),analysis};
});
export const getWeaknessSummary=createServerFn({method:"GET"}).handler(async()=>{const x=await getLosses();return x.summary;});

/**
 * Award Autopsy (owner-ratified, Option B): runs AUTOMATICALLY for a loss the
 * user just logged, right after analyzeLoss. Looks up the REAL award on
 * USAspending via getFPDSIntel (cached), and:
 *  - ok:    found an award → persist + return the card (Basic: winner+amount+
 *           difference only; Starter+: full findings + recommendation).
 *  - gated: the user is over their monthly allowance — honest upgrade prompt,
 *           nothing looked up, nothing persisted.
 *  - none:  USAspending returned nothing real — honest fallback message; the
 *           manual loss still feeds the Learning Engine (already done in
 *           analyzeLoss via recordOutcomeWithValue).
 * A FAILED lookup does not consume allowance; the allowance is consumed only
 * for a real (found) autopsy via the atomic guarded increment.
 */
export const autopsyLoss=createServerFn({method:"POST"}).validator((d:unknown)=>d as {lossId:number}).handler(async({data}):Promise<AutopsyResult>=>{
  const user=await getCurrentUser(); if(!user) throw new Error("Not authenticated"); await ensureTable();
  const lossId=Number(data.lossId); if(!Number.isInteger(lossId)||lossId<=0) throw new Error("Invalid loss");
  const rows=await sql()`SELECT * FROM bid_losses WHERE id=${lossId} AND user_email=${user.email} LIMIT 1`;
  if(!(rows as any[]).length) throw new Error("Loss not found");
  const loss=(rows as any[])[0] as any;
  // Allowance BEFORE the (potentially slow, rate-limited) external lookup.
  const allowance=await getAutopsyAllowanceStatus(user.id, user);
  if(allowance.overLimit) return {status:"gated",autopsy:null,allowance};
  const tier=allowance.tier;
  const {autopsy}=await buildAutopsy({
    bidTitle:String(loss.bid_title||""), agency:String(loss.agency||""),
    naicsCode:String(loss.naics_code||""), estimatedValue:String(loss.estimated_value||""),
    paid:allowance.paid, deeper:isDeeperAutopsyTier(tier),
  });
  if(!autopsy.found) return {status:"none",autopsy,allowance}; // honest fallback — no consume
  const consumed=await consumeAutopsyAllowance(user.id, tier);
  if(consumed===null) {
    // Raced past the cap between the pre-check and the consume (Basic 1/mo or
    // Starter 5/mo). Still show THIS card (it was within allowance at
    // pre-check), but the honest usage line reflects the cap being reached.
    return {status:"ok",autopsy,allowance:{...allowance,used:allowance.limit??allowance.used,remaining:0,overLimit:true}};
  }
  const updated=await sql()`UPDATE bid_losses SET autopsy=${JSON.stringify(autopsy)}::jsonb WHERE id=${lossId} AND user_email=${user.email} RETURNING autopsy`;
  const fresh=mapLoss((updated as any[])[0] ?? {...loss, autopsy: JSON.parse(JSON.stringify(autopsy))});
  return {status:"ok",autopsy:fresh.autopsy,allowance:{...allowance,used:consumed,remaining:allowance.limit===null?null:Math.max(0,allowance.limit-consumed),overLimit:false}};
});

export const recordWin=createServerFn({method:"POST"}).validator((d:unknown)=>d as {bidTitle:string;agency:string;estimatedValue:string;naicsCode:string;notes:string}).handler(async({data})=>{const user=await getCurrentUser();if(!user)throw new Error("Not authenticated");await recordOutcomeWithValue(user.email,data.bidTitle,data.agency,data.naicsCode||"",data.estimatedValue||"",true,data.notes||"");return{success:true}});

export const Route=createFileRoute("/losses")({loader:async()=>{const user=await getCurrentUser(); if(!user) throw redirect({to:"/login"}); const [data,allowance]=await Promise.all([getLosses(),getAutopsyAllowanceStatus(user.id,user)]); return {...data,allowance};},component:LossesPageGated,head:()=>({meta:[{ name: "robots", content: "noindex, nofollow" },{title:"Why You Lost | Contrax"},{name:"description",content:"Learn why government bids were lost and track recurring weaknesses with AI-powered debrief analysis."}]})});

/** Trial gate: expired-trial users see an upgrade prompt instead of the page. */
function LossesPageGated() {
  return (
    <TrialGate>
      <LossesPage />
    </TrialGate>
  );
}
const sev=(s:string)=>({critical:"bg-red-100 text-red-700",high:"bg-orange-100 text-orange-700",medium:"bg-amber-100 text-amber-700",low:"bg-green-100 text-green-700"}[s]||"bg-slate-100 text-slate-600");
function Badge({value}:{value:string}){return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${sev(value)}`}>{value}</span>}
function LossesPage(){const user=Route.useLoaderData(); const [losses,setLosses]=useState(user.losses); const [summary,setSummary]=useState(user.summary); const [analysis,setAnalysis]=useState<{loss:Loss;analysis:Analysis}|null>(null); const [expanded,setExpanded]=useState<number|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [form,setForm]=useState({bidTitle:"",agency:"",estimatedValue:"",awardedTo:"",debriefNotes:"",naicsCode:""});const [formMode,setFormMode]=useState<"loss"|"win">("loss");const [winForm,setWinForm]=useState({bidTitle:"",agency:"",estimatedValue:"",naicsCode:"",notes:""});const [winBusy,setWinBusy]=useState(false);const [winMsg,setWinMsg]=useState("");const [autopsy,setAutopsy]=useState<AutopsyResult|null>(null);const [autopsyBusy,setAutopsyBusy]=useState(false);const [allowance,setAllowance]=useState<AutopsyAllowanceStatus>(user.allowance);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");setAutopsy(null);try{const r=await analyzeLoss({data:form});setAnalysis(r);setLosses([r.loss,...losses]);setSummary((await getWeaknessSummary()));setForm({bidTitle:"",agency:"",estimatedValue:"",awardedTo:"",debriefNotes:"",naicsCode:""});
  // AUTOMATIC Award Autopsy (owner vision): right after the AI loss analysis,
  // look up the real award on USAspending — no second click needed.
  try{setAutopsyBusy(true);const ar=await autopsyLoss({data:{lossId:r.loss.id}});setAutopsy(ar);setAllowance(ar.allowance);}catch{setAutopsy(null);}finally{setAutopsyBusy(false);}
 }catch(e){setError(e instanceof Error?e.message:"Analysis failed");setAutopsyBusy(false)}finally{setBusy(false)}};
 const submitWin=async(e:React.FormEvent)=>{e.preventDefault();setWinBusy(true);setWinMsg("");try{await recordWin({data:winForm});setWinMsg("Win recorded and fed into the Learning Engine!");setWinForm({bidTitle:"",agency:"",estimatedValue:"",naicsCode:"",notes:""});setTimeout(()=>setWinMsg(""),4000)}catch(e){setWinMsg(e instanceof Error?e.message:"Failed to record win")}finally{setWinBusy(false)}};
 return <div className="min-h-screen bg-slate-50"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3"><a href="/dashboard" className="flex items-center gap-2"><img src="/logo.png" alt="Contrax" className="h-8 w-auto" /></a><div className="flex items-center gap-4 text-sm"><a href="/dashboard" className="text-slate-500 hover:text-slate-900">Dashboard</a><a href="/learnings" className="text-slate-500 hover:text-slate-900">🧠 Learnings</a><span className="hidden text-slate-400 sm:inline">{user.losses.length} losses logged</span></div></div></header><main className="mx-auto max-w-5xl px-4 py-8"><div className="mb-8"><h1 className="text-3xl font-bold text-slate-900">Why You Lost</h1><p className="mt-2 text-slate-500">Turn every lost bid into a smarter next proposal.</p></div>
 {/* Tabs */}
 <div className="mb-4 flex gap-2"><button onClick={()=>setFormMode("loss")} className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${formMode==="loss"?"bg-red-100 text-red-700":"bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>📉 Log a loss</button><button onClick={()=>setFormMode("win")} className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${formMode==="win"?"bg-green-100 text-green-700":"bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>🏆 Mark as Won</button></div>
 {formMode==="loss"?<>
 <form onSubmit={submit} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-bold text-slate-900">Log a lost bid</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Bid Title" value={form.bidTitle} req onChange={v=>setForm({...form,bidTitle:v})}/><Field label="Agency" value={form.agency} req onChange={v=>setForm({...form,agency:v})}/><Field label="Estimated Value" value={form.estimatedValue} onChange={v=>setForm({...form,estimatedValue:v})}/><Field label="Awarded To" value={form.awardedTo} onChange={v=>setForm({...form,awardedTo:v})}/><Field label="NAICS Code (optional)" value={form.naicsCode} onChange={v=>setForm({...form,naicsCode:v})}/><div className="sm:col-span-2"><label className="text-sm font-medium text-slate-700">Debrief Notes</label><textarea required value={form.debriefNotes} onChange={e=>setForm({...form,debriefNotes:e.target.value})} rows={4} placeholder="Paste the agency's debrief feedback or describe what happened..." className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"/></div></div>{error&&<p className="mt-3 text-sm text-red-600">{error}</p>}<button disabled={busy} className="mt-5 rounded-xl bg-amber-500 px-5 py-2.5 font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50">{busy?"Analyzing...":"Analyze this loss →"}</button></form>
 {analysis&&<AnalysisCard result={analysis.analysis}/>}{autopsyBusy&&<div className="mt-6 rounded-2xl border border-slate-100 bg-white p-5 text-sm text-slate-500 shadow-sm sm:p-6">⚖ Looking up the real award on USAspending…</div>}{!autopsyBusy&&<AutopsyCard result={autopsy} allowance={allowance}/>}</>:<>
 <form onSubmit={submitWin} className="rounded-2xl border border-green-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-bold text-slate-900">Record a won bid</h2><p className="mt-1 text-sm text-slate-500">Recording wins helps the AI learn what works and improve future bid recommendations.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Bid Title" value={winForm.bidTitle} req onChange={v=>setWinForm({...winForm,bidTitle:v})}/><Field label="Agency" value={winForm.agency} req onChange={v=>setWinForm({...winForm,agency:v})}/><Field label="Estimated Value" value={winForm.estimatedValue} onChange={v=>setWinForm({...winForm,estimatedValue:v})}/><Field label="NAICS Code (optional)" value={winForm.naicsCode} onChange={v=>setWinForm({...winForm,naicsCode:v})}/><div className="sm:col-span-2"><label className="text-sm font-medium text-slate-700">Notes (optional)</label><textarea value={winForm.notes} onChange={e=>setWinForm({...winForm,notes:e.target.value})} rows={3} placeholder="What worked well? Any tips for future bids?" className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"/></div></div>{winMsg&&<p className="mt-3 text-sm text-green-600">{winMsg}</p>}<button disabled={winBusy} className="mt-5 rounded-xl bg-green-600 px-5 py-2.5 font-semibold text-white hover:bg-green-500 disabled:opacity-50">{winBusy?"Recording...":"Record win 🏆"}</button></form>
 </>}
 <section className="mt-10"><h2 className="mb-4 text-xl font-bold text-slate-900">Loss History</h2>{losses.length===0?<div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">No losses logged yet. Add your first lost bid above.</div>:<div className="space-y-3">{losses.map(l=><div key={l.id} className="rounded-2xl border border-slate-100 bg-white shadow-sm"><button onClick={()=>setExpanded(expanded===l.id?null:l.id)} className="flex w-full flex-col gap-2 p-4 text-left sm:flex-row sm:items-center sm:gap-5"><div className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-900">{l.bid_title}</b><span className="text-xs text-slate-500">{l.agency} · {new Date(l.created_at).toLocaleDateString()}</span></div><span className="text-sm text-slate-500">{l.primary_reason||"Analysis pending"}</span><Badge value={l.severity||"medium"}/><span className="text-slate-400">{expanded===l.id?"⌃":"⌄"}</span></button>{expanded===l.id&&<div className="border-t border-slate-100 px-4 pb-5 pt-4 text-sm"><p className="font-semibold text-slate-800">Actionable fix</p><p className="mt-1 text-slate-600">{l.actionable_fix}</p><p className="mt-4 font-semibold text-slate-800">Weaknesses</p><div className="mt-2 flex flex-wrap gap-2">{l.weaknesses.map((w,i)=><span key={i} className="rounded-full bg-purple-100 px-2.5 py-1 text-xs text-purple-700">↻ {w.weakness}</span>)}</div>{l.debrief_notes&&<><p className="mt-4 font-semibold text-slate-800">Debrief notes</p><p className="mt-1 whitespace-pre-wrap text-slate-600">{l.debrief_notes}</p></>}</div>}</div>)}</div>}</section>
 <section className="mt-10"><h2 className="mb-4 text-xl font-bold text-slate-900">Recurring Weaknesses</h2><div className="rounded-2xl border border-purple-100 bg-white p-5 shadow-sm">{summary.length===0?<p className="text-sm text-slate-500">No recurring weaknesses yet. Log your first lost bid to start tracking.</p>:<div className="space-y-4">{summary.map(s=><div key={s.pattern} className="flex flex-col gap-1 border-b border-slate-100 pb-3 last:border-0"><div className="flex items-center justify-between"><b className="text-sm text-slate-800">↻ {s.pattern}</b><span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700">{s.count} occurrences</span></div><p className="text-xs text-slate-500">Appeared in: {s.titles.join(", ")}</p></div>)}</div>}</div></section></main></div>}
function Field({label,value,onChange,req}:{label:string;value:string;onChange:(v:string)=>void;req?:boolean}){return <div><label className="text-sm font-medium text-slate-700">{label}{req&&" *"}</label><input required={req} value={value} onChange={e=>onChange(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"/></div>}
function AnalysisCard({result}:{result:Analysis}){return <div className="mt-6 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-900">AI loss analysis</h2><Badge value={result.severity}/></div><p className="mt-4 text-slate-700">{result.primary_reason}</p><h3 className="mt-5 text-sm font-semibold text-slate-800">Identified weaknesses</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{result.weaknesses.map((w,i)=><li key={i}>{w.weakness} <Badge value={w.severity}/>{w.recurring&&<span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">↻ recurring</span>}</li>)}</ul><div className="mt-5 rounded-xl bg-amber-50 p-4"><b className="text-sm text-amber-900">One action to improve</b><p className="mt-1 text-sm text-amber-800">{result.actionable_fix}</p></div>{result.recurring&&<p className="mt-4 text-sm text-purple-700">↻ <b>Recurring pattern:</b> {result.recurring_detail}</p>}</div>}

/** Money formatter for the autopsy card (whole dollars). */
function fmtMoney(n:number){return "$"+n.toLocaleString("en-US",{maximumFractionDigits:0});}

/**
 * Award Autopsy card (owner vision, 09-05): the REAL award outcome rendered
 * right after "Analyze this loss". Data is live USAspending via getFPDSIntel —
 * never invented; competition is "not disclosed" unless a source provides it.
 * Gating: Basic = winner + amount + difference only (the demo), Starter+ adds
 * the full findings + recommendation, and the honest monthly usage line.
 */
function AutopsyCard({result,allowance}:{result:AutopsyResult|null;allowance:AutopsyAllowanceStatus}){
  const usageLine = allowance.limit===null
    ? `Unlimited autopsies on your current plan${allowance.used?` — ${allowance.used} this month`:""}`
    : `${allowance.used} of ${allowance.limit} autopsy allowance used this month`;
  if(result?.status==="gated"){
    return <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm sm:p-6"><h2 className="text-lg font-bold text-slate-900">⚖ Award Autopsy</h2><p className="mt-3 text-sm text-slate-700">Your free award autopsies are used for this month — upgrade to Starter for 5/month + full loss analysis.</p><a href="/pricing" className="mt-4 inline-block rounded-xl bg-amber-500 px-5 py-2.5 font-semibold text-slate-900 hover:bg-amber-400">See plans →</a><p className="mt-3 text-xs text-slate-500">{usageLine}.</p></div>;
  }
  const a=result?.autopsy;
  if(!a){ return null; }
  if(!a.found){
    return <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-bold text-slate-900">⚖ Award Autopsy</h2><p className="mt-3 text-sm text-slate-600">{a.fallbackMessage}</p></div>;
  }
  const full=allowance.paid;
  const diff=a.difference!=null?fmtMoney(Math.abs(a.difference)):null;
  const pct=a.differencePct!=null?`${Math.abs(a.differencePct).toFixed(1)}%`:null;
  const tone=(t:"red"|"orange"|"green")=>t==="red"?"border-red-200 bg-red-50 text-red-800":t==="orange"?"border-orange-200 bg-orange-50 text-orange-800":"border-green-200 bg-green-50 text-green-800";
  return (
    <div className="mt-6 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">⚖ Award Autopsy</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Live USAspending data</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">You bid</p><p className="mt-1 text-sm font-semibold text-slate-900">{a.youBid!=null?fmtMoney(a.youBid):"Not recorded"}</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Winner</p><p className="mt-1 text-sm font-semibold text-slate-900">{a.winner}</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Winning amount</p><p className="mt-1 text-sm font-semibold text-slate-900">{a.winningAmount!=null?fmtMoney(a.winningAmount):"Not disclosed"}</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Difference</p><p className="mt-1 text-sm font-semibold text-slate-900">{diff&&pct?`${diff} / ${pct}`:diff??pct??"—"}</p></div>
        <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Incumbent</p><p className="mt-1 text-sm font-semibold text-slate-900">{a.winner}{a.incumbentRetained!=null?(a.incumbentRetained?" · Incumbent retained contract: Yes":" · Incumbent retained contract: No"):" · Incumbent retained contract: not disclosed"}</p></div>
        <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Competition</p><p className="mt-1 text-sm font-semibold text-slate-900">{a.competition!=null?`${a.competition} offers received`:"Competition: not disclosed"}</p></div>
      </div>
      {full&&a.findings.length>0&&<div className="mt-5"><h3 className="text-sm font-semibold text-slate-800">What probably hurt you</h3><div className="mt-2 space-y-2">{a.findings.map((f,i)=><div key={i} className={`rounded-xl border p-3 text-sm ${tone(f.tone)}`}>{f.emoji} {f.text}</div>)}</div></div>}
      {!full&&<div className="mt-5 rounded-xl bg-amber-50 p-4"><b className="text-sm text-amber-900">Want the full autopsy?</b><p className="mt-1 text-sm text-amber-800">Upgrade to Starter for the complete analysis — what probably hurt you, historical pricing, and a price range for similar opportunities.</p><a href="/pricing" className="mt-3 inline-block rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400">See plans →</a></div>}
      {full&&a.recommendation&&<div className="mt-5 rounded-xl bg-amber-50 p-4"><b className="text-sm text-amber-900">Contrax recommendation</b><p className="mt-1 text-sm text-amber-800">{a.recommendation}</p></div>}
      {full&&a.historicalPricing.length>0&&<div className="mt-5"><h3 className="text-sm font-semibold text-slate-800">Historical awards — this agency &amp; NAICS</h3><div className="mt-2 flex flex-wrap gap-2">{a.historicalPricing.map(h=><span key={h.fiscal_year} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">FY{h.fiscal_year}: {fmtMoney(h.total_obligated)} across {h.award_count} award{h.award_count===1?"":"s"}</span>)}</div></div>}
      <p className="mt-4 text-xs text-slate-400">{usageLine}.</p>
    </div>
  );
}
