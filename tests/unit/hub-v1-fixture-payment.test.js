'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({getClient:jest.fn()}));
jest.mock('../../services/payment-service',()=>({markPaid:jest.fn()}));
jest.mock('../../services/order-status-machine',()=>({transitionOrderStatus:jest.fn()}));
const db=require('../../db');
const {markPaid}=require('../../services/payment-service');
const {transitionOrderStatus}=require('../../services/order-status-machine');
const {confirmFixturePayment}=require('../../services/hub-v1-fixture-payment');
const uuid='00000000-0000-0000-0000-000000000001';
const reference='E2E-HUB-V1-ABC12345-KOM-101';
const env={KOMERCE_ENV:'staging',NODE_ENV:'test',HUB_V1_E2E_APPLY_MODE:'approved'};
function client({payment_status='pending',status='pending',simulation_scope='E2E-HUB-V1',
  buyer_email='e2e-hub-v1-abc12345@komerce.test',payment_mode='cash_relais',actorRole='admin'}={}){
  const q=jest.fn(async sql=>{
    if(sql.startsWith('SELECT o.id'))return{rows:[{
      id:uuid,reference,simulation_scope,payment_mode,
      payment_status,status,buyer_email,
    }]};
    if(sql.includes('SELECT role::text AS role FROM users'))return{rows:[{role:actorRole}]};
    return{rows:[]};
  });
  return{query:q,release:jest.fn()};
}
beforeEach(()=>{
  jest.clearAllMocks();
  markPaid.mockResolvedValue({changed:true,rowCount:1});
  transitionOrderStatus.mockImplementation(async ({newStatus})=>({
    success:true,noop:false,newStatus,
  }));
});
test('staging test-only approved required before any SQL',async()=>{
  await expect(confirmFixturePayment({reference,actorId:uuid,env:{...env,NODE_ENV:'production'}}))
    .rejects.toMatchObject({code:'HUB_V1_FIXTURE_PAYMENT_ENV_FORBIDDEN'});
  await expect(confirmFixturePayment({reference,actorId:uuid,env:{...env,HUB_V1_E2E_APPLY_MODE:'audit'}}))
    .rejects.toMatchObject({code:'HUB_V1_FIXTURE_PAYMENT_ENV_FORBIDDEN'});
  expect(db.getClient).not.toHaveBeenCalled();
});
test('markPaid canonique et deux transitions dans la même transaction, aucune caisse ni PSP',async()=>{
  const c=client();db.getClient.mockResolvedValue(c);
  const out=await confirmFixturePayment({reference,actorId:uuid,env});
  expect(out).toMatchObject({ok:true,proof:'SIMULATION_ONLY_NO_DEBIT',idempotent_replay:false});
  expect(markPaid).toHaveBeenCalledWith(uuid,{client:c,cashPaidAt:false});
  expect(transitionOrderStatus.mock.calls.map(([x])=>x.newStatus)).toEqual(['confirmed','ordered']);
  expect(transitionOrderStatus.mock.calls.every(([x])=>x.dbClient===c&&x.source==='hub_v1_fixture')).toBe(true);
  expect(c.query.mock.calls.map(x=>x[0])).toEqual(expect.arrayContaining(['BEGIN','COMMIT']));
  expect(c.query.mock.calls.map(x=>x[0])).not.toContain('ROLLBACK');
  expect(c.release).toHaveBeenCalledTimes(1);
});
test('isolation : refus commande réelle, buyer non fictif et acteur sans autorité',async()=>{
  for(const overrides of [
    {simulation_scope:null}, {buyer_email:'real@user.com'}, {actorRole:'client'},
    {payment_mode:'stripe_eur'},
  ]){
    const c=client(overrides);db.getClient.mockResolvedValue(c);
    await expect(confirmFixturePayment({reference,actorId:uuid,env})).rejects.toBeTruthy();
    expect(c.query.mock.calls.map(x=>x[0])).toContain('ROLLBACK');
    expect(c.query.mock.calls.map(x=>x[0])).not.toContain('COMMIT');
    expect(c.release).toHaveBeenCalledTimes(1);
  }
  expect(markPaid).not.toHaveBeenCalled();
});
test('rejeu = no-op sans payer ni écrire ; transition refusée -> ROLLBACK',async()=>{
  const c=client({payment_status:'paid',status:'ordered'});db.getClient.mockResolvedValue(c);
  const noop=await confirmFixturePayment({reference,actorId:uuid,env});
  expect(noop.idempotent_replay).toBe(true);
  expect(markPaid).not.toHaveBeenCalled();
  expect(c.query.mock.calls.map(x=>x[0])).toContain('ROLLBACK');
  const c2=client();db.getClient.mockResolvedValue(c2);
  transitionOrderStatus.mockResolvedValueOnce({success:false,error:'gate'});
  await expect(confirmFixturePayment({reference,actorId:uuid,env}))
    .rejects.toMatchObject({code:'HUB_V1_FIXTURE_STATUS_TRANSITION_REFUSED'});
  expect(c2.query.mock.calls.map(x=>x[0])).toContain('ROLLBACK');
  expect(c2.query.mock.calls.map(x=>x[0])).not.toContain('COMMIT');
});
