'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
test('Operations compacts the chain only when both orders and structural alerts are absent', () => {
  const js = fs.readFileSync(path.join(root, 'js', 'operations-decision.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css', 'operations-control-board-v1.css'), 'utf8');
  expect(js).toContain('columns.some(column => column.orders.length > 0)');
  expect(js).toContain('columns.some(column => column.alerts.length > 0)');
  expect(js).toContain("isEmpty ? 'kmc-control-chain is-empty' : 'kmc-control-chain is-active'");
  expect(js).toContain("data-chain-state");
  expect(css).toContain('.kmc-control-chain.is-empty .kmc-control-order-list');
  expect(css).toContain('.kmc-control-chain.is-empty .kmc-control-stage');
  expect(css).not.toContain('.kmc-control-chain.is-active .kmc-control-order-list { display: none; }');
});
