'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/suppliers/canonical-unit-purchasing-gate', () => ({
  evaluateCanonicalProcurementReadiness: jest.fn(),
}));
jest.mock('../../services/suppliers/execution-adapter-registry', () => ({ EXECUTION_ADAPTER_REGISTRY: { fake: {} } }));

const gate = require('../../services/suppliers/canonical-unit-purchasing-gate');
const snap = require('../../services/purchase-line-snapshot');

const ENV = process.env.KOMERCE_PROCUREMENT_HUB_REF;
afterEach(() => {
  if (ENV === undefined) delete process.env.KOMERCE_PROCUREMENT_HUB_REF; else process.env.KOMERCE_PROCUREMENT_HUB_REF = ENV;
  jest.clearAllMocks();
});

describe('hub', () => {
  test('défaut DXB, surcharge par env, libellé', () => {
    delete process.env.KOMERCE_PROCUREMENT_HUB_REF;
    expect(snap.resolveProcurementHubRef()).toBe('DXB');
    process.env.KOMERCE_PROCUREMENT_HUB_REF = '  IST ';
    expect(snap.resolveProcurementHubRef()).toBe('IST');
    expect(snap.procurementHubLabel('DXB')).toBe('Dubai');
    expect(snap.procurementHubLabel('IST')).toBe('IST');
  });
});

describe('requireSupplierMoney', () => {
  test('prix canonique, repli AED, devise explicite', () => {
    expect(snap.requireSupplierMoney({ supplier_unit_price: 3, supplier_currency: 'usd' })).toEqual({ amount: 3, currency: 'USD' });
    expect(snap.requireSupplierMoney({ supplier_price_aed: 5 })).toEqual({ amount: 5, currency: 'AED' });
  });
  test.each([[undefined], [{}], [{ supplier_unit_price: 0, supplier_currency: 'AED' }], [{ supplier_unit_price: 2 }], [{ supplier_unit_price: 2, supplier_currency: 'EURO' }]])(
    'refuse %j', (t) => { expect(() => snap.requireSupplierMoney(t)).toThrow('SUPPLIER_MONEY_UNAVAILABLE'); });
});

describe('loadExactSoldSku', () => {
  test('sans sku_id → null', async () => {
    expect(await snap.loadExactSoldSku({ query: jest.fn() }, {})).toBeNull();
  });
  test('sku introuvable → bloqué', async () => {
    const c = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(snap.loadExactSoldSku(c, { sku_id: 's', product_id: 'p' })).rejects.toThrow();
  });
  test('supplier_sku absent → bloqué', async () => {
    const c = { query: jest.fn().mockResolvedValue({ rows: [{ id: 's', supplier_sku: '  ' }] }) };
    await expect(snap.loadExactSoldSku(c, { sku_id: 's', product_id: 'p' })).rejects.toThrow();
    c.query.mockResolvedValue({ rows: [{ id: 's' }] });
    await expect(snap.loadExactSoldSku(c, { sku_id: 's', product_id: 'p' })).rejects.toThrow();
  });
  test('nominal avec et sans supplier_unit_ref', async () => {
    const identity = { provider: 'x', version: 1, payload: { k: 'v' } };
    const c = { query: jest.fn().mockResolvedValue({ rows: [{ id: 's', product_id: 'p', supplier_sku: ' A1 ', supplier_unit_ref: ' U ', supplier_order_identity: identity }] }) };
    const out = await snap.loadExactSoldSku(c, { sku_id: 's', product_id: 'p' });
    expect(out).toMatchObject({ supplier_sku: 'A1', supplier_unit_ref: 'U' });
    // identité présente sans supplier_unit_ref : refus (le SOI exige une unité commandable)
    c.query.mockResolvedValue({ rows: [{ id: 's', supplier_sku: 'A1', supplier_unit_ref: null, supplier_order_identity: identity }] });
    await expect(snap.loadExactSoldSku(c, { sku_id: 's', product_id: 'p' })).rejects.toThrow('supplier_unit_ref requis');
  });
});

describe('resolveExactSkuProcurementReadiness', () => {
  const client = { query: jest.fn() };
  const sku = { id: 's', supplier_order_identity: { provider: 'x' } };
  test('refus du gate (reason, status, evidence par défaut)', async () => {
    gate.evaluateCanonicalProcurementReadiness.mockResolvedValueOnce({ ready: false, reason: 'no_stock', evidence: { a: 1 } });
    await expect(snap.resolveExactSkuProcurementReadiness(client, sku, 1)).rejects.toThrow();
    gate.evaluateCanonicalProcurementReadiness.mockResolvedValueOnce({ ready: false, status: 'blocked' });
    await expect(snap.resolveExactSkuProcurementReadiness(client, sku, 1, {})).rejects.toThrow();
  });
  test('prêt → traduit le verdict', async () => {
    gate.evaluateCanonicalProcurementReadiness.mockResolvedValueOnce({
      ready: true, money: { unit_price: 4, currency: 'AED' }, canonical_unit_id: 'cu', canonical_unit: { u: 1 },
      supplier_unit_ref: 'R', identity: { provider: 'x' }, preflight: { ok: true },
    });
    expect(await snap.resolveExactSkuProcurementReadiness(client, sku, 2, { k: 1 })).toMatchObject({ unit_price: 4, currency: 'AED', canonical_unit_id: 'cu', supplier_unit_ref: 'R' });
  });
});

describe('buildPurchaseTarget', () => {
  test('chemin exact-sku', () => {
    const out = snap.buildPurchaseTarget({ id: 'ps' }, { supplier_sku: 'S' }, { unit_price: 2, currency: 'USD', supplier_unit_ref: 'R', supplier_order_identity: { p: 1 } });
    expect(out).toMatchObject({ unitPriceAed: null, supplierUnitRef: 'R', supplierOrderIdentity: { p: 1 }, money: { amount: 2, currency: 'USD' } });
    expect(out.purchaseTarget.supplier_sku).toBe('S');
  });
  test('chemin historique AED', () => {
    const out = snap.buildPurchaseTarget({ supplier_sku: 'H', supplier_price_aed: '7' }, null, null);
    expect(out).toMatchObject({ unitPriceAed: 7, supplierUnitRef: null, supplierOrderIdentity: null });
  });
});

describe('lignes historiques', () => {
  const ps = { id: 'ps', supplier_id: 'sup' };
  const base = { purchaseOrderId: 'po', item: { id: 'it' }, ps, quantity: 3 };
  const snapshot = (over = {}) => ({ productSkuId: 'sk', purchaseTarget: { supplier_sku: 'S' }, supplierUnitRef: 'R', supplierOrderIdentity: { p: 1 }, money: { amount: 2, currency: 'AED' }, ...over });

  test('sans order_item → aucune ligne', async () => {
    const c = { query: jest.fn() };
    expect(await snap.insertHistoricalPurchaseLine(c, { ...base, item: {}, snapshot: snapshot() })).toBeNull();
    expect(await snap.insertHistoricalPurchaseLine(c, { ...base, item: null, snapshot: snapshot() })).toBeNull();
    expect(c.query).not.toHaveBeenCalled();
  });
  test('insertion complète', async () => {
    delete process.env.KOMERCE_PROCUREMENT_HUB_REF;
    const c = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'l1' }] }) };
    expect(await snap.insertHistoricalPurchaseLine(c, { ...base, snapshot: snapshot() })).toEqual({ id: 'l1' });
    expect(c.query.mock.calls[0][1]).toEqual(['po', 'it', 'sup', 'ps', 'sk', 'S', 'R', JSON.stringify({ p: 1 }), 3, 2, 'AED', 'DXB']);
  });
  test('insertion sans sku ni identité, sans retour', async () => {
    const c = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    expect(await snap.insertHistoricalPurchaseLine(c, { ...base, snapshot: snapshot({ productSkuId: null, supplierOrderIdentity: null }) })).toBeNull();
    const params = c.query.mock.calls[0][1];
    expect(params[4]).toBeNull();
    expect(params[7]).toBeNull();
  });
  test('ligne ouverte : INSERT sans PO avec l\'instantané exact et le hub', async () => {
    delete process.env.KOMERCE_PROCUREMENT_HUB_REF;
    const c = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'open1' }] }) };
    expect(await snap.insertOpenPurchaseLine(c, { item: base.item, ps, snapshot: snapshot(), quantity: 3 })).toEqual({ id: 'open1' });
    expect(c.query.mock.calls[0][0]).toContain('VALUES (NULL,');
    expect(c.query.mock.calls[0][1]).toEqual(['it', 'sup', 'ps', 'sk', 'S', 'R', JSON.stringify({ p: 1 }), 3, 2, 'AED', 'DXB']);
  });
  test('ligne ouverte : refuse sans order_item ou sans identité exacte', async () => {
    const c = { query: jest.fn() };
    await expect(snap.insertOpenPurchaseLine(c, { item: {}, ps, snapshot: snapshot(), quantity: 1 })).rejects.toThrow('order_item requis');
    await expect(snap.insertOpenPurchaseLine(c, { item: base.item, ps, snapshot: snapshot({ productSkuId: null }), quantity: 1 })).rejects.toThrow('identité exacte requise');
    await expect(snap.insertOpenPurchaseLine(c, { item: base.item, ps, snapshot: snapshot({ supplierUnitRef: null }), quantity: 1 })).rejects.toThrow('identité exacte requise');
    await expect(snap.insertOpenPurchaseLine(c, { item: base.item, ps, snapshot: snapshot({ supplierOrderIdentity: null }), quantity: 1 })).rejects.toThrow('identité exacte requise');
    expect(c.query).not.toHaveBeenCalled();
  });
  test('confirmation (prix fourni ou par défaut)', async () => {
    const c = { query: jest.fn().mockResolvedValue({}) };
    await snap.confirmHistoricalPurchaseLine(c, 'po', { quantity: 3, unitPrice: 2 });
    await snap.confirmHistoricalPurchaseLine(c, 'po', { quantity: 3 });
    expect(c.query.mock.calls[0][1]).toEqual(['po', 3, 2]);
    expect(c.query.mock.calls[1][1]).toEqual(['po', 3, null]);
  });
});

describe('findItemCoverage', () => {
  test('sans id d\'item → null, aucune requête', async () => {
    const c = { query: jest.fn() };
    expect(await snap.findItemCoverage(c, {})).toBeNull();
    expect(await snap.findItemCoverage(c, null)).toBeNull();
    expect(c.query).not.toHaveBeenCalled();
  });
  test('aucune ligne → null ; somme insuffisante → null', async () => {
    const c = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'po', status: 'pending', effective_quantity: 1 }, { id: null, status: null, effective_quantity: null }] }) };
    expect(await snap.findItemCoverage(c, { id: 'it', quantity: 2 })).toBeNull();
    expect(await snap.findItemCoverage(c, { id: 'it', quantity: 2 })).toBeNull();
  });
  test('somme suffisante (lignes cumulées) → première PO', async () => {
    const c = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'po1', status: 'confirmed', effective_quantity: 1 }, { id: 'po2', status: 'pending', effective_quantity: 1 }] }) };
    expect(await snap.findItemCoverage(c, { id: 'it', quantity: 2 })).toEqual({ id: 'po1', status: 'confirmed' });
    expect(c.query.mock.calls[0][0]).toContain('NOT cancelled');
  });
});
