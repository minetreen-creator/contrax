import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { BID_PACK_FILE_NAME, BID_PACK_SESSION_RE } from "~/lib/bid-pack";
import { bidPackPaidForSession } from "~/lib/bid-pack.server";

/** GET ?session=cs_… → the buyer's ZIP. Only a paid Stripe session for this product opens it. */
async function handler({ request }: { request: Request }) {
  const session = new URL(request.url).searchParams.get("session") ?? "";
  if (!BID_PACK_SESSION_RE.test(session)) return new Response("This download link is not valid.", { status: 400 });
  const ip = await checkIpLimit(request, "bid_pack_download_ip", 30, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  if (!(await bidPackPaidForSession(session))) {
    return new Response("We could not find a paid order for this link. Email contrax.companyllc@gmail.com and we will sort it out.", { status: 404 });
  }
  const { BID_PACK_ZIP_BASE64 } = await import("~/lib/bid-pack-file");
  const bytes = new Uint8Array(Buffer.from(BID_PACK_ZIP_BASE64, "base64"));
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${BID_PACK_FILE_NAME}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export const Route = createFileRoute("/api/bid-pack/download")({ server: { handlers: { GET: handler } } });
