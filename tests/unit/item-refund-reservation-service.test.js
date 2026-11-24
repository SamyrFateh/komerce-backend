'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief E7 : prorata de la capture d'origine, sans PSP ni conversion du jour.
 */
jest.mock('../../db', () => ({ getClient: jest.fn() }));
const { calculateRefundShare, readVerifiedShortageCandidates } = require('../../services/item-refund-reservation-service');
describe('E7 item refund quote - captured snapshot', () => {
  it('un article manquant sur trois : 1/3 du montant encaissé sans taux du jour', () => {
    expect(calculateRefundShare({quantity:1,priceKmf:'1000',totalKmf:'3000',totalEur:'6.00'}))
      .toMatchObject({amountKmf:'1000.00',amountEur:'2.00'});
  });
  it('conserve le centime de la capture avec arrondi déterministe', () => {
    expect(calculateRefundShare({quantity:1,priceKmf:'1.00',totalKmf:'3.00',totalEur:'1.00'}).amountEur)
      .toBe('0.33');
  });
  it('refuse des prix qui dépassent la capture', () => {
    expect(() => calculateRefundShare({quantity:2,priceKmf:'1000',totalKmf:'1000',totalEur:'2.00'}))
      .toThrow('Montants capturés ou prix de ligne incompatibles');
  });
  it('refuse les quotités invalides ou sans snapshot', () => {
    expect(() => calculateRefundShare({quantity:0,priceKmf:'1',totalKmf:'2',totalEur:'1'})).toThrow();
    expect(() => calculateRefundShare({quantity:1,priceKmf:'1',totalKmf:'2',totalEur:''})).toThrow();
  });
});

describe('N26a candidate projection — read-only and PSP-only',()=>{
  const admin={id:'admin-1',role:'admin'};
  function candidateDb({payment='stripe_eur',blocked=false}={}){
    const query=jest.fn(async sql=>{
      if(sql.includes('FROM orders WHERE UPPER(reference)'))return {rows:[{id:'order-1',reference:'K1FOWL5',
        status:'in_transit',payment_mode:payment,payment_status:'paid',has_capture:payment!=='cash_relais'}]};
      if(sql.includes('FROM order_items oi LEFT JOIN products'))return {rows:[{id:'item-1',quantity:3,
        qty_collected:1,qty_refunded:0,product_name:'Tissu test',reserved:0}]};
      if(sql.includes('FROM incidents WHERE order_id'))return {rows:[]};
      if(sql.includes('FROM international_shipment_relay_receipts r'))return {rows:[{incident_id:'incident-1',
        order_item_id:'item-1',missing:2}]};
      if(sql.includes('SELECT\n        EXISTS'))return {rows:[{legacy_refund:false,
        unresolved_intent:blocked,local_claim:false}]};
      throw new Error('Unexpected candidate query: '+sql);
    });
    return {query};
  }
  test('offers only verified missing units on paid PSP order, subtracting collected and held quantities',async()=>{
    const db=candidateDb();
    const out=await readVerifiedShortageCandidates({orderReference:'K1FOWL5',actor:admin,db});
    expect(out).toMatchObject({order:{payment_mode:'stripe_eur',payment_status:'paid'},blocked:false,
      candidates:[{incident_id:'incident-1',order_item_id:'item-1',proof:'relay_receipt',
        verified_missing:2,available_quantity:2}]});
    expect(db.query).toHaveBeenCalledTimes(5);
    expect(db.query.mock.calls.some(([sql])=>/INSERT|UPDATE|DELETE/i.test(sql))).toBe(false);
  });
  test('hides candidates for a local rail or unresolved refund intent',async()=>{
    const local=await readVerifiedShortageCandidates({orderReference:'K1FOWL5',actor:admin,db:candidateDb({payment:'cash_relais'})});
    expect(local).toMatchObject({blocked:true,candidates:[]});
    const unresolved=await readVerifiedShortageCandidates({orderReference:'K1FOWL5',actor:admin,db:candidateDb({blocked:true})});
    expect(unresolved).toMatchObject({blocked:true,candidates:[]});
  });
  test('allows the N27 read-only context to show verified local-rail candidates without changing the PSP default',async()=>{
    const out=await readVerifiedShortageCandidates({orderReference:'K1FOWL5',actor:admin,
      db:candidateDb({payment:'cash_relais'}),allowLocal:true});
    expect(out).toMatchObject({blocked:false,order:{payment_mode:'cash_relais'},
      candidates:[{incident_id:'incident-1',available_quantity:2}]});
  });
  test('requires an admin and a valid command reference before reading',async()=>{
    const db=candidateDb();
    await expect(readVerifiedShortageCandidates({orderReference:'K1FOWL5',actor:{id:'relay',role:'agent_relais'},db}))
      .rejects.toMatchObject({code:'ITEM_REFUND_ADMIN_REQUIRED'});
    await expect(readVerifiedShortageCandidates({orderReference:'../secret',actor:admin,db}))
      .rejects.toMatchObject({code:'ITEM_REFUND_REFERENCE_INVALID'});
    expect(db.query).not.toHaveBeenCalled();
  });
});
