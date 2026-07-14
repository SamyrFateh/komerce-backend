'use strict';

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
  return {
    id: 'ps1', supplier_id: 's1', supplier_sku: 'SKU-1', supplier_price_aed: 30,
    supplier_name: 'Supplier X', platform: 'manual', auto_order: false,
    contact_phone: '971500000000', account_id: null, api_key_enc: null,
    api_secret_enc: null, lead_time_days: 5, supplier_url: 'https://x.test/p',
    ...overrides,
  };
}

describe('purchasing-trigger-service — triggerPurchasing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_PHONE;
    notifyText.mockResolvedValue(undefined);
  });

  it('commande introuvable → throw sans toucher au client', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(triggerPurchasing('missing-order')).rejects.toThrow('Commande introuvable : missing-order');
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('aucun fournisseur mappé → notifie admin (ADMIN_PHONE défini) et pousse no_supplier', async () => {
    process.env.ADMIN_PHONE = '+269900000';
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([{ rows: [] }]); // SELECT product_suppliers → vide
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders).toEqual([
      { item: 'Sac Ali', status: 'no_supplier', purchase_order_id: null },
    ]);
    expect(notifyText).toHaveBeenCalledWith('+269900000', expect.stringContaining('Sourcing requis'), 'sourcing_alert', 'o1');
    expect(client.release).toHaveBeenCalled();
  });

  it('aucun fournisseur mappé, ADMIN_PHONE absent → pas de notification SMS', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders[0].status).toBe('no_supplier');
    expect(notifyText).not.toHaveBeenCalled();
  });

  it('purchase_order déjà existante (idempotence anti-replay) → already_exists', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { rows: [supplierRow()] },
      { rows: [{ id: 'po-existing', status: 'pending' }] },
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders).toEqual([{
      item: 'Sac Ali', status: 'already_exists',
      purchase_order_id: 'po-existing', purchase_order_status: 'pending',
    }]);
  });

  it('auto_order=true mais API fournisseur non implémentée (stub Phase 2) → api_failed_notified', async () => {
    process.env.ADMIN_PHONE = '+269900000';
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { rows: [supplierRow({ auto_order: true, platform: 'noon' })] },
      { rows: [] }, // pas de PO existante
      { rows: [{ id: 'po1' }] }, // INSERT purchase_orders
      {}, // UPDATE status notified
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders).toEqual([{ item: 'Sac Ali', status: 'api_failed_notified', purchase_order_id: 'po1' }]);
    expect(notifyText).toHaveBeenCalledWith('+269900000', expect.stringContaining('À commander'), 'purchase_manual', 'o1');
  });

  it('fournisseur WhatsApp (auto_order=false, platform=whatsapp) → whatsapp_sent', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { rows: [supplierRow({ platform: 'whatsapp', auto_order: false })] },
      { rows: [] },
      { rows: [{ id: 'po2' }] },
      {}, // UPDATE notes wa_url (LOT R3 : via le client transactionnel, plus le pool)
      {}, // UPDATE status notified
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders).toEqual([{ item: 'Sac Ali', status: 'whatsapp_sent', purchase_order_id: 'po2' }]);
    // LOT R3 (DEBT-03/FSF-03) : le wa_url doit être écrit via le client
    // transactionnel (même transaction que l'INSERT purchase_orders), pas
    // via db.query (le pool) — c'était la cause du wa_url perdu après COMMIT.
    expect(client.calls).toEqual(
      expect.arrayContaining([expect.stringContaining('UPDATE purchase_orders SET notes')])
    );
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE purchase_orders SET notes'), expect.anything());
  });

  it('fournisseur manuel standard (auto_order=false, platform≠whatsapp) → admin_notified', async () => {
    process.env.ADMIN_PHONE = '+269900000';
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { rows: [supplierRow({ platform: 'manual', auto_order: false })] },
      { rows: [] },
      { rows: [{ id: 'po3' }] },
      {},
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders).toEqual([{ item: 'Sac Ali', status: 'admin_notified', purchase_order_id: 'po3' }]);
  });

  it('sans supplier_url (falsy) → notifyAdminManual n\'ajoute pas la ligne Lien', async () => {
    process.env.ADMIN_PHONE = '+269900000';
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { rows: [supplierRow({ supplier_url: null })] },
      { rows: [] },
      { rows: [{ id: 'po4' }] },
      {},
    ]);
    db.getClient.mockResolvedValue(client);

    await triggerPurchasing('o1');

    const msg = notifyText.mock.calls[0][1];
    expect(msg).not.toMatch(/Lien :/);
  });

  it('erreur globale si la sélection du fournisseur échoue (hors try per-item) → rollback complet, propage', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { error: new Error('select ps failed') }, // SELECT product_suppliers échoue — hors du try per-item
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(triggerPurchasing('o1')).rejects.toThrow('select ps failed');
    expect(client.calls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('erreur lors du traitement d\'un item (post-lookup fournisseur) → rollback au savepoint, insère une alerte, continue', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { rows: [supplierRow()] },                     // SELECT product_suppliers OK
      { error: new Error('existing po lookup failed') }, // SELECT purchase_orders échoue (dans le try per-item)
      {}, // INSERT INTO alerts réussit
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders).toEqual([{ item: 'Sac Ali', status: 'error', error: 'existing po lookup failed' }]);
    expect(client.calls.some(c => /^ROLLBACK TO SAVEPOINT/.test(c))).toBe(true);
    expect(client.calls.some(c => /INSERT INTO alerts/.test(c))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it('erreur item + échec de l\'insertion d\'alerte → géré silencieusement (double catch)', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { rows: [supplierRow()] },
      { error: new Error('existing po lookup failed') },
      { error: new Error('alerts insert failed') },
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders).toEqual([{ item: 'Sac Ali', status: 'error', error: 'existing po lookup failed' }]);
  });

  it('erreur globale (ex: BEGIN échoue) → rollback, propage l\'erreur, release appelé', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = {
      calls: [],
      query: jest.fn().mockRejectedValueOnce(new Error('begin failed')).mockResolvedValue({}),
      release: jest.fn(),
    };
    db.getClient.mockResolvedValue(client);

    await expect(triggerPurchasing('o1')).rejects.toThrow('begin failed');
    expect(client.release).toHaveBeenCalled();
  });

  it('plusieurs items dans la même commande sont traités séquentiellement', async () => {
    const item2 = { ...item, product_id: 'p2', product_name: 'Chaussures' };
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item, item2] });
    const client = makeClient([
      { rows: [] }, // item1 : pas de fournisseur
      { rows: [] }, // item2 : pas de fournisseur
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders.map(r => r.item)).toEqual(['Sac Ali', 'Chaussures']);
    expect(result.purchase_orders.every(r => r.status === 'no_supplier')).toBe(true);
  });

  it('auto_order=true, plateforme amazon_uae → stub non implémentée → api_failed_notified', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { rows: [supplierRow({ auto_order: true, platform: 'amazon_uae' })] },
      { rows: [] },
      { rows: [{ id: 'po5' }] },
      {},
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders[0].status).toBe('api_failed_notified');
  });

  it('auto_order=true, plateforme aliexpress → stub non implémentée → api_failed_notified', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { rows: [supplierRow({ auto_order: true, platform: 'aliexpress' })] },
      { rows: [] },
      { rows: [{ id: 'po6' }] },
      {},
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders[0].status).toBe('api_failed_notified');
  });

  it('auto_order=true, plateforme inconnue → default "Plateforme sans API" → api_failed_notified', async () => {
    db.query.mockResolvedValueOnce({ rows: [order] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient([
      { rows: [supplierRow({ auto_order: true, platform: 'shopify' })] },
      { rows: [] },
      { rows: [{ id: 'po7' }] },
      {},
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing('o1');

    expect(result.purchase_orders[0].status).toBe('api_failed_notified');
  });
});
