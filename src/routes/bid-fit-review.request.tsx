import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { SiteHeader } from "~/components/SiteHeader";
export const Route = createFileRoute("/bid-fit-review/request")({
  head: () => ({ meta: [{ title: "Your Bid Fit Review | Contrax" }, { name: "robots", content: "noindex, nofollow" }, {name:"referrer",content:"no-referrer"}],
    links: [], }),
  component: ReviewProgress,
});
function ReviewProgress() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<{ status: string; paymentStatus: string; documents: { id: number; filename: string }[] } | null>(null);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let key = window.location.hash.slice(1);
    try { key = key || sessionStorage.getItem("bid-fit-review-access") || ""; if(key) sessionStorage.setItem("bid-fit-review-access",key); } catch { /* private browsing may disable storage */ }
    window.history.replaceState(null,"",window.location.pathname);
    setToken(key);
  }, []);
  async function refresh(key: string) {
    const r = await fetch("/api/bid-fit-review/progress", { headers: { Authorization: `Bearer ${key}` } });
    const body = await r.json(); if (!r.ok) throw new Error(body.error || "Could not load request"); setData(body);
  }
  useEffect(() => { if (token) refresh(token).catch(e => setMessage(e.message)); }, [token]);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/bid-fit-review/documents", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: new FormData(form) });
      const body = await r.json(); if (!r.ok) throw new Error(body.error || "Upload failed");
      await refresh(token); form.reset(); setMessage("Document uploaded.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed"); } finally { setBusy(false); }
  }
  return <><SiteHeader /><main className="mx-auto max-w-2xl px-5 py-12">
    <h1 className="text-3xl font-bold">Your Bid Fit Review</h1>
    <p className="mt-3 text-slate-600">Keep this private link. It expires after 30 days. Contact contrax.companyllc@gmail.com if you need a replacement.</p>
    {data ? <section className="mt-6 rounded-xl border p-5">
      <p><strong>Work status:</strong> {data.status.replaceAll("_", " ")}</p>
      <p className="mt-2"><strong>Payment:</strong> {data.paymentStatus}</p>
      <button className="mt-3 rounded border px-3 py-2" onClick={()=>refresh(token).catch(e=>setMessage(e.message))}>Refresh status</button>
      <h2 className="mt-6 text-xl font-bold">Related documents</h2>
      <ul className="mt-3 space-y-2">{data.documents.map(d => <li key={d.id}>{d.filename}</li>)}</ul>
      {!["completed", "declined"].includes(data.status) && <form onSubmit={upload} className="mt-5 space-y-3">
        <label className="block font-semibold">Upload a PDF<input className="mt-2 block w-full" type="file" name="file" accept="application/pdf,.pdf" required /></label>
        <p className="text-sm text-slate-600">Solicitation, amendments, or capability statement. PDFs only, 3 MB total per request. For larger documents, reply to our email. Do not upload identification cards or private client records.</p>
        <button disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white">{busy ? "Uploading…" : "Upload document"}</button>
      </form>}
      <p className="mt-5 text-sm text-slate-600">Payment is offered after we accept your request. The review begins after confirmed payment and receipt of all required documents and business details.</p>
    </section> : <p className="mt-6">{token ? "Loading request…" : "Open the private request link provided after submission or by email."}</p>}
    {message && <p role="status" className="mt-4 rounded-lg bg-slate-100 p-3">{message}</p>}
  </main></>;
}
