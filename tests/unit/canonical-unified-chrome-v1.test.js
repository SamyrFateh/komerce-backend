/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/css/canonical-unified-chrome-v1.css'), 'utf8');

test('menu actif et CTA de recherche suivent la palette orange Komerce', () => {
  expect(css).not.toMatch(/#3B82F6|#2563EB|#60A5FA|#0B3F94|#174EA6|rgb\(59 130 246/i);
  expect(css).toContain('.kmc-admin-reference-submit { background: #EA580C');
});
