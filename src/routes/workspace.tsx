import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";

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

async function ensureTables() {
  await sql()`CREATE TABLE IF NOT EXISTS team_members (id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('estimator','proposal_writer','accountant','project_manager')), status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','declined')), invited_at TIMESTAMPTZ DEFAULT NOW(), accepted_at TIMESTAMPTZ, UNIQUE(owner_id,email))`;
  await sql()`CREATE TABLE IF NOT EXISTS team_activity (id SERIAL PRIMARY KEY, member_email TEXT NOT NULL, action TEXT NOT NULL, bid_id INTEGER REFERENCES bids(id), details TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
}

async function ensureIntegrationsTable() {
  await sql()`CREATE TABLE IF NOT EXISTS integrations (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), provider TEXT NOT NULL CHECK (provider IN ('google_calendar','outlook_calendar','slack','teams','google_drive','onedrive')), access_token TEXT, refresh_token TEXT, status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('active','disconnected')), connected_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, provider))`;
}

async function owner() { const u = await getCurrentUser(); if (!u) throw new Error("Not authenticated"); const p = await sql()`SELECT id FROM business_profiles WHERE user_id=${u.id} LIMIT 1`; if (!p.length) throw new Error("Only the business owner can access the workspace"); return u; }

const getWorkspace = createServerFn({ method: "GET" }).handler(async () => { const u = await owner(); try { await ensureTables(); } catch { return { allowed: true, members: [], activity: [] as Activity[] }; } const members = await sql()`SELECT id,email,role,status,invited_at FROM team_members WHERE owner_id=${u.id} ORDER BY invited_at DESC`; const emails = [u.email, ...(members as any[]).map(m => m.email)]; const activity = await sql()`SELECT a.id,a.member_email,a.action,a.details,a.created_at,b.title AS bid_title FROM team_activity a LEFT JOIN bids b ON b.id=a.bid_id WHERE a.member_email = ANY(${emails}) ORDER BY a.created_at DESC LIMIT 50`; return { allowed: true, members: members as Member[], activity: activity as Activity[] }; });

const inviteMember = createServerFn({ method: "POST" }).validator((d: unknown) => d as { email: string; role: Role }).handler(async ({ data }) => { const u = await owner(); await ensureTables(); const email = data.email.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address"); if (!roles.some(r => r.key === data.role)) throw new Error("Choose a valid role"); if (email === u.email.toLowerCase()) throw new Error("You cannot invite yourself"); const rows = await sql()`INSERT INTO team_members(owner_id,email,role) VALUES(${u.id},${email},${data.role}) RETURNING id,email,role,status,invited_at`; return rows[0] as Member; });

const removeMember = createServerFn({ method: "POST" }).validator((d: unknown) => d as { email: string }).handler(async ({ data }) => { const u = await owner(); await ensureTables(); await sql()`DELETE FROM team_members WHERE owner_id=${u.id} AND email=${data.email}`; return { success: true }; });

// --- Integration server functions ---

const getIntegrations = createServerFn({ method: "GET" }).handler(async (): Promise<IntegrationsData> => {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not authenticated");
  await ensureIntegrationsTable();
  const userRows = await sql()`SELECT plan_tier FROM users WHERE id=${u.id} LIMIT 1`;
  const planTier = (userRows.length ? (userRows[0] as any).plan_tier : null) as string | null;
  const rows = await sql()`SELECT id, provider, status, connected_at FROM integrations WHERE user_id=${u.id} ORDER BY provider`;
  return { planTier, integrations: rows as Integration[] };
});

const connectIntegration = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { provider: string })
  .handler(async ({ data }) => {
    const u = await getCurrentUser();
    if (!u) throw new Error("Not authenticated");
    const userRows = await sql()`SELECT plan_tier FROM users WHERE id=${u.id} LIMIT 1`;
    const planTier = (userRows.length ? (userRows[0] as any).plan_tier : null) as string | null;
    if (planTier !== "agency") throw new Error("Agency plan required for integrations");
    if (!PROVIDERS.some(p => p.key === data.provider)) throw new Error("Unknown provider");

    const baseUrl = process.env.NODE_ENV === "production"
      ? (process.env.PUBLIC_URL || "https://pricedoctor.net")
      : "http://localhost:3000";
    const redirectUri = `${baseUrl}/api/integrations/callback?provider=${data.provider}`;
    const state = Buffer.from(JSON.stringify({ userId: u.id, provider: data.provider })).toString("base64");

    const oauthUrls: Record<string, string> = {
      google_calendar: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/calendar.events&state=${state}&access_type=offline&prompt=consent`,
      outlook_calendar: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.OUTLOOK_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=Calendars.ReadWrite&state=${state}`,
      slack: `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=chat:write,channels:read&state=${state}&user_scope=`,
      teams: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.TEAMS_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=Team.ReadBasic.All,ChannelMessage.Send&state=${state}`,
      google_drive: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_DRIVE_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/drive.file&state=${state}&access_type=offline&prompt=consent`,
      onedrive: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.ONEDRIVE_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=Files.ReadWrite&state=${state}`,
    };
    return { url: oauthUrls[data.provider] || null };
  });

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

export const Route = createFileRoute("/workspace")({ loader: () => getCurrentUser(), component: WorkspacePage });

function WorkspacePage() {
  const [data,setData]=useState<{members:Member[];activity:Activity[]}|null>(null);
  const [integrationsData, setIntegrationsData] = useState<IntegrationsData | null>(null);
  const [error,setError]=useState("");
  const [invite,setInvite]=useState<Role|null>(null);
  const [email,setEmail]=useState("");
  const [busy,setBusy]=useState(false);
  const [integrationsBusy, setIntegrationsBusy] = useState<string | null>(null);

  const load=()=>getWorkspace().then(r=>setData(r as any)).catch(e=>setError(e.message));
  const loadIntegrations = () => getIntegrations().then(r => setIntegrationsData(r)).catch(() => {});

  useEffect(()=>{load(); loadIntegrations();},[]);

  async function send(){if(!invite)return;setBusy(true);setError("");try{await inviteMember({data:{email,role:invite}});setEmail("");setInvite(null);await load()}catch(e){setError(e instanceof Error?e.message:"Invite failed")}finally{setBusy(false)}}
  async function remove(member:Member){if(!confirm(`Remove ${member.email}?`))return;await removeMember({data:{email:member.email}});load()}

  async function handleConnect(provider: string) {
    setIntegrationsBusy(provider);
    setError("");
    try {
      const result = await connectIntegration({ data: { provider } }) as any;
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
          {!data?.activity.length ? <p className="py-8 text-center text-sm text-slate-500">No activity yet. Score, save, or draft a proposal to see progress here.</p> :
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
