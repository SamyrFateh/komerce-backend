'use strict';

const fs = require('fs');
const path = require('path');
const source = relative => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

describe('workspace cash confirmation boundary (#2440)', () => {
  const workspace = source('services/operations-workspace.js');
  const route = source('routes/admin-operations-workspace.js');
  const canonical = source('services/payment-cash-confirm.js');
  const start = workspace.indexOf('async function confirmCash(');
  const end = workspace.indexOf('async function assignInventory(', start);
  const action = workspace.slice(start, end);

  test('resolves the order in the server market before any payment mutation', () => {
    expect(action.indexOf('resolveOrderInMarket(')).toBeGreaterThan(-1);
    expect(action.indexOf('resolveOrderInMarket(')).toBeLessThan(action.indexOf('confirmCashByReference('));
    expect(workspace).toContain('o.cash_ref_code');
    expect(action).toContain('order.cash_ref_code');
  });

  test('delegates to canonical controls, never legacy paid-without-collection path', () => {
    expect(action).toContain('confirmCashByReference(');
    expect(action).not.toContain('confirmCashAndCreateParcel(');
    expect(canonical).toContain('prepareCashConfirmation(');
    expect(canonical).toContain('INSERT INTO cash_collections');
    expect(canonical).toContain('finalizeCashConfirmation(');
  });

  test('pending second approval is not presented as paid or HTTP 200', () => {
    expect(action).toContain('result.status === 202 && result.body.pending_second_approval');
    expect(action).toContain("payment_status: 'pending'");
    expect(route).toContain('result.pending_second_approval ? 202 : 200');
  });
});
