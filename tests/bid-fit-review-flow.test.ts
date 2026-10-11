import { adsTagAllowed } from "../src/lib/google-ads";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReviewCheckout, handleReviewPaymentEvent, validPdf, validReviewToken, tokenHash } from "../src/lib/bid-fit-review-flow.server";

function fakeDb(row: any) {
  const writes: {query:string; values:unknown[]}[]=[];
  const db=async (parts:TemplateStringsArray,...values:unknown[])=> {
    const query=parts.join("?");
    if(query.includes("SELECT")) return row ? [row] : [];
    writes.push({query,values}); return [{id:1}];
  };
  return {db:db as any,writes};
}
function event(overrides:Record<string,unknown>={},type="checkout.session.completed") {
  return {type,data:{object:{id:"cs_review",mode:"payment",payment_status:"paid",currency:"usd",amount_total:9900,
    metadata:{product:"bid_fit_review",review_request_id:"1"},payment_intent:"pi_review",...overrides}}} as any;
}
test("private tokens reject short guesses and PDFs enforce signature and size",()=>{
  assert.equal(validReviewToken("a".repeat(64)),true);
  assert.equal(validReviewToken("1"),false);
  assert.notEqual(tokenHash("a".repeat(64)),"a".repeat(64));
  assert.equal(validPdf(Buffer.from("%PDF-1.7 data")),true);
  assert.equal(validPdf(Buffer.from("<script>bad</script>")),false);
  assert.equal(validPdf(Buffer.concat([Buffer.from("%PDF-"),Buffer.alloc(3000000)])),false);
});
test("unrelated product events never write review data",async()=>{
  const f=fakeDb(null);
  assert.equal(await handleReviewPaymentEvent(event({metadata:{product:"bid_scout"}}),f.db),false);
  assert.equal(f.writes.length,0);
});
test("only the accepted request's exact session may confirm payment",async()=>{
  for(const row of [null,{accepted_at:null,checkout_session_id:"cs_review"},{accepted_at:"now",checkout_session_id:"cs_other"}]) {
    const f=fakeDb(row);await assert.rejects(()=>handleReviewPaymentEvent(event(),f.db));assert.equal(f.writes.length,0);
  }
  for(const amount of [4900,0,9901]) {
    const f=fakeDb({accepted_at:"now",checkout_session_id:"cs_review"});
    await assert.rejects(()=>handleReviewPaymentEvent(event({amount_total:amount}),f.db));assert.equal(f.writes.length,0);
  }
});
test("delayed payment waits for paid confirmation; repeated/late events cannot undo payment",async()=>{
  const f=fakeDb({accepted_at:"now",checkout_session_id:"cs_review"});
  await handleReviewPaymentEvent(event({payment_status:"unpaid"}),f.db);
  assert.ok(f.writes[0].values.includes("processing"));
  assert.ok(f.writes[0].query.includes("payment_status<>'paid'"));
  await handleReviewPaymentEvent(event({},"checkout.session.async_payment_succeeded"),f.db);
  assert.ok(f.writes[1].query.includes("paid_at=COALESCE(paid_at,NOW())"));
  assert.ok(f.writes[1].query.includes("CASE WHEN status='awaiting_payment'"));
  await handleReviewPaymentEvent(event({payment_status:"unpaid"},"checkout.session.expired"),f.db);
  assert.ok(f.writes[2].query.includes("payment_status<>'paid'"));
});
test("checkout refuses unaccepted and paid requests; accepted review is exactly $99 once",async()=>{
  let params:any,options:any;let creates=0;
  const stripe={checkout:{sessions:{create:async(p:any,o:any)=>{params=p;options=o;creates++;return {id:"cs_review",url:"https://checkout.stripe.com/review"};},retrieve:async()=>({status:"open",url:"https://checkout.stripe.com/reuse"})}}} as any;
  for(const row of [{accepted_at:null,status:"new",payment_status:"unpaid"},{accepted_at:"now",status:"awaiting_payment",payment_status:"paid"}])
    await assert.rejects(()=>createReviewCheckout(1,{db:fakeDb(row).db,stripe}));
  const f=fakeDb({id:1,email:"applicant@example.com",accepted_at:"now",status:"awaiting_payment",payment_status:"unpaid"});
  await createReviewCheckout(1,{db:f.db,stripe});
  assert.equal(params.mode,"payment");assert.equal(params.line_items[0].price_data.unit_amount,9900);
  assert.equal(params.metadata.review_request_id,"1");assert.equal(params.payment_method_types,undefined);
  assert.ok(options.idempotencyKey);assert.equal(creates,1);
  await createReviewCheckout(1,{db:fakeDb({...f,accepted_at:"now",status:"awaiting_payment",payment_status:"unpaid",checkout_session_id:"cs_existing"}).db,stripe});
  assert.equal(creates,1);
});

test("private request pages do not enable advertising tags",()=>{
  assert.equal(adsTagAllowed("/bid-fit-review/request"),false);
  assert.equal(adsTagAllowed("/bid-fit-review"),true);
});
test("stale checkout creation expires the unshared session",async()=>{
  let expired=false;
  const db=async(parts:TemplateStringsArray)=>parts.join("").includes("SELECT")
    ? [{email:"a@example.com",status:"awaiting_payment",accepted_at:"now",payment_status:"unpaid"}] : [];
  const stripe={checkout:{sessions:{create:async()=>({id:"cs_stale",url:"https://checkout.stripe.com/stale"}),expire:async()=>{expired=true;}}}} as any;
  await assert.rejects(()=>createReviewCheckout(1,{db:db as any,stripe})); assert.equal(expired,true);
});
