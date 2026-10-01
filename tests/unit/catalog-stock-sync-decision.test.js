'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const skuProof = require('../../services/sourcing-catalog-change-sku-identity-proof');
const { decideStockSyncApplication, DECISION, REASON } = require('../../services/catalog-stock-sync-decision');

const ENV_KEYS = ['GITHUB_ACTIONS', 'NODE_ENV', 'KOMERCE_DISABLE_CRONS', 'DATABASE_URL'];
const saved = {};
beforeAll(() => {
  ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; });
  process.env.GITHUB_ACTIONS = 'true';
  process.env.NODE_ENV = 'test';
  process.env.KOMERCE_DISABLE_CRONS = 'true';
  process.env.DATABASE_URL = 'postgresql://komerce:komerce@localhost:5432/komerce_test';
});
afterAll(() => {
  ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
});

const identityFn = async () => ({
  status: skuProof.STATUS.EXACT_CATALOG_SKU_IDENTITY, product_sku_id: 'sku-1', stock_available_observed: 5, source_id: 'src-1',
});
const authorityFn = async (ctx) => ({ proved: true, operation: 'stock_read', source_id: ctx.source_id, product_sku_id: ctx.product_sku_id });

// Script de requêtes dans l'ordre de decideStockSyncApplication.
function scripted(rowsByStep) {
  const sqls = [];
  const query = jest.fn(async (sql) => {
    sqls.push(String(sql));
    const rows = rowsByStep.shift();
    if (!rows) throw new Error('script épuisé : ' + sql);
    return { rows };
  });
  return { query, sqls };
}

describe('catalog-stock-sync-decision — engagements fournisseur lus via les lignes d\'achat', () => {
  const envelope = [{ observed_at: new Date(Date.now() - 3600e3).toISOString(), event_id: 'e1' }];

  it('PO pending/notified portée par une ligne (PO regroupée sans product_sku_id) → REVIEW_REQUIRED', async () => {
    const { query, sqls } = scripted([envelope, [], [{ id: 'po-1', status: 'pending' }]]);
    const v = await decideStockSyncApplication('obs-1', { query, identityFn, authorityFn });
    expect(v).toMatchObject({ decision: DECISION.REVIEW_REQUIRED, reason: REASON.UNRECONCILED_KOMERCE_COMMITMENT });
    expect(sqls[3 - 1]).toContain('purchase_lines');
    expect(sqls[3 - 1]).toContain("status IN ('pending','notified')");
  });

  it('engagement historique sans preuve de réconciliation → REVIEW_REQUIRED, la requête passe aussi par les lignes', async () => {
    const { query, sqls } = scripted([envelope, [], [], [{ id: 'po-2', status: 'confirmed' }]]);
    const v = await decideStockSyncApplication('obs-1', { query, identityFn, authorityFn, reconciliationFn: async () => ({ proved: false }) });
    expect(v).toMatchObject({ decision: DECISION.REVIEW_REQUIRED, reason: REASON.STOCK_RECONCILIATION_NOT_PROVEN, commitment_count_at_least: 1 });
    expect(sqls[3]).toContain('purchase_lines');
  });
});
