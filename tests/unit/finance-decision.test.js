'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

test('file paiements fournisseurs : statuts et motifs affichés en français', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/finance-decision.js'), 'utf8');
  expect(src).toContain("PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED: 'rapprochement à confirmer'");
  expect(src).toContain("unverified: 'non vérifié'");
  expect(src).not.toContain("row.review_reason || null");
});

test('file fournisseurs Finance : rows, empty et not-provided restent distincts', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/finance-decision.js'), 'utf8');
  expect(src).toContain('const supplierState = supplierReviewState(payload);');
  expect(src).toContain("review.section.setAttribute('data-review-state', supplierState.state)");
  expect(src).toContain("if (supplierState.state === 'rows')");
  expect(src).toContain('supplierState.message');
  expect(src).toContain('Non disponible dans cette vue');
  expect(src).toContain('Aucun paiement fournisseur ambigu');
});
