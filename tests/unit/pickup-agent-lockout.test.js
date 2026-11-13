'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => {
  const query = jest.fn();
  return { query, withTransaction: jest.fn(cb => cb({ query })) };
});
jest.mock('../../services/order-mutation-service', () => ({
  setPickupAttemptsOnly: jest.fn(), setPickupAttemptState: jest.fn(), setCollectedByName: jest.fn(),
}));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
const mockAlert = jest.fn();
jest.mock('../../utils/alerts', () => ({ createAlert: (...a) => mockAlert(...a) }));
jest.mock('../../services/pickup-collection-recorder', () => ({
  recordCanonicalCollection: jest.fn(async () => ({
    parcelId: 'p1', parcelReference: 'P-1', partial: false, orderStatus: 'collected', collectedAt: new Date(), scanId: null,
  })),
  mapCanonicalCollectionError: jest.fn(() => null),
}));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));

const db = require('../../db');
const { hashCode } = require('../../services/pickup-code-helpers');
const { collectByPickupCode } = require('../../services/pickup-collection-service');

const GOOD = 'ABCDEFGH';
const UNKNOWN = 'ZZZZZZZZ';
const SALT = 's';
const AGENT_A = { id: 'a1', role: 'agent_relais' };
const AGENT_B = { id: 'a2', role: 'agent_relais' };
const GOOD_ORDER = { id: 'o1', reference: 'KC1', relais_id: 'r1', pickup_secret_hash: hashCode(GOOD, SALT), pickup_secret_salt: SALT,
  pickup_secret_attempts: 0, pickup_secret_blocked_until: null, pickup_secret_expires_at: null, status: 'available' };

// Faux PostgreSQL minimal : table des échecs en mémoire, horloge pilotable.
let failures; let now;
function install() {
  db.query.mockReset();
  db.query.mockImplementation(async (sql, params) => {
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/FROM pickup_collect_failures/.test(sql) && /ORDER BY/.test(sql)) {
      const rows = failures.filter(f => f.agent === params[0] && f.at > now - params[1] * 60000)
        .sort((x, y) => y.at - x.at).slice(0, params[2]).map(f => ({ created_at: new Date(f.at) }));
      return { rows };
    }
    if (/INSERT INTO pickup_collect_failures/.test(sql)) { failures.push({ agent: params[0], at: now }); return { rows: [] }; }
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: failures.filter(f => f.agent === params[0] && f.at > now - params[1] * 60000).length }] };
    if (/FROM orders o/.test(sql)) return { rows: params[0] === 'ZZZZ' ? [] : [GOOD_ORDER] };
    if (/FROM users WHERE id/.test(sql)) return { rows: [{ relais_id: 'r1' }] };
    return { rows: [] };
  });
}
beforeEach(() => { failures = []; now = 1_000_000_000_000; jest.spyOn(Date, 'now').mockImplementation(() => now); mockAlert.mockClear(); install(); });
afterEach(() => jest.restoreAllMocks());

const tryCode = (user, code) => collectByPickupCode({ code, user });

test('5 codes inconnus : 404 puis 429 au 6e, alerte de verrouillage une fois', async () => {
  for (let i = 0; i < 5; i++) expect((await tryCode(AGENT_A, UNKNOWN)).status).toBe(404);
  const r = await tryCode(AGENT_A, UNKNOWN);
  expect(r.status).toBe(429);
  expect(mockAlert.mock.calls.filter(([, a]) => a.type === 'pickup_collect_agent_locked')).toHaveLength(1);
});

test('verrouillé : même le bon code est refusé', async () => {
  for (let i = 0; i < 5; i++) await tryCode(AGENT_A, UNKNOWN);
  expect((await tryCode(AGENT_A, GOOD)).status).toBe(429);
});

test('un autre agent du même relais n\'est pas bloqué (clé par agent)', async () => {
  for (let i = 0; i < 5; i++) await tryCode(AGENT_A, UNKNOWN);
  expect((await tryCode(AGENT_B, UNKNOWN)).status).toBe(404);
});

test('remise à zéro après la fenêtre de 15 minutes', async () => {
  for (let i = 0; i < 5; i++) await tryCode(AGENT_A, UNKNOWN);
  now += 16 * 60 * 1000;
  expect((await tryCode(AGENT_A, UNKNOWN)).status).toBe(404);
});

test('bon code avant le seuil : remise OK malgré 4 échecs', async () => {
  for (let i = 0; i < 4; i++) await tryCode(AGENT_A, UNKNOWN);
  expect((await tryCode(AGENT_A, GOOD)).status).toBe(200);
});

test('mauvais code ciblé compte aussi dans le verrou agent', async () => {
  for (let i = 0; i < 2; i++) await collectByPickupCode({ code: 'ABCDEFGJ', user: AGENT_A, expectedOrderId: 'o1' });
  expect(failures).toHaveLength(2);
});
