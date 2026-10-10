'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/relay-dashboard-queries.js (R9)
 * db est mocké (aucune connexion réelle).
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const mockCountRelayParcels = jest.fn(() => Promise.resolve({ available: 5, in_transit: 3 }));
jest.mock('../../services/operations-relay-projection', () => ({ countRelayParcels: (...a) => mockCountRelayParcels(...a) }));

const db = require('../../db');
const relayQueries = require('../../services/relay-dashboard-queries');

const ADMIN = { id: 1, role: 'admin', relais_id: null };
const RELAY_USER = { id: 2, role: 'agent_relais', relais_id: 7 };
const MARKET_OPERATOR = { id: 3, role: 'market_operator', relais_id: null };
const MARKETS_KM = new Set(['km-uuid']);

beforeEach(() => { jest.clearAllMocks(); });

describe('getDashboardKPIs', () => {
  const KPI_ROW = {
    en_transit: 3, disponibles: 5, cash_a_encaisser: 2,
    collectes_aujourd_hui: 1, collectes_7j: 10,
    en_attente_72h: 1, total_actives: 8, montant_cash_pending: 30000,
  };

  it('scope la requête KPI par relais_id pour un agent_relais', async () => {
    db.query.mockResolvedValueOnce({ rows: [KPI_ROW] }).mockResolvedValueOnce({ rows: [{ c: 0 }] });
    await relayQueries.getDashboardKPIs(RELAY_USER);
    const [kpiSql, kpiParams] = db.query.mock.calls[0];
    expect(kpiSql).toContain('WHERE relais_id = $1');
    expect(kpiParams).toEqual([7]);
    const [incSql, incParams] = db.query.mock.calls[1];
    expect(incSql).toContain('o.relais_id = $1');
    expect(incParams).toEqual([7]);
    expect(mockCountRelayParcels).toHaveBeenCalledWith({ marketIds: null, relaisId: 7 });
  });

  it('LIVE-06 : en_transit et disponibles viennent de la projection colis unique', async () => {
    db.query.mockResolvedValueOnce({ rows: [KPI_ROW] }).mockResolvedValueOnce({ rows: [{ c: 0 }] });
    const res = await relayQueries.getDashboardKPIs(ADMIN);
    expect(mockCountRelayParcels).toHaveBeenCalledWith({ marketIds: null, relaisId: null });
    expect(res.kpi.disponibles).toBe(5);
    expect(res.kpi.en_transit).toBe(3);
  });

  it('GAP-2 : scope KPI et incidents par market_id pour market_operator', async () => {
    db.query.mockResolvedValueOnce({ rows: [KPI_ROW] }).mockResolvedValueOnce({ rows: [{ c: 0 }] });
    await relayQueries.getDashboardKPIs(MARKET_OPERATOR, { authorizedMarkets: MARKETS_KM });
    expect(db.query.mock.calls[0][0]).toContain('WHERE market_id = ANY($1::uuid[])');
    expect(db.query.mock.calls[0][1]).toEqual([['km-uuid']]);
    expect(db.query.mock.calls[1][0]).toContain('o.market_id = ANY($1::uuid[])');
    expect(db.query.mock.calls[1][1]).toEqual([['km-uuid']]);
  });

  it('GAP-2 : sans scope actif, tableau vide et aucune fuite', async () => {
    db.query.mockResolvedValueOnce({ rows: [KPI_ROW] }).mockResolvedValueOnce({ rows: [{ c: 0 }] });
    await relayQueries.getDashboardKPIs(MARKET_OPERATOR, { authorizedMarkets: null });
    expect(db.query.mock.calls[0][1]).toEqual([[]]);
  });

  it('admin reste global', async () => {
    db.query.mockResolvedValueOnce({ rows: [KPI_ROW] }).mockResolvedValueOnce({ rows: [{ c: 0 }] });
    await relayQueries.getDashboardKPIs(ADMIN);
    expect(db.query.mock.calls[0][0]).not.toContain('WHERE relais_id');
    expect(db.query.mock.calls[0][1]).toEqual([]);
  });
});

describe('getOrders', () => {
  it('scope par relais_id pour agent_relais', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await relayQueries.getOrders(RELAY_USER, {});
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('o.relais_id = $1');
    expect(params).toEqual([7, 50, 0]);
  });

  it('GAP-2 : scope par market_id pour market_operator', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await relayQueries.getOrders(MARKET_OPERATOR, {}, { authorizedMarkets: MARKETS_KM });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('o.market_id = ANY($1::uuid[])');
    expect(params).toEqual([['km-uuid'], 50, 0]);
  });

  it('admin sans scoping relais', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await relayQueries.getOrders(ADMIN, { status: 'available,in_transit', limit: 10, offset: 5 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toContain('o.relais_id = $');
    expect(params).toEqual([['available', 'in_transit'], 10, 5]);
  });
});

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

  it('retourne null si commande absente', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    expect(await relayQueries.getOrderDetail(RELAY_USER, '999')).toBeNull();
  });

  it('IDOR agent_relais', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...BASE_ORDER, relais_id: 99 }] });
    expect(await relayQueries.getOrderDetail(RELAY_USER, '100')).toEqual({ forbidden: true });
  });

  it('GAP-2 : interdit marché hors scope', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...BASE_ORDER, market_id: 'yt-uuid' }] });
    expect(await relayQueries.getOrderDetail(MARKET_OPERATOR, '100', { authorizedMarkets: MARKETS_KM })).toEqual({ forbidden: true });
  });

  it('GAP-2 : accès au détail dans le marché', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ...BASE_ORDER, market_id: 'km-uuid' }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await relayQueries.getOrderDetail(MARKET_OPERATOR, '100', { authorizedMarkets: MARKETS_KM });
    expect(result.order.reference).toBe('CMD-100');
  });

  it('GAP-2 : client_history reste limité aux marchés autorisés', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ...BASE_ORDER, user_id: 5, market_id: 'km-uuid' }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total_orders: 1, total_spent_kmf: 50000, cancelled: 0, first_order: '2026-06-01' }] });
    await relayQueries.getOrderDetail(MARKET_OPERATOR, '100', { authorizedMarkets: MARKETS_KM });
    const [sql, params] = db.query.mock.calls[6];
    expect(sql).toContain('market_id = ANY($2::uuid[])');
    expect(params).toEqual([5, ['km-uuid']]);
  });

  it('client_history agent_relais conserve le contrat historique', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ...BASE_ORDER, user_id: 5 }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total_orders: 3, total_spent_kmf: 90000, cancelled: 1, first_order: '2026-01-01' }] });
    await relayQueries.getOrderDetail(RELAY_USER, '100');
    expect(db.query.mock.calls[6][1]).toEqual([5]);
  });
});

describe('getOrders — filtres, enum et urgence', () => {
  it('compare le statut en texte : la colonne est un enum, pas un text', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await relayQueries.getOrders(ADMIN, { status: 'available' });
    expect(db.query.mock.calls[0][0]).toContain('o.status::text = ANY($1::text[])');
  });

  it('market_operator sans scope actif : liste vide côté SQL, aucune fuite', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await relayQueries.getOrders(MARKET_OPERATOR, {});
    expect(db.query.mock.calls[0][1]).toEqual([[], 50, 0]);
  });

  it('sans statut, limite aux statuts du parcours relais', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await relayQueries.getOrders(ADMIN, {});
    // « Tous les colis » inclut in_transit, comme la tuile du tableau de bord (LIVE-04).
    expect(db.query.mock.calls[0][0]).toContain("o.status IN ('shipped','in_transit','available','collected')");
  });

  it('recherche : ajoute le paramètre ILIKE avant limite et décalage', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await relayQueries.getOrders(ADMIN, { search: 'CMD', limit: 500, offset: -4 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('o.reference ILIKE $1');
    expect(params).toEqual(['%CMD%', 100, 0]);
  });

  it('limite et décalage invalides retombent sur les défauts', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await relayQueries.getOrders(ADMIN, { limit: 'x', offset: 'y' });
    expect(db.query.mock.calls[0][1]).toEqual([50, 0]);
  });

  it.each([
    [130, 'critique'], [80, 'haute'], [30, 'moyenne'], [5, 'normale'],
  ])('urgence d’un colis disponible depuis %i h = %s', async (heures, urgence) => {
    db.query.mockResolvedValueOnce({ rows: [{
      id: 1, status: 'available', total_kmf: '1000', pickup_secret_last4: 'ABCD',
      payment_mode: 'cash_relais', payment_status: 'pending', heures_attente: heures, age_jours: 2.4,
    }] });
    const { orders, total } = await relayQueries.getOrders(ADMIN, {});
    expect(total).toBe(1);
    expect(orders[0]).toMatchObject({ urgence, heures_attente: heures, age_jours: 2, total_kmf: 1000, cash_pending: true });
  });

  it('un colis non disponible reste en urgence normale, payé = pas de cash à encaisser', async () => {
    db.query.mockResolvedValueOnce({ rows: [{
      id: 2, status: 'in_transit', total_kmf: 10, pickup_secret_last4: null,
      payment_mode: 'cash_relais', payment_status: 'paid', heures_attente: 500, age_jours: 1,
    }] });
    const { orders } = await relayQueries.getOrders(ADMIN, {});
    expect(orders[0]).toMatchObject({ urgence: 'normale', cash_pending: false });
  });

  it('mode de paiement non cash : jamais de cash à encaisser', async () => {
    db.query.mockResolvedValueOnce({ rows: [{
      id: 3, status: 'available', total_kmf: 10, payment_mode: 'card', payment_status: 'pending', heures_attente: null, age_jours: 0,
    }] });
    const { orders } = await relayQueries.getOrders(ADMIN, {});
    expect(orders[0]).toMatchObject({ cash_pending: false, heures_attente: 0 });
  });
});

describe('getDashboardKPIs — alertes et incidents', () => {
  const ROW = {
    en_transit: 0, disponibles: 0, cash_a_encaisser: 0, collectes_aujourd_hui: 0, collectes_7j: 0,
    en_attente_72h: 0, total_actives: 0, montant_cash_pending: 0,
  };

  it('alerte danger quand des incidents sont ouverts (admin : requête globale)', async () => {
    db.query.mockResolvedValueOnce({ rows: [ROW] }).mockResolvedValueOnce({ rows: [{ c: 2 }] });
    const res = await relayQueries.getDashboardKPIs(ADMIN);
    expect(db.query.mock.calls[1][1]).toEqual([]);
    expect(res.kpi.incidents_ouverts).toBe(2);
    expect(res.alertes).toEqual([{ type: 'danger', message: '2 incident(s) non résolu(s)' }]);
  });

  it('alertes warning 72 h et info cash', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...ROW, en_attente_72h: 2, cash_a_encaisser: 1, montant_cash_pending: 12500 }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] });
    const res = await relayQueries.getDashboardKPIs(ADMIN);
    expect(res.alertes.map(a => a.type)).toEqual(['warning', 'info']);
  });

  it('une table d’incidents indisponible est une erreur, pas un 0 silencieux', async () => {
    db.query.mockResolvedValueOnce({ rows: [ROW] }).mockRejectedValueOnce(new Error('relation absente'));
    await expect(relayQueries.getDashboardKPIs(ADMIN)).rejects.toThrow('relation absente');
  });

  it('publie l’heure serveur de la lecture (generated_at)', async () => {
    db.query.mockResolvedValueOnce({ rows: [ROW] }).mockResolvedValueOnce({ rows: [{ c: 0 }] });
    const res = await relayQueries.getDashboardKPIs(ADMIN);
    expect(new Date(res.generated_at).toString()).not.toBe('Invalid Date');
  });
});

describe('getOrderDetail — éléments complémentaires', () => {
  const ORDER = {
    id: 100, reference: 'CMD-100', status: 'available', pickup_secret_last4: 'P1CK',
    relais_id: 7, user_id: null, client_nom: null, user_name: null, client_phone: null, user_phone: null, client_email: null,
    payment_mode: 'card', payment_status: 'paid', total_kmf: 100, total_eur: '1.5', wallet_applied_kmf: '20',
    heures_attente: null, age_jours: 1,
  };

  it('accepte une référence, applique les valeurs par défaut, mappe les lignes et tolère les tables absentes', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [{ produit_nom: 'Tee', image_url: 'u', category: 'c', quantity: '2', price_kmf: '50' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'available' }] })
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('y'))
      .mockRejectedValueOnce(new Error('z'));
    const res = await relayQueries.getOrderDetail(ADMIN, 'CMD-100');
    expect(db.query.mock.calls[0][0]).toContain('o.reference = $1');
    expect(db.query.mock.calls[0][0]).not.toContain('::uuid');
    expect(res.client).toMatchObject({ nom: 'Client', phone: '', email: '' });
    expect(res.items).toEqual([{ produit: 'Tee', image: 'u', category: 'c', quantity: 2, prix_kmf: 50 }]);
    expect(res.paiement).toMatchObject({ is_paid: true, cash_pending: false, total_eur: 1.5, wallet_applied: 20 });
    expect(res.order.heures_attente).toBe(0);
    expect(res.incidents).toEqual([]);
    expect(res.comments).toEqual([]);
    expect(res.notifications_envoyees).toEqual([]);
  });

  it('un UUID est cherché par id ou référence ; nom client depuis le compte utilisateur', async () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    db.query
      .mockResolvedValueOnce({ rows: [{ ...ORDER, user_name: 'Ali', user_phone: '+269', payment_mode: 'cash_relais', payment_status: 'pending', total_eur: null, wallet_applied_kmf: 0 }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockResolvedValueOnce({ rows: [{ id: 2 }] }).mockResolvedValueOnce({ rows: [{ event: 'e' }] });
    const res = await relayQueries.getOrderDetail(ADMIN, uuid);
    expect(db.query.mock.calls[0][0]).toContain('o.id = $1::uuid OR o.reference = $1');
    expect(res.client).toMatchObject({ nom: 'Ali', phone: '+269' });
    expect(res.paiement).toMatchObject({ cash_pending: true, bloquant_pour_remise: true, total_eur: null, wallet_applied: 0 });
    expect(res.incidents).toEqual([{ id: 1 }]);
    expect(res.comments).toEqual([{ id: 2 }]);
    expect(res.notifications_envoyees).toEqual([{ event: 'e' }]);
  });

  it('historique client : marché hors scope = tableau vide, client récurrent', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ...ORDER, user_id: 5, market_id: 'km-uuid' }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total_orders: 2, total_spent_kmf: '10.4', cancelled: 0, first_order: 'd' }] });
    const res = await relayQueries.getOrderDetail(MARKET_OPERATOR, '100', { authorizedMarkets: new Set(['km-uuid']) });
    expect(res.client.history).toMatchObject({ total_spent_kmf: 10, is_recurring: true });
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ ...ORDER, user_id: 5, market_id: 'km-uuid' }] });
    expect(await relayQueries.getOrderDetail(MARKET_OPERATOR, '100')).toEqual({ forbidden: true });
  });
});
