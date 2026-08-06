'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/scan-engine-content-verification.test.js
 * Tests de caractérisation — services/scan-engine.js (Lot C6 — 2026-06-28)
 *
 * Couvre les deux fonctions internes précédemment sans test :
 *   _processContentVerification — vérification de contenu colis (content_verified)
 *   _logScanEventDirect         — insertion scan_events hors transaction (rejets)
 *
 * Pattern : makeClient (script de réponses ordonnées) pour les appels client.query,
 * pool.query mocké directement pour logScanEventDirect.
 */

jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../services/notification-service', () => ({
  notifyParcelScan: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: jest.fn().mockResolvedValue({ success: true }),
}));

const { makeClient } = require('../integration/test-harness/mock-db');
const pool = require('../../db');

const {
  _processContentVerification: processContentVerification,
  _logScanEventDirect: logScanEventDirect,
} = require('../../services/scan-engine');

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════
// 1. processContentVerification — cas nominaux
// ════════════════════════════════════════════════════════════════

describe('processContentVerification — all_ok', () => {
  it('retourne all_ok=true quand toutes les quantités correspondent', async () => {
    const client = makeClient([
      // SELECT parcel_items LEFT JOIN order_items
      { rows: [{ id: 1, qty_shipped: 2, qty_packed: null, qty_allocated: null, oi_product_name: 'Widget', order_item_id: 10 }] },
      // UPDATE parcel_items SET verified
      { rows: [] },
    ]);

    const items = [{ parcel_item_id: 1, qty_found: 2, verified: true }];
    const result = await processContentVerification(client, 'parcel-1', 'order-1', items, 'agent-1', 'relay_agent');

    expect(result.all_ok).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.incidents).toHaveLength(0);
  });
});

describe('processContentVerification — unexpected_item', () => {
  it('détecte un article non présent dans le manifeste', async () => {
    const client = makeClient([
      // SELECT → manifeste vide (colis sans items attendus)
      { rows: [] },
      // INSERT incidents — unexpected_item
      { rows: [{ id: 55, incident_type: 'unexpected_item', severity: 'high' }] },
    ]);

    const items = [{ parcel_item_id: 99 }]; // parcel_item_id introuvable dans le manifeste
    const result = await processContentVerification(client, 'parcel-1', 'order-1', items, 'agent-1', 'relay_agent');

    expect(result.all_ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe('unexpected');
    expect(result.issues[0].parcel_item_id).toBe(99);
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].incident_type).toBe('unexpected_item');
  });
});

describe('processContentVerification — missing_item critical', () => {
  it('severity=critical quand qty_found=0', async () => {
    const client = makeClient([
      { rows: [{ id: 1, qty_shipped: 3, qty_packed: null, qty_allocated: null, oi_product_name: 'Chaussures', order_item_id: 10 }] },
      { rows: [] }, // UPDATE verified
      { rows: [{ id: 56, incident_type: 'missing_item', severity: 'critical' }] }, // INSERT incident
    ]);

    const items = [{ parcel_item_id: 1, qty_found: 0 }];
    const result = await processContentVerification(client, 'parcel-1', 'order-1', items, 'agent-1', 'relay_agent');

    expect(result.all_ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ type: 'missing', expected: 3, found: 0 });
    expect(result.incidents[0].severity).toBe('critical');
  });
});

describe('processContentVerification — missing_item high', () => {
  it('severity=high quand qty_found > 0 mais < qty_expected', async () => {
    const client = makeClient([
      { rows: [{ id: 1, qty_shipped: 4, qty_packed: null, qty_allocated: null, oi_product_name: 'Sac', order_item_id: 11 }] },
      { rows: [] },
      { rows: [{ id: 57, incident_type: 'missing_item', severity: 'high' }] },
    ]);

    const items = [{ parcel_item_id: 1, qty_found: 2 }];
    const result = await processContentVerification(client, 'parcel-1', 'order-1', items, 'agent-1', 'relay_agent');

    expect(result.all_ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ type: 'missing', expected: 4, found: 2 });
    expect(result.incidents[0].severity).toBe('high');
  });
});

describe('processContentVerification — surplus', () => {
  it('détecte un surplus (qty_found > qty_expected)', async () => {
    const client = makeClient([
      { rows: [{ id: 1, qty_shipped: 2, qty_packed: null, qty_allocated: null, oi_product_name: 'T-shirt', order_item_id: 12 }] },
      { rows: [] },
      { rows: [{ id: 58, incident_type: 'quantity_mismatch', severity: 'medium' }] },
    ]);

    const items = [{ parcel_item_id: 1, qty_found: 5 }];
    const result = await processContentVerification(client, 'parcel-1', 'order-1', items, 'agent-1', 'relay_agent');

    expect(result.all_ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ type: 'surplus', expected: 2, found: 5 });
    expect(result.incidents[0].incident_type).toBe('quantity_mismatch');
    expect(result.incidents[0].severity).toBe('medium');
  });
});

describe('processContentVerification — not_checked', () => {
  it('crée un incident missing_item pour les articles non vérifiés', async () => {
    const client = makeClient([
      // Manifeste : 2 articles
      {
        rows: [
          { id: 1, qty_shipped: 2, qty_packed: null, qty_allocated: null, oi_product_name: 'Article A', order_item_id: 10 },
          { id: 2, qty_shipped: 1, qty_packed: null, qty_allocated: null, oi_product_name: 'Article B', order_item_id: 11 },
        ],
      },
      // UPDATE pour l'item 1 (vérifié)
      { rows: [] },
      // INSERT incident pour item 2 (not_checked)
      { rows: [{ id: 59, incident_type: 'missing_item', severity: 'high' }] },
    ]);

    // Seul l'item 1 est soumis dans le scan — item 2 n'est pas vérifié
    const items = [{ parcel_item_id: 1, qty_found: 2 }];
    const result = await processContentVerification(client, 'parcel-1', 'order-1', items, 'agent-1', 'relay_agent');

    expect(result.all_ok).toBe(false);
    const notChecked = result.issues.find(i => i.type === 'not_checked');
    expect(notChecked).toBeDefined();
    expect(notChecked.parcel_item_id).toBe(2);
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].incident_type).toBe('missing_item');
  });
});

describe('processContentVerification — qty via fallback (qty_packed)', () => {
  it('utilise qty_packed si qty_shipped est null', async () => {
    const client = makeClient([
      { rows: [{ id: 1, qty_shipped: null, qty_packed: 3, qty_allocated: null, oi_product_name: 'Lot', order_item_id: 13 }] },
      { rows: [] },
    ]);

    const items = [{ parcel_item_id: 1, qty_found: 3 }];
    const result = await processContentVerification(client, 'parcel-1', 'order-1', items, 'agent-1', 'relay_agent');

    expect(result.all_ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 2. logScanEventDirect
// ════════════════════════════════════════════════════════════════

describe('logScanEventDirect', () => {
  it('insère dans scan_events via pool.query et retourne l\'événement', async () => {
    const fakeEvent = { id: 77, event_type: 'validation_error', status: 'rejected' };
    pool.query.mockResolvedValueOnce({ rows: [fakeEvent] });

    const result = await logScanEventDirect({
      parcel_id: 'parcel-1',
      order_id: 'order-1',
      event_type: 'validation_error',
      scan_code: 'SC-001',
      scanned_by: 'agent-1',
      status: 'rejected',
      error_message: 'Séquence invalide',
    });

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO scan_events/i);
    expect(params[0]).toBe('parcel-1'); // parcel_id
    expect(params[2]).toBe('validation_error'); // event_type
    expect(params[12]).toBe('rejected'); // status
    expect(result).toEqual(fakeEvent);
  });

  it('utilise status=rejected et metadata={} par défaut', async () => {
    const fakeEvent = { id: 78, status: 'rejected' };
    pool.query.mockResolvedValueOnce({ rows: [fakeEvent] });

    await logScanEventDirect({ parcel_id: 'parcel-2', event_type: 'barcode_error' });

    const [, params] = pool.query.mock.calls[0];
    expect(params[12]).toBe('rejected'); // status par défaut
    expect(params[9]).toBe('{}');         // metadata JSON
  });
});
