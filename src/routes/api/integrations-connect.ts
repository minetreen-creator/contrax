import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { hasAgencyAccess, loadUserTrialStatus } from "~/lib/trial";

const PROVIDERS = ["google_calendar", "outlook_calendar", "slack", "teams", "google_drive", "onedrive"];
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const u = await getUserFromRequest(request);
    if (!u) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const data = (await request.json().catch(() => null)) as { provider?: unknown } | null;
    if (!data || typeof data.provider !== "string") return Response.json({ error: "Unknown provider" }, { status: 400 });
    const provider = data.provider;
    const trial = await loadUserTrialStatus(u.id);
    if (!hasAgencyAccess(trial, u)) return Response.json({ error: "Agency plan required for integrations" }, { status: 403 });
    if (!PROVIDERS.includes(provider)) return Response.json({ error: "Unknown provider" }, { status: 400 });
    const baseUrl = process.env.NODE_ENV === "production" ? (process.env.PUBLIC_URL || "https://www.contrax.company") : "http://localhost:3000";
    const redirectUri = `${baseUrl}/api/integrations/callback?provider=${provider}`;
    const state = Buffer.from(JSON.stringify({ userId: u.id, provider })).toString("base64");
    const oauthUrls: Record<string, string> = {
      google_calendar: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/calendar.events&state=${state}&access_type=offline&prompt=consent`,
      outlook_calendar: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.OUTLOOK_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=Calendars.ReadWrite&state=${state}`,
      slack: `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=chat:write,channels:read&state=${state}&user_scope=`,
      teams: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.TEAMS_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=Team.ReadBasic.All,ChannelMessage.Send&state=${state}`,
      google_drive: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_DRIVE_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/drive.file&state=${state}&access_type=offline&prompt=consent`,
      onedrive: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.ONEDRIVE_CLIENT_ID || "PLACEHOLDER"}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=Files.ReadWrite&state=${state}`,
    };
    return Response.json({ url: oauthUrls[provider] || null });
  } catch (err) { console.error("[api/integrations-connect] error:", err); return Response.json({ error: err instanceof Error ? err.message : "Connection failed" }, { status: 500 }); }
}
export const Route = createFileRoute("/api/integrations-connect")({ server: { handlers: { POST: handler } } });
