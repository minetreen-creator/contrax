import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { getCurrentUser } from "~/lib/auth";

/**
 * /settings/integrations — Webhook management (Zapier-ready).
 *
 * Users create outbound webhooks (typically a Zapier "Webhooks → Catch Hook"
 * URL). When generateBidAlerts() matches a new bid to their profile, Contrax
 * POSTs a signed `bid_match` payload to every active webhook. Delivery
 * attempts are logged server-side and the latest status is shown per
 * webhook here.
 */

interface Delivery {
  id: number;
  webhook_id: number;
  event: string;
  status_code: number | null;
  attempt: number;
  success: boolean;
  error: string | null;
  created_at: string;
}

interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  last_delivery: Delivery | null;
}

interface SlackDelivery {
  id: number;
  user_id: number;
  event: string;
  status_code: number | null;
  attempt: number;
  success: boolean;
  error: string | null;
  created_at: string;
}

interface SlackConfig {
  user_id: number;
  webhook_url: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_delivery: SlackDelivery | null;
}

/** Structural subset shared by webhook + Slack deliveries (for status badges). */
type DeliveryLike = {
  success: boolean;
  status_code: number | null;
  attempt: number;
  error: string | null;
  created_at: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function maskSlackUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments[0] === "services" && segments.length >= 3) {
      const masked = segments.slice(1).map((s) => s.slice(0, 3) + "…").join("/");
      return `${u.origin}/services/${masked}`;
    }
    return u.origin + "/•••";
  } catch {
    return url.length > 40 ? url.slice(0, 37) + "…" : url;
  }
}

function DeliveryBadge({ delivery }: { delivery: DeliveryLike | null }) {
  if (!delivery) {
    return <span className="text-xs text-slate-400">No deliveries yet</span>;
  }
  if (delivery.success) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Delivered · HTTP {delivery.status_code ?? "—"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700" title={delivery.error ?? ""}>
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      Failed{delivery.status_code ? ` · HTTP ${delivery.status_code}` : ""} {delivery.attempt > 1 ? `· ${delivery.attempt} attempts` : ""}
    </span>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${checked ? "bg-green-600" : "bg-slate-300"} ${disabled ? "opacity-60" : ""}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function SettingsIntegrationsPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Create form
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<{ webhook: Webhook; secret: string } | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Per-webhook busy state for test/delete
  const [busyId, setBusyId] = useState<number | null>(null);

  // Slack connection state
  const [slackConfig, setSlackConfig] = useState<SlackConfig | null>(null);
  const [slackUrl, setSlackUrl] = useState("");
  const [slackBusy, setSlackBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/webhooks", { method: "GET" });
      if (!res.ok) throw new Error("Failed to load webhooks");
      const data = (await res.json()) as { webhooks: Webhook[] };
      setWebhooks(data.webhooks);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
    try {
      const res = await fetch("/api/slack/config", { method: "GET" });
      if (!res.ok) throw new Error("Failed to load Slack connection");
      const data = (await res.json()) as { config: SlackConfig | null };
      setSlackConfig(data.config);
    } catch {
      // Slack config is optional — don't fail the whole page over it.
    }
  }

  // Load once on mount.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create webhook");
      setWebhooks((w) => [data.webhook, ...w]);
      setJustCreated({ webhook: data.webhook as Webhook, secret: data.secret as string });
      setName("");
      setUrl("");
      setNotice("Webhook created. A test event is not sent automatically — use “Send test” below to verify it in Zapier.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create webhook");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(webhook: Webhook, next: boolean) {
    try {
      const res = await fetch("/api/webhooks/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: webhook.id, isActive: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update webhook");
      setWebhooks((ws) => ws.map((w) => (w.id === webhook.id ? data.webhook : w)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update webhook");
    }
  }

  function startEdit(webhook: Webhook) {
    setEditingId(webhook.id);
    setEditName(webhook.name);
    setEditUrl(webhook.url);
    setError("");
  }

  async function handleSaveEdit(webhook: Webhook) {
    setSavingEdit(true);
    setError("");
    try {
      const res = await fetch("/api/webhooks/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: webhook.id, name: editName, url: editUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update webhook");
      setWebhooks((ws) => ws.map((w) => (w.id === webhook.id ? data.webhook : w)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update webhook");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(webhook: Webhook) {
    if (!window.confirm(`Delete webhook "${webhook.name}"? Delivery history will be removed too.`)) return;
    setBusyId(webhook.id);
    setError("");
    try {
      const res = await fetch("/api/webhooks/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: webhook.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete webhook");
      setWebhooks((ws) => ws.filter((w) => w.id !== webhook.id));
      setNotice("Webhook deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete webhook");
    } finally {
      setBusyId(null);
    }
  }

  async function handleTest(webhook: Webhook) {
    setBusyId(webhook.id);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/webhooks/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: webhook.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to send test event");
      if (data.delivered) {
        setNotice(`Test event delivered (HTTP ${data.statusCode}). Check your Zap/CRM — the sample payload should have arrived.`);
      } else {
        setError(`Test event failed (HTTP ${data.statusCode ?? "no response"}${data.attempts > 1 ? ` after ${data.attempts} attempts` : ""}). Check that the URL is reachable and accepts POST requests.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send test event");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSlackConnect(e: FormEvent) {
    e.preventDefault();
    setSlackBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/slack/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: slackUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to connect Slack");
      setSlackConfig(data.config);
      setSlackUrl("");
      setNotice("Slack connected! Use “Send test notification” below to verify the channel.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect Slack");
    } finally {
      setSlackBusy(false);
    }
  }

  async function handleSlackToggle(next: boolean) {
    setSlackBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/slack/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update Slack alerts");
      setSlackConfig(data.config);
      setNotice(next ? "Slack alerts enabled — new bid matches will be posted to your channel." : "Slack alerts paused. Generic webhooks are unaffected.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update Slack alerts");
    } finally {
      setSlackBusy(false);
    }
  }

  async function handleSlackTest() {
    setSlackBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/slack/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to send test message");
      if (data.delivered) {
        setNotice(`Test message delivered (HTTP ${data.statusCode}). Check your Slack channel — the sample bid alert should have arrived.`);
      } else {
        setError(`Test message failed (HTTP ${data.statusCode ?? "no response"}${data.attempts > 1 ? ` after ${data.attempts} attempts` : ""}): ${data.error ?? "Slack rejected the request."}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send test message");
    } finally {
      setSlackBusy(false);
    }
  }

  async function handleSlackDisconnect() {
    if (!window.confirm("Disconnect Slack? Bid alerts will stop posting to your channel. You can reconnect any time.")) return;
    setSlackBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/slack/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to disconnect Slack");
      setSlackConfig(null);
      setSlackUrl("");
      setNotice("Slack disconnected.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect Slack");
    } finally {
      setSlackBusy(false);
    }
  }

  async function copySecret() {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.secret);
      setNotice("Secret copied to clipboard.");
    } catch {
      setNotice("Could not copy automatically — select the secret below and copy it manually.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <a href="/settings" className="font-bold text-slate-900">← Settings</a>
          <a href="/" className="text-lg font-bold text-slate-900">Contrax</a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-amber-600">Integrations</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">Integrations</h1>
          <p className="mt-2 text-slate-600">
            Send new bid matches to Slack, Zapier, your CRM, email, or anything that accepts an HTTP POST.
          </p>
        </div>

        {notice && (
          <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <span>✓ {notice}</span>
            <button onClick={() => setNotice("")} className="text-green-500 hover:text-green-800">&times;</button>
          </div>
        )}
        {error && (
          <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-800">&times;</button>
          </div>
        )}

        {/* Slack section */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#4A154B] text-lg font-bold text-white">S</div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900">Slack</h2>
              <p className="text-sm text-slate-500">
                Get bid match alerts in a Slack channel as rich, formatted messages.
              </p>
            </div>
            {slackConfig && (
              slackConfig.enabled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  Connected · paused
                </span>
              )
            )}
          </div>

          {/* How to get your webhook URL */}
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-sm font-semibold text-slate-700">How to get your Slack webhook URL</p>
            <ol className="mt-3 space-y-2.5 text-sm text-slate-600">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#4A154B] text-xs font-bold text-white">1</span>
                <span>In Slack, open <strong>Settings &amp; administration → Manage apps</strong> (or go to <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">slack.com/apps</code>), search for <strong>Incoming Webhooks</strong>, and click <strong>Add to Slack</strong>.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#4A154B] text-xs font-bold text-white">2</span>
                <span>Pick the channel that should receive bid alerts (or choose the workspace-wide default), then click <strong>Add Incoming Webhooks integration</strong>.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#4A154B] text-xs font-bold text-white">3</span>
                <span>Copy the <strong>Webhook URL</strong> at the bottom of the page (it starts with the host <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">hooks.slack.com</code>) and paste it below.</span>
              </li>
            </ol>
          </div>

          {slackConfig ? (
            <div className="mt-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Webhook URL</p>
                    <p className="mt-0.5 truncate text-sm font-medium text-slate-800" title={slackConfig.webhook_url}>
                      {maskSlackUrl(slackConfig.webhook_url)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-slate-500">Alerts</span>
                    <Toggle checked={slackConfig.enabled} onChange={(v) => handleSlackToggle(v)} disabled={slackBusy} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
                  <DeliveryBadge delivery={slackConfig.last_delivery} />
                  {slackConfig.last_delivery && (
                    <span className="text-xs text-slate-400">{formatDate(slackConfig.last_delivery.created_at)}</span>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={handleSlackTest}
                  disabled={slackBusy || !slackConfig.enabled}
                  className="rounded-lg bg-[#4A154B] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#3a103c] disabled:opacity-60"
                >
                  {slackBusy ? "Sending…" : "Send test notification"}
                </button>
                <button
                  onClick={handleSlackDisconnect}
                  disabled={slackBusy}
                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSlackConnect} className="mt-5 space-y-4">
              <div>
                <label htmlFor="slack-url" className="block text-sm font-medium text-slate-700">
                  Slack webhook URL <span className="font-normal text-slate-400">— paste your Incoming Webhook URL here</span>
                </label>
                <input
                  id="slack-url"
                  value={slackUrl}
                  onChange={(e) => setSlackUrl(e.target.value)}
                  placeholder="Paste your Slack Incoming Webhook URL here"
                  required
                  type="url"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={slackBusy}
                className="rounded-lg bg-[#4A154B] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3a103c] disabled:opacity-60"
              >
                {slackBusy ? "Connecting…" : "Connect Slack"}
              </button>
            </form>
          )}
          <p className="mt-4 text-xs text-slate-400">
            Messages are delivered as Slack Block Kit and are compact on mobile. Transient failures are retried once; every attempt is logged with its HTTP status. Slack alerts toggle independently of generic webhooks.
          </p>
        </section>

        {/* Zapier setup instructions */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Connect with Zapier in 3 steps</h2>
          <ol className="mt-4 space-y-3 text-sm text-slate-600">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">1</span>
              <span>In Zapier, create a Zap with the trigger <strong>Webhooks by Zapier → Catch Hook</strong> and click <strong>Continue</strong>.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">2</span>
              <span>Copy the webhook URL Zapier gives you, then <strong>paste that URL into the form below</strong> — this is the URL Contrax will POST to.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">3</span>
              <span>Click <strong>Send test</strong> on your new webhook — the sample <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">bid_match</code> payload arrives in Zapier instantly, so you can map fields into Slack, Google Sheets, Salesforce, email, and more.</span>
            </li>
          </ol>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <p className="font-semibold text-slate-700">What gets sent</p>
            <p className="mt-1">Every <code className="rounded bg-slate-100 px-1 py-0.5">bid_match</code> POST includes <code className="rounded bg-slate-100 px-1 py-0.5">event</code>, <code className="rounded bg-slate-100 px-1 py-0.5">bid</code> (title, agency, set_aside, location, due_date, source_url), <code className="rounded bg-slate-100 px-1 py-0.5">matched_on</code>, and <code className="rounded bg-slate-100 px-1 py-0.5">timestamp</code>. Each request is signed with your secret in the <code className="rounded bg-slate-100 px-1 py-0.5">X-Contrax-Signature</code> header (<code className="rounded bg-slate-100 px-1 py-0.5">sha256=…</code>) so your endpoint can verify it came from Contrax.</p>
          </div>
        </section>

        {/* Create form */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Add a webhook</h2>
          <form onSubmit={handleCreate} className="mt-4 space-y-4">
            <div>
              <label htmlFor="wh-name" className="block text-sm font-medium text-slate-700">Name</label>
              <input
                id="wh-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My Zapier pipeline"
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="wh-url" className="block text-sm font-medium text-slate-700">
                Webhook URL <span className="font-normal text-slate-400">— paste your Zapier Catch Hook URL here</span>
              </label>
              <input
                id="wh-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.zapier.com/hooks/catch/123/abc/"
                required
                type="url"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create webhook"}
            </button>
          </form>

          {justCreated && (
            <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-amber-900">Webhook secret (shown only once)</p>
                  <p className="mt-1 text-xs text-amber-800">
                    Save this somewhere safe. Your endpoint can verify requests with the{" "}
                    <code className="rounded bg-amber-100 px-1 py-0.5">X-Contrax-Signature</code> header, which is{" "}
                    <code className="rounded bg-amber-100 px-1 py-0.5">sha256=&lt;HMAC of the raw body&gt;</code> signed with this secret.
                    It cannot be retrieved again later.
                  </p>
                </div>
                <button onClick={copySecret} className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                  Copy
                </button>
              </div>
              <code className="mt-3 block break-all rounded-lg bg-white px-3 py-2 text-xs text-slate-800">{justCreated.secret}</code>
              <button
                onClick={() => setJustCreated(null)}
                className="mt-3 text-xs font-semibold text-amber-800 underline hover:text-amber-900"
              >
                I saved it — dismiss
              </button>
            </div>
          )}
        </section>

        {/* Webhook list */}
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Your webhooks</h2>
          {loading ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-500">
              Loading webhooks…
            </div>
          ) : webhooks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <div className="text-4xl">🔗</div>
              <h3 className="mt-4 text-xl font-semibold text-slate-900">No webhooks yet</h3>
              <p className="mx-auto mt-2 max-w-md text-slate-500">
                Create one above and we’ll start posting <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">bid_match</code> events whenever a new bid matches your profile.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {webhooks.map((webhook) => (
                <article key={webhook.id} className={`rounded-xl border bg-white p-5 shadow-sm ${webhook.is_active ? "border-slate-200" : "border-slate-200 bg-slate-50/60"}`}>
                  {editingId === webhook.id ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Name</label>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">URL</label>
                        <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} type="url" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleSaveEdit(webhook)} disabled={savingEdit} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
                          {savingEdit ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => setEditingId(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-slate-900">{webhook.name}</h3>
                            <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                              {webhook.events.join(", ")}
                            </span>
                            {!webhook.is_active && (
                              <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                                Paused
                              </span>
                            )}
                          </div>
                          <p className="mt-1 max-w-xl truncate text-xs text-slate-500" title={webhook.url}>{webhook.url}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <DeliveryBadge delivery={webhook.last_delivery} />
                            {webhook.last_delivery && (
                              <span className="text-xs text-slate-400">{formatDate(webhook.last_delivery.created_at)}</span>
                            )}
                            <span className="text-xs text-slate-400">Created {formatDate(webhook.created_at)}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-xs text-slate-500">Active</span>
                          <Toggle checked={webhook.is_active} onChange={(v) => handleToggle(webhook, v)} disabled={busyId === webhook.id} />
                        </div>
                      </div>
                      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
                        <button
                          onClick={() => handleTest(webhook)}
                          disabled={busyId === webhook.id}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
                        >
                          {busyId === webhook.id ? "Sending…" : "Send test"}
                        </button>
                        <button onClick={() => startEdit(webhook)} disabled={busyId === webhook.id} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(webhook)}
                          disabled={busyId === webhook.id}
                          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <p className="mt-8 text-xs text-slate-400">
          Payloads are delivered fire-and-log: every attempt is recorded with its HTTP status. Transient failures (5xx/timeouts) are retried once; client errors (4xx) are not.
        </p>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/settings/integrations")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return user;
  },
  head: () => ({
    meta: [
      { title: "Integrations — Contrax" },
      { name: "description", content: "Send Contrax bid matches to Slack channels and pipe them into Zapier, CRM, and email with signed webhooks." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SettingsIntegrationsPage,
});
