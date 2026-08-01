import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "~/lib/auth";
import { checkTrial } from "~/routes/dashboard";
import { redirectToCheckout } from "~/lib/checkout";
const getStatus=createServerFn({method:"GET"}).handler(async()=>{const u=await getCurrentUser(); return u?checkTrial():null});
export const Route=createFileRoute("/upgrade")({component:Upgrade});
function Upgrade(){const status=Route.useLoaderData?.() as any; const plans=[{id:"starter",name:"Starter",price:49},{id:"professional",name:"Professional",price:149},{id:"agency",name:"Agency",price:399}]; return <div className="min-h-screen bg-slate-50 px-4 py-16"><div className="mx-auto max-w-6xl"><a href="/dashboard" className="text-sm text-slate-500">← Dashboard</a><h1 className="mt-8 text-center text-3xl font-bold text-slate-900">Keep going with Contrax</h1><p className="mt-3 text-center text-slate-600">Your trial is ending soon. Choose a plan to keep going.</p><div className="mt-10 grid gap-6 md:grid-cols-3">{plans.map(p=><div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"><h2 className="text-xl font-bold text-slate-900">{p.name}</h2><p className="mt-4 text-4xl font-extrabold text-slate-900">${p.price}<span className="text-sm font-normal text-slate-500">/mo</span></p><button onClick={()=>redirectToCheckout(p.id as any)} className="mt-8 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-800">Subscribe</button></div>)}</div></div></div>}
