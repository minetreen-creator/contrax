import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";
import { hasAgencyAccess, loadUserTrialStatus } from "~/lib/trial";
import { TrialGate } from "~/components/TrialGate";

type Role = "estimator" | "proposal_writer" | "accountant" | "project_manager";
type Member = { id: number; email: string; role: Role; status: "pending" | "active" | "declined"; invited_at: string };
type Activity = { id: number; member_email: string; action: string; details: string | null; bid_title: string | null; created_at: string };
const roles: { key: Role; label: string; icon: string }[] = [
  { key: "estimator", label: "Estimator", icon: "📊" }, { key: "proposal_writer", label: "Proposal Writer", icon: "✍️" },
  { key: "accountant", label: "Accountant", icon: "🧮" }, { key: "project_manager", label: "Project Manager", icon: "📋" },
];

// --- Integrations ---
type Integration = { id: number; provider: string; status: string; connected_at: string | null };
type IntegrationsData = { planTier: string | null; integrations: Integration[] };

const PROVIDERS: { key: string; label: string; icon: string; color: string; bg: string }[] = [
  { key: "google_calendar", label: "Google Calendar", icon: "📅", color: "#4285F4", bg: "#E8F0FE" },
  { key: "outlook_calendar", label: "Outlook Calendar", icon: "📅", color: "#0078D4", bg: "#E6F0FA" },
  { key: "slack", label: "Slack", icon: "💬", color: "#4A154B", bg: "#EDE5ED" },
  { key: "teams", label: "Microsoft Teams", icon: "👥", color: "#6264A7", bg: "#EFEFF7" },
  { key: "google_drive", label: "Google Drive", icon: "📁", color: "#0F9D58", bg: "#E6F5EE" },
  { key: "onedrive", label: "OneDrive", icon: "☁️", color: "#0078D4", bg: "#E6F0FA" },
];

async function ensureIntegrationsTable() {
  await sql()`CREATE TABLE IF NOT EXISTS integrations (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), provider TEXT NOT NULL CHECK (provider IN ('google_calendar','outlook_calendar','slack','teams','google_drive','onedrive')), access_token TEXT, refresh_token TEXT, status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('active','disconnected')), connected_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, provider))`;
}
type ApiKeyRow = { id: number; name: string; last_used_at: string | null; created_at: string; revoked: boolean };
type Entity = { id: number; business_name: string; industry: string };

async function agencyUser() {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not authenticated");
  // Agency access is granted either by plan_tier === 'agency' OR an active
  // full-access grant (per-user access_expires_at/full_access), consistent with
  // how the other plan-tier predicates (hasProfessionalAccess, etc.) and the
  // /api/integrations-connect endpoint honor grants.
  const trial = await loadUserTrialStatus(u.id);
  if (!hasAgencyAccess(trial, u)) throw new Error("Agency plan required");
  return u;
}
const getAgencyData = createServerFn({ method: "GET" }).handler(async () => {
  const u = await agencyUser();
  await sql()`CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),key_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL DEFAULT 'Default key',last_used_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),revoked BOOLEAN NOT NULL DEFAULT FALSE)`;
  const [keys, entities, profile] = await Promise.all([
    sql()`SELECT id,name,last_used_at,created_at,revoked FROM api_keys WHERE user_id=${u.id} ORDER BY created_at DESC`,
    sql()`SELECT id,business_name,industry FROM business_profiles WHERE user_id=${u.id} ORDER BY created_at`,
    sql()`SELECT active_profile_id FROM users WHERE id=${u.id}`,
  ]);
  return { keys: keys as ApiKeyRow[], entities: entities as Entity[], activeProfileId: (profile[0] as any)?.active_profile_id ?? null };
});
const createApiKey = createServerFn({ method: "POST" }).validator((d: unknown) => d as { name?: string }).handler(async ({data}) => {
  const u = await agencyUser();
  const raw = "ctx_" + crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  await sql()`INSERT INTO api_keys(user_id,key_hash,name) VALUES(${u.id},${hash},${(data.name || "API key").trim().slice(0,80) || "API key"})`;
  return { key: raw };
});
const revokeApiKey = createServerFn({ method: "POST" }).validator((d: unknown) => d as { id: number }).handler(async ({data}) => { const u = await agencyUser(); await sql()`UPDATE api_keys SET revoked=TRUE WHERE id=${data.id} AND user_id=${u.id}`; return {success:true}; });
const saveBranding = createServerFn({ method: "POST" }).validator((d: unknown) => d as { businessName: string; logoUrl: string; logoData?: string }).handler(async ({data}) => { const u=await agencyUser(); await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS logo_data TEXT`; const logoData = (data.logoData && data.logoData.length > 0) ? data.logoData.slice(0, 500000) : null; await sql()`UPDATE business_profiles SET business_name=${data.businessName.trim().slice(0,200)}, logo_url=${data.logoUrl.trim().slice(0,2000)}, logo_data=COALESCE(${logoData},logo_data), is_agency=TRUE, updated_at=NOW() WHERE user_id=${u.id} AND id=COALESCE((SELECT active_profile_id FROM users WHERE id=${u.id}), (SELECT id FROM business_profiles WHERE user_id=${u.id} ORDER BY created_at LIMIT 1))`; return {success:true}; });
const switchEntity = createServerFn({ method: "POST" }).validator((d: unknown) => d as { id: number }).handler(async ({data}) => { const u=await agencyUser(); await sql()`UPDATE users SET active_profile_id=${data.id} WHERE id=${u.id} AND EXISTS (SELECT 1 FROM business_profiles WHERE id=${data.id} AND user_id=${u.id})`; return {success:true}; });
const createEntity = createServerFn({ method: "POST" }).validator((d: unknown) => d as { businessName: string; industry: string }).handler(async ({data}) => { const u=await agencyUser(); const rows=await sql()`INSERT INTO business_profiles(user_id,business_name,industry,is_agency) VALUES(${u.id},${data.businessName.trim().slice(0,200)},${data.industry.trim().slice(0,120) || "General"},TRUE) RETURNING id`; return {id:(rows[0] as any).id}; });
const deleteEntity = createServerFn({ method: "POST" }).validator((d: unknown) => d as { id: number }).handler(async ({data}) => { const u=await agencyUser(); await sql()`DELETE FROM business_profiles WHERE id=${data.id} AND user_id=${u.id} AND (SELECT COUNT(*) FROM business_profiles WHERE user_id=${u.id}) > 1`; return {success:true}; });

const disconnectIntegration = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { provider: string })
  .handler(async ({ data }) => {
    const u = await getCurrentUser();
    if (!u) throw new Error("Not authenticated");
    await ensureIntegrationsTable();
    await sql()`DELETE FROM integrations WHERE user_id=${u.id} AND provider=${data.provider}`;
    return { success: true };
  });

// --- Helpers ---

function relative(date: string) { const mins = Math.floor((Date.now()-new Date(date).getTime())/60000); if (mins < 1) return "just now"; if (mins < 60) return `${mins} minute${mins===1?"":"s"} ago`; const hours=Math.floor(mins/60); if(hours<24)return `${hours} hour${hours===1?"":"s"} ago`; const days=Math.floor(hours/24); return days===1?"yesterday":`${days} days ago`; }
function activityText(a: Activity) { const who = a.member_email.split("@")[0]; const title = a.bid_title || "a bid"; if(a.action === "scored_bid") return `${who} scored a bid${a.details ? ` — ${a.details}` : ""} on ${title}`; if(a.action === "drafted_proposal") return `${who} drafted a proposal for ${title}`; if(a.action === "saved_bid") return `${who} saved ${a.details || "a bid"} to track`; if(a.action === "dismissed_bid") return `${who} dismissed ${title}`; return `${who} ${a.details || a.action}`; }

export const Route = createFileRoute("/workspace")({ loader: () => getCurrentUser(), head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }), component: WorkspacePageGated });

/** Trial gate: expired-trial users see an upgrade prompt instead of the page. */
function WorkspacePageGated() {
  return (
    <TrialGate>
      <WorkspacePage />
    </TrialGate>
  );
}

function WorkspacePage() {
  const [data,setData]=useState<{members:Member[];activity:Activity[]}|null>(null);
  const [integrationsData, setIntegrationsData] = useState<IntegrationsData | null>(null);
  const [error,setError]=useState("");
  const [invite,setInvite]=useState<Role|null>(null);
  const [email,setEmail]=useState("");
  const [busy,setBusy]=useState(false);
  const [integrationsBusy, setIntegrationsBusy] = useState<string | null>(null);
  const [agency, setAgency] = useState<{keys: ApiKeyRow[]; entities: Entity[]; activeProfileId: number | null} | null>(null);
  const [newKey, setNewKey] = useState("");
  const [brandName, setBrandName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoData, setLogoData] = useState("");
  const logoPreview = logoData || logoUrl || null;
  const [entityName, setEntityName] = useState("");
  const [entityIndustry, setEntityIndustry] = useState("");

  const load=()=>fetch("/api/workspace").then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||"Workspace load failed");return body}).then(r=>setData(r as any)).catch(e=>setError(e.message));
  const loadIntegrations = () => fetch("/api/integrations").then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||"Integrations load failed");return body}).then(r=>setIntegrationsData(r)).catch(() => {});

  const loadAgency = () => getAgencyData().then(r => { setAgency(r); const current = r.entities.find(e => e.id === r.activeProfileId) || r.entities[0]; if (current) setBrandName(current.business_name); }).catch(() => {});
  useEffect(()=>{load(); loadIntegrations(); loadAgency();},[]);

  async function generateKey() { try { const r = await createApiKey({data:{name:"CRM integration"}}); setNewKey(r.key); await loadAgency(); } catch(e) { setError(e instanceof Error ? e.message : "Could not create key"); } }
  async function saveBrand() { try { await saveBranding({data:{businessName:brandName,logoUrl,logoData}}); await loadAgency(); } catch(e) { setError(e instanceof Error ? e.message : "Could not save branding"); } }
  async function addEntity() { if (!entityName.trim()) return; try { await createEntity({data:{businessName:entityName,industry:entityIndustry}}); setEntityName(""); setEntityIndustry(""); await loadAgency(); } catch(e) { setError(e instanceof Error ? e.message : "Could not add entity"); } }

  async function send(){if(!invite)return;setBusy(true);setError("");try{const res=await fetch("/api/workspace-invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,role:invite})});if(!res.ok){const b=await res.json().catch(()=>null);throw new Error(b?.error||"Invite failed")}setEmail("");setInvite(null);await load()}catch(e){setError(e instanceof Error?e.message:"Invite failed")}finally{setBusy(false)}}
  async function remove(member:Member){if(!confirm(`Remove ${member.email}?`))return;try{const res=await fetch("/api/workspace-remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:member.email})});if(!res.ok){const b=await res.json().catch(()=>null);throw new Error(b?.error||"Remove failed")}load()}catch(e){setError(e instanceof Error?e.message:"Remove failed")}}

  async function handleConnect(provider: string) {
    setIntegrationsBusy(provider);
    setError("");
    try {
      const response = await fetch("/api/integrations/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Connection failed");
      if (result.url) window.location.href = result.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setIntegrationsBusy(null);
    }
  }

  async function handleDisconnect(provider: string) {
    if (!confirm(`Disconnect this integration?`)) return;
    setIntegrationsBusy(provider);
    setError("");
    try {
      await disconnectIntegration({ data: { provider } });
      await loadIntegrations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setIntegrationsBusy(null);
    }
  }

  const showIntegrations = integrationsData?.planTier === "agency";

  return <main className="min-h-screen bg-slate-50">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div>
          <a href="/dashboard" className="text-sm font-semibold text-blue-600">← Dashboard</a>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Team Workspace</h1>
          <p className="mt-1 text-slate-500">Invite collaborators and track your team&apos;s progress on every opportunity.</p>
        </div>
        <a href="/" className="font-bold text-slate-800">Contrax</a>
      </div>
    </header>

    <div className="mx-auto max-w-6xl space-y-10 px-6 py-10">
      {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {/* Team Section */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Your team</h2>
            <p className="text-sm text-slate-500">Assign roles to keep bids moving forward.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {roles.map(role => {
            const m = data?.members.find(x => x.role === role.key);
            return <div key={role.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-3xl">{role.icon}</div>
              <h3 className="mt-3 font-bold text-slate-900">{role.label}</h3>
              {m ? <div className="mt-4">
                <p className="truncate text-sm text-slate-600" title={m.email}>{m.email}</p>
                <span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${m.status==='active'?"bg-emerald-100 text-emerald-700":"bg-amber-100 text-amber-700"}`}>{m.status}</span>
                <button onClick={()=>remove(m)} className="mt-4 block text-xs font-semibold text-red-600 hover:text-red-700">Remove member</button>
              </div> : invite===role.key ? <div className="mt-4 space-y-2">
                <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@company.com" type="email" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/>
                <select value={role.key} onChange={e=>setInvite(e.target.value as Role)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">{roles.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select>
                <div className="flex gap-2">
                  <button disabled={busy} onClick={send} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">{busy?"Sending…":"Send Invite"}</button>
                  <button onClick={()=>setInvite(null)} className="text-xs text-slate-500">Cancel</button>
                </div>
              </div> : <button onClick={()=>setInvite(role.key)} className="mt-5 w-full rounded-lg border border-dashed border-blue-300 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50">+ Invite</button>}
            </div>;
          })}
        </div>
      </section>

      {/* Activity Section */}
      <section>
        <h2 className="text-xl font-bold text-slate-900">Activity</h2>
        <p className="mb-4 text-sm text-slate-500">AI-tracked progress across your bids and proposals.</p>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {!data?.activity.length ? <p className="py-8 text-center text-sm text-slate-500">No activity yet. <a href="/score" className="font-semibold text-amber-700 hover:underline">Score a bid</a>, <a href="/awards" className="font-semibold text-amber-700 hover:underline">save a bid</a>, or <a href="/copilot" className="font-semibold text-amber-700 hover:underline">draft a proposal</a> to see progress here.</p> :
          <div className="space-y-5">
            {data.activity.map(a => <div key={a.id} className="flex gap-4">
              <div className="mt-1 h-3 w-3 shrink-0 rounded-full bg-blue-500 ring-4 ring-blue-50"/>
              <div>
                <p className="text-sm font-medium text-slate-800">{activityText(a)}</p>
                <p className="mt-1 text-xs text-slate-400">{relative(a.created_at)}</p>
              </div>
            </div>)}
          </div>}
        </div>
      </section>

      {/* Agency controls */}
      {showIntegrations && agency && <>
        <section><div className="mb-4"><h2 className="text-xl font-bold text-slate-900">Branding</h2><p className="text-sm text-slate-500">White-label proposal exports with your company identity.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3"><input value={brandName} onChange={e=>setBrandName(e.target.value)} placeholder="Company name" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/><div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Logo</p><div className="flex items-center gap-3"><input type="file" accept="image/png,image/jpeg" onChange={async(e)=>{const file=e.target.files?.[0];if(!file)return;if(file.size>500000){setError("Logo must be under 500KB");return};const reader=new FileReader();reader.onload=()=>{setLogoData(reader.result as string);setLogoUrl("");};reader.readAsDataURL(file)}} className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"/><span className="text-xs text-slate-400">or</span><input value={logoUrl} onChange={e=>{setLogoUrl(e.target.value);setLogoData("");}} placeholder="Logo URL (optional)" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"/></div>{logoPreview && <img src={logoPreview} alt="Logo preview" className="mt-2 h-10 rounded border object-contain"/>}</div><button onClick={saveBrand} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Save branding</button></div></section>
        <section><div className="mb-4"><h2 className="text-xl font-bold text-slate-900">API Access</h2><p className="text-sm text-slate-500">Use Bearer keys with GET /api/v1/bids, /api/v1/bids?id=, and /api/v1/matches (60 requests/minute).</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{newKey && <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Copy this key now — it will not be shown again: <code className="font-bold">{newKey}</code></div>}<button onClick={generateKey} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Generate API key</button><div className="mt-4 space-y-2">{agency.keys.length ? agency.keys.map(k=><div key={k.id} className="flex items-center justify-between border-b py-2 text-sm"><span>{k.name} · {k.revoked ? "Revoked" : "Active"}</span>{!k.revoked && <button onClick={async()=>{await revokeApiKey({data:{id:k.id}});loadAgency()}} className="text-red-600">Revoke</button>}</div>) : <p className="text-sm text-slate-500">No API keys yet.</p>}</div></div></section>
        <section><div className="mb-4"><h2 className="text-xl font-bold text-slate-900">Entities</h2><p className="text-sm text-slate-500">Manage separate businesses under this Agency account.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="space-y-2">{agency.entities.map(e=><div key={e.id} className="flex items-center justify-between border-b py-2 text-sm"><button onClick={async()=>{await switchEntity({data:{id:e.id}});loadAgency()}} className={`font-semibold ${agency.activeProfileId===e.id?"text-blue-600":"text-slate-700"}`}>{e.business_name} ({e.industry})</button>{agency.entities.length>1 && <button onClick={async()=>{await deleteEntity({data:{id:e.id}});loadAgency()}} className="text-red-600">Delete</button>}</div>)}</div><div className="mt-4 flex gap-2"><input value={entityName} onChange={e=>setEntityName(e.target.value)} placeholder="New entity name" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"/><input value={entityIndustry} onChange={e=>setEntityIndustry(e.target.value)} placeholder="Industry" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"/><button onClick={addEntity} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">Add</button></div></div></section>
      </>}

      {/* Integrations Section — Agency only */}
      {showIntegrations && (
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-900">Integrations</h2>
            <p className="text-sm text-slate-500">Connect your tools to streamline your workflow. Available on the Agency plan.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PROVIDERS.map(provider => {
              const integration = integrationsData?.integrations.find(i => i.provider === provider.key);
              const connected = integration?.status === "active";
              const isBusy = integrationsBusy === provider.key;
              return (
                <div key={provider.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg" style={{ backgroundColor: provider.bg }}>
                      {provider.icon}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-slate-900">{provider.label}</h3>
                      <p className="text-xs text-slate-500">
                        {connected ? (
                          <span className="text-emerald-600">Connected ✓</span>
                        ) : (
                          "Not connected"
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4">
                    {connected ? (
                      <button
                        onClick={() => handleDisconnect(provider.key)}
                        disabled={isBusy}
                        className="w-full rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {isBusy ? "Disconnecting…" : "Disconnect"}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(provider.key)}
                        disabled={isBusy}
                        className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {isBusy ? "Redirecting…" : "Connect"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  </main>;
}
