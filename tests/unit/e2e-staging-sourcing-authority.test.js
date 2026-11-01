'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockGetClient = jest.fn();
jest.mock('../../db', () => ({
  getClient: (...args) => mockGetClient(...args),
  pool: { end: jest.fn() },
}));
const {ACK, REASON, modeFrom, guard, run} =
  require('../../scripts/e2e-staging-sourcing-authority');

const ENV = Object.freeze({
  KOMERCE_ENV: 'staging',
  RAILWAY_ENVIRONMENT_NAME: 'staging',
  NODE_ENV: 'test',
  E2E_SOURCING_EMAIL: 'sourcing-e2e@example.test',
  E2E_SOURCING_GLOBAL_AUTH_ACK: ACK,
});
const KEEPER_ID = '51eda5e1-b915-4f08-bba6-ba825ee36001';
const TEST_ID = 'test-sourcing-uuid';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetClient.mockResolvedValue({query: mockQuery, release: mockRelease});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('dry-run is the default; mutually exclusive modes fail closed', () => {
  expect(modeFrom([])).toBe('--dry-run');
  expect(modeFrom(['--grant'])).toBe('--grant');
  expect(() => modeFrom(['--grant', '--revoke'])).toThrow('MODE_CONFLICT');
});

test('only Railway staging can issue global grants', () => {
  expect(guard('--grant', ENV)).toBe(ENV.E2E_SOURCING_EMAIL);
  expect(() => guard('--grant', {...ENV, KOMERCE_ENV: 'production'})).toThrow('STAGING_ONLY_GUARD');
  expect(() => guard('--grant', {...ENV, RAILWAY_ENVIRONMENT_NAME: 'production'})).toThrow('STAGING_ONLY_GUARD');
  expect(() => guard('--grant', {...ENV, NODE_ENV: 'production'})).toThrow('STAGING_ONLY_GUARD');
  expect(() => guard('--grant', {...ENV, E2E_SOURCING_GLOBAL_AUTH_ACK: ''})).toThrow('EXPLICIT_TEMPORARY_GRANT_ACK_REQUIRED');
  expect(() => guard('--grant', {...ENV, E2E_SOURCING_EMAIL: ''})).toThrow('SOURCING_IDENTITY_ENV_REQUIRED');
});

function databaseScenario(existing = null, keeper = true) {
  let grant = existing;
  mockQuery.mockImplementation(async (sql, params) => {
    if (/SELECT id, role, password_hash FROM users/.test(sql)) {
      return {rows: [{id: TEST_ID, role: 'sourcing', password_hash: '$2b$12$fixture'}]};
    }
    if (/JOIN sourcing_global_access_grants g/.test(sql)) {
      return {rows: keeper ? [{id: KEEPER_ID}] : []};
    }
    if (/SELECT reason, revoked_at, granted_by/.test(sql)) {
      return {rows: grant ? [grant] : []};
    }
    if (/INSERT INTO sourcing_global_access_grants/.test(sql)) {
      grant = {reason: REASON, revoked_at: null, granted_by: KEEPER_ID};
      return {rows: []};
    }
    if (/UPDATE sourcing_global_access_grants SET revoked_at/.test(sql)) {
      grant = {...grant, revoked_at: 'now'};
      return {rows: []};
    }
    return {rows: []};
  });
}

test('grant is explicit, idempotent, transactional, keeper-authorized and attributed', async () => {
  databaseScenario();
  await expect(run('--grant', ENV)).resolves.toBe('TEMPORARY_GRANT_CREATED');
  const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO sourcing_global_access_grants/.test(sql));
  expect(insert[1]).toEqual([TEST_ID, KEEPER_ID, REASON]);
  expect(mockQuery.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  expect(mockRelease).toHaveBeenCalledTimes(1);
});

test('no canonical keeper => no global grant', async () => {
  databaseScenario(null, false);
  await expect(run('--grant', ENV)).rejects.toThrow('CANONICAL_CENTRAL_KEEPER_NOT_AUTHORIZED');
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO sourcing_global_access_grants/.test(sql))).toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
});

test('revoke affects only our exact temporary grant, never a preexisting authority', async () => {
  databaseScenario({reason: 'real_business_authority', revoked_at: null, granted_by: KEEPER_ID});
  await expect(run('--revoke', ENV)).rejects.toThrow('REFUSE_TO_REVOKE_NON_E2E_GRANT');
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE sourcing_global_access_grants/.test(sql))).toBe(false);
});

test('dry run reads grants but makes no changes', async () => {
  databaseScenario();
  await expect(run('--dry-run', ENV)).resolves.toBe('GLOBAL_GRANT_MISSING');
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO sourcing_global_access_grants/.test(sql))).toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
});
