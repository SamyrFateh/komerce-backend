'use strict';

// RED regression contract for #2440. The workspace cash-confirm flow currently
// calls confirmCashAndCreateParcel, which marks paid without recording the
// canonical cash_collections fact. Do not weaken this assertion to go green.
const fs = require('fs');
const path = require('path');

test('workspace cash confirmation uses the canonical controlled cash boundary (#2440)', () => {
  const workspace = fs.readFileSync(path.join(__dirname, '../../services/operations-workspace.js'), 'utf8');
  const legacy = fs.readFileSync(path.join(__dirname, '../../services/parcel-auto-create-service.js'), 'utf8');
  const canonical = fs.readFileSync(path.join(__dirname, '../../services/payment-cash-confirm.js'), 'utf8');
  expect(canonical).toContain('prepareCashConfirmation(');
  expect(canonical).toContain('INSERT INTO cash_collections');
  // This assertion is intentionally red until workspace delegates cash confirmation
  // through the same control boundary, including 2-actor approval and Market scope.
  const start = workspace.indexOf('async function confirmCash(');
  expect(start).toBeGreaterThan(-1);
  const body = workspace.slice(start, workspace.indexOf('\nasync function ', start + 1) < 0 ? undefined : workspace.indexOf('\nasync function ', start + 1));
  expect(body).not.toContain('confirmCashAndCreateParcel(');
  expect(legacy).toContain('async function confirmCashAndCreateParcel(');
});
