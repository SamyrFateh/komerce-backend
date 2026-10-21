'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

test('entity-360.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('entity-360.css')).toEqual([]);
});

test('entity-360.css : fil de la commande, section Coûts & écarts et ancres décalées sous l’en-tête collant', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/entity-360.css'), 'utf8');
  expect(css).toContain('.kmc-order-thread-step.is-current');
  expect(css).toContain('.kmc-order-costs-links');
  expect(css).toMatch(/#couts, #parcours \{ scroll-margin-top: 96px; \}/);
  // Aucun bleu saturé dominant : l'étape courante est orange (couleur d'action Komerce).
  expect(css).toMatch(/is-current \{ border-color: #fb923c; background: #fff7ed; \}/);
});
