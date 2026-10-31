'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ getClient: jest.fn() }));
const db = require('../../db');
const prices = require('../../services/market-commercial-price-service');

const market = {id:'00000000-0000-4000-8000-000000000001',code:'KM',currency:'KMF'};
const product = {id:'00000000-0000-4000-8000-000000000002',product_ref:'KPR-1',name:'Produit',category:'Audio',price_kmf:25000,is_active:true};
const actorId='00000000-0000-4000-8000-000000000003';
const snapshot = {activation_allowed:true,local_price:28000,currency:'KMF',strategy_risk:'contributive'};

let statements;
beforeEach(() => {
  statements = [];
  db.getClient.mockReset();
  db.getClient.mockImplementation(async () => ({
    release: jest.fn(),
    query: jest.fn(async (sql, params=[]) => {
      statements.push({sql:String(sql),params});
      const q=String(sql);
      if (q.includes('FROM products')) return {rows:[product]};
      if (q.includes('FROM product_market_price_drafts') && q.includes('FOR UPDATE')) {
        return {rows:[{amount:25000,currency:'KMF',status:'LOCAL_ACTIVE'}]};
      }
      if (q.includes('UPDATE product_market_price_drafts')) {
        return {rows:[{amount:28000,status:'LOCAL_ACTIVE',reason:'Repricing',source:'market_catalog_atomic_reprice',updated_at:new Date().toISOString(),authorized_at:new Date().toISOString(),active_at:new Date().toISOString()}]};
      }
      return {rows:[]};
    }),
  }));
});

test('un repricing actif conserve LOCAL_ACTIVE pendant une unique transaction et journalise SET', async () => {
  const result=await prices.replaceActiveMarketPrice({
    market,productRef:'KPR-1',amount:28000,expectedAmount:25000,
    authorizationSnapshot:snapshot,reason:'Repricing contrôlé',actorId,
  });
  expect(result).toMatchObject({decision_status:'LOCAL_ACTIVE',buyer_effective:true,local_price:28000});
  const sql=statements.map(x=>x.sql).join('\n');
  expect(sql).toMatch(/BEGIN/);
  expect(sql).toMatch(/COMMIT/);
  expect(sql).toMatch(/SET amount=\$3/);
  expect(sql).toMatch(/status='LOCAL_ACTIVE'/);
  expect(sql).toMatch(/'SET', \$3, \$4/);
  expect(sql).not.toContain('DRAFT_PENDING_GATE');
});

test('un prix actif modifié depuis la lecture provoque un refus concurrent, sans écriture', async () => {
  await expect(prices.replaceActiveMarketPrice({
    market,productRef:'KPR-1',amount:28000,expectedAmount:22000,
    authorizationSnapshot:snapshot,reason:'Repricing contrôlé',actorId,
  })).rejects.toMatchObject({code:'market_price_reprice_concurrent_change',status:409});
  expect(statements.some(x=>x.sql.includes('UPDATE product_market_price_drafts'))).toBe(false);
  expect(statements.some(x=>x.sql==='ROLLBACK')).toBe(true);
});

test('une preuve serveur non autorisante est rejetée avant toute transaction', async () => {
  await expect(prices.replaceActiveMarketPrice({
    market,productRef:'KPR-1',amount:28000,expectedAmount:25000,
    authorizationSnapshot:{...snapshot,activation_allowed:false},reason:'Repricing contrôlé',actorId,
  })).rejects.toMatchObject({code:'market_price_reprice_authorization_required'});
  expect(db.getClient).not.toHaveBeenCalled();
});
