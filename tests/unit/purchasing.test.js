'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — purchasing-trigger-service (A-BE-05)
 *
 * processReceive (purchasing-receive-service) a été extrait dans son propre
 * fichier tests/unit/purchasing-receive-service.test.js (audit 2026-07-07)
 * pour s'aligner avec la convention testBaseKey() de feature-guard.js.
 *
 * Chemins couverts :
 *   triggerPurchasing :
 *     □ no_supplier → résultat no_supplier, pas de PO créée
 *     □ already_exists → idempotent, aucun INSERT
 *     □ mode manual → status admin_notified
 *     □ mode whatsapp → status whatsapp_sent
 *     □ mode auto_order (stub Phase 2 → échec) → api_failed_notified
 *     □ erreur DB item → savepoint rollback, résultat error, alerte insérée
 */

// ─── Mocks globaux ────────────────────────────────────────────────────────────

let mockDbQuery = jest.fn();
let mockGetClient = jest.fn();

jest.mock('../../db', () => ({
  query:     (...args) => mockDbQuery(...args),
  getClient: (...args) => mockGetClient(...args),
}));

jest.mock('../../services/notification-service', () => ({ notifyText: jest.fn().mockResolvedValue({}) }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

// ─── Require service après les mocks ─────────────────────────────────────────
const { triggerPurchasing } = require('../../services/purchasing-trigger-service');

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const ORDER = { id: 'order-uuid', reference: 'KOM-001', relais_id: null, relais_name: null };
const ITEM  = { product_id: 'prod-uuid', product_name: 'Widget A', quantity: 2, category: 'electronics', price_aed: 50 };

const PS_MANUAL = {
  id: 'ps-1', supplier_id: 's-1', auto_order: false, platform: 'manual',
  supplier_name: 'ACME', supplier_price_aed: 10, supplier_sku: 'SKU1', supplier_url: null,
};
const PS_WHATSAPP = {
  id: 'ps-2', supplier_id: 's-2', auto_order: false, platform: 'whatsapp',
  supplier_name: 'LocalSup', supplier_price_aed: 20, supplier_sku: 'WA-SKU',
  contact_phone: '971500000000', supplier_url: null,
};
const PS_AUTO = {
  id: 'ps-3', supplier_id: 's-3', auto_order: true, platform: 'noon',
  supplier_name: 'Noon', supplier_price_aed: 30, supplier_sku: 'NOON-1',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient(script = []) {
  const queue = [...script];
  const calls = [];
  const client = {
    calls,
    released: false,
    query: jest.fn(async (sql, params = []) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: s, params });
      if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(s)) {
        return { rows: [], rowCount: 0 };
      }
      const next = queue.shift();
      if (!next) throw new Error(`No mock for: ${s.slice(0, 60)}`);
      if (next.error) throw next.error;
      return { rows: next.rows || [], rowCount: next.rowCount ?? (next.rows?.length ?? 0) };
    }),
    release: jest.fn(() => { client.released = true; }),
  };
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
//   triggerPurchasing
// ═══════════════════════════════════════════════════════════════════════════════

describe('triggerPurchasing', () => {
  test('no_supplier → résultat no_supplier, pas de PO créée', async () => {
    // db.query : ordre, items
    mockDbQuery
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [ITEM] });

    // client : SELECT product_suppliers → rien
    const client = makeClient([{ rows: [] }]);
    mockGetClient.mockResolvedValue(client);

    const result = await triggerPurchasing('order-uuid');
    expect(result.purchase_orders[0].status).toBe('no_supplier');
    expect(result.purchase_orders[0].purchase_order_id).toBeNull();
    const inserts = client.calls.filter(c => c.sql.startsWith('INSERT INTO purchase_orders'));
    expect(inserts).toHaveLength(0);
  });

  test('already_exists → idempotent, aucun INSERT', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [ITEM] });

    const client = makeClient([
      { rows: [PS_MANUAL] },
      { rows: [{ id: 'po-existing', status: 'confirmed' }] }, // existingPo
    ]);
    mockGetClient.mockResolvedValue(client);

    const result = await triggerPurchasing('order-uuid');
    expect(result.purchase_orders[0].status).toBe('already_exists');
    expect(result.purchase_orders[0].purchase_order_id).toBe('po-existing');
    const inserts = client.calls.filter(c => c.sql.startsWith('INSERT INTO purchase_orders'));
    expect(inserts).toHaveLength(0);
  });

  test('mode manual → status admin_notified', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [ITEM] });

    const client = makeClient([
      { rows: [PS_MANUAL] },
      { rows: [] },                   // existingPo → rien
      { rows: [{ id: 'po-new' }] },  // INSERT purchase_orders
      { rows: [], rowCount: 1 },      // UPDATE status = notified
    ]);
    mockGetClient.mockResolvedValue(client);

    const result = await triggerPurchasing('order-uuid');
    expect(result.purchase_orders[0].status).toBe('admin_notified');
    expect(result.purchase_orders[0].purchase_order_id).toBe('po-new');
  });

  test('mode whatsapp → status whatsapp_sent', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [ITEM] });

    const client = makeClient([
      { rows: [PS_WHATSAPP] },
      { rows: [] },                   // existingPo
      { rows: [{ id: 'po-wa' }] },   // INSERT
      { rows: [], rowCount: 1 },      // UPDATE notes wa_url (LOT R3 : via le client transactionnel)
      { rows: [], rowCount: 1 },      // UPDATE status = notified
    ]);
    mockGetClient.mockResolvedValue(client);

    const result = await triggerPurchasing('order-uuid');
    expect(result.purchase_orders[0].status).toBe('whatsapp_sent');
    // LOT R3 (DEBT-03/FSF-03) : le wa_url doit être écrit dans LA MÊME
    // transaction que l'INSERT purchase_orders (via le client), pas via
    // db.query (le pool) — sinon perdu après COMMIT (READ COMMITTED).
    const waUpdate = client.calls.find(c => c.sql.startsWith('UPDATE purchase_orders SET notes'));
    expect(waUpdate).toBeDefined();
    expect(waUpdate.params[0]).toEqual(expect.stringContaining('wa_url:'));
  });

  test('mode auto_order (stub noon → echec) → api_failed_notified', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [ITEM] });

    const client = makeClient([
      { rows: [PS_AUTO] },
      { rows: [] },                  // existingPo
      { rows: [{ id: 'po-auto' }] }, // INSERT
      { rows: [], rowCount: 1 },     // UPDATE trigger_mode=manual, status=notified (api_failed fallback)
    ]);
    mockGetClient.mockResolvedValue(client);

    const result = await triggerPurchasing('order-uuid');
    // Noon est un stub qui retourne success:false → api_failed_notified
    expect(result.purchase_orders[0].status).toBe('api_failed_notified');
  });

  test('erreur DB sur INSERT → savepoint rollback, résultat error, alerte insérée', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [ITEM] });

    const dbError = new Error('constraint_violation');
    const client = makeClient([
      { rows: [PS_MANUAL] },
      { rows: [] },            // existingPo
      { error: dbError },      // INSERT purchase_orders → crash
      { rows: [], rowCount: 1 }, // INSERT alerts
    ]);
    mockGetClient.mockResolvedValue(client);

    const result = await triggerPurchasing('order-uuid');
    expect(result.purchase_orders[0].status).toBe('error');
    expect(result.purchase_orders[0].error).toBe('constraint_violation');

    const rbSp = client.calls.find(c => /ROLLBACK TO SAVEPOINT/i.test(c.sql));
    expect(rbSp).toBeDefined();

    const alert = client.calls.find(c => c.sql.startsWith('INSERT INTO alerts'));
    expect(alert).toBeDefined();
  });
});
