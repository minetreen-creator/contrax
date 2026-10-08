import { coursePassed, type PracticeLesson, type SelfPacedCourse } from "./self-paced-course";
export const ADVANCED_ID = "government-strategy-advanced-v1";
export const ADVANCED_TITLE = "Government Contracting Strategy and Management";
const far = (section: string, label: string) => ({ label, url: `https://www.acquisition.gov/far/${section}` });
export const ADVANCED_LESSONS: PracticeLesson[] = [
  {
    id: "capture", title: "Build a disciplined pursuit strategy", minutes: 10,
    blocks: [
      { p: "At the advanced level, the question is not only 'Can we bid?' It is 'Why should we spend limited time and money on this opportunity rather than another?' A pursuit strategy connects the buyer's published needs to a specific, deliverable advantage your business can prove." },
      { list: ["Research the buyer using public forecasts, solicitations, award records, and authorized industry events. Separate confirmed information from hypotheses. A forecast is a planning signal, not a guarantee that a solicitation or award will follow.", "Create a pursuit brief: customer need; likely scope; procurement stage; official source; expected timing if published; eligibility checks; evidence of your fit; gaps; and the next decision date. Label unknowns instead of inventing detail.", "Use staged gates. Research gate: is there a plausible fit? Investment gate: is there enough evidence to justify bid effort? Submission gate: are mandatory gaps resolved? Name who can stop the pursuit at each gate.", "Budget the pursuit itself. Estimate staff hours, partner effort, review costs, and opportunity cost. Set a spending limit and a stop condition before enthusiasm turns a weak pursuit into a sunk-cost project."] },
      { p: "Fictional scenario used throughout this course: a facilities-services business is considering a multi-site service contract. It has strong local supervisors but little experience coordinating distant locations. Public documents suggest consistent service reporting matters. The team must decide whether coordination is a real strength, a solvable gap, or a reason to pass." },
      { p: "An incumbent's history can explain the buyer's context, but it does not prove the next contract has the same scope or that the incumbent will compete. Keep a short evidence ledger: fact, public source, date checked, implication, and confidence. Test assumptions again when the actual solicitation arrives." },
      { tip: "Keep acquisition communications within the buyer's authorized channels. Do not seek competitors' proprietary proposals, nonpublic evaluation information, or a promise of preferential treatment." },
    ],
    exercise: "Write a pursuit brief for the fictional multi-site contract or a real public opportunity. Record two confirmed facts, two hypotheses, one investment limit, and a stop condition.",
    worksheet: "Buyer need; stage; source/date; confirmed facts; hypotheses; competitive fit; pursuit budget; gate owner; stop condition",
    sources: [{ label: "SBA: how to win contracts", url: "https://www.sba.gov/counseling/how-to-win-contracts/" }, far("3.104", "FAR: procurement integrity")],
    quiz: [
      { q: "A forecast lists work you want. What does it establish?", options: ["A guaranteed award to your business", "A planning signal to investigate and verify", "The final scope and closing date"], answer: 1, why: "A forecast supports research; the actual procurement can change or may not proceed." },
      { q: "Why set a stop condition before investing heavily?", options: ["To prevent evidence-poor pursuits from consuming unlimited resources", "To avoid reading the solicitation", "To make competitors withdraw"], answer: 0, why: "Decision gates help allocate limited business resources rather than defend sunk costs." },
    ],
  },
  {
    id: "value", title: "Develop an evaluated value proposition", minutes: 10,
    blocks: [
      { p: "A strong advanced proposal connects advantages to the buyer's stated evaluation factors. Read the evaluation method before choosing what to emphasize. Do not assume every procurement rewards a premium service package or simply selects the lowest price." },
      { p: "In the federal negotiated tradeoff process described by FAR 15.101-1, the government can consider price and non-price factors and accept a proposal other than the lowest priced one. The solicitation states the factors and their relative importance. This is not a promise that a higher price or better technical score will win." },
      { list: ["Build a value map: evaluation factor; buyer concern; your specific solution; supporting evidence; measurable benefit; delivery cost. Delete claims that have no relevant evidence or no connection to the requirement.", "Distinguish compliance from a useful discriminator. Meeting a required response time is baseline compliance. A tested backup staffing method may be a differentiator if it addresses an evaluated risk and you can actually deliver it.", "Use measurable commitments carefully. A reporting cadence, escalation time, or quality target creates work and may become part of your contractual obligation. Verify staffing, cost, and feasibility before promising it.", "Review the response from the evaluator's perspective. Can the reviewer find the answer, understand the evidence, and see why it matters without filling gaps on your behalf?"] },
      { p: "For the fictional multi-site contract, 'excellent service' says little. A proposed weekly cross-site exception report could be more useful if consistent reporting is evaluated. The team would need to show the report format, supervisor responsibility, escalation process, and real evidence that it can maintain the reporting—not invent a past result." },
      { tip: "Run a challenge review: for each claimed advantage, ask 'Where is the evidence? Who delivers it? What does it cost? Does this buyer evaluate it?'" },
    ],
    exercise: "Create two value-map rows. For each, identify the evaluated factor, a deliverable advantage, truthful evidence, and the cost or resource needed to support the promise.",
    worksheet: "Evaluation factor; buyer concern; solution; evidence; benefit; delivery owner/cost; unsupported claims to remove",
    sources: [far("15.101-1", "FAR: negotiated tradeoff process"), far("15.304", "FAR: evaluation factors")],
    quiz: [
      { q: "In an applicable federal tradeoff procurement, what determines your proposal emphasis?", options: ["Your favorite marketing slogan", "The published evaluation factors and their relative importance", "A belief that the highest price always wins"], answer: 1, why: "Your response should follow the actual factors; tradeoffs do not guarantee an outcome." },
      { q: "A useful discriminator should be…", options: ["A claim your team cannot support", "Unrelated to the buyer's need", "Relevant, supported by evidence, and feasible to deliver"], answer: 2, why: "An unsupported or unaffordable promise is not a dependable competitive advantage." },
    ],
  },
  {
    id: "teaming", title: "Evaluate partners and teaming risks", minutes: 10,
    blocks: [
      { p: "Teaming can close a capability gap, but it also adds coordination, dependency, and compliance risks. Know whether you are discussing a prime/subcontractor arrangement or a joint venture. FAR 9.601 describes both forms of contractor team arrangements; it does not make their obligations or small-business eligibility interchangeable." },
      { list: ["Check the partner's actual capacity, financial reliability, relevant experience, insurance, licenses, and proposed personnel. Ask for evidence and reference permission. A capability statement alone is not a delivery commitment.", "Map work packages and interfaces: who owns each task, who supervises, who supplies evidence, who reports issues, and who approves changes. Identify the consequences if a partner misses a milestone or withdraws.", "Before relying on a quote, verify scope, quantities, exclusions, validity period, availability, escalation terms, and payment expectations. Align it with the final solicitation and your price model.", "For set-asides, verify the applicable size, certification, affiliation, joint-venture, and limitations-on-subcontracting rules. Do not assume you can pass most work to any partner and remain eligible. Obtain qualified review when the structure or rules are uncertain."] },
      { p: "A teaming checklist should also cover confidentiality, ownership of proposal material, permitted use of references, data access, contract flow-downs, and the transition from a pre-award discussion to an executed subcontract or other agreement. Discuss these matters explicitly; a friendly conversation is not a substitute for understood responsibilities." },
      { p: "In the fictional multi-site scenario, a distant partner can supply local supervisors. The prime still needs to understand reporting interfaces, backup coverage, service failures, and the costs of oversight. Model a partner outage: what work stops, how quickly can a replacement mobilize, and which contract obligations remain your responsibility?" },
      { tip: "Use this lesson to prepare questions for a partner and qualified adviser. It is not a template for signing a legally binding teaming or joint-venture agreement." },
    ],
    exercise: "Draft a partner due-diligence list and a responsibility map for two work packages. Name one partner dependency, a backup action, and a compliance question requiring verification.",
    worksheet: "Partner evidence; work packages; responsibility/interface map; quote assumptions; dependency; backup; compliance review questions",
    sources: [far("9.601", "FAR: contractor team arrangements"), { label: "SBA: set-aside subcontracting limitations", url: "https://www.sba.gov/contracting-officials/" }],
    quiz: [
      { q: "What should happen before a partner quote becomes part of your offer?", options: ["Verify scope, exclusions, availability, and relevant compliance requirements", "Assume it includes everything", "Use it without the partner's knowledge"], answer: 0, why: "A quote must support the actual delivery plan and applicable procurement requirements." },
      { q: "Does having a partner automatically resolve set-aside eligibility and subcontracting limits?", options: ["Yes, every team is eligible", "No; verify the applicable structure and rules", "Yes, if the partner has a website"], answer: 1, why: "Prime/subcontractor and joint-venture arrangements need their own eligibility and compliance analysis." },
    ],
  },
  {
    id: "risk", title: "Stress-test pricing and contract exposure", minutes: 10,
    blocks: [
      { p: "Move beyond one optimistic estimate. Identify how the contract allocates cost, schedule, quantity, and performance risk. Read the actual contract type and clauses; familiar labels do not replace their terms." },
      { p: "FAR 16.202-1 describes firm-fixed-price contracts as placing substantial cost responsibility and resulting profit or loss on the contractor. Under that structure, an overrun is not automatically reimbursed just because your estimate was low. Other contract types allocate risk differently; do not apply this lesson's fixed-price scenario to every contract." },
      { list: ["Build base, adverse, and recovery scenarios. Change explicit assumptions such as productive hours, mobilization, partner cost, fuel, equipment downtime, or collection timing. Identify which assumptions the contract actually allows you to change.", "Keep profit risk separate from cash timing. A delayed accepted invoice can create a cash shortage without changing your estimated total profit. A permanent delivery overrun can change both.", "Create a risk register with cause, consequence, likelihood, impact, trigger, owner, mitigation, and residual risk. Assign costs to mitigation rather than writing 'we will manage it.'", "Review commitments and exposure: service levels, acceptance criteria, insurance, bonds where required, remedies, notice requirements, option periods, volume assumptions, and any price-adjustment mechanism. Mark unclear terms for qualified review before committing."] },
      { p: "Illustrative fixed-price practice case: contract revenue is $120,000 and estimated total cost is $108,000, leaving $12,000 estimated profit. If staffing problems add $9,000 in cost with no authorized price adjustment, estimated profit falls to $3,000. Separately, if the business must pay $18,000 before receipts arrive but has only $10,000 available, it has an $8,000 cash-timing gap. These are invented figures, not a financing recommendation." },
      { tip: "A contingency allowance is a planning choice, not permission to change the buyer's price schedule or recover costs the contract does not allow." },
    ],
    exercise: "Build a base and adverse scenario. Calculate the profit impact and a separate cash-timing gap. Add two risks with named triggers, owners, and costed mitigation actions.",
    worksheet: "Contract type/clauses to verify; base/adverse assumptions; price/cost/profit; cash timing; risk trigger; owner; mitigation/cost",
    sources: [far("16.202-1", "FAR: firm-fixed-price contract description"), { label: "SBA: contracting readiness and cash flow", url: "https://www.sba.gov/counseling/get-started/" }],
    quiz: [
      { q: "In the practice case, $120,000 revenue minus $108,000 cost minus a $9,000 overrun leaves…", options: ["$21,000 estimated profit", "$12,000 estimated profit", "$3,000 estimated profit"], answer: 2, why: "The additional cost reduces the original $12,000 estimated profit to $3,000." },
      { q: "Is a cash-timing shortage the same as a loss on the whole contract?", options: ["No; cash availability and total profit need separate analysis", "Yes, they always mean the same thing", "Neither matters after award"], answer: 0, why: "A contract can remain profitable while requiring cash before payment arrives." },
    ],
  },
  {
    id: "performance", title: "Manage performance and authorized changes", minutes: 10,
    blocks: [
      { p: "A winning proposal becomes a delivery obligation when incorporated into the contract. Build an operating baseline from the actual award: scope, schedule, staff, price, reporting, inspection, acceptance, and invoicing requirements. Confirm the authorized start process before mobilizing." },
      { list: ["Assign an owner to each deliverable and keep a calendar for submissions, service checks, notices, and invoices. Define the evidence that establishes completion and the contact authorized to review it.", "Keep a decision log, issue log, and change log. Record who requested a change, when, what work it affects, and the expected cost and schedule impact. Preserve the original baseline and every authorized revision.", "Escalate risks early through the prescribed channel. An unresolved staffing gap, repeated quality defect, or partner failure should trigger a recovery action before it becomes a missed deliverable.", "Review performance with facts: completion records, inspection results, incident resolution, staffing coverage, and invoice status. Use the contract's metrics rather than inventing a success measure that hides a missed obligation."] },
      { p: "For federal contracts, FAR 43.102 addresses the authority to execute contract modifications and prohibits unauthorized personnel from directing work that should be covered by a modification. A site contact's request is not automatically a valid change to your contract. Identify the authorized official and follow applicable clauses and notice procedures; obtain timely qualified help when an instruction, disputed change, or urgent situation is unclear." },
      { p: "Fictional scenario: a site manager asks your multi-site team to add weekend service. Before treating it as paid additional work, document the request and assess scope, hours, price, and schedule. Refer it through the contract's authorized process. Do not assume silence approves extra payment, and do not use this scenario as advice to ignore an actual contractual duty." },
      { tip: "Operational staff need to know where routine service coordination ends and a potential contract change begins. Make the escalation route part of kickoff training." },
    ],
    exercise: "Draft a kickoff baseline and a change-log entry for the weekend-service request. Name the authorized approval path, required verification, affected tasks, and expected cost/schedule impact.",
    worksheet: "Deliverables/owners; acceptance evidence; calendar; issue/recovery actions; change request; authority; cost/schedule impact; notice requirements to verify",
    sources: [far("43.102", "FAR: contract modification authority"), far("42.1503", "FAR: performance evaluation procedures")],
    quiz: [
      { q: "A site contact requests added service. What should you verify?", options: ["Only whether the contact sounds confident", "Scope, authority, and the contract's change/notice process", "Nothing if you expect a future award"], answer: 1, why: "A request must be assessed against contractual authority and applicable procedures." },
      { q: "What is a dependable operating baseline?", options: ["The actual award's obligations, owners, schedule, and acceptance evidence", "An old marketing brochure", "Only the headline contract value"], answer: 0, why: "The delivery team needs a concrete plan tied to the awarded contract." },
    ],
  },
  {
    id: "improve", title: "Turn delivery evidence into future strength", minutes: 10,
    blocks: [
      { p: "Advanced contracting is a cycle: pursue selectively, commit realistically, deliver, retain evidence, and improve. A future proposal is stronger when your business has truthful, relevant records rather than a collection of unsupported success claims." },
      { list: ["Maintain a project evidence file: actual scope and role, delivery period, approved changes, quality records, issue resolutions, measurable results, and reference permissions. Protect customer and partner information; do not publish confidential material.", "For federal contracts subject to performance evaluation, understand the applicable CPARS process and review opportunities. FAR 42.1503 calls for evaluations supported by objective facts. Use the actual notification and procedures rather than assuming a universal response deadline.", "Request permitted feedback after an unsuccessful pursuit using the buyer's process. Capture the stated weaknesses and distinguish them from your own hypotheses. Do not infer competitors' confidential proposal content from an award notice.", "Run an after-action review against the original pursuit brief and risk register. Which assumptions were wrong? Which mitigation worked? What should change in estimating, partner selection, proposal evidence, or delivery controls?"] },
      { p: "Capstone: combine the six exercises into a strategy and management plan for the fictional multi-site contract or a real opportunity. The plan should include decision gates, an evaluated value proposition, a partner responsibility map, adverse cost and cash scenarios, a delivery baseline, a change-control route, and an evidence/improvement plan." },
      { p: "The capstone is a planning worksheet, not a finished proposal, legal agreement, or government-approved management plan. Check it for consistency: if the value proposition promises rapid backup staffing, the partner map, cost model, and operating baseline must show how that promise is delivered." },
      { tip: "Choose one measurable improvement for the next pursuit, with an owner and review date. More bids alone do not prove a better contracting process." },
    ],
    exercise: "Complete your strategy and management worksheet. Identify one inconsistency to fix and one evidence-backed improvement with an owner and review date.",
    worksheet: "Project evidence; reference permissions; evaluation/feedback procedures; lessons learned; capstone consistency check; next improvement/owner/date",
    sources: [far("42.1503", "FAR: objective performance evaluations"), far("15.506", "FAR: applicable postaward debriefing procedures")],
    quiz: [
      { q: "What belongs in a reusable project evidence file?", options: ["Invented ratings and competitor rumors", "Only your bid's original promises", "Truthful delivery records, relevant results, and permitted references"], answer: 2, why: "Past-performance claims should be supported by actual work and appropriate permissions." },
      { q: "A value proposition promises rapid backup staffing. What must the capstone also show?", options: ["A partner/staffing plan, cost assumptions, and operating controls that support it", "Only a bold headline", "A guarantee that the buyer will award the next contract"], answer: 0, why: "Strategy, pricing, partners, and delivery must agree with the commitments you make." },
    ],
  },
];
export const ADVANCED_COURSE: SelfPacedCourse = {
  id: ADVANCED_ID, key: "contrax_course_advanced_v1", title: ADVANCED_TITLE, level: "Advanced", minutes: 60,
  lessons: ADVANCED_LESSONS,
  summary: "Build a stronger pursuit strategy, evaluate partners, stress-test contract risk, and plan disciplined performance after award.",
  prerequisiteHref: "/learn/intermediate-government-contracting", prerequisiteLabel: "Review the intermediate course",
  worksheetLabel: "strategy and management plan", worksheetFile: "contrax-contract-strategy-plan.txt",
};
export const advancedPassed = (value: unknown) => coursePassed(ADVANCED_COURSE, value);
