/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/require-market-execution-capability', () => ({
  attachMarketExecutionRoleFor: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/require-market-delegated-capability', () => ({
  requireMarketDelegatedCapability: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(),
}));
jest.mock('../../services/operations-workspace', () => ({
  OperationsWorkspaceError: class OperationsWorkspaceError extends Error {},
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn() }),
}));

const { _test } = require('../../routes/admin-operations-workspace');

function responseDouble() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('admin operations workspace cash HTTP contract', () => {
  test('first approval stays pending and returns HTTP 202', () => {
    const res = responseDouble();
    const result = {
      reference: 'ORD-CASH-1',
      payment_status: 'pending',
      pending_second_approval: true,
    };

    _test.sendCashConfirmationResult(res, result);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      action: 'confirm_cash',
      result,
    });
  });

  test('completed canonical confirmation returns HTTP 200', () => {
    const res = responseDouble();
    const result = {
      reference: 'ORD-CASH-1',
      payment_status: 'paid',
      cash_control: { status: 'confirmed' },
    };

    _test.sendCashConfirmationResult(res, result);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      action: 'confirm_cash',
      result,
    });
  });
});

describe('admin-operations-workspace — dépôt en sac MANUAL accepté (#3900)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../routes/admin-operations-workspace.js'), 'utf8');
  test('la route transmet la provenance réelle et ne refuse plus MANUAL', () => {
    expect(src).not.toContain('HUB_BAG_MANUAL_APPROVAL_REQUIRED');
    expect(src).toContain("body.evidence_method !== 'SCAN' && body.evidence_method !== 'MANUAL'");
    expect(src).toContain('evidence_ref:body.evidence_ref');
  });
});
