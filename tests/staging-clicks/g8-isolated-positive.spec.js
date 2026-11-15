'use strict';
/** @komerce-arch-lite
 * @role g8-isolated-positive-real-chromium
 * @domain refunds
 * @layer e2e
 * @owner backend-core
 * @purpose Real Chromium/HTTP/PG16 with SYNTHETIC paid facts, never shared staging.
 * @impact-areas refunds, payments, cash
 */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {test,expect}=require('@playwright/test'),db=require('../../db');
const ROOT='test-results/g8-positive-isolated',LOCAL='http://localhost:3917';
const plan=JSON.parse(fs.readFileSync(path.join(ROOT,'prepare.json'),'utf8'));
const proof={kind:'G8_POSITIVE_SYNTHETIC_ONLY',staging_go:false,realMoney:0,checks:[],
  http:[],blocked:[],jsErrors:[],verdict:'NOT_PROVEN'};
function check(name,ok,detail){
 proof.checks.push({name,pass:Boolean(ok),detail:detail||null});
 if(!ok)throw Error('G8_FAIL:'+name+':'+String(detail||''));
}
async function login(browser,key){
 const env={admin:'G8_ADMIN_EMAIL',relay:'G8_RELAY_EMAIL',
   operator:'G8_OPERATOR_EMAIL',reviewer:'G8_REVIEWER_EMAIL'};
 const ctx=await browser.newContext({baseURL:LOCAL}),page=await ctx.newPage();
 await page.route('**/*',route=>{
  const q=route.request(),u=new URL(q.url());
  if(u.origin!==LOCAL){proof.blocked.push('external:'+u.origin);return route.abort('blockedbyclient');}
  if(['GET','HEAD','OPTIONS'].includes(q.method())||q.method()==='POST'&&(
    u.pathname==='/api/auth/login'||
    u.pathname.startsWith('/api/admin/orders/')||
    u.pathname.startsWith('/api/relay/orders/')))return route.continue();
  proof.blocked.push(q.method()+' '+u.pathname);
  return route.abort('blockedbyclient');
 });
 page.on('dialog',dialog=>dialog.accept());
 page.on('pageerror',error=>proof.jsErrors.push(String(error.message).slice(0,160)));
 await page.goto('/login.html?next='+encodeURIComponent('/g8-remboursements.html'),{waitUntil:'domcontentloaded'});
 await page.locator('#email').fill(process.env[env[key]]);
 await page.locator('#password').fill(process.env.G8_PASSWORD);
 const auth=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
 await page.locator('#btn-submit').click();
 const a=await auth;check('login_'+key,a.status()===200,a.status());
 await page.waitForURL(u=>u.pathname==='/g8-remboursements.html',{timeout:20000});
 await expect(page.locator('#g8-env')).toHaveText('Recette autorisée',{timeout:20000});
 return {ctx,page};
}
async function clickPost(page,where,fields,name,suffix,okStatus){
 const node=page.locator(where);await expect(node).toBeVisible();
 if(fields)for(const [key,value] of Object.entries(fields))
   await node.locator('[name="'+key+'"]').fill(String(value));
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith(suffix));
 await node.getByRole('button',{name}).click();
 const r=await response,b=await r.json().catch(()=>({}));
 proof.http.push({action:suffix,status:r.status(),code:b.code||null});
 check('UI_POST_'+suffix,okStatus.includes(r.status()),b.code||r.status());
 return b;
}
async function rawPost(page,url,body,expected,name){
 const r=await page.request.post(url,{data:body||{},headers:{origin:LOCAL}}),b=await r.json().catch(()=>({}));
 check(name+'_not_csrf',b.code!=='csrf_origin_required',b.code||null);
 check(name,expected.includes(r.status()),b.code||r.status());
 proof.http.push({action:name,status:r.status(),code:b.code||null});
 return b;
}
test('G8 cash and manual mobile synthetic positive UI, real HTTP and PG16',async({browser,request})=>{
 require('../../scripts/recette/hub-v1-certification-runner').assertEphemeralTarget(process.env.DATABASE_URL,[]);
 if(plan.kind!=='G8_ISOLATED_SYNTHETIC'||plan.staging_go!==false||
    plan.noRealTransfers!==true||plan.noPhysicalCashHandover!==true)
   throw Error('G8_REAL_PAYOUT_PROHIBITED');
 fs.mkdirSync(ROOT,{recursive:true});
 const actors=[];
 try {
  const r=await request.get('/health/version');
  check('server_version',r.status()===200);
  check('same_commit',(await r.json()).commit===process.env.E2E_EXPECTED_DEPLOY_SHA);
  for(const key of ['admin','relay','operator','reviewer'])actors.push(await login(browser,key));
  const [admin,relay,operator,reviewer]=actors.map(a=>a.page);
  const cash=plan.cases.cash,mm=plan.cases.mobile;
  // The first author is deliberately a genuine browser form; no mocked API.
  await admin.locator('#g8-new-reservation summary').click();
  const cashReserved=await clickPost(admin,'#g8-new-reservation',{
   order_id:cash.orderId,order_item_id:cash.itemId,incident_id:cash.incidentId,
   quantity:1,reason:'SYNTHETIC G8 cash missing '+plan.run},
   'Réserver cette dette','/local-refund-reservations',[202]);
  check('cash_liability_not_paid',cashReserved.status==='reserved'&&cashReserved.paid===false);
  const cashId=cashReserved.reservationId;
  await expect(admin.locator('[data-g8-case="'+cashId+'"]')).toBeVisible();
  const cashApproved=await clickPost(admin,'[data-g8-case="'+cashId+'"]',{
   holder_id:plan.ids.relay,original_payer_proof_ref:'G8-SYNTH-PAYER-'+plan.run,
   identity_check_proof_ref:'G8-SYNTH-CHECK-'+plan.run},
   'Autoriser la remise au relais','/authorize-cash',[201]);
  check('cash_approved_not_paid',cashApproved.status==='approved'&&!cashApproved.paid);
  const relBase='/api/relay/orders/'+cash.orderId+'/items/'+cash.itemId+
   '/local-cash-handoffs/'+cashApproved.authorizationId;
  await rawPost(admin,relBase+'/start',{},[403],'unauthorized_cash_handoff');
  await relay.locator('#g8-refresh').click();
  await expect(relay.locator('[data-g8-case="'+cashApproved.authorizationId+'"]')).toBeVisible();
  const began=await clickPost(relay,'[data-g8-case="'+cashApproved.authorizationId+'"]',null,
   'Engager une remise physique','/start',[202]);
  check('cash_pending_not_paid',began.status==='handoff_pending'&&!began.paid);
  await relay.locator('#g8-refresh').click();
  const cashEvidence={signed_receipt_ref:'G8-SYNTH-RECEIPT-'+plan.run,
   payer_signature_proof_ref:'G8-SYNTH-SIGNATURE-'+plan.run,
   witness_proof_ref:'G8-SYNTH-WITNESS-'+plan.run};
  const cashDone=await clickPost(relay,'[data-g8-case="'+cashApproved.authorizationId+'"]',cashEvidence,
   'Confirmer après remise réelle des espèces','/confirm',[200]);
  check('cash_synthetic_settled',cashDone.status==='settled'&&cashDone.paid===true);
  const replay=await rawPost(relay,relBase+'/confirm',cashEvidence,[200],'cash_replay_identical');
  check('cash_replay_same_refund',replay.replayed===true&&replay.refundId===cashDone.refundId);
  await rawPost(relay,relBase+'/confirm',{...cashEvidence,signed_receipt_ref:'G8-OTHER-SYNTH-'+plan.run},[409],
   'cash_replay_divergent_denied');
  await relay.screenshot({path:path.join(ROOT,'f1-synthetic.png'),fullPage:true});
  // F2 fixture has a synthetic successful source capture in LOCAL PG, not a provider.
  const mobileReserved=await clickPost(admin,'#g8-new-reservation',{
   order_id:mm.orderId,order_item_id:mm.itemId,incident_id:mm.incidentId,
   quantity:1,reason:'SYNTHETIC G8 mobile missing '+plan.run},
   'Réserver cette dette','/local-refund-reservations',[202]);
  check('mobile_liability_not_paid',mobileReserved.status==='reserved'&&mobileReserved.paid===false);
  const mid=mobileReserved.reservationId;
  await expect(admin.locator('[data-g8-case="'+mid+'"]')).toBeVisible();
  const payer=crypto.createHash('sha256').update('SYNTHETIC-'+plan.run).digest('hex');
  const auth=await clickPost(admin,'[data-g8-case="'+mid+'"]',{
   operator_id:plan.ids.operator,payer_fingerprint:payer,
   original_payer_proof_ref:'G8-SYNTH-MM-PAYER-'+plan.run},
   'Autoriser le virement manuel','/approve',[202]);
  check('mobile_approved_not_paid',auth.status==='approved'&&!auth.paid);
  const mmBase='/api/admin/orders/'+mm.orderId+'/items/'+mm.itemId+
   '/local-refund-reservations/'+mid+'/manual-mobile';
  await rawPost(admin,mmBase+'/start',{},[403],'wrong_mobile_operator_denied');
  await operator.locator('#g8-refresh').click();
  await expect(operator.locator('[data-g8-case="'+mid+'"]')).toBeVisible();
  const mmStart=await clickPost(operator,'[data-g8-case="'+mid+'"]',null,
   'Prendre en charge le transfert externe','/start',[202]);
  check('mobile_pending_not_paid',mmStart.status==='transfer_pending'&&!mmStart.paid);
  const evidence={amount_minor:mobileReserved.amountMinor,currency:'KMF',
    payee_fingerprint:payer,capture_external_transaction_id:mm.captureRef,
    transfer_ref:'G8-SYNTH-TRANSFER-'+plan.run,
    transfer_proof_ref:'G8-SYNTH-PROVIDER-RECEIPT-'+plan.run,
    operator_verification_ref:'G8-SYNTH-REVIEW-'+plan.run};
  await rawPost(operator,mmBase+'/confirm',evidence,[403],'operator_cannot_verify_own_transfer');
  await reviewer.locator('#g8-refresh').click();
  await expect(reviewer.locator('[data-g8-case="'+mid+'"]')).toBeVisible();
  await rawPost(reviewer,mmBase+'/confirm',{...evidence,amount_minor:'1'},[409],
    'wrong_mobile_amount_denied');
  const mmDone=await clickPost(reviewer,'[data-g8-case="'+mid+'"]',evidence,
    'Rapprocher le virement déjà exécuté','/confirm',[200]);
  check('mobile_synthetic_settled',mmDone.status==='settled'&&mmDone.paid===true);
  const replayMm=await rawPost(reviewer,mmBase+'/confirm',evidence,[200],'mobile_replay_identical');
  check('mobile_replay_same_refund',replayMm.replayed===true&&replayMm.refundId===mmDone.refundId);
  await reviewer.screenshot({path:path.join(ROOT,'f2-synthetic.png'),fullPage:true});
  const {rows:[pg]}=await db.query(
   'SELECT (SELECT COUNT(*)::int FROM refunds WHERE order_id=ANY($1::uuid[]) AND status=$7) AS n_refunds, '+
   '(SELECT COUNT(*)::int FROM local_cash_refund_payouts WHERE order_id=$2) AS n_cash, '+
   '(SELECT COUNT(*)::int FROM local_mobile_refund_handoffs WHERE reservation_id=$3 AND status=$8) AS n_mobile, '+
   '(SELECT qty_refunded FROM order_items WHERE id=$4) AS cash_qty, '+
   '(SELECT qty_refunded FROM order_items WHERE id=$5) AS mobile_qty, '+
   '(SELECT SUM(delta_kmf) FROM cash_custody_movements WHERE holder_id=$6) AS cash_balance',
   [[cash.orderId,mm.orderId],cash.orderId,mid,cash.itemId,mm.itemId,plan.ids.relay,'completed','settled']);
  proof.db={...pg,cash_balance:String(pg.cash_balance)};
  check('pg_two_completed_refunds',Number(pg.n_refunds)===2);
  check('pg_exactly_one_per_rail',Number(pg.n_cash)===1&&Number(pg.n_mobile)===1);
  check('pg_exact_refunded_quantity',Number(pg.cash_qty)===1&&Number(pg.mobile_qty)===1);
  check('no_outbound_browser_request',proof.blocked.length===0,proof.blocked);
  check('no_uncaught_browser_error',proof.jsErrors.length===0,proof.jsErrors);
  proof.verdict='PASS_G8_ISOLATED_SYNTHETIC_CHROMIUM_HTTP_PG16';
 }finally{
  fs.writeFileSync(path.join(ROOT,'browser-evidence.json'),JSON.stringify(proof,null,2)+'\n');
  for(const a of actors)await a.ctx.close().catch(()=>{});
  console.log(JSON.stringify({verdict:proof.verdict,checks:proof.checks.length,realPayouts:0}));
 }
});
