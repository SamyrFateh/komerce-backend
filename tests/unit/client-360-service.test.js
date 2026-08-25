'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const client360 = require('../../services/client-360');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const MARKET_CM = '22222222-2222-4222-8222-222222222222';
const MARKET_CG = '33333333-3333-4333-8333-333333333333';

function resolvedClient() {
  return {
    user_id: USER_ID,
    full_name: 'Amina',
    email: 'amina@example.test',
    phone: '+2691234567',
    country: 'KM',
    normalized_phone: '+2691234567',
  };
}

function installLoadFixtures() {
  db.query.mockImplementation(async (sql, params) => {
    const text = String(sql);

    if (text.includes('WITH scoped_orders AS')) {
      return { rows: [{
        name: 'Amina',
        email: 'amina@example.test',
        phone: '+2691234567',
        country: 'KM',
        orders_total: 3,
        orders_valid: 2,
        orders_cancelled: 1,
        paid_orders: 2,
        unpaid_orders: 1,
        ltv_kmf: 150000,
        average_basket_kmf: 75000,
        first_order_at: '2026-06-01T10:00:00Z',
        last_order_at: '2026-08-20T10:00:00Z',
        days_since_last_order: 5,
      }] };
    }

    if (text.includes('SELECT\n      o.reference')) {
      return { rows: [{
        reference: 'CMD-CM-001',
        status: 'collected',
        payment_status: 'paid',
        payment_mode: 'cash_relais',
        total_kmf: 75000,
        created_at: '2026-08-20T10:00:00Z',
        collected_at: '2026-08-23T10:00:00Z',
        cancelled_at: null,
        market_code: 'CM',
        market_name: 'Cameroun',
        relais_name: 'Relais Centre',
        relais_island: null,
      }] };
    }

    if (text.includes('FROM order_items oi')) {
      return { rows: [{
        name: 'Produit A',
        category: 'Maison',
        quantity: 2,
        revenue_kmf: 50000,
        orders_count: 1,
      }] };
    }

    if (text.includes('SELECT DISTINCT m.code')) {
      return { rows: [{ code: 'CM', name: 'Cameroun', currency: 'XAF' }] };
    }

    if (text.includes('FROM client_notifications n')) {
      return { rows: [{
        event_key: 'order-ready',
        severity: 'important',
        title: 'Commande disponible',
        message: 'Votre commande est disponible',
        status: 'open',
        order_reference: 'CMD-CM-001',
        created_at: '2026-08-23T09:00:00Z',
        acknowledged_at: null,
        resolved_at: null,
      }] };
    }

    if (text.includes('FROM shared_carts sc')) {
      return { rows: [{
        title: 'Anniversaire',
        status: 'OPEN',
        created_at: '2026-07-01T09:00:00Z',
        closed_at: null,
        cancelled_at: null,
        items_count: 4,
        claimed_count: 2,
      }] };
    }

    if (text.includes('FROM webauthn_credentials')) {
      return { rows: [{
        active_count: 1,
        revoked_count: 0,
        last_used_at: '2026-08-24T09:00:00Z',
        first_enrolled_at: '2026-07-15T09:00:00Z',
      }] };
    }

    if (text.includes('FROM users') && text.includes('last_login_at')) {
      return { rows: [{
        role: 'client',
        country: 'KM',
        currency_pref: 'KMF',
        created_at: '2026-05-01T09:00:00Z',
        updated_at: '2026-08-24T09:00:00Z',
        last_login_at: '2026-08-24T08:00:00Z',
      }] };
    }

    throw new Error(`Unexpected SQL in test: ${text.slice(0, 120)} params=${JSON.stringify(params)}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('normalise un téléphone métier sans accepter un identifiant arbitraire', () => {
  expect(client360.normalizePhone(' +269 123-45-67 ')).toBe('+2691234567');
  expect(client360.normalizePhone('(269) 123.45.67')).toBe('2691234567');
  expect(client360.normalizePhone('client-42')).toBeNull();
});

test('resolveClient applique le MarketScope dans la requête avant résolution', async () => {
  db.query.mockResolvedValue({ rows: [{ user_id: USER_ID, phone: '+2691234567' }] });

  const result = await client360.resolveClient('+2691234567', { marketIds: [MARKET_CM] });

  expect(result.invalid).toBe(false);
  expect(result.client.normalized_phone).toBe('+2691234567');
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toContain('o.market_id = ANY($2::uuid[])');
  expect(params).toEqual(['+2691234567', [MARKET_CM]]);
});

test('projection marché filtre toutes les facettes transactionnelles et masque les facettes compte', async () => {
  installLoadFixtures();

  const payload = await client360.loadClient360(resolvedClient(), {
    marketIds: [MARKET_CM],
    includeSecurity: false,
  });

  expect(payload.scope).toEqual({
    mode: 'market',
    markets: [{ code: 'CM', name: 'Cameroun', currency: 'XAF' }],
  });
  expect(payload.shared_lists).toEqual([]);
  expect(payload.security).toEqual({ visibility: 'restricted' });
  expect(payload.summary.shared_lists).toBe(0);
  expect(payload.orders[0].reference).toBe('CMD-CM-001');
  expect(payload.finance.ltv_kmf).toBe(150000);

  const sqlCalls = db.query.mock.calls.map(([sql]) => String(sql));
  expect(sqlCalls.filter(sql => sql.includes('market_id = ANY($2::uuid[])')).length).toBeGreaterThanOrEqual(5);
  expect(sqlCalls.some(sql => sql.includes('FROM shared_carts sc'))).toBe(false);
  expect(sqlCalls.some(sql => sql.includes('FROM webauthn_credentials'))).toBe(false);
});

test('projection globale expose les facettes compte sans publier leurs identifiants techniques', async () => {
  installLoadFixtures();

  const payload = await client360.loadClient360(resolvedClient(), {
    marketIds: null,
    includeSecurity: true,
  });

  expect(payload.scope.mode).toBe('global');
  expect(payload.shared_lists).toHaveLength(1);
  expect(payload.security.visibility).toBe('global');
  expect(payload.security.passkeys.active_count).toBe(1);
  expect(payload.timeline.some(row => row.type === 'security')).toBe(true);

  const json = JSON.stringify(payload);
  [
    USER_ID,
    MARKET_CM,
    MARKET_CG,
    'user_id',
    'order_id',
    'market_id',
    'shared_cart_id',
    'credential_id',
    'public_key',
  ].forEach(forbidden => expect(json).not.toContain(forbidden));
});

test('marketFilter échoue fermé quand aucun marché n’est autorisé', () => {
  expect(client360.marketFilter('o', [], 2)).toEqual({ sql: ' AND FALSE', params: [] });
  expect(client360.marketFilter('o', null, 2)).toEqual({ sql: '', params: [] });
});
