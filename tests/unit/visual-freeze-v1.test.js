'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'css', 'visual-freeze-v1.css'), 'utf8');

test('visual-freeze-v1 garde ses tokens et ses règles responsive après élagage des déclarations mortes', () => {
  expect(css).toContain('--kmc-freeze-nav: #0f1a2e');
  expect(css).toContain('@media (min-width: 1321px) and (max-width: 1660px)');
  expect(css).toContain('@media (max-width: 720px)');
});

test('visual-freeze-v1.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('visual-freeze-v1.css')).toEqual([]);
});
