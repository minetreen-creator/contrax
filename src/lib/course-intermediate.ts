import type { SelfPacedCourse } from "./self-paced-course";
import type { Lesson } from "./course-construction";

export const INTERMEDIATE_ID = "government-bids-intermediate-v1";
export const INTERMEDIATE_TITLE = "Preparing a Government Contract Bid";
export const INTERMEDIATE_KEY = "contrax_course_intermediate_v1";
const far = (section: string, label: string) => ({ label, url: `https://www.acquisition.gov/far/${section}` });
export const INTERMEDIATE_LESSONS: (Lesson & { exercise: string; worksheet: string })[] = [
  {
    id: "decision", title: "Make a bid or no-bid decision", minutes: 7,
    blocks: [
      { p: "An attractive contract is not automatically a good contract for your business. Before drafting, decide whether you can meet the requirements, deliver the work, and afford the effort. The goal is a defensible decision, not a promise that you will win." },
      { list: ["Confirm eligibility from the current solicitation: business size, required certifications, licenses, location restrictions, registrations, and mandatory meetings. Separate things you already have from things you must obtain.", "Check delivery capacity: people, equipment, start date, geography, insurance, and any bonding requirements. Write down the gap, the person responsible, and when it can be closed.", "Estimate bid effort and working capital. Can you fund wages, materials, and subcontractors before payment under the published terms? Do not assume an advance or guaranteed work volume.", "Read the evaluation approach. Is the buyer judging price alone, technical approach, experience, or some combination? Identify evidence your business can actually supply."] },
      { p: "Practice scenario (fictional): your cleaning company can staff an evening office-cleaning contract, but the solicitation requires a mandatory site visit tomorrow. Your supervisor is available, your insurance needs an update, and your cash reserve covers only one payroll cycle. A good decision records these conditions; it does not simply say 'cleaning is our trade.'" },
      { tip: "Use three outcomes: bid; bid only if named gaps are resolved; or no bid. A missed mandatory requirement is a stop sign, not a low score you can average away." },
    ],
    exercise: "Choose an opportunity on Radar or use the fictional cleaning scenario. Record your decision, two delivery risks, and one condition that must be resolved before you commit.",
    worksheet: "Bid/no-bid decision, reasons, capacity gaps, owner, resolution date",
    sources: [{ label: "SBA: how to win contracts", url: "https://www.sba.gov/counseling/how-to-win-contracts/" }],
    quiz: [
      { q: "Your team matches the trade, but cannot attend a required site visit. What comes first?", options: ["Write a strong proposal anyway", "Resolve the mandatory requirement or decide not to bid", "Assume the visit is optional"], answer: 1, why: "Trade fit does not replace a mandatory solicitation requirement." },
      { q: "What should a conditional bid decision include?", options: ["A promise of winning", "Only the contract's headline value", "Specific gaps, owners, and dates for resolving them"], answer: 2, why: "Conditions must be concrete enough to check before bid work proceeds." },
    ],
  },
  {
    id: "requirements", title: "Turn the solicitation into a compliance checklist", minutes: 8,
    blocks: [
      { p: "Download the official solicitation, attachments, forms, and amendments. Start a document list with filenames and revision dates. A summary helps you navigate, but the buyer's current documents control what you must submit." },
      { list: ["Locate the scope, submission instructions, evaluation factors, required forms, price schedule, and contract terms. Some federal negotiated solicitations use Section L for instructions and Section M for evaluation factors; other federal, state, and local formats differ.", "Create one checklist row per requirement: document/page reference; exact requirement; response location; responsible person; evidence needed; status. Keep 'must submit' separate from 'will be evaluated.'", "Record the closing date, stated time zone, question deadline, required meeting dates, submission method, file limits, signatures, and amendment acknowledgment instructions.", "Maintain an amendment log. Recheck the official portal and update your checklist when scope, quantities, forms, or dates change. Do not rely on an old downloaded copy."] },
      { p: "Example checklist row: 'Attachment B, page 2 | Provide three references | Past performance file, page 3 | Owner: Jordan | Obtain permission and current contact details | Pending.' Another row could cover an authorized signature or a portal upload limit. This prevents an impressive narrative from hiding a missing document." },
      { tip: "Ask the buyer through the solicitation's stated channel when a requirement is unclear. Do not assume an informal conversation changes the written requirements." },
    ],
    exercise: "Write three checklist rows: one required form, one evaluated response, and one submission rule. Add a question you would send through the authorized channel.",
    worksheet: "Requirement | document/page | response location | owner | evidence | status; question and amendment log",
    sources: [far("15.204-5", "FAR: federal proposal instructions and evaluation sections"), far("15.206", "FAR: solicitation amendments")],
    quiz: [
      { q: "In a federal solicitation using the uniform negotiated contract format, where are proposal instructions usually found?", options: ["Section L", "Every buyer's homepage", "Only in the award notice"], answer: 0, why: "Section L carries instructions in that format; other formats may use different headings." },
      { q: "A new amendment changes the required price form. What should you do?", options: ["Keep your old form because it is finished", "Update the checklist and response using the amendment's instructions", "Ignore amendments unless the closing date changes"], answer: 1, why: "Amendments can change more than the deadline, including the documents you must submit." },
    ],
  },
  {
    id: "price", title: "Build a price you can deliver", minutes: 8,
    blocks: [
      { p: "Start with the buyer's units and quantities. A monthly service price, hourly rate, per-trip price, and annual total are different things. Use the required price schedule and check each extension. Separate a stated estimate from a guaranteed quantity." },
      { list: ["Build direct costs: labor hours and fully loaded rates, materials, travel, equipment, and subcontractor quotes. Document what is included and avoid counting the same cost twice.", "Add overhead allocations and identified delivery risks. Check the actual solicitation for applicable labor requirements, insurance, bonds, and other costs; do not use a generic wage or assumed exemption.", "Choose profit deliberately. Markup is profit divided by cost; margin is profit divided by selling price. Neither is a guarantee of the profit you will actually earn.", "Model cash timing separately from profit: when payroll and supplier payments leave your account, when invoices can be submitted, and when the contract terms provide for payment. Test whether you can sustain a delay."] },
      { p: "Illustrative monthly example, not a wage recommendation: 160 hours at a fully loaded $25 per hour is $4,000. Supplies of $500 and allocated overhead of $500 bring estimated cost to $5,000. A $5,500 price leaves $500 estimated profit: 10% markup on cost, but about 9.1% margin on price. Missing costs or extra hours reduce that profit." },
      { p: "Before using the example, verify that the hours, staffing, rate, and service frequency match the actual scope. A low price based on fewer visits than the buyer requires is not a sustainable estimate. Where assumptions are permitted, state them clearly; do not make exceptions the solicitation prohibits." },
      { tip: "Review optional periods, minimum charges, overtime, mobilization, and any escalation instructions. Check that the narrative and pricing describe the same delivery plan." },
    ],
    exercise: "Draft a simple cost model for your trade. Show units, quantities, direct costs, overhead, price, estimated profit, and the cash reserve you would need under your payment assumptions.",
    worksheet: "Units and quantities; labor; other direct costs; overhead; price; profit; cash timing; assumptions to verify",
    sources: [{ label: "SBA: get started with contracting", url: "https://www.sba.gov/counseling/get-started/" }],
    quiz: [
      { q: "Estimated cost is $5,000 and price is $5,500. What is estimated profit before missing costs or overruns?", options: ["$5,500", "$500", "$50"], answer: 1, why: "Price minus estimated cost is $500. Markup and margin use different denominators." },
      { q: "Why make a cash-flow plan as well as a profit estimate?", options: ["A profitable job can still need cash before the buyer pays", "Profit guarantees cash is available today", "Every government contract pays an advance"], answer: 0, why: "Payroll and supplier bills may come before contract payment; the published terms matter." },
    ],
  },
  {
    id: "evidence", title: "Write a response backed by evidence", minutes: 7,
    blocks: [
      { p: "Write to the buyer's requirements and evaluation factors. Follow the required order and limits so reviewers can find your answers. A general capability statement may support your response, but it does not replace the specific proposal sections requested." },
      { list: ["For each important requirement, explain your approach, identify who will do the work, and show how you will check quality. Use a schedule or named responsibility when it helps make the plan verifiable.", "Use a claim-evidence-benefit pattern: what you can do; a truthful example or supporting document; why it matters to this buyer. Avoid unsupported claims such as 'best in the state.'", "Build concise project summaries: customer and work type, your actual role, size or dates where relevant, result, and a reference the customer permits you to provide. Follow the solicitation's definitions and instructions for experience and past performance.", "Do not invent a government customer, certification, project result, staff qualification, or subcontractor commitment. If AI assists with drafting, verify every claim and check the final response against the source documents."] },
      { p: "Weak: 'We provide excellent cleaning.' Stronger fictional example: 'Our supervisor checks the required rooms against a nightly checklist, logs missed tasks, and assigns corrections before the next shift. On a comparable private office project, we used this process to document completion.' Use that statement only if it describes your real process and experience." },
      { tip: "Lack of federal work does not justify invented past performance. Read what evidence this solicitation allows. Ask for clarification if private-sector projects, key-personnel experience, or other evidence are not clearly addressed." },
    ],
    exercise: "Draft a 100-word approach for one requirement, then add one truthful evidence item and one project summary. Label any fact that still needs verification.",
    worksheet: "Requirement; approach; responsible person; quality check; evidence; project summary; facts to verify",
    sources: [far("15.304", "FAR: evaluation factors"), far("15.305", "FAR: proposal evaluation and past performance")],
    quiz: [
      { q: "Which response is easiest for a reviewer to assess?", options: ["A broad promise of excellence", "A long company history unrelated to the scope", "A specific approach supported by truthful evidence"], answer: 2, why: "Specific actions and evidence help the reviewer evaluate the required work." },
      { q: "An AI draft invents a previous government customer. What should you do?", options: ["Keep it if it sounds convincing", "Remove it and use verified, permitted evidence", "Change only the customer's name"], answer: 1, why: "Drafting assistance does not make a false experience claim acceptable." },
    ],
  },
  {
    id: "submit", title: "Review, submit, and keep proof", minutes: 8,
    blocks: [
      { p: "Treat submission as a separate project milestone. The person who wrote the response should not be its only reviewer if another person is available. Start with the compliance checklist, then review consistency across the approach, staffing, schedule, and price." },
      { list: ["Run a compliance review: required files, signatures, forms, amendment acknowledgments where required, references, page limits, and file names. Open the final exported files; do not check only the editable originals.", "Run a delivery review: test whether the stated staff, hours, equipment, and subcontractors can meet the scope. Check arithmetic, units, price totals, and dates against the narrative.", "Verify the buyer's submission route and stated time zone. Create or test portal access early where needed. Leave time for upload problems; pressing Upload may not be the same as finishing a required Submit step.", "Keep the exact submitted files and confirmation number, receipt, or other permitted proof. Verify that the portal or buyer indicates a completed submission. Follow the published instructions if a correction or replacement is needed."] },
      { p: "Do not build a plan around late-submission exceptions. Federal rules and solicitation provisions address late offers, and state and local processes differ. Your practical goal is a correctly completed submission before the published deadline. An unexplained missing receipt deserves immediate attention through the authorized contact channel." },
      { tip: "Set your internal deadline earlier than the buyer's deadline. Record the person submitting, the backup person, and where the confirmation will be stored." },
    ],
    exercise: "Build a preflight checklist with five checks, an internal deadline, an authorized submission route, and a plan for preserving proof of submission.",
    worksheet: "Preflight checks; internal deadline and zone; submission owner and backup; authorized route; confirmation location",
    sources: [far("52.215-1", "FAR: instructions to offerors for applicable competitive acquisitions")],
    quiz: [
      { q: "Your files uploaded, but the portal still shows Draft. What should you do?", options: ["Assume the bid was submitted", "Follow the portal's final submission steps and verify completion", "Wait until after closing to ask"], answer: 1, why: "A saved upload can remain a draft; check the buyer's actual completion requirements." },
      { q: "What should you preserve after submitting?", options: ["The submitted version and available confirmation", "Only an earlier editable draft", "Nothing once the deadline passes"], answer: 0, why: "A retained package and receipt help establish what you submitted and when." },
    ],
  },
  {
    id: "follow-up", title: "Plan your next step after submission", minutes: 7,
    blocks: [
      { p: "Submission is the start of a tracking phase, not permission to begin work. Monitor the official portal and designated communications. Log clarification requests and respond through the stated channel by the applicable deadline." },
      { list: ["Track status, contact, next action, and follow-up date. In Contrax, a saved bid can be managed in the Bid Workspace; use your own worksheet if your plan does not include that tool.", "If selected, read the actual award or contract, reconcile scope and price, and confirm the authorized start process. Build a kickoff plan with staffing, access, deliverables, inspection, invoicing, and issue reporting.", "If not selected, check the notice and procurement rules for available feedback or debriefing procedures and any time limits. Do not assume every buyer must provide the same kind of debriefing.", "Compare what you learned with your original bid decision and estimate. Update your reusable evidence and checklist. Choose one concrete improvement for the next opportunity."] },
      { p: "Capstone: combine your six exercises into a one-page bid plan. It should name the opportunity; record a bid decision; list unresolved requirements; outline delivery and evidence; summarize pricing assumptions; assign submission responsibility; and schedule follow-up. This is a preparation tool, not a finished proposal or an award guarantee." },
      { tip: "If a clarification changes what you believe the buyer needs, check for a formal written change. Keep your records tied to the official documents." },
    ],
    exercise: "Finish the bid plan below and set one next action with an owner and date. If you use a fictional scenario, clearly label it as practice.",
    worksheet: "Status; next action; owner; follow-up date; kickoff considerations; improvement for the next bid",
    sources: [far("15.506", "FAR: postaward debriefing procedures for applicable negotiated acquisitions"), { label: "SBA: how to win contracts", url: "https://www.sba.gov/counseling/how-to-win-contracts/" }],
    quiz: [
      { q: "A proposal was submitted. When should your business begin contracted work?", options: ["Immediately after uploading", "After the applicable award and authorized start process", "When another bidder says you won"], answer: 1, why: "Submission alone is not authorization to begin performance." },
      { q: "What is a useful follow-up record?", options: ["A reminder with no date or owner", "A guess that the contract is yours", "A next action, responsible person, and follow-up date"], answer: 2, why: "A concrete next step makes the opportunity manageable after submission." },
    ],
  },
];
export const INTERMEDIATE_MINUTES = INTERMEDIATE_LESSONS.reduce((sum, lesson) => sum + lesson.minutes, 0);
export type IntermediateAnswers = Record<string, (number | null)[]>;
export function lessonPassed(id: string, answers: IntermediateAnswers): boolean {
  const lesson = INTERMEDIATE_LESSONS.find(l => l.id === id);
  return !!lesson && lesson.quiz.every((q, i) => answers[id]?.[i] === q.answer);
}
export function intermediatePassed(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return INTERMEDIATE_LESSONS.every(l => lessonPassed(l.id, value as IntermediateAnswers));
}
export function readIntermediateProgress(raw: string | null): { answers: IntermediateAnswers; notes: Record<string, string> } {
  const result: { answers: IntermediateAnswers; notes: Record<string, string> } = { answers: {}, notes: {} };
  try {
    const value = JSON.parse(raw || "{}");
    for (const l of INTERMEDIATE_LESSONS) {
      const answers = value?.answers?.[l.id];
      if (Array.isArray(answers)) result.answers[l.id] = l.quiz.map((q, i) => Number.isInteger(answers[i]) && answers[i] >= 0 && answers[i] < q.options.length ? answers[i] : null);
      if (typeof value?.notes?.[l.id] === "string") result.notes[l.id] = value.notes[l.id].slice(0, 4000);
    }
  } catch { /* Fresh start if storage is unavailable or malformed. */ }
  return result;
}
export function bidPlanText(notes: Record<string, string>): string {
  return `${INTERMEDIATE_TITLE}\nContrax practice worksheet — not a submitted proposal\n\nOpportunity/reference: ____________________\nOfficial source: ____________________\n\n` + INTERMEDIATE_LESSONS.map((l, i) => `${i + 1}. ${l.title}\n${l.worksheet}\n${notes[l.id]?.trim() || "[Add your notes]"}`).join("\n\n");
}

export const INTERMEDIATE_COURSE: SelfPacedCourse = {
  id: INTERMEDIATE_ID, key: INTERMEDIATE_KEY, title: INTERMEDIATE_TITLE, level: "Intermediate",
  minutes: INTERMEDIATE_MINUTES, lessons: INTERMEDIATE_LESSONS,
  summary: "Turn an opportunity into a practical bid plan. Build a checklist, work through pricing, organize your evidence, and prepare for submission.",
  prerequisiteHref: "/learn/government-contracting", prerequisiteLabel: "Start with our introductory course",
  worksheetLabel: "bid-planning worksheet", worksheetFile: "contrax-bid-plan.txt",
  nextHref: "/learn/advanced-government-contracting", nextTitle: "Government Contracting Strategy and Management",
};
