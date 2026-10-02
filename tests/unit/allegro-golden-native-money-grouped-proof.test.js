'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));

const proof = require('../../scripts/allegro-golden-native-money-proof');

const ORDER = 'order-1';
const PRODUCT = 'product-1';
const SKU = 'SKU-ALG-1';

const baseRow = {
  id: 'row-1', order_id: ORDER, product_id: PRODUCT, supplier_sku: SKU, supplier_unit_ref: 'UNIT-1',
  supplier_unit_price: '25.50', supplier_currency: 'PLN', mapping_supplier_price_aed: null,
};

describe('preuve Golden Allegro — mode historique (drapeau éteint, inchangé)', () => {
  test('une PO par commande : lecture sur purchase_orders, aucune fuite AED', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ ...baseRow, unit_price_aed: null }] });
    const po = await proof.readHistoricalPurchaseOrder(query, { orderId: ORDER, productId: PRODUCT, supplierSku: SKU });
    expect(po.id).toBe('row-1');
    expect(query.mock.calls[0][0]).toContain('FROM purchase_orders po');
  });

  test.each([
    ['aucune PO', [], 'GOLDEN_PURCHASE_ORDER_NOT_EXACT_0'],
    ['deux PO', [baseRow, baseRow], 'GOLDEN_PURCHASE_ORDER_NOT_EXACT_2'],
    ['identité différente', [{ ...baseRow, supplier_sku: 'AUTRE', unit_price_aed: null }], 'GOLDEN_PURCHASE_ORDER_IDENTITY_MISMATCH'],
    ['fuite AED sur la PO', [{ ...baseRow, unit_price_aed: 10 }], 'GOLDEN_LEGACY_AED_LEAK'],
    ['fuite AED sur le mapping', [{ ...baseRow, unit_price_aed: null, mapping_supplier_price_aed: 3 }], 'GOLDEN_LEGACY_AED_LEAK'],
  ])('%s → %s', async (_label, rows, code) => {
    const query = jest.fn().mockResolvedValue({ rows });
    await expect(proof.readHistoricalPurchaseOrder(query, { orderId: ORDER, productId: PRODUCT, supplierSku: SKU })).rejects.toThrow(code);
  });
});

describe('preuve Golden Allegro — mode regroupé : une ligne par item', () => {
  test('lit la ligne d\'achat (identité + monnaie native) sans exiger de PO', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ ...baseRow, purchase_order_id: null }] });
    const line = await proof.readGroupedPurchaseLine(query, { orderId: ORDER, productId: PRODUCT, supplierSku: SKU });
    expect(line.purchase_order_id).toBeNull();
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('FROM purchase_lines pl');
    expect(sql).toContain('pl.cancelled_at IS NULL');
    expect(sql).not.toContain('FROM purchase_orders');
  });

  test.each([
    ['aucune ligne', [], 'GOLDEN_PURCHASE_LINE_NOT_EXACT_0'],
    ['deux lignes pour un item', [baseRow, baseRow], 'GOLDEN_PURCHASE_LINE_NOT_EXACT_2'],
    ['identité différente', [{ ...baseRow, product_id: 'autre' }], 'GOLDEN_PURCHASE_LINE_IDENTITY_MISMATCH'],
    ['fuite AED sur le mapping', [{ ...baseRow, mapping_supplier_price_aed: 3 }], 'GOLDEN_LEGACY_AED_LEAK'],
  ])('%s → %s', async (_label, rows, code) => {
    const query = jest.fn().mockResolvedValue({ rows });
    await expect(proof.readGroupedPurchaseLine(query, { orderId: ORDER, productId: PRODUCT, supplierSku: SKU })).rejects.toThrow(code);
  });
});

describe('runGoldenNativeMoneyProof — bout en bout simulé', () => {
  function makeEnv(rows) {
    const query = jest.fn(async (sql) => {
      if (/FROM users/.test(sql)) return { rows: [{ email: 'admin@komerce.test', phone: null }] };
      return { rows };
    });
    const supplier = { id: 'sup-1', name: 'Allegro Sandbox', platform: 'allegro', auto_order: false };
    const fetchImpl = jest.fn(async (url) => {
      const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), headers: { getSetCookie: () => ['auth=1; Path=/'], get: () => null } });
      if (/auth\/login/.test(url)) return json({ ok: true });
      if (/suppliers\?platform=allegro/.test(url)) return json([supplier]);
      if (/\/map$/.test(url)) return json({ id: 'map-1', product_id: PRODUCT, supplier_id: 'sup-1', supplier_sku: SKU, supplier_price_aed: null, is_active: true });
      throw new Error(`URL inattendue ${url}`);
    });
    return { query, fetchImpl, triggerPurchasing: jest.fn().mockResolvedValue({ results: [] }) };
  }
  const args = { orderId: ORDER, productId: PRODUCT, supplierSku: SKU, apiUrl: 'https://komerce.test', adminPassword: 'x' };

  test('mode regroupé : rapport avec purchase_line et sans PO', async () => {
    const env = makeEnv([{ ...baseRow, purchase_order_id: null }]);
    const report = await proof.runGoldenNativeMoneyProof({ ...args, ...env, grouped: true });
    expect(report).toMatchObject({ status: 'PASS', purchase_mode: 'grouped', purchase_order: null });
    expect(report.purchase_line.id).toBe('row-1');
  });

  test('mode historique : rapport avec purchase_order et sans ligne', async () => {
    const env = makeEnv([{ ...baseRow, unit_price_aed: null }]);
    const report = await proof.runGoldenNativeMoneyProof({ ...args, ...env, grouped: false });
    expect(report).toMatchObject({ status: 'PASS', purchase_mode: 'historical', purchase_line: null });
    expect(report.purchase_order.id).toBe('row-1');
  });

  test('monnaie native invalide → GOLDEN_NATIVE_MONEY_INVALID dans les deux modes', async () => {
    for (const grouped of [true, false]) {
      const env = makeEnv([{ ...baseRow, unit_price_aed: null, supplier_currency: 'pln' }]);
      await expect(proof.runGoldenNativeMoneyProof({ ...args, ...env, grouped })).rejects.toThrow('GOLDEN_NATIVE_MONEY_INVALID');
    }
  });
});
