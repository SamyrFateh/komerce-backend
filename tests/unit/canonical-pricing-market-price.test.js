'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const source = fs.readFileSync(
  path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'pricing-workspace-market-price.js'),
  'utf8'
);
const index = fs.readFileSync(
  path.join(ROOT, 'public', 'dashboards', 'canonical', 'index.html'),
  'utf8'
);

test('le sidecar pricing marché est chargé par le Canonical après le workspace principal', () => {
  const baseIndex = index.indexOf('/dashboards/canonical/js/pricing-workspace.js');
  const overlayIndex = index.indexOf('/dashboards/canonical/js/pricing-workspace-market-price.js');
  expect(baseIndex).toBeGreaterThan(-1);
  expect(overlayIndex).toBeGreaterThan(baseIndex);
});

test('la surface n’existe qu’en contexte marché et respecte viewer/manager', () => {
  expect(source).toContain('if (!options.requestedMarket) return;');
  expect(source).toContain('payload.access?.can_decide_prices === true');
  expect(source).toContain("priceInput.disabled = !canDecide");
  expect(source).toContain("duration.disabled = !canDecide");
  expect(source).toContain("rationale.disabled = !canDecide");
  expect(source).toContain("decide.disabled = !canDecide");
});

test('la décision envoie uniquement références métier et choix commercial, jamais market_id', () => {
  expect(source).toContain('/products/${encodeURIComponent(productRef)}/price-decision`');
  expect(source).toContain('price_amount: Number(amount?.value)');
  expect(source).toContain("rationale: rationale?.value || ''");
  expect(source).toContain('duration_days: durationDays');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('product_id');
});

test('le reset retire seulement l’overlay et revient à l’héritage global', () => {
  expect(source).toContain('/price-decision/reset`');
  expect(source).toContain('reset_to_global_from_canonical_workspace');
  expect(source).toContain('Revenir au global');
});

test('la surface explique le gate économique au manager sans exposer de seuil à saisir', () => {
  expect(source).toContain('Le moteur refuse toujours un prix destructif');
  expect(source).toContain('une position sous CDR exige une couverture marché autorisante et une durée explicite');
  expect(source).not.toContain('coverage_threshold');
  expect(source).not.toContain('maturity_threshold');
});
