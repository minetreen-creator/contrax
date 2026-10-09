import { useState } from "react";
import { STATE_NAMES } from "~/lib/contract-map";
import { TRADE_SUGGESTIONS } from "~/lib/trade-suggestions";
import { learnBusinessSearch, learnNextCourseHref } from "~/lib/learn-radar";
import { trackEvent } from "~/lib/track";

export function CourseOpportunity({courseId,initialState="",initialTrade="",nextHref,nextTitle}:{courseId:string;initialState?:string;initialTrade?:string;nextHref?:string;nextTitle?:string}) {
  const initial=learnBusinessSearch({state:initialState,trade:initialTrade});
  const [state,setState]=useState(initial.state),[trade,setTrade]=useState(initial.trade);
  const suggestionsId=`learn-trades-${courseId}`;
  return <section aria-label="Find bids for your business" className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 sm:p-6">
    <h2 className="text-xl font-bold text-slate-900">Find bids for your business</h2>
    <p className="mt-2 text-sm leading-relaxed text-slate-700">Put what you learned into practice. Choose your state and the work your business does to find current opportunities in Radar. You can search before completing the course or requesting a certificate.</p>
    <form action="/radar" method="get" onSubmit={()=>trackEvent("course_radar_clicked",courseId)} className="mt-4 space-y-4">
      <input type="hidden" name="source" value="learn"/><input type="hidden" name="course" value={courseId}/>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-slate-800">Your state
          <select name="state" value={state} onChange={e=>setState(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3">
            <option value="">All states</option>{Object.entries(STATE_NAMES).sort((a,b)=>a[1].localeCompare(b[1])).map(([code,name])=><option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-slate-800">Your trade or service
          <input name="trade" value={trade} onChange={e=>setTrade(e.target.value)} list={suggestionsId} required maxLength={120} placeholder="e.g. janitorial, trucking, HVAC" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3"/>
          <datalist id={suggestionsId}>{TRADE_SUGGESTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</datalist>
        </label>
      </div>
      <button type="submit" disabled={!trade.trim()} className="w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-50 sm:w-auto">Find matching bids →</button>
      <p className="text-xs leading-relaxed text-slate-600">Radar’s free preview has usage limits. Create a free account to save an opportunity within your free plan’s allowance. AI briefs and bid drafting are available with the relevant paid plans. These courses remain free.</p>
    </form>
    {nextHref && <p className="mt-5 border-t border-blue-200 pt-4 text-sm"><a href={learnNextCourseHref(nextHref,{state,trade})} className="font-semibold text-blue-700 underline">Continue learning: {nextTitle} →</a></p>}
  </section>;
}
