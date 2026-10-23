'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const { reconcileRefundIntent } = require('../../services/refund-intent-reconciliation');
const intent = { id:'11111111-2222-4333-8444-555555555555',
  order_id:'22222222-3333-4444-8555-666666666666',
  market_id:'33333333-4444-4555-8666-777777777777',
  provider:'stripe', capture_ref:'pi_mock', amount_eur:'20.00', status:'processing', provider_ref:null };
function fixture(extra={}) {
  const log=[];
  const stripe = { refunds:{ retrieve:jest.fn(async()=>{
    log.push('PSP_GET'); if(extra.timeout) throw Error('timeout');
    return { id:'re_mock', payment_intent:'pi_mock', currency:'eur',amount:2000,status:'succeeded', ...extra.provider };
  }) } };
  const client={query:jest.fn(async sql=>{
    log.push(sql);
    if(sql.includes('FROM orders WHERE')) return {rows:[{id:intent.order_id,market_id:extra.market || intent.market_id}]};
    if(sql.includes('FROM refund_execution_intents')&&sql.includes('FOR UPDATE')) return {rows:[extra.current || intent]};
    if(sql.startsWith('UPDATE refund_execution_intents')) return {rows:extra.updated === false ? []:[{id:intent.id}]};
    return {rows:[]};
  }),release:jest.fn()};
  const db={query:jest.fn(async()=>({rows:[extra.row || intent]})),connect:jest.fn(async()=>client)};
  const opts={intentId:intent.id,providerRefundId:'re_mock',stripe,db};
  return {opts,db,client,stripe,log};
}
test('GET avant BEGIN et preuve confirmée inscrite une seule fois',async()=>{
  const f=fixture(),r=await reconcileRefundIntent(f.opts);
  expect(r).toMatchObject({status:'confirmed',complete:true});
  expect(f.log.slice(0,2)).toEqual(['PSP_GET','BEGIN']);
  expect(f.log.at(-1)).toBe('COMMIT');
  expect(f.log.some(sql=>String(sql).includes('UPDATE orders'))).toBe(false);
});
test('rejeu confirmé ne rappelle jamais le PSP',async()=>{
  const f=fixture({row:{...intent,status:'confirmed',provider_ref:'re_mock'}});
  expect(await reconcileRefundIntent(f.opts)).toMatchObject({replayed:true,status:'confirmed'});
  expect(f.stripe.refunds.retrieve).not.toHaveBeenCalled();
});
test('timeout donne UNKNOWN et jamais un succès',async()=>{
  const f=fixture({timeout:true});
  expect(await reconcileRefundIntent(f.opts)).toMatchObject({status:'unknown',complete:false});
});
test.each([
  [{payment_intent:'pi_other'},'REFUND_EVIDENCE_CAPTURE_MISMATCH'],
  [{amount:2001},'REFUND_EVIDENCE_AMOUNT_MISMATCH'],
  [{currency:'usd'},'REFUND_EVIDENCE_AMOUNT_MISMATCH']
])('preuve PSP contradictoire refusée sans transaction',async(provider,code)=>{
  const f=fixture({provider});
  await expect(reconcileRefundIntent(f.opts)).rejects.toMatchObject({code});
  expect(f.db.connect).not.toHaveBeenCalled();
});
test('marché incohérent : rollback sans écriture',async()=>{
  const f=fixture({market:'44444444-4444-4444-8444-444444444444'});
  await expect(reconcileRefundIntent(f.opts)).rejects.toMatchObject({code:'REFUND_MARKET_MISMATCH'});
  expect(f.log.at(-1)).toBe('ROLLBACK');
});
test('capture modifiée pendant appel : rollback',async()=>{
  const f=fixture({current:{...intent,capture_ref:'pi_other'}});
  await expect(reconcileRefundIntent(f.opts)).rejects.toMatchObject({code:'REFUND_INTENT_CHANGED'});
  expect(f.log.at(-1)).toBe('ROLLBACK');
});
test('concurrence : si une transaction a déjà confirmé, pas de second update',async()=>{
  const f=fixture({current:{...intent,status:'confirmed',provider_ref:'re_mock'}});
  expect(await reconcileRefundIntent(f.opts)).toMatchObject({replayed:true,status:'confirmed'});
  expect(f.log.some(q=>String(q).startsWith('UPDATE'))).toBe(false);
});
test('reserved ne lance jamais de PSP',async()=>{
  const f=fixture({row:{...intent,status:'reserved'}});
  await expect(reconcileRefundIntent(f.opts)).rejects.toMatchObject({code:'REFUND_INTENT_NOT_RECONCILABLE'});
  expect(f.stripe.refunds.retrieve).not.toHaveBeenCalled();
});
test('mise à jour sans ligne retourne conflit et rollback',async()=>{
  const f=fixture({updated:false});
  await expect(reconcileRefundIntent(f.opts)).rejects.toMatchObject({code:'REFUND_RECONCILIATION_CONFLICT'});
  expect(f.log.at(-1)).toBe('ROLLBACK');
});

test('rejeu confirmé sans référence PSP persistée : refus fermé',async()=>{
  const f=fixture({row:{...intent,status:'confirmed',provider_ref:null}});
  await expect(reconcileRefundIntent(f.opts)).rejects.toMatchObject({code:'REFUND_CONFIRMED_REFERENCE_UNVERIFIED'});
  expect(f.stripe.refunds.retrieve).not.toHaveBeenCalled();
});
test('course : confirmation concurrente sans référence PSP refuse le succès',async()=>{
  const f=fixture({current:{...intent,status:'confirmed',provider_ref:null}});
  await expect(reconcileRefundIntent(f.opts)).rejects.toMatchObject({code:'REFUND_CONFIRMED_REFERENCE_UNVERIFIED'});
  expect(f.log.at(-1)).toBe('ROLLBACK');
  expect(f.log.some(q=>String(q).startsWith('UPDATE'))).toBe(false);
});
