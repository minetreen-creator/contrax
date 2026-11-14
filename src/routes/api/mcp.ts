import { createFileRoute } from "@tanstack/react-router";
import { handleMcp, type McpDeps } from "~/lib/mcp";
import { checkIpLimit } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";

/**
 * POST /api/mcp — the Contrax Model Context Protocol endpoint (src/lib/mcp.ts). Stateless
 * "streamable HTTP": each POST carries one JSON-RPC message (or a batch) and gets JSON back.
 * There is no server-to-client stream, so GET answers 405 as the protocol allows.
 */
const HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

const deps: McpDeps = {
  market: async (state, trade) => {
    const { reportData } = await import("~/lib/pipeline-report-data.server");
    return reportData(state, trade, 12);
  },
};

async function post({ request }: { request: Request }) {
  if (isBlockedIp(request)) return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Forbidden" } }), { status: 403, headers: HEADERS });
  const body = await request.text();
  if (body.length > 20_000) return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }), { status: 413, headers: HEADERS });
  let msg: unknown;
  try { msg = JSON.parse(body); }
  catch { return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers: HEADERS }); }
  // 40 data calls an hour per address; listing tools and connecting are not counted.
  const allowCall = async () => (await checkIpLimit(request, "mcp_tools_call_ip", 40, 3600)).allowed;
  if (Array.isArray(msg)) {
    const replies = (await Promise.all(msg.slice(0, 10).map((m) => handleMcp(m, deps, allowCall)))).filter((r) => r !== null);
    return replies.length ? new Response(JSON.stringify(replies), { headers: HEADERS }) : new Response(null, { status: 202 });
  }
  const reply = await handleMcp(msg, deps, allowCall);
  return reply ? new Response(JSON.stringify(reply), { headers: HEADERS }) : new Response(null, { status: 202 });
}

const notAllowed = () => new Response(null, { status: 405, headers: { allow: "POST" } });

export const Route = createFileRoute("/api/mcp")({ server: { handlers: { POST: post, GET: notAllowed, DELETE: notAllowed } } });
