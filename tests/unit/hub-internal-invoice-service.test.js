'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/market-delegation-cost-statement-service', () => ({
  readHubStatement: jest.fn(),
  statementPeriod: jest.fn((from, to) => ({ fromIso: from, toIso: to })),
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
    .resolves.toMatchObject({ ...balance, status: 'ISSUED' });
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
    .resolves.toMatchObject({ status: 'PAID', payment_reference: 'BANK-1' });
  await expect(recordPayment(client([market], [paid]), input)).resolves.toMatchObject({ status: 'PAID' });
  await expect(recordPayment(client([market], [balance]), { ...input, amountKmf: '39999.99' }))
    .rejects.toMatchObject({ code: 'HUB_INVOICE_PAYMENT_MISMATCH' });
  await expect(recordPayment(client([market], []), input)).rejects.toMatchObject({ status: 404 });
});
