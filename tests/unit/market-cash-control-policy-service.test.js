'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockResolveAuthorization = jest.fn();
const mockAudit = jest.fn();

jest.mock('../../services/market-delegation-team-service', () => ({
  resolveAuthorization: (...args) => mockResolveAuthorization(...args),
}));
jest.mock('../../services/market-delegation-service', () => ({
  audit: (...args) => mockAudit(...args),
}));

const {
  normalizePolicyInput,
  readMarketCashPolicy,
  updateMarketCashPolicy,
} = require('../../services/market-cash-control-policy-service');

const AUTHZ = Object.freeze({
  assignment_id: '11111111-1111-1111-1111-111111111111',
  membership_id: '22222222-2222-2222-2222-222222222222',
  market_id: '33333333-3333-3333-3333-333333333333',
  market_code: 'CM',
  market_name: 'Cameroun',
  currency: 'XAF',
  capabilities: ['finance.read', 'cash_control.policy.manage'],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveAuthorization.mockResolvedValue(AUTHZ);
  mockAudit.mockResolvedValue(undefined);
});

function captureError(work) {
  try {
    work();
    throw new Error('expected error');
  } catch (error) {
    if (error.message === 'expected error') throw error;
    return error;
  }
}

describe('market cash control policy', () => {
  test('normalise uniquement le contrat local supporté', () => {
    expect(normalizePolicyInput({ cash_enabled: true, confirmation_mode: 'dual_always' }))
      .toEqual({ cash_enabled: true, confirmation_mode: 'DUAL_ALWAYS' });
    const error = captureError(() => normalizePolicyInput({
      cash_enabled: true,
      confirmation_mode: 'SINGLE',
      market_id: 'x',
    }));
    expect(error.code).toBe('CASH_POLICY_FIELD_FORBIDDEN');
  });

  test('la lecture exige finance.read et retourne SINGLE par défaut si aucune politique n’existe', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const result = await readMarketCashPolicy(db, { userId: 'user-1', marketCode: 'CM' });

    expect(mockResolveAuthorization).toHaveBeenCalledWith(db, {
      userId: 'user-1', marketCode: 'CM', requiredCapability: 'finance.read',
    });
    expect(result.policy).toMatchObject({
      assignment_id: AUTHZ.assignment_id,
      market_id: AUTHZ.market_id,
      market_code: 'CM',
      cash_enabled: true,
      confirmation_mode: 'SINGLE',
      source: 'DEFAULT',
    });
  });

  test('la mutation exige cash_control.policy.manage, persiste et audite before/after', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'policy-1',
            assignment_id: AUTHZ.assignment_id,
            market_id: AUTHZ.market_id,
            cash_enabled: true,
            confirmation_mode: 'SINGLE',
            updated_by_membership_id: AUTHZ.membership_id,
            updated_at: '2026-09-10T00:00:00Z',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'policy-1',
            assignment_id: AUTHZ.assignment_id,
            market_id: AUTHZ.market_id,
            cash_enabled: true,
            confirmation_mode: 'DUAL_ALWAYS',
            updated_by_membership_id: AUTHZ.membership_id,
            updated_at: '2026-09-10T00:01:00Z',
          }],
        }),
    };

    const result = await updateMarketCashPolicy(db, {
      userId: 'user-1',
      marketCode: 'CM',
      payload: { cash_enabled: true, confirmation_mode: 'DUAL_ALWAYS' },
      correlationId: 'corr-1',
    });

    expect(mockResolveAuthorization).toHaveBeenCalledWith(db, {
      userId: 'user-1', marketCode: 'CM', requiredCapability: 'cash_control.policy.manage',
    });
    expect(result.policy.confirmation_mode).toBe('DUAL_ALWAYS');
    expect(mockAudit).toHaveBeenCalledWith(db, expect.objectContaining({
      actorUserId: 'user-1',
      assignmentId: AUTHZ.assignment_id,
      membershipId: AUTHZ.membership_id,
      capability: 'cash_control.policy.manage',
      action: 'CASH_CONTROL_POLICY_UPDATED',
      correlationId: 'corr-1',
    }));
  });

  test('aucun market_id ne fait partie des champs de mutation acceptés', () => {
    const error = captureError(() => normalizePolicyInput({
      cash_enabled: true,
      confirmation_mode: 'SINGLE',
      marketId: AUTHZ.market_id,
    }));
    expect(error.code).toBe('CASH_POLICY_FIELD_FORBIDDEN');
  });
});
