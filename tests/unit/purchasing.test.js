'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — purchasing-trigger-service (A-BE-05)
 *
 * La réception déclarative historique a été retirée en HB-10 ; ces tests ne
 * concernent que le déclenchement d'achat, pas le reçu physique Hub.
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

// PS_LOCAL exerce la branche d'exécution par défaut du trigger : un
// supplier avec un vrai provider (local — fournisseur sans intégration
// API tierce) qui n'est ni whatsapp ni auto_order-capable → triggerMode
// dérive en 'manual'. `manual` n'est jamais une valeur de `platform` :
// c'est un mode d'exécution, pas un provider (cf. provider-authority.js).
const PS_LOCAL = {
  id: 'ps-1', supplier_id: 's-1', auto_order: false, platform: 'local',
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

  test.each([
    ['manuel', PS_LOCAL],
    ['auto_order (aucun appel fournisseur au paiement)', PS_AUTO],
  ])('fournisseur %s → une ligne ouverte, aucune PO', async (_label, ps) => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [{ ...ITEM, id: 'oi-1' }] });
    const client = makeClient([{ rows: [ps] }, { rows: [] }, { rows: [{ id: 'line-1' }] }]);
    mockGetClient.mockResolvedValue(client);

    const result = await triggerPurchasing('order-uuid');
    expect(result.purchase_orders[0]).toMatchObject({ status: 'line_opened', purchase_order_id: null, purchase_line_id: 'line-1' });
    expect(client.calls.filter(c => c.sql.startsWith('INSERT INTO purchase_orders'))).toHaveLength(0);
    expect(client.calls.filter(c => c.sql.startsWith('INSERT INTO purchase_lines'))).toHaveLength(1);
  });

  test('already_exists → idempotent, aucun INSERT', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [{ ...ITEM, id: 'oi-1' }] });
    const client = makeClient([{ rows: [PS_LOCAL] }, { rows: [{ id: null, status: null, effective_quantity: 2 }] }]);
    mockGetClient.mockResolvedValue(client);

    const result = await triggerPurchasing('order-uuid');
    expect(result.purchase_orders[0].status).toBe('already_exists');
    expect(client.calls.filter(c => c.sql.startsWith('INSERT'))).toHaveLength(0);
  });

  test('erreur DB sur INSERT → savepoint rollback, résultat error, alerte insérée', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [{ ...ITEM, id: 'oi-1' }] });
    const client = makeClient([{ rows: [PS_LOCAL] }, { rows: [] }, { error: new Error('db down') }, { rows: [] }]);
    mockGetClient.mockResolvedValue(client);

    const result = await triggerPurchasing('order-uuid');
    expect(result.purchase_orders[0]).toMatchObject({ status: 'error', error: 'db down' });
  });
});
