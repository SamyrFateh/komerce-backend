/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const {
  business,canonicalScenario,resolveCanonicalReplay,resolveRelayCashRefs
}=require('../../scripts/recette/g6-canonical-journey-binding');
const {
  validateGuard,validateBuyerProof,validateCashProof,validateHubProof,validateCommitmentCheckpoint,validateVendorReadinessCheckpoint,validateHubReceivingCheckpoint,isToolingOnlyResumeDiff,verifyResumeTooling
}=require('../../scripts/recette/g6-canonical-replay');

const sha='a'.repeat(40);
const env={
  G6_CANONICAL_SCENARIO:'M01',G6_TARGET_MARKET:'KM',
  GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'SamyrFateh',GITHUB_REPOSITORY_OWNER:'SamyrFateh',
  GITHUB_REPOSITORY:'SamyrFateh/komerce-backend',
  NODE_ENV:'test',KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',
  EXPECTED_RAILWAY_ENVIRONMENT:'staging',
  STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
  E2E_EXPECTED_DEPLOY_SHA:sha,
  DATABASE_URL:'postgres://test-unconnected',E2E_ADMIN_EMAIL:'test@example.invalid',
  E2E_ADMIN_PASSWORD:'dummy-not-used',G6_CANONICAL_ACCEPT_PARTIAL_REPLAY:'1'
};
const scope={id:'M01',market:'KM',source_version:business.version};
const buyer={
  verdict:'G6_P2_REAL_OTP_CHROMIUM_ORDER_CREATED_NO_EXTERNAL_EFFECTS',
  market:'KM',runtime_sha:sha,db_fingerprint:'staging-fingerprint',
  blocked_requests:[],payment_real:false,supplier_order_real:false,
  order:{id:'550e8400-e29b-41d4-a716-446655440000',reference:'K123456',
    status:'pending',payment_status:'pending',payment_mode:'cash_relais',scope:'G6-BUYER',market:'KM'}
};
const cash={
  verdict:'G6_A_RELAY_UI_ASSIGNMENT_AND_CASH_CHROMIUM_PG_PASS_NOT_PICKUP_GO',
  sha,db_fingerprint:'staging-fingerprint',real_external_payment:false,
  steps:[
    {name:'PRECHECK_TARGET_CASH_ORDERS',references:{KM:'K123456'}},
    {name:'CASH_UI_PAID',market:'KM',reference:'K123456',http:200,
      payment_status:'paid',cash_collection_count:1,cash_control_confirmed_count:1}
  ]
};

describe('G6 canonical journey — same order, original matrix, real staging guard',()=>{
  test('le catalogue de référence reste le seul propriétaire des 46 scénarios',()=>{
    expect(business.scenarios).toHaveLength(46);
    expect(canonicalScenario('M01','KM').id).toBe('M01');
    expect(canonicalScenario('M04','CM').id).toBe('M04');
    expect(canonicalScenario('M05','CG').id).toBe('M05');
    expect(()=>canonicalScenario('M04','KM')).toThrow('G6_MARKET_OUTSIDE_SCENARIO');
    expect(()=>canonicalScenario('M99','KM')).toThrow('G6_SCENARIO_ID_INVALID');
  });
  test('réutilise M01/M04/M05 sans prétendre supporter les autres branches',()=>{
    expect(resolveCanonicalReplay(env)).toMatchObject({id:'M01',market:'KM'});
    expect(resolveCanonicalReplay({...env,G6_CANONICAL_SCENARIO:'M04',G6_TARGET_MARKET:'CM'}).market).toBe('CM');
    expect(()=>resolveCanonicalReplay({...env,G6_CANONICAL_SCENARIO:'M02'})).toThrow();
    expect(()=>resolveCanonicalReplay({...env,G6_CANONICAL_SCENARIO:'M06'})).toThrow();
  });
  test('pas de régression pour les 3 références historiques',()=>{
    expect(resolveRelayCashRefs({})).toEqual({KM:'K18SFYN',CM:'KW34OBY',CG:'KSJWLND'});
  });
  test('la caisse cible une SEULE commande issue du checkout',()=>{
    expect(resolveRelayCashRefs({G6_CANONICAL_SCENARIO:'M01',G6_CANONICAL_MARKET:'KM',
      G6_CANONICAL_ORDER_REFERENCE:'K123456'})).toEqual({KM:'K123456'});
    expect(()=>resolveRelayCashRefs({G6_CANONICAL_SCENARIO:'M01',G6_CANONICAL_MARKET:'KM'}))
      .toThrow('G6_CANONICAL_CASH_BINDING_INCOMPLETE');
    expect(()=>resolveRelayCashRefs({G6_CANONICAL_SCENARIO:'M01',G6_CANONICAL_MARKET:'CM',
      G6_CANONICAL_ORDER_REFERENCE:'K123456'})).toThrow('G6_MARKET_OUTSIDE_SCENARIO');
  });
  test('refuse exécution hors staging propriétaire, sans pin, sans DB',()=>{
    expect(validateGuard(env)).toMatchObject({id:'M01',market:'KM'});
    for(const edit of [{GITHUB_ACTOR:'other'},{KOMERCE_ENV:'production'},
      {STAGING_BASE_URL:'https://komerce.co'},{E2E_EXPECTED_DEPLOY_SHA:'?'},
      {DATABASE_URL:''},{G6_CANONICAL_ACCEPT_PARTIAL_REPLAY:'0'}]){
      expect(()=>validateGuard({...env,...edit})).toThrow('G6_CANONICAL_OWNER_STAGING_GUARD');
    }
  });
  test('une preuve client doit être réelle et sur la même commande pending',()=>{
    expect(validateBuyerProof(buyer,scope,env)).toMatchObject({reference:'K123456',market:'KM'});
    expect(()=>validateBuyerProof({...buyer,market:'CM'},scope,env)).toThrow();
    expect(()=>validateBuyerProof({...buyer,order:{...buyer.order,payment_status:'paid'}},scope,env)).toThrow();
    expect(()=>validateBuyerProof({...buyer,runtime_sha:'b'.repeat(40)},scope,env)).toThrow();
    expect(()=>validateBuyerProof({...buyer,blocked_requests:[{method:'POST'}]},scope,env)).toThrow();
  });
  test('reprend la preuve du checkout historique sans recopier le clic ni les paramètres métier',()=>{
    const previous={...buyer,order:{...buyer.order}};
    delete previous.order.payment_mode; // ancien rapport G6 : SQL a quand même vérifié cash_relais
    expect(validateBuyerProof(previous,scope,env)).toMatchObject({reference:'K123456'});
    expect(()=>validateBuyerProof({...previous,runtime_sha:'b'.repeat(40)},scope,env)).toThrow();
    expect(validateBuyerProof({...previous,runtime_sha:'b'.repeat(40)},scope,env,
      {toolingEquivalent:true})).toMatchObject({reference:'K123456'});
    expect(()=>validateBuyerProof({...previous,order:{...previous.order,payment_status:'paid'}},
      scope,env,{toolingEquivalent:true})).toThrow();
  });
  test('reprise autorisée seulement si TOUS les fichiers modifiés sont des outils de recette déclarés',()=>{
    expect(isToolingOnlyResumeDiff([
      'scripts/recette/g6-canonical-replay.js',
      'scripts/recette/g6-hub-commitment-chromium.js',
      'scripts/recette/g6-hub-vendor-readiness-chromium.js',
      '.github/workflows/staging-g6-canonical-buyer-cash.yml',
      'tests/unit/g6-canonical-journey-replay.test.js',
      'tests/staging-clicks/g6-p3-kuyiyuk.spec.js',
      'docs/chantier/STATUS.md'
    ])).toBe(true);
    expect(isToolingOnlyResumeDiff([])).toBe(false);
    expect(isToolingOnlyResumeDiff(['server.js'])).toBe(false);
    expect(isToolingOnlyResumeDiff(['docs/chantier/STATUS.md','services/order-checkout-service.js'])).toBe(false);
    expect(isToolingOnlyResumeDiff([
      'scripts/recette/g6-canonical-replay.js','public/boutique/js/b-komerce.js'
    ])).toBe(false);
    expect(verifyResumeTooling(sha,sha)).toEqual({equivalent:true,changedFiles:[]});
    expect(()=>verifyResumeTooling('bad',sha)).toThrow('G6_CANONICAL_RESUME_SHA_INVALID');
  });
  test('la preuve PO Hub doit appartenir au même ordre payé et rester sans effet fournisseur',()=>{
    const h={
      verdict:'G6_P3_MANUAL_LINE_AND_DRAFT_PO_CHROMIUM_PASS',
      reference:'K123456',external_supplier_calls:0,external_payment_executed:false,
      final:{order_id:buyer.order.id,status:'confirmed',payment_status:'paid',
        line_count:1,po_count:1,cash_collection_count:1,cash_control_confirmed_count:1}
    };
    const order={id:buyer.order.id,reference:'K123456'};
    expect(validateHubProof(h,order,{reference:'K123456'})).toMatchObject({po_count:1,line_count:1});
    expect(()=>validateHubProof({...h,reference:'OTHER'},order,{reference:'K123456'})).toThrow();
    expect(()=>validateHubProof({...h,final:{...h.final,po_count:0}},order,{reference:'K123456'})).toThrow();
    expect(()=>validateHubProof({...h,final:{...h.final,cash_collection_count:2}},order,{reference:'K123456'})).toThrow();
    expect(()=>validateHubProof({...h,external_payment_executed:true},order,{reference:'K123456'})).toThrow();
  });
  test('la reprise directrice est attachée à une PO unique, à la même commande payée et au vrai rapport G6',()=>{
    const poId='11111111-1111-4111-8111-111111111111';
    const prior={
      scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',
      full_chain_certified:false,production_permitted:false,
      buyer_cash_verdict:'PASS',hub_po_verdict:'PASS',
      db_fingerprint:buyer.db_fingerprint,
      order:{id:buyer.order.id,reference:buyer.order.reference},
      stages:['BUYER','RELAY_CASH','HUB_PO'].map(id=>({id,verdict:'PASS'}))
    };
    const hub={
      verdict:'G6_P3_MANUAL_LINE_AND_DRAFT_PO_CHROMIUM_PASS',
      reference:buyer.order.reference,external_supplier_calls:0,external_payment_executed:false,
      final:{order_id:buyer.order.id,status:'ordered',payment_status:'paid',
        line_count:1,po_count:1,cash_collection_count:1,cash_control_confirmed_count:1},
      gestures:[{key:'prepare-draft-po',verdict:'PASS',purchase_order_id:poId}]
    };
    expect(validateCommitmentCheckpoint(prior,hub,buyer,scope)).toMatchObject({
      poId,order:{id:buyer.order.id,reference:buyer.order.reference}
    });
    expect(()=>validateCommitmentCheckpoint({...prior,market:'CG'},hub,buyer,scope)).toThrow();
    expect(()=>validateCommitmentCheckpoint({...prior,hub_po_verdict:'NOT_PROVEN'},hub,buyer,scope)).toThrow();
    expect(()=>validateCommitmentCheckpoint({...prior,full_chain_certified:true},hub,buyer,scope)).toThrow();
    expect(()=>validateCommitmentCheckpoint({...prior,db_fingerprint:'OTHER'},hub,buyer,scope)).toThrow();
    expect(()=>validateCommitmentCheckpoint({...prior,stages:prior.stages.slice(0,2)},hub,buyer,scope)).toThrow();
    expect(()=>validateCommitmentCheckpoint(prior,{...hub,gestures:[]},buyer,scope)).toThrow();
    expect(()=>validateCommitmentCheckpoint(prior,{...hub,gestures:[
      ...hub.gestures,{key:'prepare-draft-po',verdict:'PASS',purchase_order_id:poId}
    ]},buyer,scope)).toThrow();
    expect(()=>validateCommitmentCheckpoint(prior,{...hub,final:{...hub.final,cash_collection_count:2}},buyer,scope)).toThrow();
  });
  test('la frontière fournisseur reprend l’engagement existant, sans requalifier le PO en livraison',()=>{
    const poId='11111111-1111-4111-8111-111111111111';
    const prior={
      reference_contract:'G6-CANONICAL-JOURNEY-v1',
      scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',
      full_chain_certified:false,production_permitted:false,
      next_stage:'VENDOR_PROOF_AND_RECEIVING',
      db_fingerprint:buyer.db_fingerprint,po_id:poId,
      order:{id:buyer.order.id,reference:'KL1WGP6',market:'KM'},
      stages:[
        ...['BUYER','RELAY_CASH','HUB_PO'].map(id=>({id,verdict:'PREVIOUS_RUN_PASS'})),
        {id:'HUB_COMMITMENT',verdict:'PASS',po_id:poId,reference:'KL1WGP6'}
      ]
    };
    const commitment={
      verdict:'G6_HUB_COMMITMENT_AND_INTERNAL_SUBMIT_CHROMIUM_PASS_NOT_VENDOR_OR_RECEIPT_GO',
      reference:'KL1WGP6',po_id:poId,db_fingerprint:buyer.db_fingerprint,
      after:{po_status:'notified',commitment_count:1,payment_authorization_count:0},
      external_supplier_calls:0,external_payment_executed:false
    };
    expect(validateVendorReadinessCheckpoint(prior,commitment,scope)).toMatchObject({
      poId,order:{id:buyer.order.id,reference:'KL1WGP6'}
    });
    expect(()=>validateVendorReadinessCheckpoint({...prior,market:'CM'},commitment,scope)).toThrow();
    expect(()=>validateVendorReadinessCheckpoint({...prior,verdict:'PASS'},commitment,scope)).toThrow();
    expect(()=>validateVendorReadinessCheckpoint({...prior,db_fingerprint:'OTHER'},commitment,scope)).toThrow();
    expect(()=>validateVendorReadinessCheckpoint({...prior,po_id:'OTHER'},commitment,scope)).toThrow();
    expect(()=>validateVendorReadinessCheckpoint({...prior,stages:prior.stages.slice(0,3)},commitment,scope)).toThrow();
    expect(()=>validateVendorReadinessCheckpoint(prior,{...commitment,after:{...commitment.after,payment_authorization_count:1}},scope)).toThrow();
    expect(()=>validateVendorReadinessCheckpoint(prior,{...commitment,external_supplier_calls:1},scope)).toThrow();
  });
  test('reçoit uniquement le PO M01 ayant une preuve fournisseur simulée liée au même ordre',()=>{
    const po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3';
    const orderId='56adad65-d1fa-4e80-8d69-c25e0fe92a76';
    const prior={scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',
      full_chain_certified:false,production_permitted:false,
      next_stage:'HUB_RECEIVING',po_id:po,db_fingerprint:'same-staging',
      order:{id:orderId,reference:'KL1WGP6'},
      stages:[{id:'HUB_VENDOR_SIMULATED',verdict:'PASS_SIMULATED_STAGING',po_id:po}]};
    const simulated={verdict:'G6_VENDOR_SIMULATED_SEND_AND_CONFIRM_CHROMIUM_PASS_NOT_RECEIPT_GO',
      reference:'KL1WGP6',po_id:po,order_id:orderId,db_fingerprint:'same-staging',
      after:{po_status:'confirmed',confirmed_quantity:1,manual_executions:1,payment_authorizations:0},
      provenance:'SIMULATED / STAGING ONLY',external_supplier_calls:0,
      external_payment_executed:false,physical_receipt_certified:false};
    expect(validateHubReceivingCheckpoint(prior,simulated,scope)).toMatchObject({poId:po});
    expect(()=>validateHubReceivingCheckpoint({...prior,po_id:'other'},simulated,scope)).toThrow();
    expect(()=>validateHubReceivingCheckpoint({...prior,next_stage:'KOM_BOX'},simulated,scope)).toThrow();
    expect(()=>validateHubReceivingCheckpoint(prior,{...simulated,order_id:'other'},scope)).toThrow();
    expect(()=>validateHubReceivingCheckpoint(prior,{...simulated,db_fingerprint:'other'},scope)).toThrow();
    expect(()=>validateHubReceivingCheckpoint(prior,{...simulated,provenance:'REAL'},scope)).toThrow();
    expect(()=>validateHubReceivingCheckpoint(prior,{...simulated,after:{...simulated.after,payment_authorizations:1}},scope)).toThrow();
  });
  test('refuse cash sur un autre ordre, une autre DB, ou un état financier incomplet',()=>{
    expect(validateCashProof(cash,buyer,scope,env)).toMatchObject({reference:'K123456',paid:true});
    expect(()=>validateCashProof({...cash,db_fingerprint:'other-db'},buyer,scope,env)).toThrow();
    expect(()=>validateCashProof({...cash,steps:cash.steps.map(s=>s.name==='CASH_UI_PAID'?{...s,reference:'OTHER-REF'}:s)},buyer,scope,env)).toThrow();
    expect(()=>validateCashProof({...cash,steps:cash.steps.map(s=>s.name==='CASH_UI_PAID'?{...s,cash_collection_count:0}:s)},buyer,scope,env)).toThrow();
    expect(()=>validateCashProof({...cash,sha:'b'.repeat(40)},buyer,scope,env)).toThrow();
  });
});
