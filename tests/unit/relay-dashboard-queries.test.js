'use strict';

/**
 * Tests unitaires — services/relay-dashboard-queries.js (R9)
 *
 * Couvre :
 *   getDashboardKPIs — KPIs + alertes, scoping relais_id (non-admin) vs admin
 *   getOrders        — filtres status/search, scoping relais, enrichissement urgence/cash_pending
 *   getOrderDetail   — détail complet, null si introuvable, guard IDOR (forbidden)
 *
 * db est mocké (aucune connexion réelle).
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const relayQueries = require('../../services/relay-dashboard-queries');

const ADMIN = { id: 1, role: 'admin', relais_id: null };
const RELAY_USER = { id: 2, role: 'relay', relais_id: 7 };

beforeEach(() => {
  jest.clearAllMocks();
});

// ── getDashboardKPIs ────────────────────────────────────────────────────────

describe('getDashboardKPIs', () => {
  const KPI_ROW = {
    en_transit: 3, disponibles: 5, cash_a_encaisser: 2,
    collectes_aujourd_hui: 1, collectes_7j: 10,
    en_attente_72h: 1, total_actives: 8, montant_cash_pending: 30000,
  };

  it('scope la requête KPI par relais_id pour un user non-admin', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [KPI_ROW] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] });

    await relayQueries.getDashboardKPIs(RELAY_USER);

    const [kpiSql, kpiParams] = db.query.mock.calls[0];
    expect(kpiSql).toContain('WHERE relais_id = $1');
    expect(kpiParams).toEqual([7]);

    const [incSql, incParams] = db.query.mock.calls[1];
    expect(incSql).toContain('o.relais_id = $1');
    expect(incParams).toEqual([7]);
  });

  it('ne filtre pas par relais pour un admin', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [KPI_ROW] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] });

    await relayQueries.getDashboardKPIs(ADMIN);

    const [kpiSql, kpiParams] = db.query.mock.calls[0];
    expect(kpiSql).not.toContain('WHERE relais_id');
    expect(kpiParams).toEqual([]);

    const [incSql, incParams] = db.query.mock.calls[1];
    expect(incSql).not.toContain('o.relais_id');
    expect(incParams).toEqual([]);
  });

  it('génère les alertes attendues quand en_attente_72h, cash_a_encaisser et incidents > 0', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [KPI_ROW] })
      .mockResolvedValueOnce({ rows: [{ c: 4 }] });

    const result = await relayQueries.getDashboardKPIs(RELAY_USER);

    expect(result.kpi.incidents_ouverts).toBe(4);
    expect(result.alertes).toEqual([
      { type: 'warning', message: '1 colis en attente depuis +72h' },
      { type: 'info', message: `2 paiements cash à encaisser (${(30000).toLocaleString('fr-FR')} KMF)` },
      { type: 'danger', message: '4 incident(s) non résolu(s)' },
    ]);
  });

  it('aucune alerte si tous les compteurs sont à zéro', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        en_transit: 0, disponibles: 0, cash_a_encaisser: 0,
        collectes_aujourd_hui: 0, collectes_7j: 0,
        en_attente_72h: 0, total_actives: 0, montant_cash_pending: 0,
      }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] });

    const result = await relayQueries.getDashboardKPIs(RELAY_USER);
    expect(result.alertes).toEqual([]);
  });

  it('incidents_ouverts reste à 0 si la table order_incidents est absente', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [KPI_ROW] })
      .mockRejectedValueOnce(new Error('relation "order_incidents" does not exist'));

    const result = await relayQueries.getDashboardKPIs(RELAY_USER);
    expect(result.kpi.incidents_ouverts).toBe(0);
  });
});

// ── getOrders ─────────────────────────────────────────────────────────────────

describe('getOrders', () => {
  it('scope par relais_id pour un user non-admin et applique le statut par défaut', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await relayQueries.getOrders(RELAY_USER, {});

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('o.relais_id = $1');
    expect(sql).toContain("o.status IN ('shipped','available','collected')");
    // params: [relais_id, limit, offset]
    expect(params).toEqual([7, 50, 0]);
  });

  it('admin sans scoping relais, statut filtré explicitement (CSV)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await relayQueries.getOrders(ADMIN, { status: 'available,in_transit', limit: 10, offset: 5 });

    const [sql, params] = db.query.mock.calls[0];
    // Pas de scoping relais pour un admin. Le LEFT JOIN relais (o.relais_id) reste
    // autorisé : on vérifie donc l'absence de la clause de filtre, pas du JOIN.
    expect(sql).not.toContain('o.relais_id = $');
    expect(sql).toContain('o.status = ANY($1::text[])');
    expect(params[0]).toEqual(['available', 'in_transit']);
    expect(params).toEqual([['available', 'in_transit'], 10, 5]);
  });

  it('ajoute le filtre search sur reference/nom/téléphone', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await relayQueries.getOrders(RELAY_USER, { search: 'Fatima' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('o.reference ILIKE');
    expect(sql).toContain('rc.full_name ILIKE');
    expect(params).toContain('%Fatima%');
  });

  it('borne limit à 100 et offset minimum à 0', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await relayQueries.getOrders(RELAY_USER, { limit: 999, offset: -5 });
    const [, params] = db.query.mock.calls[0];
    expect(params[params.length - 2]).toBe(100);
    expect(params[params.length - 1]).toBe(0);
  });

  it('calcule urgence selon heures_attente pour status=available et cash_pending', async () => {
    db.query.mockResolvedValueOnce({ rows: [
      { id: 1, status: 'available', heures_attente: 150, payment_mode: 'cash_relais', payment_status: 'pending', total_kmf: 10000, age_jours: 6 },
      { id: 2, status: 'available', heures_attente: 80,  payment_mode: 'stripe_eur',  payment_status: 'paid',    total_kmf: 20000, age_jours: 3 },
      { id: 3, status: 'available', heures_attente: 30,  payment_mode: 'cash_relais', payment_status: 'paid',    total_kmf: 15000, age_jours: 1 },
      { id: 4, status: 'available', heures_attente: 5,   payment_mode: 'cash_relais', payment_status: 'paid',    total_kmf: 5000,  age_jours: 0 },
      { id: 5, status: 'collected', heures_attente: 200, payment_mode: 'cash_relais', payment_status: 'paid',    total_kmf: 5000,  age_jours: 9 },
    ] });

    const { total, orders } = await relayQueries.getOrders(RELAY_USER, {});

    expect(total).toBe(5);
    expect(orders[0].urgence).toBe('critique'); // >120h
    expect(orders[1].urgence).toBe('haute');    // >72h
    expect(orders[2].urgence).toBe('moyenne');  // >24h
    expect(orders[3].urgence).toBe('normale');  // <=24h
    expect(orders[4].urgence).toBe('normale');  // status != available
    expect(orders[0].cash_pending).toBe(true);
    expect(orders[1].cash_pending).toBe(false);
    expect(orders[2].cash_pending).toBe(false); // paid
  });
});

// ── getOrderDetail ────────────────────────────────────────────────────────────

describe('getOrderDetail', () => {
  const BASE_ORDER = {
    id: 100, reference: 'CMD-100', status: 'available', pickup_secret_last4: 'P1CK',
    created_at: '2026-06-01', updated_at: '2026-06-10',
    relais_id: 7, relais_nom: 'Relais Moroni', ile: 'Grande Comore',
    relais_adresse: 'Adresse', relais_phone: '+269000',
    client_nom: 'Fatima', client_phone: '+269111', client_email: 'f@x.com',
    user_name: null, user_phone: null, user_id: null,
    payment_mode: 'cash_relais', payment_status: 'pending',
    total_kmf: 50000, total_eur: null, wallet_applied_kmf: 0,
    heures_attente: 12, age_jours: 3,
  };

  it('retourne null si la commande n\'existe pas', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await relayQueries.getOrderDetail(RELAY_USER, '999');
    expect(result).toBeNull();
  });

  it('retourne forbidden=true si le relais ne correspond pas (IDOR)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...BASE_ORDER, relais_id: 99 }] });
    const result = await relayQueries.getOrderDetail(RELAY_USER, '100');
    expect(result).toEqual({ forbidden: true });
  });

  it('admin peut accéder à une commande de n\'importe quel relais', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ...BASE_ORDER, relais_id: 99 }] })
      .mockResolvedValueOnce({ rows: [] }) // items
      .mockResolvedValueOnce({ rows: [] }) // timeline
      .mockResolvedValueOnce({ rows: [] }) // incidents
      .mockResolvedValueOnce({ rows: [] }) // comments
      .mockResolvedValueOnce({ rows: [] }); // sms_log

    const result = await relayQueries.getOrderDetail(ADMIN, '100');
    expect(result.forbidden).toBeUndefined();
    expect(result.order.reference).toBe('CMD-100');
  });

  it('retourne order/client/relais/paiement/items/timeline pour une commande valide', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [BASE_ORDER] })
      .mockResolvedValueOnce({ rows: [{ id: 1, produit_nom: 'Riz', image_url: 'img.jpg', category: 'alimentaire', quantity: 2, price_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ status: 'available', note: null, created_at: '2026-06-10', changed_by_name: 'Admin', changed_by_role: 'admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'open' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, content: 'note' }] })
      .mockResolvedValueOnce({ rows: [{ event: 'available', status: 'sent', sent_at: '2026-06-10', message_preview: 'Colis dispo' }] });

    const result = await relayQueries.getOrderDetail(RELAY_USER, '100');

    expect(result.order).toEqual({
      id: 100, reference: 'CMD-100', status: 'available', pickup_code: '•••-•P1-CK',
      created_at: '2026-06-01', updated_at: '2026-06-10',
      age_jours: 3, heures_attente: 12,
    });
    expect(result.client).toEqual({
      nom: 'Fatima', phone: '+269111', email: 'f@x.com',
      history: { total_orders: 0, total_spent_kmf: 0, problems: 0 },
    });
    expect(result.relais).toEqual({
      nom: 'Relais Moroni', ile: 'Grande Comore', adresse: 'Adresse', phone: '+269000',
    });
    expect(result.paiement).toEqual({
      mode: 'cash_relais', status: 'pending', is_paid: false,
      cash_pending: true, total_kmf: 50000, total_eur: null,
      wallet_applied: 0, bloquant_pour_remise: true,
    });
    expect(result.items).toEqual([{ produit: 'Riz', image: 'img.jpg', category: 'alimentaire', quantity: 2, prix_kmf: 5000 }]);
    expect(result.timeline).toHaveLength(1);
    expect(result.incidents).toEqual([{ id: 1, status: 'open' }]);
    expect(result.comments).toEqual([{ id: 1, content: 'note' }]);
    expect(result.notifications_envoyees).toHaveLength(1);
  });

  it('calcule client_history et is_recurring quand order.user_id est présent', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ...BASE_ORDER, user_id: 5, user_name: 'Fatima U', user_phone: '+269111' }] })
      .mockResolvedValueOnce({ rows: [] }) // items
      .mockResolvedValueOnce({ rows: [] }) // timeline
      .mockResolvedValueOnce({ rows: [] }) // incidents
      .mockResolvedValueOnce({ rows: [] }) // comments
      .mockResolvedValueOnce({ rows: [] }) // sms_log
      .mockResolvedValueOnce({ rows: [{ // client_history
        total_orders: 3, total_spent_kmf: 90000, cancelled: 1, first_order: '2026-01-01',
      }] });

    const result = await relayQueries.getOrderDetail(RELAY_USER, '100');

    expect(result.client.history).toEqual({
      total_orders: 3, total_spent_kmf: 90000, cancelled: 1,
      first_order: '2026-01-01', is_recurring: true,
    });
    const [, params] = db.query.mock.calls[6];
    expect(params).toEqual([5]);
  });

  it('incidents/comments/sms_log restent [] si les tables sont absentes', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [BASE_ORDER] })
      .mockResolvedValueOnce({ rows: [] }) // items
      .mockResolvedValueOnce({ rows: [] }) // timeline
      .mockRejectedValueOnce(new Error('no table'))  // incidents
      .mockRejectedValueOnce(new Error('no table'))  // comments
      .mockRejectedValueOnce(new Error('no table')); // sms_log

    const result = await relayQueries.getOrderDetail(RELAY_USER, '100');
    expect(result.incidents).toEqual([]);
    expect(result.comments).toEqual([]);
    expect(result.notifications_envoyees).toEqual([]);
  });

  it("cherche par reference uniquement quand orderId n'est pas un UUID", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [BASE_ORDER] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await relayQueries.getOrderDetail(RELAY_USER, 'CMD-100');
    const [sql, params] = db.query.mock.calls[0];
    // CMD-100 n'est pas un UUID -> branche reference uniquement
    expect(sql).toContain('o.reference = $1');
    expect(sql).not.toContain('o.id =');
    expect(params).toEqual(['CMD-100']);
  });

  it('cherche par id ET reference quand orderId est un UUID', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [BASE_ORDER] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const uuid = 'e3e70682-c209-4cac-629f-6fbed82c07cd';
    await relayQueries.getOrderDetail(RELAY_USER, uuid);
    const [sql, params] = db.query.mock.calls[0];
    // UUID valide -> branche id::uuid OR reference
    expect(sql).toContain('o.id = $1::uuid OR o.reference = $1');
    expect(params).toEqual([uuid]);
  });
});
