import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { createHash } from "node:crypto";
async function handler({request}:{request:Request}) { const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,""); if(!token)return Response.json({error:"Unauthorized"},{status:401}); const h=createHash("sha256").update(token).digest("hex"); const k=await sql()`SELECT user_id FROM api_keys WHERE key_hash=${h} AND revoked=FALSE`; if(!k.length)return Response.json({error:"Unauthorized"},{status:401}); const rows=await sql()`SELECT sm.id,sm.bid_id,sm.status,sm.notes,sm.created_at,b.title,b.agency,b.due_date FROM saved_matches sm JOIN bids b ON b.id=sm.bid_id WHERE sm.user_id=${(k[0] as any).user_id} ORDER BY sm.created_at DESC`; return Response.json({data:rows}); }
export const Route=createFileRoute("/api/v1/matches")({server:{handlers:{GET:handler}}});
