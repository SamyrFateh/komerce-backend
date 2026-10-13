'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

const { describeE2E, createCleanup, uuid, tag } = require('../helpers/e2eDbKit');
jest.setTimeout(30000);

const adapter = require('../../services/mobile-money/orange-money-cm');
const statusQueue = [];
jest.spyOn(adapter, 'isConfigured').mockImplementation(() => true);
jest.spyOn(adapter, 'getStatus').mockImplementation(async () => {
  const next = statusQueue.shift();
  if (next instanceof Error) throw next;
  if (!next) throw new Error('S5 provider status queue exhausted');
  return next;
});
const mobileMoney = require('../../services/payment-mobile-money');

describeE2E('S5 — Mobile Money replay, ordering and provider faults', ({ db }) => {
  const marketId = uuid();
  const userId = uuid();
  const productId = uuid();
  const relaisId = uuid();
  let cleanup;

  async function seedAttempt(label) {
    const orderId = uuid(); const txId = uuid();
    const ref = tag(`mm-${label}`); const external = tag(`provider-${label}`);
    await db.query(`INSERT INTO orders (id,reference,user_id,market_id,relais_id,total_kmf,payment_mode,payment_status,status) VALUES ($1,$2,$3,$4,$5,10000,'mobile_money','pending','pending')`, [orderId,ref,userId,marketId,relaisId]);
    cleanup.track('orders','id',orderId);
    cleanup.trackSql('DELETE FROM invoices WHERE order_id=$1',[orderId]);
    cleanup.trackSql('DELETE FROM order_items WHERE order_id=$1',[orderId]);
    cleanup.trackSql('DELETE FROM order_status_history WHERE order_id=$1',[orderId]);
    await db.query(`INSERT INTO order_items (order_id,product_id,quantity,price_kmf) VALUES ($1,$2,1,10000)`,[orderId,productId]);
    await db.query(`INSERT INTO mobile_money_transactions (id,order_id,market_id,provider,currency,minor_unit,amount_minor,external_transaction_id,status,provider_status) VALUES ($1,$2,$3,'orange_money','XAF',0,13334,$4,'pending','PENDING')`,[txId,orderId,marketId,external]);
    cleanup.track('mobile_money_transactions','id',txId);
    return {orderId,txId};
  }

  async function snapshot(orderId,txId) {
    const {rows:[order]}=await db.query('SELECT status,payment_status,confirmed_at FROM orders WHERE id=$1',[orderId]);
    const {rows:[tx]}=await db.query('SELECT status,provider_status,completed_at FROM mobile_money_transactions WHERE id=$1',[txId]);
    const {rows:[h]}=await db.query('SELECT count(*)::int AS n FROM order_status_history WHERE order_id=$1',[orderId]);
    return {order,tx,history:h.n};
  }

  beforeAll(async()=>{
    cleanup=createCleanup(db);
    await db.query(`INSERT INTO markets (id,code,name,currency,minor_unit,is_active,lifecycle_status) VALUES ($1,$2,$3,'XAF',0,true,'ACTIVE')`,[marketId,tag('S5').slice(0,12).toUpperCase(),'S5 Mobile Money Market']); cleanup.track('markets','id',marketId);
    await db.query(`INSERT INTO relais (id,name,agent_name,phone,address,market_id) VALUES ($1,$2,'S5 Agent','+237600000001','S5 Relay',$3)`,[relaisId,tag('S5 Relay'),marketId]); cleanup.track('relais','id',relaisId);
    await db.query(`INSERT INTO users (id,full_name,email,phone,role) VALUES ($1,'S5 Client',$2,$3,'client')`,[userId,`${tag('s5')}@komerce.test`,`+2693${Date.now().toString().slice(-7)}`]); cleanup.track('users','id',userId);
    await db.query(`INSERT INTO products (id,name,price_kmf,stock) VALUES ($1,$2,10000,100)`,[productId,tag('S5 Product')]); cleanup.track('products','id',productId);
  });
  afterEach(()=>{statusQueue.length=0;});
  afterAll(async()=>{if(cleanup) await cleanup.run();});

  it('provider timeout leaves canonical state unchanged',async()=>{
    const a=await seedAttempt('timeout'); const before=await snapshot(a.orderId,a.txId);
    const err=new Error('provider timeout'); err.code='ETIMEDOUT'; statusQueue.push(err);
    await expect(mobileMoney.reconcileMobileMoneyTransaction(a.txId)).rejects.toMatchObject({code:'ETIMEDOUT'});
    expect(await snapshot(a.orderId,a.txId)).toEqual(before);
  });

  it('amount mismatch never confirms payment',async()=>{
    const a=await seedAttempt('mismatch'); const before=await snapshot(a.orderId,a.txId);
    statusQueue.push({status:'succeeded',providerStatus:'SUCCESSFUL',amount:13335,currency:'XAF',safePayload:{}});
    await expect(mobileMoney.reconcileMobileMoneyTransaction(a.txId)).rejects.toMatchObject({code:'mobile_money_payment_contract_mismatch'});
    expect(await snapshot(a.orderId,a.txId)).toEqual(before);
  });

  it('failed then late success confirms exactly once',async()=>{
    const a=await seedAttempt('late-success');
    statusQueue.push({status:'failed',providerStatus:'FAILED',amount:13334,currency:'XAF',safePayload:{}});
    expect((await mobileMoney.reconcileMobileMoneyTransaction(a.txId)).transaction.status).toBe('failed');
    statusQueue.push({status:'succeeded',providerStatus:'SUCCESSFUL',amount:13334,currency:'XAF',safePayload:{}});
    expect((await mobileMoney.reconcileMobileMoneyTransaction(a.txId)).transaction.status).toBe('succeeded');
    const once=await snapshot(a.orderId,a.txId);
    expect(once.order.payment_status).toBe('paid'); expect(once.order.status).toBe('ordered'); expect(once.history).toBe(3);
    expect((await mobileMoney.reconcileMobileMoneyTransaction(a.txId)).reconciled).toBe(false);
    expect(await snapshot(a.orderId,a.txId)).toEqual(once);
  });

  it('late old observation cannot downgrade succeeded',async()=>{
    const a=await seedAttempt('monotonic');
    statusQueue.push({status:'succeeded',providerStatus:'SUCCESSFUL',amount:13334,currency:'XAF',safePayload:{}});
    await mobileMoney.reconcileMobileMoneyTransaction(a.txId); const before=await snapshot(a.orderId,a.txId);
    expect((await mobileMoney.reconcileMobileMoneyTransaction(a.txId)).reconciled).toBe(false);
    expect(await snapshot(a.orderId,a.txId)).toEqual(before);
  });
});
