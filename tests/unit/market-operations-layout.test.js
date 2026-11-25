'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

test('Opérations répartit les huit KPI sur une grille lisible et responsive', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/dashboards/canonical/css/komerce-layout-canon-v1.css'), 'utf8');
  expect(css).toContain('[data-dashboard-id="operations"] .kmc-metric-strip');
  expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
  expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
});

test('les alertes cash rendent un montant structuré avec sa devise projetée', () => {
  const operations = require('../../public/dashboards/canonical/js/operations');
  const [signal] = operations.projectSignals({ signals: [{
    signal_type: 'cash_expiring', severity: 'warning', title: 'Cash non couvert',
    amount: { value: 5990, unit: 'XAF' }, summary: 'À contrôler',
  }] });
  expect(signal.title).toContain('Cash non couvert');
  expect(signal.title).toContain('5 990 XAF');
});
