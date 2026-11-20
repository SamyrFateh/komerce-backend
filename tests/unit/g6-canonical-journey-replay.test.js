/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const {
  business,canonicalScenario,resolveCanonicalReplay,resolveRelayCashRefs
}=require('../../scripts/recette/g6-canonical-journey-binding');
const {
  validateGuard,validateBuyerProof,validateCashProof,validateHubProof,validateCommitmentCheckpoint,validateVendorReadinessCheckpoint,validateVendorSimulationCheckpoint,validateHubReceivingCheckpoint,validateCustomerBagCheckpoint,validateKomBoxCheckpoint,validateShipmentCheckpoint,validatePartialShipmentCheckpoint,isToolingOnlyResumeDiff,verifyResumeTooling
}=require('../../scripts/recette/g6-canonical-replay');

const {loadGoldenStages,stageGraph}=require('../../scripts/recette/canonical/stage-registry');

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
    for(const m of ['KM','CM','CG'])expect(resolveCanonicalReplay({...env,G6_CANONICAL_SCENARIO:'M02',G6_TARGET_MARKET:m})).toMatchObject({id:'M02',market:m});
    expect(()=>resolveCanonicalReplay({...env,G6_CANONICAL_SCENARIO:'M03'})).toThrow(/NOT_BOUND/);
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
    expect(validateGuard({...env,G6_CANONICAL_SCENARIO:'M05',G6_TARGET_MARKET:' cg '})).toMatchObject({id:'M05',market:'CG'});
    expect(()=>validateGuard({...env,G6_TARGET_MARKET:'ZZ'})).toThrow('G6_UNSUPPORTED_MARKET');
    for(const edit of [{GITHUB_ACTOR:'other'},{KOMERCE_ENV:'production'},
      {STAGING_BASE_URL:'https://komerce.co'},{E2E_EXPECTED_DEPLOY_SHA:'?'},
      {DATABASE_URL:''},{G6_CANONICAL_ACCEPT_PARTIAL_REPLAY:'0'}]){
      expect(()=>validateGuard({...env,...edit})).toThrow('G6_CANONICAL_OWNER_STAGING_GUARD');
    }
  });
  test('BUYER passe par le contrat run/validate du registre sans fabriquer de preuve',async()=>{
    const stage=stageGraph(loadGoldenStages()).byId.get('BUYER');
    const execution=jest.fn(id=>{
      expect(id).toBe('BUYER');
      return buyer;
    });
    const proof=await stage.run({runCertifiedStage:execution});
    expect(execution).toHaveBeenCalledTimes(1);
    expect(proof).toBe(buyer);
    const oracle=jest.fn((id,result)=>{
      expect(id).toBe('BUYER');
      return validateBuyerProof(result,scope,env);
    });
    expect(stage.validate({validateCertifiedStage:oracle},proof)).toMatchObject({
      reference:'K123456',market:'KM'
    });
    expect(oracle).toHaveBeenCalledTimes(1);
    expect(()=>stage.validate({validateCertifiedStage:oracle},{...buyer,market:'CM'})).toThrow();
    await expect(stage.run({runCertifiedStage:()=>{throw Error('CHROMIUM_BLOCKED');}}))
      .rejects.toThrow('CHROMIUM_BLOCKED');
    expect(()=>stage.validate({},buyer)).toThrow('G6_STAGE_VALIDATOR_NOT_BOUND_BUYER');
  });
  test('RELAY_CASH utilise le contrat run/validate et refuse une autre commande',async()=>{
    const stage=stageGraph(loadGoldenStages()).byId.get('RELAY_CASH');
    const execution=jest.fn(id=>{
      expect(id).toBe('RELAY_CASH');
      return cash;
    });
    const proof=await stage.run({runCertifiedStage:execution});
    expect(execution).toHaveBeenCalledTimes(1);
    expect(proof).toBe(cash);
    const oracle=jest.fn((id,result)=>{
      expect(id).toBe('RELAY_CASH');
      return validateCashProof(result,buyer,scope,env);
    });
    expect(stage.validate({validateCertifiedStage:oracle},proof)).toMatchObject({
      reference:'K123456',paid:true,collection_count:1
    });
    expect(oracle).toHaveBeenCalledTimes(1);
    const foreign={...cash,steps:cash.steps.map(s=>s.name==='CASH_UI_PAID'?
      {...s,reference:'FOREIGN'}:s)};
    expect(()=>stage.validate({validateCertifiedStage:oracle},foreign)).toThrow();
    await expect(stage.run({runCertifiedStage:()=>{throw Error('RELAY_UI_BLOCKED');}}))
      .rejects.toThrow('RELAY_UI_BLOCKED');
    expect(()=>stage.validate({},cash)).toThrow('G6_STAGE_VALIDATOR_NOT_BOUND_RELAY_CASH');
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
  test('HUB_PO passe par le contrat des étapes et vérifie la commande déjà payée',async()=>{
    const stage=stageGraph(loadGoldenStages()).byId.get('HUB_PO');
    const order={id:buyer.order.id,reference:buyer.order.reference};
    const paid={reference:buyer.order.reference,paid:true};
    const hub={verdict:'G6_P3_MANUAL_LINE_AND_DRAFT_PO_CHROMIUM_PASS',
      reference:order.reference,external_supplier_calls:0,external_payment_executed:false,
      final:{order_id:order.id,payment_status:'paid',line_count:1,po_count:1,
        cash_collection_count:1,cash_control_confirmed_count:1}};
    const execute=jest.fn(id=>{expect(id).toBe('HUB_PO');return hub;});
    expect(await stage.run({runCertifiedStage:execute})).toBe(hub);
    expect(execute).toHaveBeenCalledTimes(1);
    const oracle=jest.fn((id,proof)=>{
      expect(id).toBe('HUB_PO');
      return validateHubProof(proof,order,paid);
    });
    expect(stage.validate({validateCertifiedStage:oracle},hub)).toMatchObject({
      reference:order.reference,po_count:1
    });
    expect(oracle).toHaveBeenCalledTimes(1);
    expect(()=>stage.validate({validateCertifiedStage:oracle},{...hub,reference:'FOREIGN'})).toThrow();
    expect(()=>stage.validate({validateCertifiedStage:oracle},{
      ...hub,external_payment_executed:true
    })).toThrow();
    await expect(stage.run({runCertifiedStage:()=>{throw Error('HUB_UI_UNAVAILABLE');}}))
      .rejects.toThrow('HUB_UI_UNAVAILABLE');
    expect(()=>stage.validate({},hub)).toThrow('G6_STAGE_VALIDATOR_NOT_BOUND_HUB_PO');
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
  test('les trois checkpoints fournisseur/reception/sac utilisent une commande neuve, pas KL1WGP6',()=>{
    const orderId='6f519f8f-ea47-4a0d-b385-123456789abc';
    const poId='5f9d8f52-aeaa-4ba3-88b5-901234567abc';
    const reference='KNEW123';
    const db='fresh-staging-db';
    const base={scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',
      full_chain_certified:false,production_permitted:false,db_fingerprint:db,
      order:{id:orderId,reference},po_id:poId};
    const readyPrevious={...base,next_stage:'REAL_SUPPLIER_SEND_EVIDENCE_REQUIRED',
      stages:[{id:'HUB_VENDOR_UI',verdict:'PASS_READONLY'}]};
    const ready={verdict:'G6_VENDOR_SEND_UI_READY_BUT_EXTERNAL_EVENT_NOT_PROVEN',
      reference,po_id:poId,db_fingerprint:db,external_supplier_calls:0,
      external_payment_executed:false,supplier_send_certified:false,supplier_confirmation_certified:false};
    expect(validateVendorSimulationCheckpoint(readyPrevious,ready,scope)).toMatchObject({
      poId,order:{id:orderId,reference}
    });
    expect(()=>validateVendorSimulationCheckpoint(readyPrevious,{...ready,reference:'FOREIGN'},scope)).toThrow();

    const receivingPrevious={...base,next_stage:'HUB_RECEIVING',
      stages:[{id:'HUB_VENDOR_SIMULATED',verdict:'PASS_SIMULATED_STAGING',po_id:poId}]};
    const simulated={verdict:'G6_VENDOR_SIMULATED_SEND_AND_CONFIRM_CHROMIUM_PASS_NOT_RECEIPT_GO',
      reference,po_id:poId,order_id:orderId,db_fingerprint:db,
      after:{po_status:'confirmed',confirmed_quantity:1,manual_executions:1,payment_authorizations:0},
      provenance:'SIMULATED / STAGING ONLY',external_supplier_calls:0,
      external_payment_executed:false,physical_receipt_certified:false};
    expect(validateHubReceivingCheckpoint(receivingPrevious,simulated,scope)).toMatchObject({
      poId,order:{id:orderId,reference}
    });
    expect(()=>validateHubReceivingCheckpoint(receivingPrevious,{...simulated,po_id:'FOREIGN'},scope)).toThrow();
    expect(()=>validateHubReceivingCheckpoint(receivingPrevious,{...simulated,db_fingerprint:'FOREIGN'},scope)).toThrow();

    const sourceRef='SUPPLIER_PACKAGE-NEW123456789';
    const receiptPrevious={...base,next_stage:'KOM_BOX',
      stages:[{id:'HUB_RECEIVING',verdict:'PASS_SIMULATED_STAGING'}]};
    const receipt={verdict:'G6_HUB_RECEIPT_SIMULATED_CHROMIUM_HISTORICAL_UI_PG_READBACK_PASS',
      reference,order_id:orderId,po_id:poId,physical_ref:sourceRef,db_fingerprint:db,
      read_only:true,external_supplier_calls:0,external_payment_executed:false,
      readback:{po:{status:'hub_received'},remaining:0,
        placements:[{reference:sourceRef,evidence_method:'MANUAL',quantity:1}]}};
    expect(validateCustomerBagCheckpoint(receiptPrevious,receipt,scope)).toMatchObject({
      poId,sourceRef,order:{id:orderId,reference}
    });
    expect(()=>validateCustomerBagCheckpoint(receiptPrevious,{...receipt,reference:'FOREIGN'},scope)).toThrow();
    expect(()=>validateCustomerBagCheckpoint(receiptPrevious,{...receipt,
      readback:{...receipt.readback,placements:[{reference:'FOREIGN',evidence_method:'MANUAL',quantity:1}]}
    },scope)).toThrow();
    expect(()=>validateCustomerBagCheckpoint(receiptPrevious,{...receipt,physical_ref:'BAD'},scope)).toThrow();
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
  test('le sac client reprend uniquement le colis physique de la réception M01 certifiée',()=>{
    const po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3';
    const orderId='56adad65-d1fa-4e80-8d69-c25e0fe92a76';
    const source='SUPPLIER_PACKAGE-17824209-30d1-41be-87ad-1ef55c8a2994';
    const previous={scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',
      full_chain_certified:false,production_permitted:false,next_stage:'KOM_BOX',
      order:{id:orderId,reference:'KL1WGP6'},po_id:po,db_fingerprint:'same',
      stages:[{id:'HUB_RECEIVING',verdict:'PASS_SIMULATED_STAGING'}]};
    const receipt={verdict:'G6_HUB_RECEIPT_SIMULATED_CHROMIUM_HISTORICAL_UI_PG_READBACK_PASS',
      reference:'KL1WGP6',order_id:orderId,po_id:po,physical_ref:source,
      db_fingerprint:'same',read_only:true,external_supplier_calls:0,external_payment_executed:false,
      readback:{po:{status:'hub_received'},remaining:0,placements:[{reference:source,quantity:1,evidence_method:'MANUAL'}]}};
    expect(validateCustomerBagCheckpoint(previous,receipt,scope)).toMatchObject({poId:po,sourceRef:source});
    expect(()=>validateCustomerBagCheckpoint({...previous,stages:[]},receipt,scope)).toThrow();
    expect(()=>validateCustomerBagCheckpoint(previous,{...receipt,physical_ref:'OTHER'},scope)).toThrow();
    expect(()=>validateCustomerBagCheckpoint(previous,{...receipt,db_fingerprint:'OTHER'},scope)).toThrow();
    expect(()=>validateCustomerBagCheckpoint(previous,{...receipt,readback:{...receipt.readback,remaining:1}},scope)).toThrow();
    expect(()=>validateCustomerBagCheckpoint(previous,{...receipt,external_payment_executed:true},scope)).toThrow();
  });
  test('la KOM-BOX reprend un seul sac PACKED et le colis canonique lié à M01',()=>{
    const po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3',id='56adad65-d1fa-4e80-8d69-c25e0fe92a76';
    const bagId='bcf810c9-33b2-438a-b4c3-857b024e2247',bagRef='KOM-ITEM-178D0AEA488AA4B5B9';
    const parcelId='95045ede-d5b8-405b-b65f-d9dbdddb4756',allocationId='3b430dcf-8662-44b4-a29f-27e38df19253';
    const previous={scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',full_chain_certified:false,
      production_permitted:false,next_stage:'KOM_BOX',order:{id,reference:'KL1WGP6'},po_id:po,db_fingerprint:'same',
      stages:[{id:'HUB_CUSTOMER_BAG',verdict:'PASS_SIMULATED_STAGING',bag_id:bagId}]};
    const bag={verdict:'G6_CUSTOMER_BAG_SIMULATED_CHROMIUM_PG_PASS',order_id:id,po_id:po,bag_id:bagId,bag_ref:bagRef,
      db_fingerprint:'same',external_supplier_calls:0,external_payment_executed:false,provenance:'SIMULATED / STAGING ONLY',
      events:[{},{},{}],after:{order:{allocation_id:allocationId},bags:[{id:bagId,state:'PACKED'}],
        units:[{id:bagId,active:true,quantity:1,evidence_method:'MANUAL'}],links:[],parcels:[{id:parcelId}]}};
    expect(validateKomBoxCheckpoint(previous,bag,scope)).toMatchObject({bagId,parcelId,allocationId});
    expect(()=>validateKomBoxCheckpoint(previous,{...bag,db_fingerprint:'other'},scope)).toThrow();
    expect(()=>validateKomBoxCheckpoint(previous,{...bag,after:{...bag.after,bags:[{id:bagId,state:'RECEIVED'}]}},scope)).toThrow();
    expect(()=>validateKomBoxCheckpoint(previous,{...bag,after:{...bag.after,links:[{}]}},scope)).toThrow();
    expect(()=>validateKomBoxCheckpoint(previous,{...bag,after:{...bag.after,parcels:[{id:parcelId},{id:'other'}]}},scope)).toThrow();
    expect(()=>validateKomBoxCheckpoint(previous,{...bag,external_payment_executed:true},scope)).toThrow();
  });
  test('reprend uniquement la KOM-BOX M01 PACKED et son colis client exact pour la remise',()=>{
    const po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3',orderId='56adad65-d1fa-4e80-8d69-c25e0fe92a76';
    const bagId='bcf810c9-33b2-438a-b4c3-857b024e2247',bagRef='KOM-ITEM-178D0AEA488AA4B5B9';
    const parcelId='95045ede-d5b8-405b-b65f-d9dbdddb4756',allocationId='3b430dcf-8662-44b4-a29f-27e38df19253';
    const boxId='6ca614e5-869c-40ab-80d7-3684974092fe',boxRef='KOM-BOX-SIM-STAGING-KL1WGP6';
    const previous={scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',full_chain_certified:false,
      production_permitted:false,next_stage:'HUB_SHIPMENT',order:{id:orderId,reference:'KL1WGP6'},po_id:po,
      db_fingerprint:'same',stages:[{id:'HUB_KOM_BOX',verdict:'PASS_SIMULATED_STAGING',box_id:boxId}]};
    const box={verdict:'G6_KOM_BOX_SIMULATED_CHROMIUM_PG_PASS_PACKED',order_id:orderId,po_id:po,
      box_id:boxId,box_ref:boxRef,bag_id:bagId,bag_ref:bagRef,parcel_id:parcelId,allocation_id:allocationId,
      db_fingerprint:'same',external_supplier_calls:0,external_payment_executed:false,provenance:'SIMULATED / STAGING ONLY',
      events:Array(8).fill({}),after:{box:[{id:boxId,state:'PACKED'}],bag:[{id:bagId,state:'PACKED'}],
      links:[{bag_unit_id:bagId,box_unit_id:boxId,parcel_id:parcelId,evidence_method:'MANUAL'}],
      effective:[{allocation_id:allocationId,quantity:1}],parcels:[{id:parcelId,status:'preparation'}]}};
    expect(validateShipmentCheckpoint(previous,box,scope)).toMatchObject({boxId,parcelId,allocationId});
    expect(()=>validateShipmentCheckpoint({...previous,stages:[]},box,scope)).toThrow();
    expect(()=>validateShipmentCheckpoint(previous,{...box,db_fingerprint:'other'},scope)).toThrow();
    expect(()=>validateShipmentCheckpoint(previous,{...box,parcel_id:'foreign'},scope)).toThrow();
    expect(()=>validateShipmentCheckpoint(previous,{...box,after:{...box.after,box:[{id:boxId,state:'RECEIVED'}]}},scope)).toThrow();
    expect(()=>validateShipmentCheckpoint(previous,{...box,after:{...box.after,links:[...box.after.links,...box.after.links]}},scope)).toThrow();
    expect(()=>validateShipmentCheckpoint(previous,{...box,external_payment_executed:true},scope)).toThrow();
  });
  test('nouvelle commande M01: sac PACKED et colis vers KOM-BOX sans IDs historiques',()=>{
    const po='5f9d8f52-aeaa-4ba3-88b5-901234567abc',id='6f519f8f-ea47-4a0d-b385-123456789abc';
    const bagId='1fa104ca-c9f0-4e42-99dd-218fc92a2b2c',bagRef='KOM-ITEM-NEWTEST12345';
    const parcelId='2c5fa38b-b75a-4f99-b982-0fd36149e174',allocationId='3e940467-d30a-4167-9174-a04da39a37d5';
    const previous={scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',full_chain_certified:false,
      production_permitted:false,next_stage:'KOM_BOX',order:{id,reference:'KNEW123'},po_id:po,db_fingerprint:'same',
      stages:[{id:'HUB_CUSTOMER_BAG',verdict:'PASS_SIMULATED_STAGING',bag_id:bagId}]};
    const bag={verdict:'G6_CUSTOMER_BAG_SIMULATED_CHROMIUM_PG_PASS',order_id:id,po_id:po,bag_id:bagId,bag_ref:bagRef,
      db_fingerprint:'same',external_supplier_calls:0,external_payment_executed:false,provenance:'SIMULATED / STAGING ONLY',
      events:[{},{},{}],after:{order:{allocation_id:allocationId},bags:[{id:bagId,state:'PACKED'}],
        units:[{id:bagId,active:true,quantity:1,evidence_method:'MANUAL'}],links:[],parcels:[{id:parcelId}]}};
    expect(validateKomBoxCheckpoint(previous,bag,scope)).toMatchObject({bagId,parcelId,allocationId});
    expect(()=>validateKomBoxCheckpoint({...previous,stages:[{id:'HUB_CUSTOMER_BAG',verdict:'PASS_SIMULATED_STAGING',bag_id:'00000000-0000-4000-8000-000000000001'}]},bag,scope)).toThrow();
    expect(()=>validateKomBoxCheckpoint({...previous,order:{...previous.order,id:'00000000-0000-4000-8000-000000000001'}},bag,scope)).toThrow();
    expect(()=>validateKomBoxCheckpoint(previous,{...bag,db_fingerprint:'other'},scope)).toThrow();
    expect(()=>validateKomBoxCheckpoint(previous,{...bag,after:{...bag.after,bags:[{id:bagId,state:'RECEIVED'}]}},scope)).toThrow();
    expect(()=>validateKomBoxCheckpoint(previous,{...bag,after:{...bag.after,links:[{}]}},scope)).toThrow();
    expect(()=>validateKomBoxCheckpoint(previous,{...bag,after:{...bag.after,parcels:[{id:parcelId},{id:'other'}]}},scope)).toThrow();
    expect(()=>validateKomBoxCheckpoint(previous,{...bag,external_payment_executed:true},scope)).toThrow();
  });
  test('nouvelle commande M01: KOM-BOX PACKED et colis client pour expédition',()=>{
    const po='5f9d8f52-aeaa-4ba3-88b5-901234567abc',orderId='6f519f8f-ea47-4a0d-b385-123456789abc';
    const bagId='1fa104ca-c9f0-4e42-99dd-218fc92a2b2c',bagRef='KOM-ITEM-NEWTEST12345';
    const parcelId='2c5fa38b-b75a-4f99-b982-0fd36149e174',allocationId='3e940467-d30a-4167-9174-a04da39a37d5';
    const boxId='4b48b432-c012-4d53-8d1a-5bebf2d39229',boxRef='KOM-BOX-SIM-STAGING-NEWTEST123';
    const previous={scenario_id:'M01',market:'KM',verdict:'NOT_PROVEN',full_chain_certified:false,
      production_permitted:false,next_stage:'HUB_SHIPMENT',order:{id:orderId,reference:'KNEW123'},po_id:po,
      db_fingerprint:'same',stages:[{id:'HUB_KOM_BOX',verdict:'PASS_SIMULATED_STAGING',box_id:boxId}]};
    const box={verdict:'G6_KOM_BOX_SIMULATED_CHROMIUM_PG_PASS_PACKED',order_id:orderId,po_id:po,
      box_id:boxId,box_ref:boxRef,bag_id:bagId,bag_ref:bagRef,parcel_id:parcelId,allocation_id:allocationId,
      db_fingerprint:'same',external_supplier_calls:0,external_payment_executed:false,provenance:'SIMULATED / STAGING ONLY',
      events:Array(8).fill({}),after:{box:[{id:boxId,state:'PACKED'}],bag:[{id:bagId,state:'PACKED'}],
      links:[{bag_unit_id:bagId,box_unit_id:boxId,parcel_id:parcelId,evidence_method:'MANUAL'}],
      effective:[{allocation_id:allocationId,quantity:1}],parcels:[{id:parcelId,status:'preparation'}]}};
    expect(validateShipmentCheckpoint(previous,box,scope)).toMatchObject({boxId,parcelId,allocationId});
    expect(()=>validateShipmentCheckpoint({...previous,stages:[]},box,scope)).toThrow();
    expect(()=>validateShipmentCheckpoint({...previous,stages:[{id:'HUB_KOM_BOX',verdict:'PASS_SIMULATED_STAGING',box_id:'00000000-0000-4000-8000-000000000001'}]},box,scope)).toThrow();
    expect(()=>validateShipmentCheckpoint({...previous,order:{...previous.order,id:'00000000-0000-4000-8000-000000000001'}},box,scope)).toThrow();
    expect(()=>validateShipmentCheckpoint(previous,{...box,db_fingerprint:'other'},scope)).toThrow();
    expect(()=>validateShipmentCheckpoint(previous,{...box,parcel_id:'foreign'},scope)).toThrow();
    expect(()=>validateShipmentCheckpoint(previous,{...box,after:{...box.after,box:[{id:boxId,state:'RECEIVED'}]}},scope)).toThrow();
    expect(()=>validateShipmentCheckpoint(previous,{...box,after:{...box.after,links:[...box.after.links,...box.after.links]}},scope)).toThrow();
    expect(()=>validateShipmentCheckpoint(previous,{...box,external_payment_executed:true},scope)).toThrow();
  });
  test('refuse cash sur un autre ordre, une autre DB, ou un état financier incomplet',()=>{
    expect(validateCashProof(cash,buyer,scope,env)).toMatchObject({reference:'K123456',paid:true});
    expect(()=>validateCashProof({...cash,db_fingerprint:'other-db'},buyer,scope,env)).toThrow();
    expect(()=>validateCashProof({...cash,steps:cash.steps.map(s=>s.name==='CASH_UI_PAID'?{...s,reference:'OTHER-REF'}:s)},buyer,scope,env)).toThrow();
    expect(()=>validateCashProof({...cash,steps:cash.steps.map(s=>s.name==='CASH_UI_PAID'?{...s,cash_collection_count:0}:s)},buyer,scope,env)).toThrow();
    expect(()=>validateCashProof({...cash,sha:'b'.repeat(40)},buyer,scope,env)).toThrow();
  });
});

test('partial shipment checkpoint requires exact historical two clicks and rejects any handover or changed lineage',()=>{
  const orderId='56adad65-d1fa-4e80-8d69-c25e0fe92a76',poId='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3';
  const bagId='bcf810c9-33b2-438a-b4c3-857b024e2247',bagRef='KOM-ITEM-178D0AEA488AA4B5B9';
  const parcelId='95045ede-d5b8-405b-b65f-d9dbdddb4756',allocationId='3b430dcf-8662-44b4-a29f-27e38df19253';
  const boxId='6ca614e5-869c-40ab-80d7-3684974092fe',boxRef='KOM-BOX-SIM-STAGING-KL1WGP6';
  const shipmentId='ff8591fc-78bb-49a4-b154-247508368d16',shipmentRef='SIM-STAGING-EXP-KL1WGP6';
  const fingerprint='8acbf99fef010c23eac7d252';
  const previous={scenario_id:'M01',market:'KM',verdict:'BLOCKED',full_chain_certified:false,production_permitted:false,
    next_stage:'HUB_SHIPMENT',resumed_from_run_id:'44199423921',order:{id:orderId,reference:'KL1WGP6'},po_id:poId,
    db_fingerprint:fingerprint,stages:[{id:'HUB_KOM_BOX',verdict:'PASS_SIMULATED_STAGING'}]};
  const after={box:[{id:boxId,state:'DISPATCHED'}],shipments:[{id:shipmentId,reference:shipmentRef,stage:'hub_ready',hub_draft:true}],
    shipmentLinks:[{shipment_id:shipmentId,physical_unit_id:boxId}],shipmentEvents:[{event_type:'opened',proof_ref:null}],
    parcels:[{id:parcelId,status:'preparation'}],parcelItems:[{quantity:1,qty_shipped:0}],parcelEvents:[],
    effective:[{allocation_id:allocationId,quantity:1}],links:[{bag_unit_id:bagId,box_unit_id:boxId,parcel_id:parcelId}],
    custody:[{event_type:'STATE_TRANSITION',from_state:'PACKED',to_state:'DISPATCHED',actor_id:'actor'}]};
  const partial={schema:'komerce-g6-hub-shipment/1',scenario_id:'M01',market:'KM',verdict:'BLOCKED',reference:'KL1WGP6',
    order_id:orderId,po_id:poId,bag_id:bagId,bag_ref:bagRef,parcel_id:parcelId,allocation_id:allocationId,box_id:boxId,
    box_ref:boxRef,shipment_id:shipmentId,shipment_ref:shipmentRef,db_fingerprint:fingerprint,
    sha:'1fc4e7eac6295f00e56802611bb5e87db081c15a',external_supplier_calls:0,external_payment_executed:false,
    provenance:'SIMULATED / STAGING ONLY',events:[{key:'open-shipment',http:201},{key:'dispatch-box',http:200,unit_id:boxId}],
    before:{box:[{id:boxId,state:'PACKED'}],shipments:[]},after_open:{box:[{id:boxId,state:'PACKED'}],shipments:[{id:shipmentId}]},
    after_dispatch:after,failure_readback:JSON.parse(JSON.stringify(after))};
  expect(validatePartialShipmentCheckpoint(previous,partial,scope)).toMatchObject({shipmentId,boxId,parcelId});
  for(const mutation of [{db_fingerprint:'other'},{shipment_id:'other'},{events:[...partial.events,{key:'handover-forwarder',http:200}]},
    {failure_readback:{...after,parcelEvents:[{}]}},{external_payment_executed:true}]){
    expect(()=>validatePartialShipmentCheckpoint(previous,{...partial,...mutation},scope)).toThrow('G6_SHIPMENT_PARTIAL_PROVENANCE_INVALID');
  }
  const handed={...after,shipments:[{...after.shipments[0],stage:'handed_over'}]};
  expect(()=>validatePartialShipmentCheckpoint(previous,{...partial,after_dispatch:handed,failure_readback:handed},scope)).toThrow();
  expect(()=>validatePartialShipmentCheckpoint({...previous,resumed_from_run_id:'other'},partial,scope)).toThrow();
});
