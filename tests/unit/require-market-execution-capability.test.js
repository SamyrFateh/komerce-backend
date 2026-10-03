'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockResolveAuthorization = jest.fn();
const mockAudit = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/market-delegation-service', () => ({
  resolveAuthorization: (...args) => mockResolveAuthorization(...args),
  audit: (...args) => mockAudit(...args),
}));

const {
  attachMarketExecutionRoleFor,
  safeResourceParams,
  correlationId,
} = require('../../middleware/require-market-execution-capability');

function res() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function authz(overrides = {}) {
  return {
    market_id: 'market-cm-id',
    market_code: 'CM',
    assignment_id: 'assignment-1',
    membership_id: 'membership-1',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveAuthorization.mockResolvedValue(authz());
  mockAudit.mockResolvedValue(undefined);
});

test('configuration invalide échoue tôt', () => {
  expect(() => attachMarketExecutionRoleFor({
    capability: 'operations.read',
    compatibilityRole: 'agent_hub',
  })).toThrow(/execution capability requise/);

  expect(() => attachMarketExecutionRoleFor({
    capability: 'execution.parcel.ship',
  })).toThrow(/compatibilityRole requis/);
});

test('sans session le bridge refuse 401', async () => {
  const guard = attachMarketExecutionRoleFor({
    capability: 'execution.parcel.ship',
    compatibilityRole: 'agent_hub',
    forceCapability: true,
  });
  const response = res();
  const next = jest.fn();

  await guard({ headers: {}, params: {}, method: 'POST' }, response, next);

  expect(response.statusCode).toBe(401);
  expect(response.body.code).toBe('AUTH_REQUIRED');
  expect(next).not.toHaveBeenCalled();
});

test('mode compatibilité conserve le bypass natif quand il est explicitement autorisé', async () => {
  const guard = attachMarketExecutionRoleFor({
    capability: 'execution.parcel.ship',
    compatibilityRole: 'agent_hub',
    nativeRoles: ['agent_hub'],
  });
  const next = jest.fn();
  const req = { user: { id: 'hub-1', role: 'agent_hub' }, headers: {}, params: {}, method: 'POST' };

  await guard(req, res(), next);

  expect(next).toHaveBeenCalledWith();
  expect(mockResolveAuthorization).not.toHaveBeenCalled();
  expect(mockAudit).not.toHaveBeenCalled();
});

test('forceCapability oblige même admin/agent_hub/agent_relais à prouver la capability exacte', async () => {
  for (const role of ['admin', 'agent_hub', 'agent_relais']) {
    mockResolveAuthorization.mockClear();
    mockAudit.mockClear();
    const guard = attachMarketExecutionRoleFor({
      capability: 'execution.parcel.ship',
      compatibilityRole: 'agent_hub',
      nativeRoles: [role],
      forceCapability: true,
    });
    const next = jest.fn();
    const req = {
      user: { id: `${role}-1`, role, full_name: role },
      workspaceMarket: { id: 'market-cm-id' },
      headers: { 'x-correlation-id': 'corr-1' },
      params: { marketCode: 'CM', reference: 'PCL-CM-001' },
      method: 'POST',
      path: '/x',
    };

    await guard(req, res(), next);

    expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), {
      userId: `${role}-1`,
      marketCode: 'CM',
      requiredCapability: 'execution.parcel.ship',
    });
    expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: `${role}-1`,
      capability: 'execution.parcel.ship',
      action: 'EXECUTION_AUTHORIZED',
      correlationId: 'corr-1',
    }));
    expect(req.user).toMatchObject({
      persisted_role: role,
      role: 'agent_hub',
      role_source: 'market_execution_capability',
      execution_capability: 'execution.parcel.ship',
    });
    expect(req.marketExecution).toMatchObject({
      market_id: 'market-cm-id',
      market_code: 'CM',
      persisted_role: role,
      compatibility_role: 'agent_hub',
    });
    expect(next).toHaveBeenCalledWith();
  }
});

test('preuve sur un autre market id est refusée avant audit', async () => {
  mockResolveAuthorization.mockResolvedValueOnce(authz({ market_id: 'market-cg-id', market_code: 'CG' }));
  const guard = attachMarketExecutionRoleFor({
    capability: 'execution.parcel.ship',
    compatibilityRole: 'agent_hub',
    forceCapability: true,
  });
  const response = res();
  const next = jest.fn();

  await guard({
    user: { id: 'u1', role: 'admin' },
    workspaceMarket: { id: 'market-cm-id' },
    headers: {},
    params: { marketCode: 'CM' },
    method: 'POST',
  }, response, next);

  expect(response.statusCode).toBe(403);
  expect(response.body.code).toBe('MARKET_SCOPE_DENIED');
  expect(mockAudit).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});

test('erreur de délégation connue est rendue telle quelle ; erreur inconnue est propagée', async () => {
  const guard = attachMarketExecutionRoleFor({
    capability: 'execution.parcel.ship',
    compatibilityRole: 'agent_hub',
    forceCapability: true,
  });

  mockResolveAuthorization.mockRejectedValueOnce(Object.assign(new Error('cap missing'), {
    code: 'MARKET_CAPABILITY_REQUIRED',
    status: 403,
  }));
  const knownRes = res();
  const knownNext = jest.fn();
  await guard({
    user: { id: 'u1', role: 'admin' },
    headers: {},
    params: { marketCode: 'CM' },
    method: 'POST',
  }, knownRes, knownNext);
  expect(knownRes.statusCode).toBe(403);
  expect(knownRes.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(knownNext).not.toHaveBeenCalled();

  const boom = new Error('boom');
  mockResolveAuthorization.mockRejectedValueOnce(boom);
  const unknownNext = jest.fn();
  await guard({
    user: { id: 'u1', role: 'admin' },
    headers: {},
    params: { marketCode: 'CM' },
    method: 'POST',
  }, res(), unknownNext);
  expect(unknownNext).toHaveBeenCalledWith(boom);
});

test('helpers bornent correlation id et retirent marketCode des ressources', () => {
  expect(correlationId({ headers: { 'x-correlation-id': 'x'.repeat(300) } })).toHaveLength(200);
  expect(correlationId({ headers: {} })).toBeNull();
  expect(safeResourceParams({
    marketCode: 'CM',
    reference: 'R1',
    itemId: 42,
    nullable: null,
  })).toEqual({
    reference: 'R1',
    itemId: '42',
    nullable: null,
  });
});
