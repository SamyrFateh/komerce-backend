'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('operations-control-board-v1.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('operations-control-board-v1.css')).toEqual([]);
});

test('operations-control-board-v1.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('operations-control-board-v1.css')).toEqual([]);
});

test('les listes vides ne réservent pas une grande hauteur et le pipeline actif reste intact', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/operations-control-board-v1.css'), 'utf8');
  expect(css).toContain('.kmc-control-chain.is-empty .kmc-control-order-list');
  expect(css).toContain('.kmc-control-chain.is-empty .kmc-control-stage');
  expect(css).not.toContain('.kmc-control-chain.is-active .kmc-control-order-list { display: none; }');
});
