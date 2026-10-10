'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/komerce-visual-canon-v1.css'), 'utf8');

test('tokens de marque : plus de or/ivoire/champagne, bordures neutres visibles', () => {
  expect(css).toContain('--kmc-brand-gold: #3B82F6;');
  expect(css).toContain('--kmc-brand-ivory: #F8FAFC;');
  expect(css).toContain('--kmc-brand-line: #D5DCE6;');
  expect(css).not.toMatch(/#C9A227|#E7D7A3|#FFF9F0|#E8DFD1/i);
});

test('hero : dégradé blanc/bleu pâle, sans crème', () => {
  expect(css).not.toContain('rgba(255,249,240');
  expect(css).not.toContain('rgba(231,215,163');
});

test('komerce-visual-canon-v1.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('komerce-visual-canon-v1.css')).toEqual([]);
});
