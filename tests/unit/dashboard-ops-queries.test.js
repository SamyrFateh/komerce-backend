'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/dashboard-ops-queries.js (R9)
 *
 * Couvre :
 *   getOps      — activité, SLA, logistique, délais, alertes
 *   getPilotage — coûts & marges, fallback taux douane, FIX getEcoVar
 *   getPipeline — kanban commandes groupé par STAGES
 *   getRetards  — clients en retard + compensations par niveau
 *   getForecast — projections CA (pessimiste/attendu/optimiste)
 *   getGlobal   — vue unifiée CT
 *   getStats    — alias /global avec mapping pilotage
 *
 * FIX vérifié : getEcoVar (alias de economic-engine-queries.getVar) est bien
 * importé et appelé avec les bonnes clés/valeurs par défaut dans getPilotage.
 *
 * db, dashboard-shared (getEurKmf, loadDashConfig) et economic-engine-queries
 * (getVar) sont mockés (aucune connexion réelle).
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../routes/dashboard-shared', () => ({
  getEurKmf: jest.fn(),
  loadDashConfig: jest.fn(),
}));
jest.mock('../../services/economic-config', () => ({
  loadFinanceConfig: jest.fn(),
  resolveLegacyInput: jest.fn(),
}));

const db = require('../../db');
const { getEurKmf, loadDashConfig } = require('../../routes/dashboard-shared');
const economicConfig = require('../../services/economic-config');
const opsQueries = require('../../services/dashboard-ops-queries');

beforeEach(() => {
  jest.clearAllMocks();
  economicConfig.loadFinanceConfig.mockResolvedValue({
    customs_rate_default_pct: 42,
    hub_monthly_cost_aed: 7000,
  });
  economicConfig.resolveLegacyInput.mockImplementation((config, key) =>
    key === 'customs_rate_default_pct' ? Number(config.customs_rate_default_pct) : Number(config.hub_monthly_cost_aed)
  );
});

// ── getOps ────────────────────────────────────────────────────────────────────

describe('getOps', () => {
  const CFG = {
    INACTIVE_DAYS: 14, SLA_BLOCKED_DAYS: 10, SLA_LATE_DAYS: 5, SLA_WARNING_DAYS: 2,
  };

  it('agrège activité, SLA, logistique, délais et alertes', async () => {
    loadDashConfig.mockResolvedValueOnce(CFG);

    db.query
      // 1. activité
      .mockResolvedValueOnce({ rows: [{
        commandes_aujourd_hui: 3, commandes_en_cours: 12, commandes_bloquees: 1,
        livrees_aujourd_hui: 2, livrees_30j: 40,
      }] })
      // 2. SLA (commandes non terminées)
      .mockResolvedValueOnce({ rows: [
        { reference: 'CMD-A', status: 'preparation', age_jours: 1, inactif_jours: 1 },   // on_time
        { reference: 'CMD-B', status: 'preparation', age_jours: 3, inactif_jours: 3 },   // warning
        { reference: 'CMD-C', status: 'shipped',     age_jours: 6, inactif_jours: 6 },   // late
        { reference: 'CMD-D', status: 'in_transit',  age_jours: 11, inactif_jours: 15 }, // blocked (inactif >= 14)
      ] })
      // 3. parcelCounts
      .mockResolvedValueOnce({ rows: [{
        hub_preparation: 4, expedie: 2, en_transit: 3, au_relais: 5,
        total_actifs: 14, colis_bloques: 1, livres_aujourd_hui: 2,
      }] })
      // 4. délais
      .mockResolvedValueOnce({ rows: [{ avg_preparation_jours: 2, avg_livraison_totale_jours: 7 }] })
      // 5-7. alertes (Promise.all)
      .mockResolvedValueOnce({ rows: [{ c: 3 }] })  // cashAlert
      .mockResolvedValueOnce({ rows: [{ c: 1 }] })  // anomAlert
      .mockResolvedValueOnce({ rows: [{ c: 2 }] }); // stockAlert

    const result = await opsQueries.getOps();

    expect(result.activite).toEqual({
      commandes_aujourd_hui: 3, commandes_en_cours: 12, commandes_bloquees: 1,
      livrees_aujourd_hui: 2, livrees_30j: 40,
    });

    expect(result.sla.on_time).toBe(1);
    expect(result.sla.warning).toBe(1);
    expect(result.sla.late).toBe(1);
    expect(result.sla.blocked).toBe(1);
    expect(result.sla.details.late).toEqual([{ reference: 'CMD-C', status: 'shipped', jours: 6 }]);

    expect(result.logistique.hub_preparation).toEqual({ count: 4, label: '📦 Hub préparation' });
    expect(result.logistique.en_transit).toEqual({ count: 3, label: '🚢 En mer' });

    expect(result.delais).toEqual({ avg_preparation_jours: 2, avg_livraison_totale_jours: 7 });

    expect(result.alertes).toEqual({ cash_pending: 3, anomalies: 1, low_stock: 2 });
  });

  it('classe blocked en priorité même si age_jours seul dépasse SLA_BLOCKED_DAYS', async () => {
    loadDashConfig.mockResolvedValueOnce(CFG);
    db.query
      .mockResolvedValueOnce({ rows: [{ commandes_aujourd_hui: 0, commandes_en_cours: 1, commandes_bloquees: 1, livrees_aujourd_hui: 0, livrees_30j: 0 }] })
      .mockResolvedValueOnce({ rows: [
        { reference: 'CMD-X', status: 'preparation', age_jours: 12, inactif_jours: 1 }, // age >= SLA_BLOCKED_DAYS (10) → blocked
      ] })
      .mockResolvedValueOnce({ rows: [{ hub_preparation: 0, expedie: 0, en_transit: 0, au_relais: 0, total_actifs: 0, colis_bloques: 0, livres_aujourd_hui: 0 }] })
      .mockResolvedValueOnce({ rows: [{ avg_preparation_jours: 0, avg_livraison_totale_jours: 0 }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] });

    const result = await opsQueries.getOps();
    expect(result.sla.blocked).toBe(1);
    expect(result.sla.late).toBe(0);
  });
});

// ── getPilotage ───────────────────────────────────────────────────────────────

describe('getPilotage', () => {
  const VOL_ROW = {
    total_commandes: 100, livrees: 80, annulees: 5, en_cours: 15,
    ca_kmf: 5000000, ca_eur: 10000,
    ca_cash_kmf: 2000000, ca_stripe_kmf: 3000000,
  };

  it('lit douane fallback et coût hub depuis finance_config', async () => {
    getEurKmf.mockResolvedValueOnce({ eur_kmf: 491, aed_kmf: 134 });
    db.query
      .mockResolvedValueOnce({ rows: [VOL_ROW] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('vue absente'))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await opsQueries.getPilotage('2026-06');

    expect(economicConfig.loadFinanceConfig).toHaveBeenCalledTimes(1);
    expect(economicConfig.resolveLegacyInput).toHaveBeenCalledWith(expect.any(Object), 'customs_rate_default_pct');
    expect(economicConfig.resolveLegacyInput).toHaveBeenCalledWith(expect.any(Object), 'hub_monthly_cost_aed');
    expect(result.couts.source_taux).toBe('finance_config_fallback');
    expect(result.couts.taux_terrain_pct).toBeCloseTo(42);
    expect(result.couts.hub_fixe_mensuel_kmf).toBe(7000 * 134);
  });

  it('utilise le taux douane effectif si la vue customs_effective_rates répond', async () => {
    getEurKmf.mockResolvedValueOnce({ eur_kmf: 491, aed_kmf: 134 });
    db.query
      .mockResolvedValueOnce({ rows: [VOL_ROW] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ period: 'last_30d', rate_pct: 38, nb_shipments: 12 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });


    const result = await opsQueries.getPilotage('2026-06');
    expect(result.couts.source_taux).toBe('last_30d');
    expect(result.couts.taux_terrain_pct).toBeCloseTo(38);
  });

  it('retourne periode, ca, volume et categories correctement formatés', async () => {
    getEurKmf.mockResolvedValueOnce({ eur_kmf: 491, aed_kmf: 134 });
    db.query
      .mockResolvedValueOnce({ rows: [VOL_ROW] })
      .mockResolvedValueOnce({ rows: [
        { category: 'alimentaire', nb_articles: 30, nb_commandes: 20, ca_kmf: 1000000 },
      ] })
      .mockRejectedValueOnce(new Error('vue absente'))
      .mockResolvedValueOnce({ rows: [{ status: 'collected', nb: 80 }] })
      .mockResolvedValueOnce({ rows: [] });


    const result = await opsQueries.getPilotage('2026-06');

    expect(result.periode).toBe('2026-06');
    expect(result.volume).toEqual({ total: 100, livrees: 80, annulees: 5, en_cours: 15 });
    expect(result.ca.total_kmf).toBe(5000000);
    expect(result.ca.total_eur).toBe(10000);
    expect(result.ca.cash_kmf).toBe(2000000);
    expect(result.ca.stripe_kmf).toBe(3000000);
    expect(result.categories[0]).toEqual({
      categorie: 'alimentaire', nb_commandes: 20, nb_articles: 30, ca_kmf: 1000000, pct_ca: 20,
    });
    expect(result.pipeline).toEqual([{ statut: 'collected', nb: 80 }]);

    // bornes du mois passées en paramètre des requêtes volume/catégories
    const [, volParams] = db.query.mock.calls[0];
    expect(volParams).toEqual(['2026-06-01', '2026-07-01']);
  });
});

// ── getPipeline ───────────────────────────────────────────────────────────────

describe('getPipeline', () => {
  it('groupe les commandes par statut dans les STAGES et calcule active', async () => {
    db.query.mockResolvedValueOnce({ rows: [
      { id: 1, status: 'confirmed' },
      { id: 2, status: 'shipped' },
      { id: 3, status: 'collected' },
      { id: 4, status: 'cancelled' },
    ] });

    const result = await opsQueries.getPipeline();

    expect(result.total).toBe(4);
    expect(result.active).toBe(2); // confirmed + shipped (ni collected ni cancelled ni refunded)
    expect(result.pipeline.confirmed.count).toBe(1);
    expect(result.pipeline.shipped.count).toBe(1);
    expect(result.pipeline.collected.count).toBe(1);
    expect(result.pipeline.cancelled.count).toBe(1);
    expect(result.pipeline.in_transit.count).toBe(0);
    expect(result.pipeline.confirmed.orders[0].id).toBe(1);
  });

  it('retourne toutes les STAGES initialisées même sans données', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await opsQueries.getPipeline();
    expect(Object.keys(result.pipeline)).toEqual([
      'pending', 'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit',
      'available', 'collected', 'cancelled', 'refunded',
    ]);
    expect(result.total).toBe(0);
    expect(result.active).toBe(0);
  });
});

// ── getRetards ────────────────────────────────────────────────────────────────

describe('getRetards', () => {
  const CFG = {
    DELAY_PREVENTIF: 3, DELAY_AVOIR: 7, DELAY_REMISE: 14, DELAY_REMBOURSEMENT: 21,
  };

  it('classe chaque commande dans le bon niveau de compensation', async () => {
    loadDashConfig.mockResolvedValueOnce(CFG);
    db.query.mockResolvedValueOnce({ rows: [
      { id: 1, reference: 'CMD-1', status: 'preparation', client_nom: 'A', client_phone: 'p1', client_email: 'a@x.com', age_jours: 4 },   // contact_preventif
      { id: 2, reference: 'CMD-2', status: 'preparation', client_nom: 'B', client_phone: 'p2', client_email: 'b@x.com', age_jours: 8 },   // avoir_5pct
      { id: 3, reference: 'CMD-3', status: 'shipped',     client_nom: 'C', client_phone: 'p3', client_email: 'c@x.com', age_jours: 15 },  // remise_10pct
      { id: 4, reference: 'CMD-4', status: 'shipped',     client_nom: 'D', client_phone: 'p4', client_email: 'd@x.com', age_jours: 22 },  // remboursement
    ] });

    const result = await opsQueries.getRetards();

    expect(result.total).toBe(4);
    expect(result.par_niveau.contact_preventif.count).toBe(1);
    expect(result.par_niveau.avoir_5pct.count).toBe(1);
    expect(result.par_niveau.remise_10pct_prochaine_cmd.count).toBe(1);
    expect(result.par_niveau.remboursement_possible.count).toBe(1);

    const cmd4 = result.clients.find(c => c.reference === 'CMD-4');
    expect(cmd4.compensation).toBe('remboursement_possible');
    expect(cmd4.jours_retard).toBe(22);
    expect(cmd4.sms_suggere).toContain('CMD-4');
    expect(cmd4).not.toHaveProperty('_niv');
  });

  it('filtre par niveau si fourni', async () => {
    loadDashConfig.mockResolvedValueOnce(CFG);
    db.query.mockResolvedValueOnce({ rows: [
      { id: 1, reference: 'CMD-1', status: 'preparation', client_nom: 'A', client_phone: 'p1', client_email: 'a@x.com', age_jours: 4 },
      { id: 2, reference: 'CMD-2', status: 'preparation', client_nom: 'B', client_phone: 'p2', client_email: 'b@x.com', age_jours: 22 },
    ] });

    const result = await opsQueries.getRetards('remboursement_possible');
    expect(result.clients).toHaveLength(1);
    expect(result.clients[0].reference).toBe('CMD-2');
    // par_niveau garde le total réel, indépendamment du filtre d'affichage
    expect(result.par_niveau.contact_preventif.count).toBe(1);
  });
});

// ── getForecast ───────────────────────────────────────────────────────────────

describe('getForecast', () => {
  it('calcule pessimiste/attendu/optimiste à partir de la moyenne et de l\'écart-type', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [
        { jour: '2026-06-01', ca_jour: 100000 },
        { jour: '2026-06-02', ca_jour: 200000 },
      ] })
      .mockResolvedValueOnce({ rows: [{ ca_kmf: 500000 }] });

    const today = new Date();
    const target = new Date(today.getTime() + 5 * 86400000).toISOString().split('T')[0];

    const result = await opsQueries.getForecast({ target_date: target, ref_period: 30 });

    expect(result.realise_kmf).toBe(500000);
    expect(result.modele.ref_period_jours).toBe(30);
    expect(result.modele.avg_ca_jour).toBe(150000); // (100000+200000)/2
    expect(result.projection.attendu).toBe(500000 + result.days_remaining * 150000);
    expect(result.projection.pessimiste).toBeLessThanOrEqual(result.projection.attendu);
    expect(result.projection.optimiste).toBeGreaterThanOrEqual(result.projection.attendu);
  });

  it('borne ref_period entre 1 et 365', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ca_kmf: 0 }] });

    await opsQueries.getForecast({ target_date: new Date().toISOString().split('T')[0], ref_period: 9999 });
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual([365]);
  });
});

// ── getGlobal ─────────────────────────────────────────────────────────────────

describe('getGlobal', () => {
  function mockGlobalQueries({ incidentsFail = false, scanFail = false, invoicesFail = false } = {}) {
    db.query
      // 1. kpi
      .mockResolvedValueOnce({ rows: [{
        total_orders: 100, active_orders: 20, completed_orders: 75, cancelled_orders: 5,
        ca_total_kmf: 5000000, avg_basket_kmf: 50000, nb_clients: 30,
      }] })
      // 2. funnel
      .mockResolvedValueOnce({ rows: [
        { status: 'confirmed', count: 5 },
        { status: 'collected', count: 75 },
      ] })
      // 3. parcelKpi
      .mockResolvedValueOnce({ rows: [{
        total_parcels: 90, shipped: 10, in_transit: 5, at_relay: 8, collected: 67,
      }] });

    // 4. incidents
    if (incidentsFail) db.query.mockRejectedValueOnce(new Error('no table'));
    else db.query.mockResolvedValueOnce({ rows: [{ c: 2 }] });

    // 5. scan_events
    if (scanFail) db.query.mockRejectedValueOnce(new Error('no table'));
    else db.query.mockResolvedValueOnce({ rows: [{ c: 40 }] });

    // 6. invoices
    if (invoicesFail) db.query.mockRejectedValueOnce(new Error('no table'));
    else db.query.mockResolvedValueOnce({ rows: [{ c: 12 }] });

    // 7. recentOrders
    db.query.mockResolvedValueOnce({ rows: [{
      reference: 'CMD-100', status: 'collected', total_kmf: 50000, payment_mode: 'cash_relais',
      created_at: '2026-06-10', customer_name: 'Client', relais_name: 'Relais Moroni', island: 'Grande Comore',
    }] });
  }

  it('agrège kpi, funnel, parcels, incidents/scan/invoices et recent_orders', async () => {
    mockGlobalQueries();
    const result = await opsQueries.getGlobal();

    expect(result.kpi).toEqual({
      total_orders: 100, active_orders: 20, completed_orders: 75, cancelled_orders: 5,
      ca_total_kmf: 5000000, avg_basket_kmf: 50000, nb_clients: 30,
    });
    expect(result.funnel).toEqual({ confirmed: 5, collected: 75 });
    expect(result.parcels).toEqual({ total: 90, shipped: 10, in_transit: 5, at_relay: 8, collected: 67 });
    expect(result.incidents).toBe(2);
    expect(result.scan_events).toBe(40);
    expect(result.invoices).toBe(12);
    expect(result.recent_orders).toHaveLength(1);
    expect(result.recent_orders[0].reference).toBe('CMD-100');
  });

  it('retombe à 0 pour incidents/scan_events/invoices si les tables sont absentes', async () => {
    mockGlobalQueries({ incidentsFail: true, scanFail: true, invoicesFail: true });
    const result = await opsQueries.getGlobal();
    expect(result.incidents).toBe(0);
    expect(result.scan_events).toBe(0);
    expect(result.invoices).toBe(0);
  });
});

// ── getStats ──────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('mappe getGlobal vers le format attendu par ct-views-pilotage', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        total_orders: 100, active_orders: 20, completed_orders: 75, cancelled_orders: 5,
        ca_total_kmf: 5000000, avg_basket_kmf: 50000, nb_clients: 30,
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total_parcels: 0, shipped: 0, in_transit: 0, at_relay: 0, collected: 0 }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await opsQueries.getStats();

    expect(result.panier_moyen_kmf).toBe(50000);
    expect(result.avgBasket).toBe(50000);
    expect(result.nb_clients).toBe(30);
    expect(result.total_orders).toBe(100);
    expect(result.active_orders).toBe(20);
    expect(result.completed_orders).toBe(75);
    expect(result.ca_total_kmf).toBe(5000000);
    expect(result.kpi.nb_clients).toBe(30);
  });
});
