'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

test('U1 garde une seule surface de detail Komerce', () => {
  const rail = fs.readFileSync(path.join(ROOT, 'js/discovery-rail.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  expect(rail).toContain("openModal(ref, { kind, detail })");
  expect(rail).not.toContain('openDiscoveryDetail');
  expect((html.match(/id="k-modal-overlay"/g) || [])).toHaveLength(1);
  expect((html.match(/id="k-modal-discovery-detail"/g) || [])).toHaveLength(1);
});
