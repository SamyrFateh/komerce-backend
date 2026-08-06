'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/ops-api.test.js
 *
 * Tests du router routes/ops-api.js (Control Tower — endpoints opérationnels)
 *
 * Le router requête directement `pool.query` en séquence (pas de service
 * intermédiaire) : on mocke pool.query et on enchaîne les résolutions dans
 * l'ordre exact des appels de chaque route (documenté route par route).
 *
 * Couverture :
 *   ✓ auth : authenticate + requireRole(['admin','agent_hub','agent_relais']) sur tout le router
 *   ✓ GET /global : agrégation orders/parcels/finance/incidents/alerts, tolère l'échec des blocs optionnels
 *   ✓ GET /incidents : liste simple
 *   ✓ GET /reconciliation (+ /reconciliation/summary, alias du même handler) : calcul du taux, division par zéro
 *   ✓ GET /alerts : 4 sources d'alertes fusionnées et triées par sévérité
 *   ✓ POST /alerts/:id/acknowledge : branche 'weight-' vs autre préfixe
 *   ✓ GET /parcels/:ref/detail : UUID vs référence, 404, items par commande
 *   ✓ GET /parcels/:id/scans, /parcels/:id/orders
 *   ✓ GET /invoices, /scan-events (limit borné)
 *   (GET /parcels/:id et GET /parcels (liste) supprimés le 2026-07-06 :
 *    code mort, shadowed en production par parcel-api-v2 monté avant)
 *   ✓ Propagation d'erreur DB → next(err) pour chaque route
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/ops-api');
    app.use('/api/v2', router);
  });
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — auth', () => {
  it('403 si le rôle n\'est pas autorisé', async () => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'u1', role: 'client' }; next(); });
    jest.isolateModules(() => {
      const router = require('../../routes/ops-api');
      app.use('/api/v2', router);
    });

    const res = await request(app).get('/api/v2/invoices');
    expect(res.status).toBe(403);
  });

  it('laisse passer agent_hub', async () => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'u1', role: 'agent_hub' }; next(); });
    jest.isolateModules(() => {
      const router = require('../../routes/ops-api');
      app.use('/api/v2', router);
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/invoices');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /global
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — GET /global', () => {
  it('agrège toutes les sections avec succès', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // orderStats (approche complexe, résultat ignoré)
      .mockResolvedValueOnce({ rows: [{ status: 'pending', count: 3 }, { status: 'collected', count: 7 }] }) // oByStatus
      .mockResolvedValueOnce({ rows: [{ total: 10, active: 3 }] }) // oTotals
      .mockResolvedValueOnce({ rows: [{ status: 'draft', count: 1 }] }) // pByStatus
      .mockResolvedValueOnce({ rows: [{ ca_total_kmf: 500000, cash_pending: 2, paid: 5 }] }) // finance
      .mockResolvedValueOnce({ rows: [{ total: 4, open: 1, resolved: 3 }] }) // incidents
      .mockResolvedValueOnce({ rows: [{ c: 1 }] }) // sla alert count
      .mockResolvedValueOnce({ rows: [{ c: 2 }] }) // cash alert count
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }); // stuck alert count

    const res = await request(app).get('/api/v2/global');

    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual({ total: 10, active: 3, by_status: { pending: 3, collected: 7 } });
    expect(res.body.parcels).toEqual({ total: 1, by_status: { draft: 1 } });
    expect(res.body.finance).toEqual({ ca_total_kmf: 500000, cash_pending: 2, paid: 5 });
    expect(res.body.incidents).toEqual({ total: 4, open: 1, resolved: 3 });
    expect(res.body.alerts).toEqual({ total: 3, critical: 1, high: 2, medium: 0 });
  });

  it('tolère un échec sur le bloc parcels (try/catch interne) sans planter la route', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // oByStatus
      .mockResolvedValueOnce({ rows: [{ total: 0, active: 0 }] }) // oTotals
      .mockRejectedValueOnce(new Error('parcels table missing')) // pByStatus → catch
      .mockResolvedValueOnce({ rows: [{ ca_total_kmf: 0, cash_pending: 0, paid: 0 }] }) // finance
      .mockRejectedValueOnce(new Error('incidents table missing')) // incidents → catch
      .mockRejectedValueOnce(new Error('alerts sla fail')); // alerts sla → catch (le reste du bloc alerts n'est pas atteint)

    const res = await request(app).get('/api/v2/global');

    expect(res.status).toBe(200);
    expect(res.body.parcels).toEqual({ total: 0, by_status: {} });
    expect(res.body.incidents).toEqual({ total: 0, open: 0, resolved: 0 });
    expect(res.body.alerts).toEqual({ total: 0, critical: 0, high: 0 });
  });

  it('500 si une requête obligatoire (hors try/catch) échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db is down'));

    const res = await request(app).get('/api/v2/global');

    expect(res.status).toBe(500);
  });

  it("calcule alertCount même quand sla/cash/stuck renvoient une ligne absente (fallback optional-chaining)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // oByStatus
      .mockResolvedValueOnce({ rows: [{ total: 0, active: 0 }] }) // oTotals
      .mockResolvedValueOnce({ rows: [] }) // pByStatus
      .mockResolvedValueOnce({ rows: [{ ca_total_kmf: 0, cash_pending: 0, paid: 0 }] }) // finance
      .mockResolvedValueOnce({ rows: [{ total: 0, open: 0, resolved: 0 }] }) // incidents
      .mockResolvedValueOnce({ rows: [] }) // sla → destructuré à undefined
      .mockResolvedValueOnce({ rows: [] }) // cash → undefined
      .mockResolvedValueOnce({ rows: [] }); // stuck → undefined

    const res = await request(app).get('/api/v2/global');

    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual({ total: 0, critical: 0, high: 0, medium: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /incidents
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — GET /incidents', () => {
  it('renvoie la liste des incidents', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', severity: 'critical' }] });

    const res = await request(app).get('/api/v2/incidents');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'i1', severity: 'critical' }]);
  });

  it('500 si la requête échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/v2/incidents');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /reconciliation (+ alias /reconciliation/summary)
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — GET /reconciliation', () => {
  it('calcule le taux de réconciliation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_parcels: 10, reconciled: 8, pending: 2, anomalies: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'PCL-1', verification_status: 'verified' }] });

    const res = await request(app).get('/api/v2/reconciliation');

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total_parcels: 10, reconciled: 8, pending: 2, anomalies: 1, rate: 80 });
    expect(res.body.parcels).toHaveLength(1);
  });

  it('rate = 0 si total_parcels = 0 (pas de division par zéro)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_parcels: 0, reconciled: 0, pending: 0, anomalies: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/reconciliation');

    expect(res.body.summary.rate).toBe(0);
  });

  it('gère une réponse summary vide (fallback {})', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/reconciliation');

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total_parcels: 0, reconciled: 0, pending: 0, anomalies: 0, rate: 0 });
  });

  it('/reconciliation/summary est un alias du même handler', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_parcels: 5, reconciled: 5, pending: 0, anomalies: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/reconciliation/summary');

    expect(res.status).toBe(200);
    expect(res.body.summary.rate).toBe(100);
  });

  it('500 si la requête échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/v2/reconciliation');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /alerts
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — GET /alerts', () => {
  it('fusionne les 4 sources et trie par sévérité (critical > high > medium)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', total_kmf: 1000, created_at: 't', customer_name: 'Jean', relay_name: 'R1', hours_pending: 80 }] }) // cash
      .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'PCL-1', status: 'shipped', updated_at: 't', order_reference: 'CMD-1', customer_name: 'Jean', customer_phone: '123', days_stuck: 9 }] }) // stuck
      .mockResolvedValueOnce({ rows: [{ id: 'o2', reference: 'CMD-2', status: 'preparation', created_at: 't', total_kmf: 2000, customer_name: 'Marie', days_elapsed: 25 }] }) // sla
      .mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'Poids anormal', description: 'd', details: {}, created_at: 't', parcel_reference: 'PCL-2', customer_name: 'Ali', customer_phone: '456', order_reference: 'CMD-3' }] }); // weight

    const res = await request(app).get('/api/v2/alerts');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    // Ordre attendu : sla (critical) → cash (high) → stuck (medium) → weight (medium)
    expect(res.body[0].type).toBe('sla_breach');
    expect(res.body[0].severity).toBe('critical');
    expect(res.body[1].type).toBe('cash_pending');
    expect(res.body[1].severity).toBe('high');
    const mediumTypes = res.body.slice(2).map(a => a.type);
    expect(mediumTypes).toEqual(expect.arrayContaining(['stuck_parcel', 'weight_anomaly']));
  });

  it('renvoie un tableau vide si aucune alerte', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/alerts');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('fallback "Client inconnu" pour une alerte SLA sans customer_name', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'o2', reference: 'CMD-2', status: 'preparation', created_at: 't', total_kmf: 2000, customer_name: null, days_elapsed: 25 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/alerts');

    expect(res.body[0].message).toContain('Client inconnu');
  });

  it('500 si une des requêtes échoue (pas de try/catch interne sur /alerts)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/v2/alerts');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /alerts/:id/acknowledge
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — POST /alerts/:id/acknowledge', () => {
  it('résout l\'incident lié pour une alerte "weight-"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/v2/alerts/weight-abc123/acknowledge');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Alerte acquittée' });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE incidents/),
      expect.arrayContaining([expect.any(String), 'abc123'])
    );
  });

  it('ne touche pas la DB pour une alerte non "weight-" (ex: cash-, sla-, stuck-)', async () => {
    const res = await request(app).post('/api/v2/alerts/cash-xyz/acknowledge');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Alerte acquittée' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('500 si la mise à jour DB échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).post('/api/v2/alerts/weight-abc/acknowledge');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /parcels/:ref/detail
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — GET /parcels/:ref/detail', () => {
  it('détecte un UUID et l\'utilise comme clé de recherche', async () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: uuid, order_id: 'o1' }] }) // parcel
      .mockResolvedValueOnce({ rows: [] }) // scans
      .mockResolvedValueOnce({ rows: [{ id: 'o1' }] }); // orders
    mockQuery.mockResolvedValueOnce({ rows: [] }); // items pour order o1

    const res = await request(app).get(`/api/v2/parcels/${uuid}/detail`);

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/p\.id = \$1/);
  });

  it('utilise la référence (non-UUID) comme clé de recherche', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/parcels/PCL-2026-0001/detail');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/p\.reference = \$1/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['PCL-2026-0001']);
  });

  it('404 si le colis est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/parcels/PCL-INEXISTANT/detail');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Colis non trouvé');
  });

  it('attache les items à chaque commande liée', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'o1' }] }) // parcel
      .mockResolvedValueOnce({ rows: [{ id: 'scan1' }] }) // scans
      .mockResolvedValueOnce({ rows: [{ id: 'o1' }, { id: 'o2' }] }) // orders (2)
      .mockResolvedValueOnce({ rows: [{ id: 'item1' }] }) // items pour o1
      .mockResolvedValueOnce({ rows: [{ id: 'item2' }] }); // items pour o2

    const res = await request(app).get('/api/v2/parcels/p1/detail');

    expect(res.status).toBe(200);
    expect(res.body.orders[0].items).toEqual([{ id: 'item1' }]);
    expect(res.body.orders[1].items).toEqual([{ id: 'item2' }]);
    expect(res.body.scans).toEqual([{ id: 'scan1' }]);
  });

  it('500 si une requête échoue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/v2/parcels/p1/detail');
    expect(res.status).toBe(500);
  });
});

// NOTE gouvernance (résolu 2026-07-06) : le handler GET /parcels/:id de
// routes/ops-api.js a été supprimé (code mort, shadowed en production par
// parcel-api-v2 GET /:ref, monté avant). Ce test l'exerçait en isolation
// (routeur monté seul, sans parcel-api-v2) donc masquait le shadowing —
// il est retiré avec le handler plutôt que laissé à échouer.

// ═══════════════════════════════════════════════════════════════════════
// GET /parcels/:id/scans
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — GET /parcels/:id/scans', () => {
  it('renvoie les scans triés par date', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1' }, { id: 's2' }] });

    const res = await request(app).get('/api/v2/parcels/p1/scans');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['p1']);
  });

  it('500 si erreur DB', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/v2/parcels/p1/scans');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /parcels/:id/orders
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — GET /parcels/:id/orders', () => {
  it('renvoie [] si le colis n\'a pas de commande liée', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/parcels/p1/orders');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('renvoie la commande liée avec ses items', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ order_id: 'o1' }] }) // parcels lookup
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1' }] }) // orders
      .mockResolvedValueOnce({ rows: [{ id: 'item1' }] }); // items

    const res = await request(app).get('/api/v2/parcels/p1/orders');

    expect(res.status).toBe(200);
    expect(res.body[0].items).toEqual([{ id: 'item1' }]);
  });

  it('500 si erreur DB', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/v2/parcels/p1/orders');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /invoices
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — GET /invoices', () => {
  it('renvoie la liste des factures', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'inv1' }] });

    const res = await request(app).get('/api/v2/invoices');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'inv1' }]);
  });

  it('500 si erreur DB', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/v2/invoices');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /scan-events
// ═══════════════════════════════════════════════════════════════════════

describe('routes/ops-api — GET /scan-events', () => {
  it('utilise 100 par défaut si limit non fourni', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/v2/scan-events');

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [100]);
  });

  it('respecte un limit personnalisé sous le plafond', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/v2/scan-events?limit=50');

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [50]);
  });

  it('plafonne le limit à 500 même si une valeur supérieure est demandée', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/v2/scan-events?limit=99999');

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [500]);
  });

  it('utilise 100 par défaut si limit est invalide (NaN)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/v2/scan-events?limit=abc');

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [100]);
  });

  it('500 si erreur DB', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/v2/scan-events');
    expect(res.status).toBe(500);
  });
});

// NOTE gouvernance (résolu 2026-07-06) : le handler GET /parcels de
// routes/ops-api.js a été supprimé (code mort, shadowed en production par
// parcel-api-v2 GET /, monté avant). Ce test l'exerçait en isolation
// (routeur monté seul, sans parcel-api-v2) donc masquait le shadowing —
// il est retiré avec le handler plutôt que laissé à échouer.
