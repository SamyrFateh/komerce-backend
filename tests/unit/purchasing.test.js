'use strict';

/**
 * Tests unitaires — purchasing-trigger-service + purchasing-receive-service (A-BE-05)
 *
 * Chemins couverts :
 *   triggerPurchasing :
 *     □ no_supplier → résultat no_supplier, pas de PO créée
 *     □ already_exists → idempotent, aucun INSERT
 *     □ mode manual → status admin_notified
 *     □ mode whatsapp → status whatsapp_sent
 *     □ mode auto_order (stub Phase 2 → échec) → api_failed_notified
 *     □ erreur DB item → savepoint rollback, résultat error, alerte insérée
 *   processReceive :
 *     □ PO introuvable → httpError 404
 *     □ déjà reçue en totalité → httpError 400
 *     □ réception partielle → po_status partially_received, order reste ordered
 *     □ réception totale → transitionOrderStatus appelé, ready_to_prepare = true
 *     □ transitionOrderStatus échoue → httpError 409
 */

// ─── Mocks globaux ────────────────────────────────────────────────────────────

let mockDbQuery = jest.fn();
let mockGetClient = jest.fn();

jest.mock('../../db', () => ({
  query:     (...args) => mockDbQuery(...args),
  getClient: (...args) => mockGetClient(...args),
}));

jest.mock('../../utils/sms', () => ({ sendSMS: jest.fn().mockResolvedValue({}) }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

const mockTriggerScan3 = jest.fn().mockResolvedValue({});
jest.mock('../../routes/scans', () => ({ triggerScan3: (...args) => mockTriggerScan3(...args) }), { virtual: true });

// ─── Require services après les mocks ────────────────────────────────────────
const { triggerPurchasing } = require('../../services/purchasing-trigger-service');
const { processReceive }    = require('../../services/purchasing-receive-service');

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
  mockTriggerScan3.mockResolvedValue({});
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
      .mockResolvedValueOnce({ rows: [ITEM] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // notifySupplierWhatsApp → UPDATE notes (via db.query)

    const client = makeClient([
      { rows: [PS_WHATSAPP] },
      { rows: [] },                   // existingPo
      { rows: [{ id: 'po-wa' }] },   // INSERT
      { rows: [], rowCount: 1 },      // UPDATE status = notified
    ]);
    mockGetClient.mockResolvedValue(client);

    const result = await triggerPurchasing('order-uuid');
    expect(result.purchase_orders[0].status).toBe('whatsapp_sent');
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

// ═══════════════════════════════════════════════════════════════════════════════
//   processReceive
// ═══════════════════════════════════════════════════════════════════════════════

describe('processReceive', () => {
  test('PO introuvable → httpError 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const result = await processReceive({ id: 'unknown', qty_recue: null, actor: null });
    expect(result.httpError).toEqual({ error: 'PO introuvable', status: 404 });
  });

  test('déjà reçue en totalité → httpError 400', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'po-1', order_id: 'ord-1', qty: 2, received_qty: 2, status: 'received', hub_received_at: new Date() }],
    });
    const result = await processReceive({ id: 'po-1', qty_recue: null, actor: null });
    expect(result.httpError).toEqual({ error: 'Quantité déjà reçue en totalité', status: 400 });
  });

  test('réception partielle → partially_received, order reste ordered, transitionOrderStatus non appelé', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', order_id: 'ord-1', qty: 3, received_qty: 0, status: 'pending', hub_received_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', status: 'partially_received' }] })
      .mockResolvedValueOnce({ rows: [{ total: '2', recus: '0', qty_totale: '6', qty_recue: '1' }] });

    const result = await processReceive({ id: 'po-1', qty_recue: 1, actor: { id: 'u1', role: 'admin' } });

    expect(result.httpError).toBeUndefined();
    expect(result.ready_to_prepare).toBe(false);
    expect(result.order_status).toBe('ordered');
    expect(mockTransitionOrderStatus).not.toHaveBeenCalled();
  });

  test('réception totale → received, transitionOrderStatus appelé, ready_to_prepare = true', async () => {
    mockTransitionOrderStatus.mockResolvedValue({ success: true });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', order_id: 'ord-1', qty: 2, received_qty: 0, status: 'pending', hub_received_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', status: 'received' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1', recus: '1', qty_totale: '2', qty_recue: '2' }] });

    const result = await processReceive({ id: 'po-1', qty_recue: null, actor: { id: 'u1', role: 'admin' } });

    expect(result.ready_to_prepare).toBe(true);
    expect(result.order_status).toBe('preparation');
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'ord-1',
      newStatus: 'preparation',
    }));
    expect(mockTriggerScan3).toHaveBeenCalledWith('ord-1', 'u1');
  });

  test('transitionOrderStatus échoue (non-noop) → httpError 409', async () => {
    mockTransitionOrderStatus.mockResolvedValue({ success: false, noop: false, error: 'Transition invalide' });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', order_id: 'ord-1', qty: 2, received_qty: 0, status: 'pending', hub_received_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', status: 'received' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1', recus: '1', qty_totale: '2', qty_recue: '2' }] });

    const result = await processReceive({ id: 'po-1', qty_recue: null, actor: null });
    expect(result.httpError).toEqual({ error: 'Transition invalide', status: 409 });
  });
});
