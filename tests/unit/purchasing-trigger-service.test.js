'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/notification-service', () => ({ notifyText: jest.fn() }));
jest.mock('../../utils/logger', () => {
  const mk = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child: mk, forModule: mk, info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

const db = require('../../db');
const { notifyText } = require('../../services/notification-service');
const { triggerPurchasing } = require('../../services/purchasing-trigger-service');

/**
 * Client de transaction mocké : BEGIN/COMMIT/ROLLBACK et les SAVEPOINT
 * sont auto-résolus (pas besoin de les mettre dans le script), le reste
 * est consommé séquentiellement depuis `script`.
 */
function makeClient(script = []) {
  const calls = [];
  const queue = [...script];
  const client = {
    calls,
    released: false,
    query: jest.fn(async (sql) => {
      calls.push(sql);
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (
        normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK' ||
        /^SAVEPOINT /.test(normalized) || /^RELEASE SAVEPOINT/.test(normalized) ||
        /^ROLLBACK TO SAVEPOINT/.test(normalized)
      ) {
        return { rows: [], rowCount: 0 };
      }
      const next = queue.shift();
      if (!next) throw new Error(`No mock query result for SQL: ${normalized}`);
      if (typeof next === 'function') return next(sql);
      if (next.error) throw next.error;
      return { rows: next.rows || [], rowCount: next.rowCount ?? (next.rows ? next.rows.length : 0) };
    }),
    release: jest.fn(() => { client.released = true; }),
  };
  return client;
}

const order = { id: 'o1', reference: 'KOM-001', relais_id: 'r1', relais_name: 'Relais A' };
const item = { product_id: 'p1', product_name: 'Sac Ali', category: 'sacs', quantity: 2, price_aed: 50 };

function supplierRow(overrides = {}) {
  // platform: 'local' — provider réel de la liste canonique. `manual` est un
  // mode d'exécution, jamais un provider (cf. provider-authority.js).
  return {
    id: 'ps1', supplier_id: 's1', supplier_sku: 'SKU-1', supplier_price_aed: 30,
    supplier_name: 'Supplier X', platform: 'local', auto_order: false,
    contact_phone: '971500000000', account_id: null, api_key_enc: null,
    api_secret_enc: null, lead_time_days: 5, supplier_url: 'https://x.test/p',
    ...overrides,
  };
}

describe('purchasing-trigger-service — triggerPurchasing (modèle unique : ligne ouverte)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_PHONE;
    notifyText.mockResolvedValue(undefined);
  });

  const itemWithId = { ...item, id: 'oi1' };

  it('commande introuvable → throw sans toucher au client', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(triggerPurchasing('missing-order')).rejects.toThrow('Commande introuvable : missing-order');
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('aucun fournisseur mappé → notifie admin et pousse no_supplier', async () => {
    process.env.ADMIN_PHONE = '+269900000';
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [itemWithId] });
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders).toEqual([{ item: 'Sac Ali', status: 'no_supplier', purchase_order_id: null }]);
    expect(notifyText).toHaveBeenCalledTimes(1);
    expect(client.released).toBe(true);
  });

  it('article LOCAL_STOCK → aucune ligne d\'achat', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ ...itemWithId, fulfillment_source: 'LOCAL_STOCK' }] });
    db.getClient.mockResolvedValue(makeClient([]));
    const result = await triggerPurchasing('o1');
    expect(result.purchase_orders[0]).toMatchObject({ status: 'local_stock_no_purchase', purchase_order_id: null });
  });

  it.each([
    ['manuel', { platform: 'local', auto_order: false }],
    ['whatsapp', { platform: 'whatsapp', auto_order: false }],
    ['auto_order=true (aucun appel fournisseur au paiement)', { platform: 'amazon_uae', auto_order: true }],
  ])('fournisseur %s → exactement une ligne ouverte, aucune PO, aucune notification d\'achat', async (_label, overrides) => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [itemWithId] });
    const client = makeClient([
      { rows: [supplierRow(overrides)] },
      { rows: [] },                       // couverture : item non couvert
      { rows: [{ id: 'line-1' }] },       // INSERT purchase_lines
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders).toEqual([
      { item: 'Sac Ali', status: 'line_opened', purchase_order_id: null, purchase_line_id: 'line-1' },
    ]);
    const sqls = client.calls.map((c) => String(c));
    expect(sqls.some((q) => /INSERT INTO purchase_orders/i.test(q))).toBe(false);
    expect(sqls.filter((q) => /INSERT INTO purchase_lines/i.test(q))).toHaveLength(1);
    expect(sqls.some((q) => /UPDATE purchase_orders/i.test(q))).toBe(false);
    expect(notifyText).not.toHaveBeenCalled();
  });

  it('produit manuel affecté au Hub → ligne ouverte Komerce dans le même flux d’achat standard', async () => {
    const hubItem = { ...itemWithId, sku_id: 'sku-manual', procurement_supplier_id: 'hub-id' };
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [hubItem] });
    const hub = {
      id: null, supplier_id: 'hub-id', supplier_name: 'Fournisseur central Hub', platform: 'local',
      system_key: 'central_hub', auto_order: false, supplier_sku: null,
    };
    const client = makeClient([
      { rows: [{ id: 'sku-manual', product_id: 'p1', supplier_sku: null, source: 'MANUAL' }] },
      { rows: [] },
      { rows: [hub] },
      { rows: [] },
      { rows: [{ id: 'hub-line-1' }] },
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders).toEqual([{
      item: 'Sac Ali', status: 'line_opened', purchase_order_id: null,
      purchase_line_id: 'hub-line-1',
    }]);
    const insert = client.calls.find((sql) => /INSERT INTO purchase_lines/i.test(String(sql)));
    expect(insert).toBeTruthy();
    const params = client.query.mock.calls.find(([sql]) => /INSERT INTO purchase_lines/i.test(String(sql)))[1];
    expect(params).toEqual(['oi1', 'hub-id', null, 'sku-manual', null, null, null, 2, null, null, 'DXB', null]);
    expect(client.calls.some((sql) => /INSERT INTO purchase_orders/i.test(String(sql)))).toBe(false);
    expect(notifyText).not.toHaveBeenCalled();
  });

  it('rejeu : item déjà couvert par les lignes → already_exists, aucune insertion', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [itemWithId] });
    const client = makeClient([
      { rows: [supplierRow()] },
      { rows: [{ id: null, status: null, effective_quantity: 2 }] },
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders[0]).toMatchObject({ status: 'already_exists' });
    expect(client.calls.some((q) => /INSERT INTO purchase_lines/i.test(String(q)))).toBe(false);
  });

  it('erreur d\'insertion → rollback au savepoint, alerte, les autres articles continuent', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [itemWithId] });
    const client = makeClient([
      { rows: [supplierRow()] },
      { rows: [] },
      { error: new Error('boom') },
      { rows: [] },                       // INSERT alerte
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders[0]).toMatchObject({ status: 'error', error: 'boom' });
    expect(client.released).toBe(true);
  });
});
