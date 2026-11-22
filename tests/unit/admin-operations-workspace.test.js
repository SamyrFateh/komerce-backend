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

describe('admin-operations-workspace — placement direct en COMBOX (#3900)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../routes/admin-operations-workspace.js'), 'utf8');
  test('le placement transmet la preuve et exige le scan de la COMBOX cible', () => {
    expect(src).toContain("'/market/:marketCode/boxes/:unitId/fill'");
    expect(src).toContain('body.box_reference_scan');
    expect(src).toContain('evidence_method: body.evidence_method, evidence_code: body.evidence_code, evidence_ref: body.evidence_ref');
  });

  test('la fermeture verrouille la COMBOX et refuse une boîte vide', () => {
    expect(src).toContain("'/market/:marketCode/boxes/:unitId/close'");
    expect(src).toContain("unit_type='MARKET_PARCEL' FOR UPDATE");
    expect(src).toContain('if (Number(contents.count) < 1)');
  });
});
