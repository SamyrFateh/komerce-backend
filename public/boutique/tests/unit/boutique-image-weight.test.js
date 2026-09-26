/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(root, 'boutique', 'index.html'), 'utf8');
describe('P-03 — images légères du chrome boutique', () => {
  const files = ['avatar_seule', 'avatar_panier', 'panier_tresse_vert', 'panier_tresse'];
  test.each(files)('%s.webp existe, est un WebP complet et pèse < 20 Ko', (name) => {
    const buf = fs.readFileSync(path.join(root, 'images', `${name}.webp`));
    expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(buf.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(buf.length).toBe(buf.readUInt32LE(4) + 8);
    expect(buf.length).toBeLessThan(20 * 1024);
  });
  test("index.html ne référence plus aucun de ces PNG", () => {
    files.forEach((name) => expect(html).not.toContain(`/images/${name}.png`));
  });
});
