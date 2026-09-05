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
