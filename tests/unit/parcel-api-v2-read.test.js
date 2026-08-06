'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcel-api-v2-read.test.js
 *
 * Tests du router routes/parcel-api-v2/read.js (717 lignes — le plus gros
 * trou de couverture du repo, 6.97% stmts / 0% branch avant ce lot).
 *
 * helpers.js (cached/setCache/computeParcelAlerts/reconcileParcel/
 * checkScanSequence) est déjà couvert par parcel-api-v2-helpers.test.js ;
 * il est mocké ici pour isoler la logique propre de read.js.
 *
 * Couverture :
 *   ✓ GET /                 : filtres status/island/search/agent_relais,
 *                       mapping de tri (colonnes + ordre), post-traitement
 *                       (fallback nb_clients/nb_orders, weight_kg, last_scan),
 *                       erreur DB → next(err)
 *   ✓ GET /kpis              : cache hit (retour direct), cache miss (4 requêtes
 *                       + setCache), erreur DB → next(err)
 *   ✓ GET /alerts            : agrégation alertes + tri par sévérité, alertes
 *                       opérationnelles (congestion îlot, incidents îlot),
 *                       erreur DB → next(err)
 *   ✓ GET /critical          : liste + fallback total_kmf, erreur DB → next(err)
 *   ✓ GET /reconciliation    : classification ok/warning/blocked, tri par
 *                       gravité, erreur DB → next(err)
 *   ✓ GET /:ref              : 404, succès avec items multi-clients, fallback
 *                       order_id sans parcel_items (avec/sans commande), erreur
 *                       DB → next(err)
 *   ✓ GET /:ref/timeline     : 404, calcul next_expected_step (statut connu et
 *                       inconnu), erreur DB → next(err)
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const mockCached = jest.fn();
const mockSetCache = jest.fn();
const mockComputeParcelAlerts = jest.fn();
const mockReconcileParcel = jest.fn();
const mockCheckScanSequence = jest.fn();
jest.mock('../../routes/parcel-api-v2/helpers', () => ({
  cached: (...args) => mockCached(...args),
  setCache: (...args) => mockSetCache(...args),
  computeParcelAlerts: (...args) => mockComputeParcelAlerts(...args),
  reconcileParcel: (...args) => mockReconcileParcel(...args),
  checkScanSequence: (...args) => mockCheckScanSequence(...args),
}));

const express = require('express');
const request = require('supertest');

const router = require('../../routes/parcel-api-v2/read');

const mockState = { user: { id: 'adm1', role: 'admin' }, agentRelaisId: null };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = mockState.user;
    req.agentRelaisId = mockState.agentRelaisId;
    next();
  });
  app.use('/api/v2/parcels', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.user = { id: 'adm1', role: 'admin' };
  mockState.agentRelaisId = null;
  mockComputeParcelAlerts.mockReturnValue([]);
  mockCached.mockReturnValue(null);
});

// ═══════════════════════════════════════════════════════════════════════
// GET /
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/v2/parcels', () => {
  it('liste sans filtre, tri par défaut (created_at DESC)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/v2/parcels');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, parcels: [] });
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).not.toContain('p.status = $');
    expect(sql).not.toContain('p.destination_island = $');
    expect(sql).toContain('ORDER BY p.created_at DESC');
    expect(params).toEqual([]);
  });

  it('applique les filtres status, island et search combinés', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await request(buildApp()).get('/api/v2/parcels?status=shipped&island=Anjouan&search=K123');

    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('p.status = $1');
    expect(sql).toContain('p.destination_island = $2');
    expect(sql).toContain('ILIKE');
    expect(params).toEqual(['shipped', 'Anjouan', '%K123%']);
  });

  it('agent_relais → ajoute le filtre relais scope via req.agentRelaisId', async () => {
    mockState.user = { id: 'agent1', role: 'agent_relais' };
    mockState.agentRelaisId = 'relais-042';
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await request(buildApp()).get('/api/v2/parcels');

    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('COALESCE(p.relay_id, p.relais_id, o.relais_id) = $1');
    expect(params).toEqual(['relais-042']);
  });

  it.each([
    ['reference', 'p.reference'],
    ['status', 'p.status'],
    ['total_kmf', 'total_kmf'],
    ['island', 'p.destination_island'],
    ['inconnu', 'p.created_at'],
  ])('mappe sort=%s vers la colonne %s', async (sort, col) => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get(`/api/v2/parcels?sort=${sort}&order=asc`);
    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toContain(`ORDER BY ${col} ASC`);
  });

  it('order différent de "asc" → DESC par défaut', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/v2/parcels?order=n_importe_quoi');
    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('DESC');
  });

  it('fallback nb_clients/nb_orders=1 quand agrégat vide mais main_order_ref présent', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: 'p1', reference: 'PCL1', status: 'shipped', nb_orders: 0, nb_clients: 0, nb_items: 0,
        total_kmf: null, weight_kg: '3.5', main_order_ref: 'K123', last_scan_type: null,
        open_incidents: 0, critical_incidents: 0,
      }],
    });

    const res = await request(buildApp()).get('/api/v2/parcels');

    expect(res.body.parcels[0]).toEqual(expect.objectContaining({
      nb_clients: 1, nb_orders: 1, total_kmf: 0, weight_kg: 3.5, last_scan: null,
    }));
  });

  it('construit last_scan quand un dernier scan existe', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: 'p1', reference: 'PCL1', status: 'shipped', nb_orders: 1, nb_clients: 1, nb_items: 1,
        total_kmf: 5000, weight_kg: null, main_order_ref: 'K1',
        last_scan_type: 'shipped', last_scan_at: '2026-07-01', last_scan_location: 'Moroni',
        last_scan_actor: 'agent1', open_incidents: 0, critical_incidents: 0,
      }],
    });

    const res = await request(buildApp()).get('/api/v2/parcels');

    expect(res.body.parcels[0].last_scan).toEqual({
      type: 'shipped', at: '2026-07-01', location: 'Moroni', actor: 'agent1',
    });
  });

  it('erreur DB → next(err) → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('liste down'));
    const res = await request(buildApp()).get('/api/v2/parcels');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('liste down');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /kpis
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/v2/parcels/kpis', () => {
  it('retourne directement la valeur en cache sans requêter la DB', async () => {
    mockCached.mockReturnValue({ cached: true });

    const res = await request(buildApp()).get('/api/v2/parcels/kpis');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cached: true });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('cache miss → 4 requêtes, construit le résultat et le met en cache', async () => {
    mockCached.mockReturnValue(null);
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        total: 10, draft: 1, preparation: 2, shipped: 3, in_transit: 1, available: 2, collected: 1, cancelled: 0, active: 9,
      }] })
      .mockResolvedValueOnce({ rows: [
        { island: 'Anjouan', status: 'shipped', count: 3 },
        { island: 'Anjouan', status: 'in_transit', count: 2 },
      ] })
      .mockResolvedValueOnce({ rows: [{
        ca_total_kmf: 100000, ca_active_kmf: 60000, ca_collected_kmf: 40000, avg_basket_kmf: 10000, nb_clients: 8,
      }] })
      .mockResolvedValueOnce({ rows: [{ total_incidents: 5, open_incidents: 2, critical_incidents: 1 }] });

    const res = await request(buildApp()).get('/api/v2/parcels/kpis');

    expect(res.status).toBe(200);
    expect(res.body.parcels.by_island).toEqual({ Anjouan: { shipped: 3, in_transit: 2 } });
    expect(res.body.finance.ca_total_kmf).toBe(100000);
    expect(res.body.incidents.critical).toBe(1);
    expect(mockSetCache).toHaveBeenCalledWith('parcel_kpis', res.body);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockCached.mockReturnValue(null);
    mockDbQuery.mockRejectedValueOnce(new Error('kpis down'));
    const res = await request(buildApp()).get('/api/v2/parcels/kpis');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /alerts
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/v2/parcels/alerts', () => {
  it('agrège les alertes, trie par sévérité et calcule les alertes opérationnelles', async () => {
    const rows = [
      { id: 'p1', reference: 'PCL1', destination_island: 'Anjouan', status: 'in_transit', open_incidents: 1 },
      { id: 'p2', reference: 'PCL2', destination_island: 'Anjouan', status: 'shipped', open_incidents: 1 },
      { id: 'p3', reference: 'PCL3', destination_island: 'Anjouan', status: 'in_transit', open_incidents: 1 },
      { id: 'p4', reference: 'PCL4', destination_island: 'Anjouan', status: 'in_transit', open_incidents: 0 },
      { id: 'p5', reference: 'PCL5', destination_island: 'Anjouan', status: 'in_transit', open_incidents: 0 },
    ];
    mockDbQuery.mockResolvedValueOnce({ rows });
    mockComputeParcelAlerts.mockImplementation((p) => (
      p.id === 'p1'
        ? [
            { severity: 'info', message: 'a' },
            { severity: 'critical', message: 'b' },
            { severity: 'exotique', message: 'c' },
            { severity: 'mystere', message: 'd' },
          ]
        : []
    ));

    const res = await request(buildApp()).get('/api/v2/parcels/alerts');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(4);
    // tri : critical avant info, sévérités inconnues (fallback ?? 9) en dernier
    expect(res.body.alerts[0].severity).toBe('critical');
    expect(res.body.alerts[1].severity).toBe('info');
    expect(res.body.alerts.slice(2).map(a => a.severity).sort()).toEqual(['exotique', 'mystere']);
    // congestion (5 colis en transit/shipped sur Anjouan) + incidents (>=3 open)
    expect(res.body.operational).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'island_congestion', island: 'Anjouan', count: 5 }),
      expect.objectContaining({ type: 'island_incidents', island: 'Anjouan', count: 3 }),
    ]));
  });

  it('aucune alerte / aucun opérationnel quand les seuils ne sont pas atteints', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', destination_island: 'Anjouan', status: 'preparation', open_incidents: 0 }] });

    const res = await request(buildApp()).get('/api/v2/parcels/alerts');

    expect(res.body).toEqual({ count: 0, alerts: [], operational: [] });
  });

  it('destination_island absente → regroupée sous "Inconnu"', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', destination_island: null, status: 'shipped', open_incidents: 0 }] });

    const res = await request(buildApp()).get('/api/v2/parcels/alerts');

    expect(res.status).toBe(200);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('alerts down'));
    const res = await request(buildApp()).get('/api/v2/parcels/alerts');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /critical
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/v2/parcels/critical', () => {
  it('retourne la file critique avec total_kmf normalisé', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { id: 'p1', reference: 'PCL1', total_kmf: '5000', open_incidents: 1, critical_incidents: 1 },
        { id: 'p2', reference: 'PCL2', total_kmf: null, open_incidents: 0, critical_incidents: 0 },
      ],
    });

    const res = await request(buildApp()).get('/api/v2/parcels/critical');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.parcels[0].total_kmf).toBe(5000);
    expect(res.body.parcels[1].total_kmf).toBe(0);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('critical down'));
    const res = await request(buildApp()).get('/api/v2/parcels/critical');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /reconciliation
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/v2/parcels/reconciliation', () => {
  it('classe un colis "ok" quand tous les checks passent', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'p1', reference: 'PCL1', status: 'preparation', order_status: 'preparation',
        payment_mode: 'stripe_eur', payment_status: 'paid', total_kmf: '1000',
      }] })
      .mockResolvedValueOnce({ rows: [{ parcel_id: 'p1', scan_count: 2, scan_sequence: ['preparation', 'shipped'] }] });
    mockCheckScanSequence.mockReturnValue(true);

    const res = await request(buildApp()).get('/api/v2/parcels/reconciliation');

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total: 1, blocked: 0, warning: 0, ok: 1 });
    expect(res.body.parcels[0].reconciliation.status).toBe('ok');
    expect(res.body.parcels[0].scan_count).toBe(2);
  });

  it('classe "blocked" quand le paiement cash relais est impossible (delivery_ready=false, total_kmf absent)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'p1', reference: 'PCL1', status: 'available', order_status: 'available',
        payment_mode: 'cash_relais', payment_status: 'pending', total_kmf: null,
      }] })
      .mockResolvedValueOnce({ rows: [] });
    mockCheckScanSequence.mockReturnValue(true);

    const res = await request(buildApp()).get('/api/v2/parcels/reconciliation');

    expect(res.body.summary.blocked).toBe(1);
    expect(res.body.parcels[0].total_kmf).toBe(0);
    expect(res.body.parcels[0].reconciliation.issues.length).toBeGreaterThan(0);
  });

  it('classe "blocked" quand la séquence de scans est incohérente (scan_sequence_ok=false)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'p1', reference: 'PCL1', status: 'shipped', order_status: 'shipped',
        payment_mode: 'stripe_eur', payment_status: 'paid', total_kmf: '1000',
      }] })
      .mockResolvedValueOnce({ rows: [{ parcel_id: 'p1', scan_count: 3, scan_sequence: ['shipped', 'preparation'] }] });
    mockCheckScanSequence.mockReturnValue(false);

    const res = await request(buildApp()).get('/api/v2/parcels/reconciliation');

    expect(res.body.summary.blocked).toBe(1);
    expect(res.body.parcels[0].reconciliation.issues).toContain('Séquence de scans incohérente');
  });

  it('classe "warning" quand seul status_sync est en défaut (non bloquant)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'p1', reference: 'PCL1', status: 'shipped', order_status: 'confirmed',
        payment_mode: 'stripe_eur', payment_status: 'paid', total_kmf: '1000',
      }] })
      .mockResolvedValueOnce({ rows: [] });
    mockCheckScanSequence.mockReturnValue(true);

    const res = await request(buildApp()).get('/api/v2/parcels/reconciliation');

    expect(res.body.summary.warning).toBe(1);
    expect(res.body.parcels[0].reconciliation.status).toBe('warning');
  });

  it('trie le résultat : blocked, puis warning, puis ok', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [
        { id: 'ok1', reference: 'OK1', status: 'preparation', order_status: 'preparation', payment_mode: 'stripe_eur', payment_status: 'paid', total_kmf: '100' },
        { id: 'blk1', reference: 'BLK1', status: 'available', order_status: 'available', payment_mode: 'cash_relais', payment_status: 'pending', total_kmf: '100' },
        { id: 'warn1', reference: 'WARN1', status: 'shipped', order_status: 'confirmed', payment_mode: 'stripe_eur', payment_status: 'paid', total_kmf: '100' },
      ] })
      .mockResolvedValueOnce({ rows: [] });
    mockCheckScanSequence.mockReturnValue(true);

    const res = await request(buildApp()).get('/api/v2/parcels/reconciliation');

    expect(res.body.parcels.map(p => p.reference)).toEqual(['BLK1', 'WARN1', 'OK1']);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('recon down'));
    const res = await request(buildApp()).get('/api/v2/parcels/reconciliation');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /:ref
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/v2/parcels/:ref', () => {
  it('404 si le colis est introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/v2/parcels/GHOST');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('GHOST');
  });

  it('200 avec regroupement multi-clients via parcel_items', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'parcel-1', reference: 'PCL1', status: 'shipped', order_id: 'order-1',
        recipient_name: 'Fallback', recipient_phone: '000', weight_kg: '2.4',
      }] })
      .mockResolvedValueOnce({ rows: [] }) // scans
      .mockResolvedValueOnce({ rows: [{ id: 'inc1', status: 'open', severity: 'critical' }] }) // incidents
      .mockResolvedValueOnce({ rows: [
        { user_id: 'u1', client_name: 'Ali', client_phone: '111', order_id: 'o1', order_ref: 'K1', order_status: 'confirmed',
          total_kmf: '1000', payment_mode: 'cash_relais', payment_status: 'paid',
          item_id: 'i1', quantity: 2, price_kmf: '500', product_name: 'Riz', image_url: null, product_emoji: '🍚', pi_product_name: null },
        { user_id: 'u1', client_name: 'Ali', client_phone: '111', order_id: 'o1', order_ref: 'K1', order_status: 'confirmed',
          total_kmf: '1000', payment_mode: 'cash_relais', payment_status: 'paid',
          item_id: 'i2', quantity: 1, price_kmf: '300', product_name: null, image_url: null, product_emoji: null, pi_product_name: 'Sucre (snapshot)' },
      ] });
    mockReconcileParcel.mockReturnValue({ status: 'ok', checks: {}, issues: [] });

    const res = await request(buildApp()).get('/api/v2/parcels/PCL1');

    expect(res.status).toBe(200);
    expect(res.body.weight_kg).toBe(2.4);
    expect(res.body.nb_clients).toBe(1);
    expect(res.body.nb_orders).toBe(1);
    expect(res.body.nb_items).toBe(3);
    expect(res.body.total_kmf).toBe(1000);
    expect(res.body.clients[0].orders[0].items).toHaveLength(2);
    expect(res.body.clients[0].orders[0].items[1].product_name).toBe('Sucre (snapshot)');
  });

  it('client anonyme (user_id/nom/téléphone/produit absents) → fallbacks "unknown"/recipient/Produit inconnu', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'parcel-1', reference: 'PCL1', status: 'shipped', order_id: 'order-1',
        recipient_name: 'Recipient Fallback', recipient_phone: '269-000', weight_kg: null,
      }] })
      .mockResolvedValueOnce({ rows: [] }) // scans
      .mockResolvedValueOnce({ rows: [] }) // incidents
      .mockResolvedValueOnce({ rows: [
        { user_id: null, client_name: null, client_phone: null, order_id: 'o1', order_ref: 'K1', order_status: 'confirmed',
          total_kmf: '300', payment_mode: 'cash_relais', payment_status: 'paid',
          item_id: 'i1', quantity: 1, price_kmf: '300', product_name: null, image_url: null, product_emoji: null, pi_product_name: null },
      ] });
    mockReconcileParcel.mockReturnValue({ status: 'ok', checks: {}, issues: [] });

    const res = await request(buildApp()).get('/api/v2/parcels/PCL1');

    expect(res.status).toBe(200);
    expect(res.body.weight_kg).toBeNull();
    expect(res.body.clients[0].user_id).toBeNull();
    expect(res.body.clients[0].name).toBe('Recipient Fallback');
    expect(res.body.clients[0].phone).toBe('269-000');
    expect(res.body.clients[0].orders[0].items[0].product_name).toBe('Produit inconnu');
  });

  it('client et colis sans aucune identité → fallback ultime "Client" / chaîne vide', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'parcel-1', reference: 'PCL1', status: 'shipped', order_id: 'order-1',
        recipient_name: null, recipient_phone: null, weight_kg: null,
      }] })
      .mockResolvedValueOnce({ rows: [] }) // scans
      .mockResolvedValueOnce({ rows: [] }) // incidents
      .mockResolvedValueOnce({ rows: [
        { user_id: null, client_name: null, client_phone: null, order_id: 'o1', order_ref: 'K1', order_status: 'confirmed',
          total_kmf: '300', payment_mode: 'cash_relais', payment_status: 'paid',
          item_id: 'i1', quantity: 1, price_kmf: '300', product_name: null, image_url: null, product_emoji: null, pi_product_name: null },
      ] });
    mockReconcileParcel.mockReturnValue({ status: 'ok', checks: {}, issues: [] });

    const res = await request(buildApp()).get('/api/v2/parcels/PCL1');

    expect(res.status).toBe(200);
    expect(res.body.clients[0].name).toBe('Client');
    expect(res.body.clients[0].phone).toBe('');
  });

  it('fallback sur order_id quand aucun parcel_items mais commande principale existe', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', reference: 'PCL1', status: 'shipped', order_id: 'order-1', recipient_name: 'R', recipient_phone: 'P' }] })
      .mockResolvedValueOnce({ rows: [] }) // scans
      .mockResolvedValueOnce({ rows: [] }) // incidents
      .mockResolvedValueOnce({ rows: [] }) // parcel_items vide
      .mockResolvedValueOnce({ rows: [{
        id: 'order-1', user_id: 'u9', reference: 'K9', status: 'confirmed', total_kmf: '750',
        payment_mode: 'stripe_eur', payment_status: 'paid', client_name: null, client_phone: null,
      }] }) // mainOrder — pas de nom/téléphone client → fallback sur recipient_name/phone du colis
      .mockResolvedValueOnce({ rows: [{ item_id: 'i1', quantity: 1, price_kmf: '750', product_name: null, image_url: null, product_emoji: null }] }); // mainItems — produit sans nom → fallback "Produit"
    mockReconcileParcel.mockReturnValue({ status: 'ok', checks: {}, issues: [] });

    const res = await request(buildApp()).get('/api/v2/parcels/PCL1');

    expect(res.status).toBe(200);
    expect(res.body.clients).toHaveLength(1);
    expect(res.body.clients[0].name).toBe('R');
    expect(res.body.clients[0].phone).toBe('P');
    expect(res.body.clients[0].orders[0].items[0].product_name).toBe('Produit');
  });

  it('fallback mainOrder totalement anonyme (client et colis sans nom/téléphone) → "Client"/chaîne vide', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', reference: 'PCL1', status: 'shipped', order_id: 'order-1', recipient_name: null, recipient_phone: null }] })
      .mockResolvedValueOnce({ rows: [] }) // scans
      .mockResolvedValueOnce({ rows: [] }) // incidents
      .mockResolvedValueOnce({ rows: [] }) // parcel_items vide
      .mockResolvedValueOnce({ rows: [{
        id: 'order-1', user_id: 'u9', reference: 'K9', status: 'confirmed', total_kmf: '750',
        payment_mode: 'stripe_eur', payment_status: 'paid', client_name: null, client_phone: null,
      }] }) // mainOrder
      .mockResolvedValueOnce({ rows: [{ item_id: 'i1', quantity: 1, price_kmf: '750', product_name: 'Huile', image_url: null, product_emoji: '🛢️' }] }); // mainItems
    mockReconcileParcel.mockReturnValue({ status: 'ok', checks: {}, issues: [] });

    const res = await request(buildApp()).get('/api/v2/parcels/PCL1');

    expect(res.status).toBe(200);
    expect(res.body.clients[0].name).toBe('Client');
    expect(res.body.clients[0].phone).toBe('');
  });

  it('fallback sans commande principale trouvée → aucun client', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', reference: 'PCL1', status: 'draft', order_id: 'order-x', recipient_name: 'R', recipient_phone: 'P' }] })
      .mockResolvedValueOnce({ rows: [] }) // scans
      .mockResolvedValueOnce({ rows: [] }) // incidents
      .mockResolvedValueOnce({ rows: [] }) // parcel_items vide
      .mockResolvedValueOnce({ rows: [] }); // mainOrder introuvable
    mockReconcileParcel.mockReturnValue({ status: 'ok', checks: {}, issues: [] });

    const res = await request(buildApp()).get('/api/v2/parcels/PCL1');

    expect(res.status).toBe(200);
    expect(res.body.clients).toEqual([]);
    expect(res.body.nb_clients).toBe(0);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('detail down'));
    const res = await request(buildApp()).get('/api/v2/parcels/PCL1');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /:ref/timeline
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/v2/parcels/:ref/timeline', () => {
  it('404 si le colis est introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/v2/parcels/GHOST/timeline');
    expect(res.status).toBe(404);
  });

  it('calcule next_expected_step et les étapes complétées', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'PCL1', status: 'shipped', eta: '2026-07-10' }] })
      .mockResolvedValueOnce({ rows: [{ event_type: 'preparation' }, { event_type: 'shipped' }] });

    const res = await request(buildApp()).get('/api/v2/parcels/PCL1/timeline');

    expect(res.status).toBe(200);
    expect(res.body.next_expected_step).toBe('in_transit');
    expect(res.body.steps.find(s => s.step === 'shipped')).toEqual({ step: 'shipped', completed: true, current: true });
    expect(res.body.steps.find(s => s.step === 'collected')).toEqual({ step: 'collected', completed: false, current: false });
  });

  it('statut final "collected" → aucune étape suivante (next_expected_step = null)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'PCL1', status: 'collected', eta: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/v2/parcels/PCL1/timeline');

    expect(res.body.next_expected_step).toBeNull();
  });

  it('erreur DB → next(err) → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('timeline down'));
    const res = await request(buildApp()).get('/api/v2/parcels/PCL1/timeline');
    expect(res.status).toBe(500);
  });
});
