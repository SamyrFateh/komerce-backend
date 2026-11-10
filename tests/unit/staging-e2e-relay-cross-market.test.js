'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../scripts/recette/target-guard', () => ({ confirmTarget: jest.fn(async () => ({ confirmed: true })) }));
jest.mock('../../services/user-mutation-service', () => ({ assignAgentRelais: jest.fn(async () => ({ status: 'assigned' })) }));
jest.mock('../../scripts/recette/staging-e2e-provision', () => ({ ensureRelayAgentMembership: jest.fn(async () => ({market:'CM'})) }));
jest.mock('../../services/market-delegation-service', () => ({}));
const { reassign } = require('../../scripts/recette/staging-e2e-relay-reassign');
const { assignAgentRelais } = require('../../services/user-mutation-service');
const { ensureRelayAgentMembership } = require('../../scripts/recette/staging-e2e-provision');

const userId = '11111111-1111-4111-8111-111111111111';
const km = '22222222-2222-4222-8222-222222222222';
const cm = '33333333-3333-4333-8333-333333333333';
const oldRelais = '44444444-4444-4444-8444-444444444444';
const newRelais = '55555555-5555-4555-8555-555555555555';
const env = { KOMERCE_ENV: 'staging', KOMERCE_TARGET_ENV: 'staging',
  E2E_AGENT_RELAIS_EMAIL: 'e2e-agent-relais@komerce.test', RELAY_MODE: 'to-fixture', RELAY_RUN8: 'A1B2C3D4' };

function scenario({ targetCode = 'CM', allowed = true, ownerGrant = false } = {}) {
  const steps = [
    { rows: [] }, // BEGIN
    { rows: [{ id: userId, relais_id: oldRelais, role: 'agent_relais' }] },
    { rows: [{ id: newRelais, market_id: cm }] },
    { rows: [{ market_id: km }] },
    { rows: [{ id: km, code: 'KM' }, { id: cm, code: targetCode }] },
    { rows: allowed ? [{ '?column?': 1 }] : [] },
    ...(ownerGrant ? [
      { rows: [{ id: '66666666-6666-4666-8666-666666666666', role: 'admin' }] },
      { rows: [{ '?column?': 1 }] },
    ] : []),
    { rows: [] }, // COMMIT/ROLLBACK
  ];
  const client = { query: jest.fn() };
  for (const row of steps) client.query.mockResolvedValueOnce(row);
  client.release = jest.fn();
  return { db: { getClient: jest.fn(async () => client) }, client };
}

beforeEach(() => jest.clearAllMocks());

test('passage KM vers CM E2E autorisé uniquement avec membership collect existant', async () => {
  const { db, client } = scenario();
  const report = await reassign({ db, env, apply: true });
  expect(report).toMatchObject({ same_market: false, recette_cross_market: true, status: 'assigned', writes: 1 });
  expect(assignAgentRelais).toHaveBeenCalledWith(client, { userId, relaisId: newRelais });
  expect(client.query.mock.calls.some(x => /JOIN membership_capabilities/.test(x[0]))).toBe(true);
  expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
});

test('sans membership du marché cible, aucune assignation', async () => {
  const { db, client } = scenario({ allowed: false });
  await expect(reassign({ db, env, apply: true })).rejects.toThrow('RELAY_E2E_NO_MARKET_MEMBERSHIP');
  expect(assignAgentRelais).not.toHaveBeenCalled();
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});

test('marchés hors KM CM CG refusés même pour compte E2E', async () => {
  const { db, client } = scenario({ targetCode: 'YT' });
  await expect(reassign({ db, env, apply: true })).rejects.toThrow('RELAY_MARKET_MISMATCH');
  expect(assignAgentRelais).not.toHaveBeenCalled();
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});

test('sur staging jetable le proprietaire ajoute uniquement la membership CM via writer canonique', async () => {
  const { db, client } = scenario({ allowed: false, ownerGrant: true });
  const authorized = {
    ...env,
    HUB_V1_STAGING_DISPOSABLE_MODE: '1',
    NODE_ENV: 'test', EXPECTED_RAILWAY_ENVIRONMENT: 'staging',
    GITHUB_REPOSITORY: 'SamyrFateh/komerce-backend',
    GITHUB_EVENT_NAME: 'issues',
    GITHUB_ACTOR: 'SamyrFateh', GITHUB_REPOSITORY_OWNER: 'SamyrFateh',
    E2E_ADMIN_EMAIL: 'admin@komerce.km',
  };
  const report = await reassign({ db, env: authorized, apply: true });
  expect(report).toMatchObject({
    recette_market_membership_granted: 'CM', recette_cross_market: true,
    status: 'assigned',
  });
  expect(ensureRelayAgentMembership).toHaveBeenCalledWith(client,
    expect.objectContaining({delegation:expect.any(Object)}),{
      userId, marketCode: 'CM', actorId: '66666666-6666-4666-8666-666666666666',
    });
  expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
});
