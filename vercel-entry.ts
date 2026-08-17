// Vercel Build Output API function entry.
//
// The Build Output Node launcher invokes the default export as a classic Node
// `(req, res)` handler — NOT a web handler. TanStack Start emits a portable web
// fetch handler (dist/server/server.js), so we adapt: Node IncomingMessage → web
// Request, run the fetch handler, stream the web Response back onto ServerResponse.
// Node 22 has global Request/Response/Headers/ReadableStream.
//
// Bundled (with its deps + the SSR handler's dynamic ./assets chunks) into
// .vercel/output/functions/render.func/index.mjs by build-vercel.sh.
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import handler from "./dist/server/server.js";

// ── Client asset references for the static SEO pages ─────────────────────────
// The entry chunk / CSS / preload filenames come from vercel-entry.assets.json,
// generated at BUILD time by scripts/generate-entry-assets.mjs (invoked from
// build-vercel.sh) from the fresh Vite/TanStack build output — so the static
// /learn + article pages always reference the CURRENT client entry chunk, never
// a stale hardcoded hash. On Vercel the whole bundle is built in one pass, so
// the generated JSON is inlined here by the bundler and never read at runtime.
import entryAssets from "./vercel-entry.assets.json";

const APP_CSS = entryAssets.appCss;
const ENTRY_URL = `/assets/${entryAssets.entryChunk}`;
const PRELOAD_URLS = entryAssets.preloads.map((p) => `/assets/${p}`);

// ── Startup env diagnostics (safe boolean-only, no values) ─────────────────────
// Helps diagnose "env var set in dashboard but not in deployed function" issues.
// Vercel Redeploy reuses old env snapshots; only fresh deployments pick up new vars.
console.log("[contrax] STRIPE_SECRET_KEY present:", !!process.env.STRIPE_SECRET_KEY);
console.log("[contrax] STRIPE_WEBHOOK_SECRET present:", !!process.env.STRIPE_WEBHOOK_SECRET);
console.log("[contrax] DATABASE_URL present:", !!process.env.DATABASE_URL);

// ── Static Legal Pages ─────────────────────────────────────────────────────────

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy — Contrax</title>
<meta name="description" content="Contrax privacy policy — how we collect, use, and protect your data.">
<meta name="robots" content="noindex, follow">
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #1e293b; line-height: 1.7; margin: 0; }
  .container { max-width: 720px; margin: 0 auto; padding: 3rem 1.5rem; }
  h1 { font-size: 2rem; font-weight: 700; color: #0f172a; }
  h2 { font-size: 1.25rem; font-weight: 600; color: #0f172a; margin-top: 2rem; }
  .date { font-size: 0.875rem; color: #64748b; margin-top: 0.25rem; }
  section { margin-top: 1.5rem; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .nav { background: #0f172a; border-bottom: 1px solid #334155; }
  .nav-inner { max-width: 1280px; margin: 0 auto; display: flex; gap: 0.25rem; padding: 0.5rem 1.5rem; }
  .nav a { color: #cbd5e1; padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; }
  .nav a:hover { color: #fff; background: #1e293b; text-decoration: none; }
  footer { border-top: 1px solid #e2e8f0; background: #f8fafc; margin-top: 3rem; }
  .f-inner { max-width: 1280px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; padding: 1.5rem; font-size: 0.875rem; color: #64748b; }
  @media (max-width: 640px) { .f-inner { flex-direction: column; gap: 0.75rem; } }
</style>
</head>
<body>
<div class="nav"><div class="nav-inner"><a href="/">📄 Contracts</a><a href="/savings">💰 Savings</a></div></div>
<div class="container">
<h1>Privacy Policy</h1>
<p class="date">Last updated: August 17, 2026</p>
<section><h2>1. Information We Collect</h2><p>When you use Contrax, we collect information you provide directly: your name, email address, business details, and preferences when you create an account. We also collect information about your use of our services, including bid preferences, saved searches, and proposal activity.</p></section>
<section><h2>2. How We Use Your Information</h2><p>We use your information to: provide our services, match your business with government contracts, generate AI-powered summaries and proposals, score win probability, track certification deadlines, send notifications, and provide support.</p></section>
<section><h2>3. Data Storage and Security</h2><p>Your data is stored on secure servers (Neon PostgreSQL, Vercel). We use industry-standard encryption. No method of electronic storage is 100% secure.</p></section>
<section><h2>4. Third-Party Services</h2><p>We use Stripe (payments), OpenAI (AI processing), Resend (email), and Vercel (hosting). See their privacy policies for details.</p></section>
<section><h2>5. Cookies</h2><p>We use essential cookies for login sessions. No advertising or tracking cookies.</p></section>
<section><h2>6. Your Rights</h2><p>You may request access, correction, or deletion of your data. Contact <a href="mailto:privacy@contrax.company">privacy@contrax.company</a>. We will respond within 30 days.</p></section>
<section><h2>7. Changes</h2><p>We may update this policy. Material changes will be notified via email or through the service.</p></section>
<section><h2>8. Contact</h2><p>Questions? Contact <a href="mailto:privacy@contrax.company">privacy@contrax.company</a>.</p></section>
</div>
<footer><div class="f-inner"><span>© 2026 Contrax. All rights reserved.</span><div style="display:flex;gap:1.5rem"><a href="/privacy" style="color:#64748b">Privacy Policy</a><a href="/terms" style="color:#64748b">Terms of Service</a><a href="/security" style="color:#64748b">Security</a><a href="mailto:minetreen@gmail.com" style="color:#64748b">Contact</a></div></div></footer>
</body>
</html>`;

const TERMS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terms of Service — Contrax</title>
<meta name="description" content="Contrax terms of service — the rules and conditions for using our platform.">
<meta name="robots" content="noindex, follow">
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #1e293b; line-height: 1.7; margin: 0; }
  .container { max-width: 720px; margin: 0 auto; padding: 3rem 1.5rem; }
  h1 { font-size: 2rem; font-weight: 700; color: #0f172a; }
  h2 { font-size: 1.25rem; font-weight: 600; color: #0f172a; margin-top: 2rem; }
  .date { font-size: 0.875rem; color: #64748b; margin-top: 0.25rem; }
  section { margin-top: 1.5rem; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .nav { background: #0f172a; border-bottom: 1px solid #334155; }
  .nav-inner { max-width: 1280px; margin: 0 auto; display: flex; gap: 0.25rem; padding: 0.5rem 1.5rem; }
  .nav a { color: #cbd5e1; padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; }
  .nav a:hover { color: #fff; background: #1e293b; text-decoration: none; }
  footer { border-top: 1px solid #e2e8f0; background: #f8fafc; margin-top: 3rem; }
  .f-inner { max-width: 1280px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; padding: 1.5rem; font-size: 0.875rem; color: #64748b; }
  @media (max-width: 640px) { .f-inner { flex-direction: column; gap: 0.75rem; } }
</style>
</head>
<body>
<div class="nav"><div class="nav-inner"><a href="/">📄 Contracts</a><a href="/savings">💰 Savings</a></div></div>
<div class="container">
<h1>Terms of Service</h1>
<p class="date">Last updated: August 17, 2026</p>
<section><h2>1. Acceptance of Terms</h2><p>By accessing or using Contrax ("the Service"), you agree to these Terms of Service. If you do not agree, do not use the Service. We may update these terms at any time; continued use after changes constitutes acceptance.</p></section>
<section><h2>2. Description of Service</h2><p>Contrax is an AI-powered platform that helps small businesses discover, understand, and respond to government contract opportunities.</p></section>
<section><h2>3. Accounts and Billing</h2><p>You must create an account to access paid features. All fees are billed in advance on a monthly basis via Stripe. You may cancel at any time; cancellation takes effect at the end of the current billing period. No refunds for partial months.</p></section>
<section><h2>4. Acceptable Use</h2><p>You agree not to use the Service for any unlawful purpose, submit false information, circumvent security features, resell or scrape the Service, submit fraudulent bids, or upload malicious code.</p></section>
<section><h2>5. AI-Generated Content</h2><p>AI-generated content (summaries, proposals, recommendations) is provided as a starting point. Review and verify all AI output before use. We make no guarantees about accuracy or suitability. You are responsible for final content you submit using our tools.</p></section>
<section><h2>6. Intellectual Property</h2><p>The Contrax platform (code, design, logos) is owned by Contrax. You retain ownership of content you create using the Service. By using the Service, you grant us a limited license to process your content solely to provide the Service.</p></section>
<section><h2>7. Third-Party Services</h2><p>The Service integrates with government procurement databases, Stripe, OpenAI, and other third-party services. We are not responsible for their availability, accuracy, or content.</p></section>
<section><h2>8. Limitation of Liability</h2><p>To the fullest extent permitted by law, Contrax shall not be liable for any indirect, incidental, or consequential damages. Our total liability is limited to amounts you paid us in the 12 months preceding the claim. The Service is provided "as is."</p></section>
<section><h2>9. Termination</h2><p>We may suspend or terminate access for violation of these terms. Data is retained for 30 days after termination for export upon request.</p></section>
<section><h2>10. Governing Law</h2><p>These terms are governed by United States law. Disputes shall be resolved through binding arbitration.</p></section>
<section><h2>11. Contact</h2><p>For questions, contact <a href="mailto:legal@contrax.app">legal@contrax.app</a>.</p></section>
</div>
<footer><div class="f-inner"><span>© 2026 Contrax. All rights reserved.</span><div style="display:flex;gap:1.5rem"><a href="/privacy" style="color:#64748b">Privacy Policy</a><a href="/terms" style="color:#64748b">Terms of Service</a><a href="/security" style="color:#64748b">Security</a><a href="mailto:minetreen@gmail.com" style="color:#64748b">Contact</a></div></div></footer>
</body>
</html>`;

// ── Static SEO Pages ──────────────────────────────────────────────────────────

const SEO_HEAD = `<link rel="stylesheet" href="/assets/${APP_CSS}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
${PRELOAD_URLS.map((u) => `<link rel="modulepreload" href="${u}">`).join("\n")}`;

const SEO_NAV = `<nav class="sticky top-0 z-50 bg-slate-900 border-b border-slate-700"><div class="mx-auto flex max-w-7xl items-center gap-1 px-6 py-2"><a class="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-slate-800" href="/">📄 Contracts</a><a class="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-slate-800" href="/savings">💰 Savings</a><a class="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-slate-800" href="/learn">📚 Learn</a></div></nav>`;

const SEO_FOOTER = `<footer class="border-t border-slate-200 bg-slate-50 mt-16"><div class="mx-auto max-w-7xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4"><p class="text-sm text-slate-500">© 2026 Contrax. All rights reserved.</p><div class="flex items-center gap-6"><a href="/privacy" class="text-sm text-slate-500 hover:text-slate-700 transition-colors">Privacy Policy</a><a href="/terms" class="text-sm text-slate-500 hover:text-slate-700 transition-colors">Terms of Service</a><a href="/security" class="text-sm text-slate-500 hover:text-slate-700 transition-colors">Security</a><a href="/learn" class="text-sm text-slate-500 hover:text-slate-700 transition-colors">Learn</a><a href="mailto:minetreen@gmail.com" class="text-sm text-slate-500 hover:text-slate-700 transition-colors">Contact</a></div></div></footer>`;

const SEO_SCRIPTS = `<script class="$tsr" id="$tsr-stream-barrier">(self.$R=self.$R||{})["tsr"]=[];self.$_TSR={h(){this.hydrated=!0,this.c()},e(){this.streamEnded=!0,this.c()},c(){this.hydrated&&this.streamEnded&&(delete self.$_TSR,delete self.$R.tsr)},p(e){this.initialized?e():this.buffer.push(e)},buffer:[]};$_TSR.router=($R=>$R[0]={manifest:$R[1]={routes:$R[2]={__root__:$R[3]={preloads:$R[4]=${JSON.stringify(PRELOAD_URLS)},scripts:$R[5]=[$R[6]={attrs:$R[7]={type:"module",async:!0,src:${JSON.stringify(ENTRY_URL)}}}]}}},matches:$R[8]=[$R[9]={i:"__root__",u:1785481081647,s:"success",ssr:!0,g:!0}],lastMatchId:"__root__"})($R["tsr"]);$_TSR.e();document.currentScript.remove()</script><script type="module" async src="${ENTRY_URL}"></script><script>(function(){try{var p=location.pathname+location.search;var r=document.referrer||"";fetch("/api/analytics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:p,referrer:r})})}catch(e){}})();</script>`;

const LEARN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Free Government Contracting Resources &amp; Guides | Contrax</title>
<meta name="description" content="Free government contracting guides for small businesses — including 8(a), WOSB/EDWOSB, SDVOSB, and HUBZone certification guides, proposal templates, capability statement examples, compliance checklists, and more.">
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:url" content="https://www.contrax.company/learn">
<meta property="og:title" content="Free Government Contracting Resources &amp; Guides | Contrax">
<meta property="og:description" content="Free government contracting guides for small businesses — including 8(a), WOSB/EDWOSB, SDVOSB, and HUBZone certification guides.">
<meta property="og:site_name" content="Contrax">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Free Government Contracting Resources &amp; Guides | Contrax">
<meta name="twitter:description" content="Free government contracting guides for small businesses — including 8(a), WOSB/EDWOSB, SDVOSB, and HUBZone certification guides.">
<link rel="canonical" href="https://www.contrax.company/learn">
${SEO_HEAD}
<style>
  .learn-hero{background:linear-gradient(135deg,#020617,#0f172a,#172554);padding:5rem 1.5rem;text-align:center;color:#fff}
  .learn-hero p{max-width:42rem;margin:1.5rem auto 0;color:#dbeafe;font-size:1.125rem;line-height:1.75}
  .learn-wrap{max-width:80rem;margin:0 auto;padding:3.5rem 1.5rem}
  .learn-guides{background:#fff}.learn-eyebrow{color:#b45309;font-size:.875rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase}
  .learn-heading{margin:.5rem 0 0;font-size:2.25rem;color:#0f172a}.learn-intro{max-width:42rem;color:#4b5563;line-height:1.6}
  .guide-grid,.resource-grid{display:grid;gap:1.5rem}.guide-grid{grid-template-columns:repeat(4,minmax(0,1fr));margin-top:2rem}
  .guide-card,.resource-card{display:flex;flex-direction:column;border:1px solid #e2e8f0;border-radius:1rem;background:#fff;padding:1.5rem;text-decoration:none;box-shadow:0 1px 2px #0000000d}
  .guide-card:hover,.resource-card:hover{border-color:#fcd34d;box-shadow:0 10px 20px #00000012}.badge{align-self:flex-start;border-radius:999px;background:#fffbeb;padding:.25rem .75rem;color:#b45309;font-size:.75rem;font-weight:700;text-transform:uppercase}
  .guide-card h3,.resource-card h3{margin:1rem 0 .75rem;color:#0f172a;font-size:1.125rem}.guide-card p,.resource-card p{margin:0;color:#475569;font-size:.875rem;line-height:1.6;flex:1}.read{margin-top:1.25rem;color:#2563eb;font-size:.875rem;font-weight:600}
  .resources{background:#f8fafc}.resource-search{display:flex;gap:1rem;margin-top:2rem}.resource-search input{flex:1;border:1px solid #e2e8f0;border-radius:.75rem;background:#fff;padding:.8rem 1.25rem;font-size:1rem}.resource-search button{border:0;border-radius:.75rem;background:#2563eb;padding:.8rem 1.5rem;color:#fff;font-weight:600}.filters{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1.5rem}.filters span{border-radius:999px;background:#fff;padding:.5rem 1rem;color:#475569;font-size:.875rem;box-shadow:inset 0 0 0 1px #e2e8f0}.resource-grid{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:1.5rem}
  @media(max-width:900px){.guide-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.resource-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.guide-grid,.resource-grid{grid-template-columns:1fr}.learn-heading{font-size:1.8rem}.resource-search{flex-direction:column}}
</style>
</head>
<body class="antialiased bg-slate-50">
${SEO_NAV}
<main>
<section class="learn-hero"><p class="learn-eyebrow" style="color:#fbbf24">The Contrax Resource Hub</p><h1 class="mt-4 text-4xl font-extrabold sm:text-6xl">Government Contracting Resources</h1><p>Free, practical guides and templates to help small businesses register, find opportunities, and submit stronger federal proposals.</p></section>
<section class="learn-guides"><div class="learn-wrap"><p class="learn-eyebrow">Certification guides</p><h2 class="learn-heading">Get certified, then win set-asides</h2><p class="learn-intro">8(a), WOSB/EDWOSB, SDVOSB, and HUBZone certifications unlock billions in federal set-aside contracts — but only if you qualify, certify, and bid. Start with the guide for your business.</p>
<div class="guide-grid">
<a class="guide-card" href="/learn/8a-certification-guide"><span class="badge">8(a)</span><h3>How to Get 8(a) Certified: The Complete Guide</h3><p>Eligibility, the application process, and the 9-year program timeline — in plain English.</p><span class="read">Read the guide →</span></a>
<a class="guide-card" href="/learn/wosb-edwosb-guide"><span class="badge">WOSB</span><h3>WOSB/EDWOSB Set-Aside Guide: Winning as a Women-Owned Business</h3><p>WOSB vs EDWOSB, how to get certified, and where the set-aside opportunities are.</p><span class="read">Read the guide →</span></a>
<a class="guide-card" href="/learn/sdvosb-guide"><span class="badge">SDVOSB</span><h3>SDVOSB Government Contracts: Veteran-Owned Business Guide</h3><p>SDVOSB eligibility, verification through the SBA, and the set-aside advantages.</p><span class="read">Read the guide →</span></a>
<a class="guide-card" href="/learn/hubzone-guide"><span class="badge">HUBZone</span><h3>HUBZone Explained: Contracting Advantages for Underutilized Areas</h3><p>How the HUBZone map works, how to get certified, and the benefits for your pricing.</p><span class="read">Read the guide →</span></a>
</div></div></section>
<section class="resources"><div class="learn-wrap"><h2 class="learn-heading" style="font-size:1.75rem">Browse resources</h2><div class="resource-search"><input aria-label="Search resources" placeholder="Search guides, templates, NAICS, SAM.gov…"><button>Search</button></div><div class="filters"><span>All resources</span><span>Capability Statements</span><span>Proposal Templates</span><span>Compliance Checklists</span><span>Solicitations</span><span>FAQs</span><span>Guides</span></div><h2 class="learn-heading" style="font-size:1.5rem;margin-top:3rem">Free guides and tools</h2><div class="resource-grid"><article class="resource-card"><span class="badge" style="background:#eff6ff;color:#1d4ed8">Guide</span><h3>Government Contracting Guide</h3><p>Practical guidance for finding opportunities, understanding solicitations, and preparing stronger proposals.</p><span class="read">Read resource →</span></article><article class="resource-card"><span class="badge" style="background:#eff6ff;color:#1d4ed8">Proposal Template</span><h3>AI-Powered RFP Proposal Writing</h3><p>Learn how to organize a compliant, persuasive response to a government RFP.</p><span class="read">Read resource →</span></article><article class="resource-card"><span class="badge" style="background:#eff6ff;color:#1d4ed8">Set-Asides</span><h3>Small Business Contracting Opportunities</h3><p>Understand federal set-aside programs and how small businesses can compete.</p><span class="read">Read resource →</span></article></div></div></section>
</main>
${SEO_FOOTER}
${SEO_SCRIPTS}
</body>
</html>`;

const GOV_CONTRACTING_GUIDE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How to Bid on Government Contracts: Complete Guide (2026) — Contrax</title>
<meta name="description" content="Step-by-step guide to bidding on government contracts for small businesses. Learn SAM.gov registration, finding RFPs, writing winning proposals, and avoiding common mistakes.">
<meta name="robots" content="index, follow">
<meta property="og:type" content="article">
<meta property="og:url" content="https://www.contrax.company/learn/government-contracting-guide">
<meta property="og:title" content="How to Bid on Government Contracts: Complete Guide (2026) — Contrax">
<meta property="og:description" content="Step-by-step guide to bidding on government contracts for small businesses. Learn SAM.gov registration, finding RFPs, writing winning proposals, and avoiding common mistakes.">
<meta property="og:site_name" content="Contrax">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="How to Bid on Government Contracts: Complete Guide (2026)">
<meta name="twitter:description" content="Step-by-step guide to bidding on government contracts for small businesses. SAM.gov registration, finding RFPs, writing proposals.">
<link rel="canonical" href="https://www.contrax.company/learn/government-contracting-guide">
${SEO_HEAD}
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"How to Bid on Government Contracts: Complete Guide (2026)","description":"Step-by-step guide to bidding on government contracts for small businesses.","author":{"@type":"Organization","name":"Contrax"},"publisher":{"@type":"Organization","name":"Contrax"}}</script>
</head>
<body class="antialiased bg-white">
${SEO_NAV}
<main class="mx-auto max-w-3xl px-6 py-12">
<p class="text-sm text-blue-600 mb-2"><a href="/learn" class="hover:underline">← Back to Resources</a></p>
<h1 class="text-4xl font-bold text-slate-900 mb-2">How to Bid on Government Contracts: The Complete Guide</h1>
<p class="text-slate-500 mb-8">Updated 2026 · 12 min read</p>

<section class="prose prose-slate max-w-none">
<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">1. Understanding Government Procurement</h2>
<p class="text-slate-600 leading-relaxed mb-4">The US government is the world's largest buyer of goods and services, spending over $600 billion annually through contracts. Federal, state, and local governments all purchase through competitive bidding processes. For small businesses, government contracts represent a massive, stable revenue opportunity — and federal law requires that 23% of all prime federal contract dollars go to small businesses.</p>
<p class="text-slate-600 leading-relaxed mb-4">Government procurement differs from B2B sales in key ways: contracts are publicly advertised, evaluation criteria are documented upfront, and awards must be justified. This transparency creates opportunity for new entrants who can navigate the process.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">2. Getting Your SAM.gov Registration</h2>
<p class="text-slate-600 leading-relaxed mb-4">SAM.gov (System for Award Management) is the mandatory registration system for any business wanting federal contracts. Registration is free but requires preparation:</p>
<ul class="list-disc pl-6 space-y-2 text-slate-600 mb-4">
<li><strong>UEI Number:</strong> Obtain your Unique Entity ID at SAM.gov (replaced DUNS in 2022)</li>
<li><strong>NAICS Codes:</strong> Identify your industry codes — these determine which contracts you qualify for</li>
<li><strong>Bank Account:</strong> Set up electronic funds transfer for payments</li>
<li><strong>Past Performance:</strong> Gather references from previous clients</li>
</ul>
<p class="text-slate-600 leading-relaxed mb-4">Registration typically takes 10-14 business days. Start early — you cannot bid on federal contracts without an active SAM registration.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">3. Finding the Right Contracts to Bid On</h2>
<p class="text-slate-600 leading-relaxed mb-4">Not every contract is worth pursuing. Smart bid selection is the difference between profitability and burnout. Here's where to look:</p>
<ul class="list-disc pl-6 space-y-2 text-slate-600 mb-4">
<li><strong>SAM.gov:</strong> The central federal database — search by NAICS code, set-aside type, and agency</li>
<li><strong>State procurement portals:</strong> Most states have their own e-procurement systems (like Virginia's eVA)</li>
<li><strong>Local government websites:</strong> Cities and counties post RFPs on their purchasing pages</li>
<li><strong>Subcontracting:</strong> Large prime contractors need small business partners — register in their supplier databases</li>
</ul>
<p class="text-slate-600 leading-relaxed mb-4"><strong>Pro tip:</strong> Use a tool like <a href="/" class="text-blue-600 hover:underline">Contrax</a> to monitor multiple procurement sources simultaneously. It automatically surfaces bids matching your NAICS codes and industry, saving hours of manual searching.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">4. Reading and Analyzing an RFP</h2>
<p class="text-slate-600 leading-relaxed mb-4">An RFP (Request for Proposal) can be 50-200+ pages of dense government language. Focus on these sections:</p>
<ul class="list-disc pl-6 space-y-2 text-slate-600 mb-4">
<li><strong>Scope of Work (SOW):</strong> What exactly is being purchased? Can you deliver it?</li>
<li><strong>Evaluation Criteria:</strong> How will proposals be scored? Price vs. technical approach vs. past performance</li>
<li><strong>Submission Requirements:</strong> Format, page limits, required forms, deadlines</li>
<li><strong>Terms and Conditions:</strong> Payment terms, insurance requirements, compliance obligations</li>
</ul>
<p class="text-slate-600 leading-relaxed mb-4">AI tools can summarize complex RFPs and highlight key requirements in minutes — a task that traditionally took hours.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">5. Writing a Winning Proposal</h2>
<p class="text-slate-600 leading-relaxed mb-4">Government proposals follow a structured format. Here's what evaluators look for:</p>
<ul class="list-disc pl-6 space-y-2 text-slate-600 mb-4">
<li><strong>Technical Approach:</strong> How will you execute the work? Be specific about methodology, staffing, and timeline</li>
<li><strong>Management Plan:</strong> Who will lead the project? What's your quality control process?</li>
<li><strong>Past Performance:</strong> Provide 3-5 relevant examples showing similar work delivered on time and on budget</li>
<li><strong>Price Proposal:</strong> Be competitive but sustainable — lowballing hurts credibility</li>
</ul>
<p class="text-slate-600 leading-relaxed mb-4">Common mistakes: missing required forms, exceeding page limits, generic responses that don't address the specific SOW, and pricing that's inconsistent with the technical approach. Use a compliance checklist before submitting.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">6. Post-Submission: Debriefs and Protests</h2>
<p class="text-slate-600 leading-relaxed mb-4">If you win — congratulations. If not, request a debriefing from the contracting officer. Debriefs reveal how you scored against the evaluation criteria and what the winner did better. This intelligence improves your next proposal. In rare cases of procedural errors, you may file a bid protest with the GAO — but this is a legal process, not a casual complaint.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">7. Tools and Resources</h2>
<ul class="list-disc pl-6 space-y-2 text-slate-600 mb-4">
<li><a href="https://sam.gov" class="text-blue-600 hover:underline">SAM.gov</a> — Federal contract database</li>
<li><a href="https://www.sba.gov" class="text-blue-600 hover:underline">SBA.gov</a> — Small business contracting programs and certifications</li>
<li><a href="/learn/ai-proposal-writing" class="text-blue-600 hover:underline">AI Proposal Writing Guide</a> — How to use AI for government proposals</li>
<li><a href="/" class="text-blue-600 hover:underline">Contrax</a> — AI-powered bid monitoring and proposal drafting</li>
</ul>
</section>

<div class="mt-12 bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-8 text-white text-center">
<h2 class="text-2xl font-bold mb-2">Stop manually searching for contracts</h2>
<p class="text-blue-100 mb-6">Contrax monitors 8 government procurement sources and drafts AI proposals — so you spend less time searching and more time winning.</p>
<a href="/" class="inline-block bg-white text-blue-700 font-semibold px-8 py-3 rounded-lg hover:bg-blue-50 transition-colors">Get Started Free →</a>
</div>
</main>
${SEO_FOOTER}
${SEO_SCRIPTS}
</body>
</html>`;

const AI_PROPOSAL_WRITING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI-Powered RFP Proposal Writing for Government Contracts — Contrax</title>
<meta name="description" content="How artificial intelligence is transforming government RFP proposal writing. Learn to use AI tools to draft compliant, winning proposals in hours instead of days.">
<meta name="robots" content="index, follow">
<meta property="og:type" content="article">
<meta property="og:url" content="https://www.contrax.company/learn/ai-proposal-writing">
<meta property="og:title" content="AI-Powered RFP Proposal Writing for Government Contracts — Contrax">
<meta property="og:description" content="How AI is transforming government RFP proposal writing. Draft compliant, winning proposals in hours instead of days.">
<meta property="og:site_name" content="Contrax">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="AI-Powered RFP Proposal Writing for Government Contracts">
<meta name="twitter:description" content="How AI is transforming government RFP proposal writing. Draft compliant, winning proposals in hours.">
<link rel="canonical" href="https://www.contrax.company/learn/ai-proposal-writing">
${SEO_HEAD}
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"AI-Powered RFP Proposal Writing for Government Contracts","description":"How artificial intelligence is transforming government RFP proposal writing.","author":{"@type":"Organization","name":"Contrax"},"publisher":{"@type":"Organization","name":"Contrax"}}</script>
</head>
<body class="antialiased bg-white">
${SEO_NAV}
<main class="mx-auto max-w-3xl px-6 py-12">
<p class="text-sm text-blue-600 mb-2"><a href="/learn" class="hover:underline">← Back to Resources</a></p>
<h1 class="text-4xl font-bold text-slate-900 mb-2">AI-Powered RFP Proposal Writing for Government Contracts</h1>
<p class="text-slate-500 mb-8">Updated 2026 · 10 min read</p>

<section class="prose prose-slate max-w-none">
<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">Why Government Proposal Writing Needs AI</h2>
<p class="text-slate-600 leading-relaxed mb-4">Government RFPs are notoriously complex. A typical federal RFP runs 50-200 pages, with detailed technical requirements, compliance checklists, and strict formatting rules. For small businesses, the proposal writing burden is often the biggest barrier to winning government contracts — each response can take 40-80 hours of staff time.</p>
<p class="text-slate-600 leading-relaxed mb-4">AI is changing this equation. Modern language models can read and analyze entire RFPs, extract key requirements, and draft compliant proposal sections in minutes. The result: small businesses can now compete for contracts that previously required dedicated proposal teams.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">How AI Proposal Writing Works</h2>
<p class="text-slate-600 leading-relaxed mb-4">AI-powered proposal tools like Contrax use large language models (LLMs) trained on vast amounts of text data. Here's the typical workflow:</p>
<ol class="list-decimal pl-6 space-y-3 text-slate-600 mb-4">
<li><strong>RFP Ingestion:</strong> The AI reads the full RFP document, identifying the scope of work, evaluation criteria, submission requirements, and compliance mandates.</li>
<li><strong>Requirement Extraction:</strong> Key requirements are extracted and organized into a checklist — ensuring nothing is missed.</li>
<li><strong>Proposal Drafting:</strong> The AI generates proposal sections addressing each requirement, drawing on best practices from successful government proposals.</li>
<li><strong>Compliance Check:</strong> The draft is cross-referenced against requirements to flag any gaps.</li>
<li><strong>Human Review:</strong> A human reviews, edits, and customizes the AI draft — adding company-specific details, past performance examples, and pricing.</li>
</ol>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">What AI Does Well in Proposals</h2>
<p class="text-slate-600 leading-relaxed mb-4">AI excels at several proposal writing tasks:</p>
<ul class="list-disc pl-6 space-y-2 text-slate-600 mb-4">
<li><strong>Summarizing complex documents:</strong> AI can distill a 100-page RFP into a 2-page summary of key points</li>
<li><strong>Generating structured content:</strong> Technical approach, management plans, quality control — AI produces well-organized first drafts</li>
<li><strong>Consistency and compliance:</strong> AI never forgets a requirement — it cross-references every section against the RFP</li>
<li><strong>Speed:</strong> What takes a human 40 hours, AI does in under 10 minutes</li>
</ul>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">What Still Requires Human Judgment</h2>
<p class="text-slate-600 leading-relaxed mb-4">AI is a powerful tool, but government proposals still require human oversight:</p>
<ul class="list-disc pl-6 space-y-2 text-slate-600 mb-4">
<li><strong>Pricing strategy:</strong> AI doesn't know your cost structure or competitive landscape</li>
<li><strong>Past performance narratives:</strong> Only you can describe your specific project experience authentically</li>
<li><strong>Company differentiators:</strong> Your unique value proposition needs human articulation</li>
<li><strong>Final review:</strong> Always verify AI-generated content for accuracy, compliance, and tone</li>
</ul>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">Best Practices for AI-Assisted Proposals</h2>
<ol class="list-decimal pl-6 space-y-3 text-slate-600 mb-4">
<li><strong>Always review and customize:</strong> Treat AI output as a strong first draft, not a finished proposal</li>
<li><strong>Feed it good context:</strong> Provide the AI with your company capabilities, past projects, and team bios for better results</li>
<li><strong>Use a compliance checklist:</strong> Even with AI, manually verify every RFP requirement is addressed</li>
<li><strong>Maintain your brand voice:</strong> Edit AI drafts to sound like your company, not a generic template</li>
<li><strong>Stay current:</strong> Government procurement rules change — ensure your AI tools and knowledge base are updated</li>
</ol>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">Getting Started with AI Proposal Writing</h2>
<p class="text-slate-600 leading-relaxed mb-4">You don't need to be a tech expert to use AI for proposals. Modern platforms handle the complexity behind the scenes. <a href="/" class="text-blue-600 hover:underline">Contrax</a> combines automated bid discovery across 8 procurement sources with AI-powered summarization and proposal drafting — so you can go from finding an RFP to submitting a proposal in hours, not weeks.</p>
<p class="text-slate-600 leading-relaxed mb-4">Ready to learn more about finding the right contracts? Read our <a href="/learn/government-contracting-guide" class="text-blue-600 hover:underline">complete guide to government contract bidding</a>.</p>
</section>

<div class="mt-12 bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-8 text-white text-center">
<h2 class="text-2xl font-bold mb-2">Write winning proposals with AI</h2>
<p class="text-blue-100 mb-6">Contrax reads RFPs, summarizes requirements, and drafts compliant proposals — so you can submit faster and win more.</p>
<a href="/" class="inline-block bg-white text-blue-700 font-semibold px-8 py-3 rounded-lg hover:bg-blue-50 transition-colors">Try Contrax Free →</a>
</div>
</main>
${SEO_FOOTER}
${SEO_SCRIPTS}
</body>
</html>`;

const SMALL_BIZ_CONTRACTING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Small Business Government Contracting: Set-Asides & Opportunities — Contrax</title>
<meta name="description" content="The US government sets aside billions in contracts for small businesses. Learn about SBA programs, set-aside categories, eligibility requirements, and how to compete successfully.">
<meta name="robots" content="index, follow">
<meta property="og:type" content="article">
<meta property="og:url" content="https://www.contrax.company/learn/small-business-government-contracting">
<meta property="og:title" content="Small Business Government Contracting: Set-Asides & Opportunities — Contrax">
<meta property="og:description" content="The US government sets aside billions in contracts for small businesses. Learn about SBA programs, set-aside categories, and eligibility.">
<meta property="og:site_name" content="Contrax">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Small Business Government Contracting: Set-Asides & Opportunities">
<meta name="twitter:description" content="Billions in government contracts are set aside for small businesses. Learn how to compete.">
<link rel="canonical" href="https://www.contrax.company/learn/small-business-government-contracting">
${SEO_HEAD}
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Small Business Government Contracting: Set-Asides & Opportunities","description":"The US government sets aside billions in contracts for small businesses.","author":{"@type":"Organization","name":"Contrax"},"publisher":{"@type":"Organization","name":"Contrax"}}</script>
</head>
<body class="antialiased bg-white">
${SEO_NAV}
<main class="mx-auto max-w-3xl px-6 py-12">
<p class="text-sm text-blue-600 mb-2"><a href="/learn" class="hover:underline">← Back to Resources</a></p>
<h1 class="text-4xl font-bold text-slate-900 mb-2">Small Business Government Contracting: Set-Asides & Opportunities</h1>
<p class="text-slate-500 mb-8">Updated 2026 · 8 min read</p>

<section class="prose prose-slate max-w-none">
<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">The Small Business Contracting Mandate</h2>
<p class="text-slate-600 leading-relaxed mb-4">By federal law, 23% of all prime federal contract dollars must be awarded to small businesses. In fiscal year 2025, that translated to over $160 billion in small business contract awards. This isn't a suggestion — it's a statutory requirement that agencies must meet, and it creates enormous opportunity for qualified small businesses.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">SBA Small Business Size Standards</h2>
<p class="text-slate-600 leading-relaxed mb-4">To qualify as a "small business" for federal contracting, you must meet the SBA's size standards for your industry. These are defined by NAICS code and measured either by average annual revenue (typically under $16M-$40M depending on industry) or number of employees (under 500-1,500). Check your NAICS code against the <a href="https://www.sba.gov/size-standards" class="text-blue-600 hover:underline">SBA size standards table</a>.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">Set-Aside Categories</h2>
<p class="text-slate-600 leading-relaxed mb-4">Beyond general small business set-asides, the government reserves contracts for specific categories:</p>
<ul class="list-disc pl-6 space-y-3 text-slate-600 mb-4">
<li><strong>8(a) Business Development:</strong> For businesses owned by socially and economically disadvantaged individuals. 9-year program with sole-source contracts up to $4.5M</li>
<li><strong>HUBZone:</strong> For businesses in Historically Underutilized Business Zones. 3% government-wide goal</li>
<li><strong>Women-Owned Small Business (WOSB):</strong> 5% goal for women-owned businesses in underrepresented industries</li>
<li><strong>Service-Disabled Veteran-Owned (SDVOSB):</strong> 3% goal for veteran-owned businesses</li>
</ul>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">How to Get Certified</h2>
<p class="text-slate-600 leading-relaxed mb-4">Certification requirements depend on the set-aside program:</p>
<ul class="list-disc pl-6 space-y-2 text-slate-600 mb-4">
<li><strong>8(a):</strong> Apply through the SBA — requires a business plan, financial statements, and personal narratives</li>
<li><strong>HUBZone:</strong> Apply through SBA — requires proof of principal office location and employee residency</li>
<li><strong>WOSB/EDWOSB:</strong> Self-certify through SAM.gov or third-party certify</li>
<li><strong>SDVOSB:</strong> Self-certify through SAM.gov (VA contracts require VA verification)</li>
</ul>
<p class="text-slate-600 leading-relaxed mb-4">Certification can take 3-6 months. Start the process early — you can bid on general small business set-asides with just your SAM registration while certifications are pending.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">Finding Set-Aside Contracts</h2>
<p class="text-slate-600 leading-relaxed mb-4">On SAM.gov, filter by "Set Aside" type to find contracts reserved for your certification. State and local governments have similar programs — check their procurement portals for small business preferences. <a href="/" class="text-blue-600 hover:underline">Contrax</a> automatically filters contracts by set-aside type and matches them to your business profile.</p>

<h2 class="text-2xl font-semibold text-slate-800 mt-10 mb-3">Subcontracting: The Fast Track</h2>
<p class="text-slate-600 leading-relaxed mb-4">Large prime contractors are required to submit subcontracting plans showing how they'll include small businesses. This creates opportunities to get government contracting experience without bidding as a prime. Register in the subcontracting databases of major federal contractors and attend industry matchmaking events.</p>
</section>

<div class="mt-12 bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-8 text-white text-center">
<h2 class="text-2xl font-bold mb-2">Find small business set-asides automatically</h2>
<p class="text-blue-100 mb-6">Contrax monitors 8 procurement sources and filters contracts by your certifications and NAICS codes — so you never miss an opportunity.</p>
<a href="/" class="inline-block bg-white text-blue-700 font-semibold px-8 py-3 rounded-lg hover:bg-blue-50 transition-colors">Get Started Free →</a>
</div>
</main>
${SEO_FOOTER}
${SEO_SCRIPTS}
</body>
</html>`;

const fetchHandler = handler as {
  fetch: (request: Request) => Response | Promise<Response>;
};

/**
 * Client IP for the anonymous /score free-score limit — same derivation as
 * /api/event's getClientIp: x-forwarded-for first value, then
 * cf-connecting-ip / x-real-ip, sliced to 64 chars. Returned as a string and
 * stashed on globalThis so createServerFn handlers can read it without node
 * builtins (keeps the client-bundle protection happy).
 */
function getClientIp(headers: IncomingHttpHeaders): string {
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const ip = headers["cf-connecting-ip"] ?? headers["x-real-ip"];
  return typeof ip === "string" && ip ? ip.slice(0, 64) : "";
}

const toWebRequest = (req: IncomingMessage): Request => {
  const host = req.headers.host ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value != null) headers.set(key, value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    ...(hasBody
      ? { body: req as unknown as ReadableStream, duplex: "half" }
      : {}),
  } as RequestInit);
};

// ── Raw body reader (for Stripe webhook) ─────────────────────────────────────

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ── Stripe webhook handler ────────────────────────────────────────────────────

async function handleStripeWebhookRoute(
  req: IncomingMessage,
): Promise<{ status: number; body: string }> {
  try {
    const signature = req.headers["stripe-signature"] as string | undefined;
    if (!signature) {
      return {
        status: 400,
        body: JSON.stringify({ error: "Missing signature" }),
      };
    }

    const rawBody = await readRawBody(req);

    // Dynamic import so env vars are available at runtime on Vercel
    const { handleStripeWebhook } = await import("./src/lib/stripe.ts");
    const result = await handleStripeWebhook(rawBody, signature);

    if (!result.success) {
      return {
        status: result.error === "Invalid signature" ? 400 : 500,
        body: JSON.stringify({ error: result.error }),
      };
    }

    return { status: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error("stripe webhook error:", err);
    return {
      status: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

// ── Stripe checkout session handler ──────────────────────────────────────────

async function handleCreateCheckoutSession(
  req: IncomingMessage,
): Promise<{ status: number; body: string }> {
  try {
    const rawBody = await readRawBody(req);
    const parsed = JSON.parse(rawBody || "{}") as {
      planTier?: string;
      mode?: "payment" | "subscription";
    };

    const validTiers = ["starter", "professional", "agency", "savings_premium"];
    if (!parsed.planTier || !validTiers.includes(parsed.planTier)) {
      return {
        status: 400,
        body: JSON.stringify({
          error: `Invalid planTier. Must be one of: ${validTiers.join(", ")}`,
        }),
      };
    }
    if (parsed.mode && !["payment", "subscription"].includes(parsed.mode)) {
      return {
        status: 400,
        body: JSON.stringify({
          error: `Invalid mode. Must be "payment" or "subscription"`,
        }),
      };
    }

    const { createCheckoutSession, resolveUserIdFromCookie } = await import(
      "./src/lib/stripe.ts"
    );
    // Attribute the checkout to the logged-in user (if any) via session cookie
    const cookieHeader = (req.headers.cookie as string | undefined) ?? null;
    const userId = await resolveUserIdFromCookie(cookieHeader);
    const result = await createCheckoutSession(parsed.planTier as any, {
      userId,
      mode: parsed.mode ?? "subscription",
    });

    if (!result.success) {
      return {
        status: 500,
        body: JSON.stringify({ error: result.error }),
      };
    }

    return { status: 200, body: JSON.stringify({ url: result.url }) };
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return {
      status: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

// ── Analytics handler ─────────────────────────────────────────────────────────

async function handleAnalytics(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      path?: string;
      referrer?: string;
    };
    const path = (body.path ?? "/").slice(0, 2048);
    const referrer = (body.referrer ?? "").slice(0, 2048) || null;
    const userAgent =
      (req.headers.get("user-agent") ?? "").slice(0, 512) || null;

    const { neon } = await import("@neondatabase/serverless");
    const url = process.env.DATABASE_URL;
    if (url) {
      const db = neon(url);
      await db`
        INSERT INTO analytics_events (path, referrer, user_agent)
        VALUES (${path}, ${referrer}, ${userAgent})
      `;
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("analytics error:", err);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ── Sync-Bids handler ─────────────────────────────────────────────────────────

async function handleSyncBidsRoute(
  req: IncomingMessage,
): Promise<{ status: number; body: string }> {
  try {
    // Auth check
    const authHeader = req.headers["authorization"] as string | undefined;
    const expectedToken = process.env.SYNC_TOKEN;

    if (!expectedToken) {
      return {
        status: 500,
        body: JSON.stringify({ error: "SYNC_TOKEN not configured on server" }),
      };
    }

    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return {
        status: 401,
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    const { runSync } = await import("./src/jobs/runner.ts");
    const result = await runSync();

    return { status: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error("sync-bids error:", err);
    return {
      status: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(
      req.url ?? "/",
      `https://${req.headers.host ?? "localhost"}`,
    );

    // Stripe webhook — needs raw body, handle before SSR
    if (url.pathname === "/api/stripe/webhook" && req.method === "POST") {
      const { status, body } = await handleStripeWebhookRoute(req);
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(body);
      return;
    }

    // Analytics endpoint — handle before SSR
    if (url.pathname === "/api/analytics" && req.method === "POST") {
      const webRes = await handleAnalytics(toWebRequest(req));
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      const text = await webRes.text();
      res.end(text);
      return;
    }

    // Privacy Policy — static page
    if (url.pathname === "/privacy" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "public, max-age=3600");
      res.end(PRIVACY_HTML);
      return;
    }

    // Terms of Service — static page
    if (url.pathname === "/terms" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "public, max-age=3600");
      res.end(TERMS_HTML);
      return;
    }

    // SEO: Learn hub
    if (url.pathname === "/learn" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "public, max-age=3600");
      res.end(LEARN_HTML);
      return;
    }

    // SEO: Government contracting guide
    if (url.pathname === "/learn/government-contracting-guide" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "public, max-age=3600");
      res.end(GOV_CONTRACTING_GUIDE_HTML);
      return;
    }

    // SEO: AI proposal writing
    if (url.pathname === "/learn/ai-proposal-writing" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "public, max-age=3600");
      res.end(AI_PROPOSAL_WRITING_HTML);
      return;
    }

    // SEO: Small business contracting
    if (url.pathname === "/learn/small-business-government-contracting" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "public, max-age=3600");
      res.end(SMALL_BIZ_CONTRACTING_HTML);
      return;
    }

    // Sync bids — cron endpoint
    if (url.pathname === "/api/sync-bids" && req.method === "POST") {
      const { status, body } = await handleSyncBidsRoute(req);
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(body);
      return;
    }

    // Make the request cookie + client IP available to route loaders and server
    // functions during SSR (same stash pattern; the IP backs the anonymous
    // /score free-score limit, derived exactly like /api/event's getClientIp).
    (globalThis as any).__contrax_request_cookie__ = (req.headers.cookie as string) || "";
    (globalThis as any).__contrax_request_ip__ = getClientIp(req.headers);
    const webRes = await fetchHandler.fetch(toWebRequest(req));
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    if (webRes.body) {
      const reader = webRes.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
    delete (globalThis as any).__contrax_request_cookie__;
    delete (globalThis as any).__contrax_request_ip__;
  } catch (error) {
    // Log the detail server-side (captured by the host's function logs); never
    // return a stack trace to the public visitor of the site.
    console.error("[team-site] SSR request failed", error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("Internal Server Error");
  }
}
