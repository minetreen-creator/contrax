import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { MCP_ROWS, MCP_TOOLS } from "~/lib/mcp";
import { seoHead } from "~/lib/seo-landing";
import { SEO_TRADES } from "~/lib/seo-trades";

/**
 * /mcp — the public page for the Contrax AI-assistant connection (owner 2026-11-14, traffic idea 3:
 * "list the AI connection in the AI tool directories"). Directories and the people browsing them
 * need one page that says what the connection is, its address, its tools and its limits. The tool
 * list is read from src/lib/mcp.ts, so this page cannot drift from what the endpoint answers.
 */
export const MCP_URL = "https://www.contrax.company/api/mcp";
export const MCP_CALLS_PER_HOUR = 40;
const TITLE = "Contrax MCP Server: Federal Contracts Ending Soon for AI Assistants | Contrax";
const DESC =
  "Connect Claude or another AI assistant to Contrax. A free, read-only MCP server that answers which federal contracts are ending in a state and line of work, who holds them and what they were awarded for.";

export const Route = createFileRoute("/mcp")({
  head: () => seoHead({ title: TITLE, description: DESC, canonical: "https://www.contrax.company/mcp" }),
  component: McpPage,
});

const ASKS = [
  "Which federal janitorial contracts are ending in Virginia in the next year, and who holds them?",
  "What were federal HVAC contracts in Texas typically awarded for?",
  "Which agencies have the most IT services work ending in Maryland?",
];
const code = "rounded bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-900";

function McpPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 text-slate-700">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600">For AI assistants</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">The Contrax MCP server</h1>
        <p className="mt-3">
          Ask an AI assistant which federal contracts are about to end, and get an answer from public records. Contrax runs a free, read-only
          connection (a Model Context Protocol server) that any assistant supporting MCP can use. No account and no key.
        </p>

        <h2 className="mt-10 text-xl font-bold text-slate-900">Address</h2>
        <p className="mt-2"><code className={code}>{MCP_URL}</code></p>
        <p className="mt-2 text-sm">
          Transport: streamable HTTP. In Claude, add it as a custom connector. In other assistants, add it wherever remote MCP servers are set up.
        </p>

        <h2 className="mt-10 text-xl font-bold text-slate-900">Tools</h2>
        <ul className="mt-3 space-y-4">
          {MCP_TOOLS.map((t) => (
            <li key={t.name} className="rounded-xl border border-slate-200 p-4">
              <p className="font-semibold text-slate-900"><code className={code}>{t.name}</code> · {t.title}</p>
              <p className="mt-1 text-sm">{t.description}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm">
          Lines of work: {SEO_TRADES.map((t) => t.label).join(", ")}. States: all 50 and DC, by two-letter code.
        </p>

        <h2 className="mt-10 text-xl font-bold text-slate-900">Things to ask</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {ASKS.map((a) => <li key={a}>{a}</li>)}
        </ul>

        <h2 className="mt-10 text-xl font-bold text-slate-900">What it returns, and its limits</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          <li>Totals for the market, the typical award size, and up to {MCP_ROWS} rows of each list, with a link to the rest.</li>
          <li>Source: USAspending.gov contract records. An end date can move if an agency extends a contract, and an ending contract is not a promise of a new solicitation.</li>
          <li>Read-only. It takes a state and a line of work and nothing about you.</li>
          <li>{MCP_CALLS_PER_HOUR} data calls an hour from one address.</li>
        </ul>

        <h2 className="mt-10 text-xl font-bold text-slate-900">Want the whole report?</h2>
        <p className="mt-2">
          The connection gives a taste. The full report for your state and trade is the{" "}
          <a href="/sample-report" className="font-semibold text-blue-700 hover:underline">Pipeline Snapshot</a>, and the pages it draws on are at{" "}
          <a href="/contracts-ending" className="font-semibold text-blue-700 hover:underline">contracts ending by state and trade</a>.
        </p>
      </main>
    </>
  );
}
