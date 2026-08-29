'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const { BUNDLES } = require('../../scripts/css-bundles.js');
const live = require('../../scripts/gen-boutique-arch-live.js');

const ROOT = path.resolve(__dirname, '..', '..');
const CSS_DIR = path.join(ROOT, 'css');
const GENERATOR = path.join(ROOT, 'scripts', 'gen-boutique-arch-live.js');

describe('Architecture LIVE Boutique — vérité canonique des bundles', () => {
  test('toutes les sources CSS sur disque appartiennent à au moins un bundle canonique', () => {
    const inventory = live.inventoryCss();
    const orphans = inventory.rows.filter(row => row.orphan).map(row => row.file);

    expect(orphans).toEqual([]);
    expect(inventory.missingSources).toEqual([]);
  });

  test('l’inventaire est dérivé de css-bundles.js, pas du wrapper historique bundle-css.js', () => {
    const source = fs.readFileSync(GENERATOR, 'utf8');

    expect(source).toMatch(/require\(['"]\.\/css-bundles\.js['"]\)/);
    expect(source).not.toMatch(/BUNDLER\s*=|readFileSync\([^\n]*bundle-css\.js/);
  });

  test('le snapshot reflète exactement les sources déclarées dans BUNDLES', () => {
    const expected = new Set(BUNDLES.flatMap(bundle => bundle.files));
    const onDisk = new Set(
      fs.readdirSync(CSS_DIR)
        .filter(file => file.endsWith('.css'))
        .map(file => file.replace(/\.css$/, ''))
    );

    expect(onDisk).toEqual(expected);
  });

  test('le rendu LIVE annonce explicitement zéro faux orphelin et zéro source manquante', () => {
    const markdown = live.render();

    expect(markdown).toContain('0 orphelin(s), 0 source(s) bundle manquante(s)');
    expect(markdown).not.toContain('🔴 **ORPHELIN**');
  });

  test('importer le générateur ne déclenche pas d’écriture documentaire implicite', () => {
    const source = fs.readFileSync(GENERATOR, 'utf8');

    expect(source).toMatch(/if \(require\.main === module\) writeLiveDoc\(\);/);
  });
});
