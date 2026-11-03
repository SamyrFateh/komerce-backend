'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief E7: la sortie PSP est post-commit, idempotente, et toute incertitude reste UNKNOWN.
 */
jest.mock('../../db',()=>({getClient:jest.fn(),query:jest.fn()}));
jest.mock('../../services/refund-intent-ledger',()=>({
  euroCents:jest.fn(()=>200n),
  claimRefundIntent:jest.fn(async()=>({providerRequestKey:'kmr-ref-00000000-0000-4000-8000-000000000005'})),
}));
jest.mock('../../services/refund-intent-reconciliation',()=>({
  reconcileRefundIntent:jest.fn(async()=>({complete:true,status:'confirmed'})),
}));
const ledger=require('../../services/refund-intent-ledger');
const verify=require('../../services/refund-intent-reconciliation');
const {executeReservedItemRefund,assertSandbox}=require('../../services/item-refund-psp-orchestrator');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const env={KOMERCE_ENV:'staging',E7_ITEM_RESERVATIONS_ENABLED:'1',
  E7_SANDBOX_REFUND_EXECUTION_ENABLED:'1',STRIPE_SECRET_KEY:'sk_test_mock'};
const actor={id:id(7),role:'admin'};
function fixture({provider='stripe',intentStatus='reserved',reservationStatus='reserved',providerFails=false}={}){
  const events=[];
  const client={query:jest.fn(async(sql,args)=>{
    events.push(sql);
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
    if(sql.includes('SELECT r.id,r.order_id,r.order_item_id'))return {rows:[{
      id:id(6),order_id:id(1),order_item_id:id(2),quantity:1,amount_kmf:'1000.00',amount_eur:'2.00',status:'processing',
      provider_ref:null,intent_id:id(5),intent_status:'confirmed',provider,intent_provider_ref:'re_123',
    }]};
    if(sql.startsWith('INSERT INTO refunds'))return {rows:[{id:id(9)}]};
    if(sql.startsWith('UPDATE order_items'))return {rows:[{id:id(2)}]};
    if(sql.startsWith('UPDATE order_item_refund_reservations'))return {rows:[{id:id(6)}]};
    throw Error('unexpected tx query '+sql);
  }),release:jest.fn()};
  const db={query:jest.fn(async(sql,args)=>{
    events.push(sql);
    if(sql.startsWith('SELECT r.id,r.status,r.refund_intent_id'))return {rows:[{
      id:id(6),status:reservationStatus,refund_intent_id:id(5),
      reason:'Remboursement manquant',provider,capture_ref:'pi_test',
      amount_eur:'2.00',intent_status:intentStatus,
    }]};
    if(sql.startsWith('UPDATE'))return {rows:[]};
    throw Error('unexpected DB query '+sql);
  }),getClient:jest.fn(async()=>client)};
  const stripe={refunds:{create:jest.fn(async()=>{
    events.push('PROVIDER_POST');
    if(providerFails)throw Object.assign(new Error('PSP timeout'),{code:'ETIMEDOUT'});
    return {id:'re_123',status:'succeeded'};
  }),retrieve:jest.fn(async()=>({id:'re_123',status:'succeeded'}))}};
  return {events,db,stripe,client};
}
describe('E7 PSP sandbox execution',()=>{
  beforeEach(()=>jest.clearAllMocks());
  test('activation hors staging interdite même si PSP configuré',()=>{
    expect(()=>assertSandbox({...env,KOMERCE_ENV:'production'})).toThrow('hors staging');
    expect(()=>assertSandbox({...env,E7_SANDBOX_REFUND_EXECUTION_ENABLED:'0'})).toThrow('non certifié');
  });
  test('aucun payout sans rôle administrateur et capture de test',async()=>{
    const f=fixture();
    await expect(executeReservedItemRefund({reservationId:id(6),orderId:id(1),
      orderItemId:id(2),actor:{id:id(7),role:'agent_relais'},db:f.db,env,stripe:f.stripe}))
      .rejects.toMatchObject({code:'ITEM_REFUND_ADMIN_REQUIRED'});
    await expect(executeReservedItemRefund({reservationId:id(6),orderId:id(1),
      orderItemId:id(2),actor,db:f.db,env:{...env,STRIPE_SECRET_KEY:'sk_live_no'},stripe:f.stripe}))
      .rejects.toMatchObject({code:'ITEM_REFUND_NOT_STRIPE_TEST_KEY'});
    expect(f.stripe.refunds.create).not.toHaveBeenCalled();
  });
  test('PayPal sandbox explicite obligatoire : aucune sortie si environnement ambigu ou production',async()=>{
    const f=fixture({provider:'paypal'});
    for (const badEnv of [{...env},{...env,PAYPAL_ENV:'production'}]) {
      await expect(executeReservedItemRefund({reservationId:id(6),orderId:id(1),
        orderItemId:id(2),actor,db:f.db,env:badEnv,paypal:{refundCapture:jest.fn()}}))
        .rejects.toMatchObject({code:'ITEM_REFUND_PAYPAL_NOT_SANDBOX'});
    }
    expect(ledger.claimRefundIntent).not.toHaveBeenCalled();
    expect(f.events.some(x=>x.includes("SET status='processing'"))).toBe(false);
  });
  test('l’orchestrateur est désactivé par défaut même en staging',async()=>{
    const f=fixture();
    await expect(executeReservedItemRefund({reservationId:id(6),orderId:id(1),
      orderItemId:id(2),actor,db:f.db,env:{KOMERCE_ENV:'staging'},
      stripe:f.stripe})).rejects.toMatchObject({code:'E7_SANDBOX_PSP_DISABLED'});
    expect(f.stripe.refunds.create).not.toHaveBeenCalled();
  });

  test('attestation réservée et claim avant PSP, puis journal financier confirmé',async()=>{
    const f=fixture();
    const out=await executeReservedItemRefund({
      reservationId:id(6),orderId:id(1),orderItemId:id(2),actor,db:f.db,env,stripe:f.stripe,
    });
    expect(out).toMatchObject({status:'confirmed',paid:true,reservationId:id(6)});
    expect(ledger.claimRefundIntent).toHaveBeenCalledTimes(1);
    expect(f.stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({
      payment_intent:'pi_test',amount:200
    }),{idempotencyKey:'kmr-ref-'+id(5)});
    expect(verify.reconcileRefundIntent).toHaveBeenCalledWith(expect.objectContaining({
      intentId:id(5),providerRefundId:'re_123'
    }));
    expect(f.events.indexOf('PROVIDER_POST')).toBeLessThan(f.events.findIndex(x=>x.startsWith('INSERT INTO refunds')));
    expect(f.events.some(x=>x.startsWith('UPDATE order_items'))).toBe(true);
    expect(f.events.slice(-1)).toEqual(['COMMIT']);
  });
  test('échec PSP vérifié : réserve libérée, aucun refund ni article crédité',async()=>{
    const f=fixture();
    verify.reconcileRefundIntent.mockResolvedValueOnce({complete:false,status:'failed'});
    const out=await executeReservedItemRefund({
      reservationId:id(6),orderId:id(1),orderItemId:id(2),
      actor,db:f.db,env,stripe:f.stripe
    });
    expect(out).toMatchObject({status:'failed',paid:false,verified:true});
    expect(f.events.some(x=>x.includes("status='failed'"))).toBe(true);
    expect(f.events.some(x=>x.startsWith('INSERT INTO refunds'))).toBe(false);
    expect(f.events.some(x=>x.startsWith('UPDATE order_items'))).toBe(false);
  });
  test('timeout PSP : statut UNKNOWN, aucune deuxième sortie ni clôture inventée',async()=>{
    const f=fixture({providerFails:true});
    const out=await executeReservedItemRefund({
      reservationId:id(6),orderId:id(1),orderItemId:id(2),actor,db:f.db,env,stripe:f.stripe
    });
    expect(out).toMatchObject({status:'unknown',paid:null,requiresReconciliation:true,errorCode:'ETIMEDOUT'});
    expect(f.events.filter(x=>x==='PROVIDER_POST')).toHaveLength(1);
    expect(f.events.filter(x=>x.startsWith('INSERT INTO refunds'))).toHaveLength(0);
    expect(f.events.some(x=>x.includes("SET status='unknown'"))).toBe(true);
  });
  test('un intent en cours/unknown est non réexécutable et non payable',async()=>{
    const f=fixture({intentStatus:'unknown',reservationStatus:'unknown'});
    await expect(executeReservedItemRefund({
      reservationId:id(6),orderId:id(1),orderItemId:id(2),actor,db:f.db,env,stripe:f.stripe
    })).rejects.toMatchObject({code:'ITEM_REFUND_NOT_RETRYABLE'});
    expect(f.stripe.refunds.create).not.toHaveBeenCalled();
  });
});
