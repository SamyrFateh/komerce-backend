'use strict';
const fs = require('node:fs');
const path = require('node:path');
describe('G6 N26b admin decision surface', () => {
  const html = fs.readFileSync(path.resolve('public/g6-sav-compensation.html'), 'utf8');
  const js = fs.readFileSync(path.resolve('public/js/g6-sav-compensation.js'), 'utf8');
  test('separates read-only proposal from explicit financial decision', () => {
    expect(html).toContain('sav-lookup');
    expect(html).toContain('sav-decision');
    expect(js).toContain('/compensation-proposal');
    expect(js).toContain("'/compensation'");
    expect(js).toContain("actor.role !== 'admin'");
    expect(js).toContain('window.confirm(warning');
  });
  test('does not bypass financial authority or manipulate database/PSP', () => {
    expect(js).not.toMatch(/wallet-service|stripe\.refunds|paypal\.refunds|INSERT INTO|UPDATE wallet/);
    expect(js).toContain("Number.isSafeInteger(amount)");
    expect(js).toContain("out.refund_status");
    expect(js).toContain("button.disabled = true");
  });
});
