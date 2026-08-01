import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { createHash } from "node:crypto";

async function auth(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const rows = await sql()`SELECT id,user_id FROM api_keys WHERE key_hash=${hash} AND revoked=FALSE`;
  if (!rows.length) return null;
  await sql()`UPDATE api_keys SET last_used_at=NOW() WHERE id=${(rows[0] as any).id}`;
  return (rows[0] as any).user_id as number;
}
async function handler({request}:{request:Request}) { try { const userId=await auth(request); if(!userId)return Response.json({error:"Unauthorized"},{status:401}); const url=new URL(request.url); const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit")||20))); const status=url.searchParams.get("status"); const rows=status ? await sql()`SELECT b.id,b.title,b.agency,b.description,b.location,b.category,b.due_date,b.estimated_value,b.source_url,sm.status FROM bids b JOIN saved_matches sm ON sm.bid_id=b.id AND sm.user_id=${userId} WHERE sm.status=${status} ORDER BY b.due_date ASC LIMIT ${limit}` : await sql()`SELECT b.id,b.title,b.agency,b.description,b.location,b.category,b.due_date,b.estimated_value,b.source_url,sm.status FROM bids b JOIN saved_matches sm ON sm.bid_id=b.id AND sm.user_id=${userId} ORDER BY b.due_date ASC LIMIT ${limit}`; return Response.json({data:rows}); } catch { return Response.json({error:"API unavailable"},{status:500}); } }
export const Route=createFileRoute("/api/v1/bids")({server:{handlers:{GET:handler}}});
