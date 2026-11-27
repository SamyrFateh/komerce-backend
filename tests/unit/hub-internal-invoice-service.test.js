'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/market-delegation-cost-statement-service', () => ({
  readHubStatement: jest.fn(),
  statementPeriod: jest.fn((from, to) => ({ fromIso: from, toIso: to })),
  projectHubInvoiceBalance: jest.requireActual('../../services/market-delegation-cost-statement-service').projectHubInvoiceBalance,
  hubInvoiceAdjustmentRequired: jest.requireActual('../../services/market-delegation-cost-statement-service').hubInvoiceAdjustmentRequired,
  projectHubAdjustment: jest.requireActual('../../services/market-delegation-cost-statement-service').projectHubAdjustment,
}));
const { readHubStatement } = require('../../services/market-delegation-cost-statement-service');
const { preview, issue, recordPayment } = require('../../services/hub-internal-invoice-service');

const dates = { marketCode: 'CM', from: '2026-10-01', to: '2026-11-01' };
const market = { id: 'cm', code: 'CM', lifecycle_status: 'ACTIVE' };
const balance = { id: '11111111-1111-1111-1111-111111111111', amount_kmf: '40000.00' };
const statement = {
  total_kmf: '40000.00',
  informational_totals: { status: 'AVAILABLE', EUR: { amount: '81.31' }, XAF: { amount: '53334' } },
  lines: [{ attribution_id: 'allocation-1' }],
  truncated: false,
  coverage: {status:'NO_CROSS_PERIOD_ATTRIBUTIONS',cross_period_attribution_count:0},
};

function client(...rows) {
  return { query: jest.fn(async () => ({ rows: rows.shift() || [] })) };
}

beforeEach(() => {
  readHubStatement.mockReset().mockResolvedValue(statement);
});

test('active market issues only the reviewed statement and freezes currency equivalents', async () => {
  const review = await preview(client([market], []), dates);
  expect(review.can_issue).toBe(true);
  const db = client([market], [], [balance]);
  await expect(issue(db, { ...dates, evidenceHash: review.evidence_hash, actorId: 'finance' }))
    .resolves.toMatchObject({ ...balance, status: 'ISSUED',balance:{hub_receivable_kmf:'40000.00',market_payable_kmf:'40000.00'} });
  expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE');
  expect(JSON.parse(db.query.mock.calls[2][1][5])).toEqual(statement);
});

test('suspended market or changed evidence prevents an insert', async () => {
  const { evidence_hash: evidenceHash } = await preview(client([market], []), dates);
  const suspended = client([{ ...market, lifecycle_status: 'SUSPENDED' }], []);
  await expect(issue(suspended, { ...dates, evidenceHash })).rejects.toMatchObject({ status: 409 });
  expect(suspended.query).toHaveBeenCalledTimes(2);

  readHubStatement.mockResolvedValue({ ...statement, lines: [{ attribution_id: 'adjusted' }] });
  const amended = client([market], []);
  await expect(issue(amended, { ...dates, evidenceHash })).rejects.toMatchObject({ code: 'HUB_INVOICE_REVIEW_REQUIRED' });
  expect(amended.query).toHaveBeenCalledTimes(2);
});

test('repeat issue returns the existing invoice; overlapping periods are refused', async () => {
  const { evidence_hash: evidenceHash } = await preview(client([market], []), dates);
  const invoice = { ...balance, evidence_hash: evidenceHash };
  await expect(issue(client([market], [invoice], [invoice]), { ...dates, evidenceHash }))
    .resolves.toMatchObject({ id: balance.id });
  await expect(issue(client([market], [invoice], []), { ...dates, evidenceHash }))
    .rejects.toMatchObject({ status: 409 });
});

test('incoming payment is recorded only against the exact amount and a matching market', async () => {
  const input = { marketCode: 'CM', invoiceId: balance.id, amountKmf: '40000', reference: 'BANK-1', actorId: 'finance' };
  const paid = { ...balance, paid_at: 'today', payment_reference: input.reference };
  await expect(recordPayment(client([market], [balance], [paid]), input))
    .resolves.toMatchObject({ status: 'PAID', payment_reference: 'BANK-1',balance:{hub_receivable_kmf:'0.00',market_payable_kmf:'0.00',settlement_status:'PAYMENT_ATTESTED'} });
  await expect(recordPayment(client([market], [paid]), input)).resolves.toMatchObject({ status: 'PAID' });
  await expect(recordPayment(client([market], [balance]), { ...input, amountKmf: '39999.99' }))
    .rejects.toMatchObject({ code: 'HUB_INVOICE_PAYMENT_MISMATCH' });
  await expect(recordPayment(client([market], []), input)).rejects.toMatchObject({ status: 404 });
});

test('cross-period, unknown coverage and non-positive amounts cannot issue',async()=>{
  for(const candidate of [
    {...statement,coverage:{status:'CROSS_PERIOD_RECONCILIATION_REQUIRED',cross_period_attribution_count:1}},
    {...statement,coverage:{status:'POOL_RECONCILIATION_REQUIRED',cross_period_attribution_count:0}},
    {...statement,coverage:undefined},
    {...statement,total_kmf:'0.00'},
  ]){
    readHubStatement.mockResolvedValue(candidate);
    const reviewed=await preview(client([market],[]),dates);
    expect(reviewed.can_issue).toBe(false);
    const db=client([market],[]);
    await expect(issue(db,{...dates,evidenceHash:reviewed.evidence_hash})).rejects.toMatchObject({code:'HUB_INVOICE_REVIEW_REQUIRED'});
    expect(db.query).toHaveBeenCalledTimes(2);
  }
});
test('late attribution changes are flagged, never silently rewrite an issued invoice',async()=>{
  const invoice={...balance,statement_snapshot:statement,evidence_hash:'a'.repeat(64)};
  readHubStatement.mockResolvedValue({...statement,lines:[{attribution_id:'allocation-2'}]});
  const result=await preview(client([market],[invoice],[invoice]),dates);
  expect(result).toMatchObject({can_issue:false,adjustment_required:true,invoice:{id:balance.id}});
  readHubStatement.mockResolvedValue(statement);
  expect(await preview(client([market],[invoice],[invoice]),dates)).toMatchObject({adjustment_required:false});
});

test('linked adjustment is a signed proposal only; unknown amounts are not zero',async()=>{
  const invoice={...balance,statement_snapshot:statement,evidence_hash:'a'.repeat(64),paid_at:'today'};
  for(const [total,delta] of [['40001.01','1.01'],['39998.99','-1.01']]){
    readHubStatement.mockResolvedValue({...statement,total_kmf:total});
    const result=await preview(client([market],[invoice],[invoice]),dates);
    expect(result).toMatchObject({invoice:{status:'PAID',amount_kmf:'40000.00'},adjustment:{invoice_id:balance.id,status:'REVIEW_REQUIRED',delta_kmf:delta}});
  }
  readHubStatement.mockResolvedValue({...statement,total_kmf:null});
  const result=await preview(client([market],[invoice],[invoice]),dates);
  expect(result.adjustment).toMatchObject({invoice_id:balance.id,status:'RECONCILIATION_REQUIRED',delta_kmf:null});
});
