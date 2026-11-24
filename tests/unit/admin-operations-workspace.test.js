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

describe('QR catalogue for already issued labels — private, read only',()=>{
  const src=require('fs').readFileSync(require('path').join(__dirname,'../../routes/admin-operations-workspace.js'),'utf8');
  test('only authorized Hub receiver can read market-scoped metadata',()=>{
    expect(src).toContain("'/market/:marketCode/labels/index'");
    expect(src).toMatch(/'\/market\/:marketCode\/labels\/index',[\s\S]*?attachHubExecutionCapability\('execution.parcel.receive'\),[\s\S]*?requireHubWorkspaceAction/);
    expect(src).toContain('marketId:req.workspaceMarket.id,limit:80');
    expect(src).toContain("res.set('Cache-Control','private, no-store')");
    expect(src).toContain("return res.status(200).json({ok:true,market:req.workspaceMarket.code,labels})");
  });
  test('existing PDF authorization and issued labels remain unchanged',()=>{
    expect(src).toContain("'/market/:marketCode/labels/articles/:id/pdf'");
    expect(src).toContain("'/market/:marketCode/labels/boxes/:id/pdf'");
    expect(src).toContain('hubLabels.listLabels(db,');
    expect(src).toContain('const {renderHubLabelPdf}=require');
  });
});
