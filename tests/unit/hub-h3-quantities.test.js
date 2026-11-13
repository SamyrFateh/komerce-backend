'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief H3 (#3998) — HB-05 confirmation sous le reçu, HB-06 reçu unique, HB-07 erreur de réception simultanée, HB-11 ligne sans variante.
 */
jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => {
  const f = jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
  return { child: f, forModule: f, info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

const fs = require('fs');
const path = require('path');
const db = require('../../db');
const grouped = require('../../services/purchasing-grouped-service');

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const PO = uuid(1);
const L1 = uuid(11);

function scripted(handlers) {
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      for (const [pattern, reply] of handlers) if (pattern.test(sql)) return typeof reply === 'function' ? reply(sql, params) : reply;
      return { rows: [] };
    }),
  };
  db.getClient.mockResolvedValue(client);
  return client;
}

beforeEach(() => jest.clearAllMocks());

describe('HB-11 — ligne sans variante non regroupable', () => {
  const poLock = [/FROM purchase_orders WHERE id = \$1 FOR UPDATE/, { rows: [{ id: PO, order_id: null, status: 'draft', market_id: uuid(7), trigger_mode: 'manual' }] }];

  it('attachDraftLines refuse une ligne sans product_sku_id (409 PURCHASE_LINE_VARIANT_REQUIRED), sans rattacher', async () => {
    const client = scripted([poLock, [/product_sku_id IS NULL/, { rows: [{ id: L1 }] }]]);
    await expect(grouped.attachDraftLines(PO, [L1])).rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_VARIANT_REQUIRED' });
    expect(client.query.mock.calls.some(([sql]) => /UPDATE purchase_lines/.test(sql))).toBe(false);
  });

  it('preparePurchaseOrder refuse aussi une ligne sans variante', async () => {
    scripted([
      [/FROM suppliers WHERE id/, { rows: [{ id: uuid(3), platform: 'local' }] }],
      [/SELECT DISTINCT o.market_id/, { rows: [{ market_id: uuid(7) }] }],
      [/INSERT INTO purchase_orders/, { rows: [{ id: PO }] }],
      [/product_sku_id IS NULL/, { rows: [{ id: L1 }] }],
    ]);
    await expect(grouped.preparePurchaseOrder({ supplier_id: uuid(3), procurement_hub_ref: 'DXB', line_ids: [L1] }))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_VARIANT_REQUIRED' });
  });
});

describe('migration — une seule définition du reçu (HB-06) et garde variante (HB-11)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/414_purchase_line_received_quantity.sql'), 'utf8');
  it('la vue de progression délègue à la fonction ; la fonction exclut quarantaine, superseded et outcome', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.purchase_line_received_quantity/);
    expect(sql).toMatch(/public\.purchase_line_received_quantity\(pl\.id\) AS received_quantity/);
    expect(sql).toMatch(/u\.state <> ALL \(ARRAY\['QUARANTINED'::text, 'SUPERSEDED'::text\]\) AND u\.outcome_type IS NULL/);
  });
  it('la garde de regroupement refuse une ligne manuelle central_hub sans variante', () => {
    expect(sql).toMatch(/purchase_line_variant_required/);
  });
});
