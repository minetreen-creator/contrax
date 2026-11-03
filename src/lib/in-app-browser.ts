/**
 * In-app browsers (owner 2026-11-03: a Charlotte, NC visitor from a Facebook
 * group post reached /signup inside Facebook's in-app browser). Google refuses
 * OAuth sign-in inside embedded browsers ("Error 403: disallowed_useragent"), so
 * on these the Google button is swapped for a note pointing to email signup.
 */
const EMBEDDED_UA = /\b(FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|LinkedInApp|Snapchat|musical_ly|BytedanceWebview|TikTok|Line\/|Pinterest|Twitter for)/i;

export function isEmbeddedBrowser(userAgent: string | null | undefined): boolean {
  return EMBEDDED_UA.test(String(userAgent ?? ""));
}

/** Which app, for the note ("inside the Facebook app"). */
export function embeddedAppName(userAgent: string | null | undefined): string {
  const ua = String(userAgent ?? "");
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua)) return "Facebook";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/LinkedInApp/i.test(ua)) return "LinkedIn";
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return "TikTok";
  if (/Snapchat/i.test(ua)) return "Snapchat";
  return "this app";
}

export const IN_APP_GOOGLE_NOTE = (app: string) =>
  `Google sign-in doesn't work inside the ${app} app. Use your email below (it takes about 20 seconds), or tap ⋯ and choose "Open in browser".`;
