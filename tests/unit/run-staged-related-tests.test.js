'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  sourceStem,
  testStem,
  stemsMatch,
  isRootSource,
  isBoutiqueSource,
  isRootUnitTest,
  isBoutiqueUnitTest,
  isSchemaOrMigrationChange,
  contentReferencesSource,
} = require('../../scripts/run-staged-related-tests');

describe('run-staged-related-tests — resolution ciblee', () => {
  test('associe exactement une source a son test homonyme', () => {
    expect(sourceStem('services/suppliers/normalized-product.js')).toBe('normalized-product');
    expect(testStem('tests/unit/normalized-product.test.js')).toBe('normalized-product');
    expect(stemsMatch(
      'services/suppliers/normalized-product.js',
      'tests/unit/normalized-product.test.js',
    )).toBe(true);
  });

  test('n elargit pas artificiellement un stem voisin', () => {
    expect(stemsMatch(
      'public/boutique/js/b-cart.js',
      'public/boutique/tests/unit/cart.test.js',
    )).toBe(false);
  });

  test('classe seulement le code runtime backend dans le workspace racine', () => {
    expect(isRootSource('services/orders.js')).toBe(true);
    expect(isRootSource('routes/orders.js')).toBe(true);
    expect(isRootSource('server.js')).toBe(true);
    expect(isRootSource('scripts/tool.js')).toBe(false);
    expect(isRootSource('public/boutique/js/b-cart.js')).toBe(false);
  });

  test('classe seulement le runtime Boutique JS dans le workspace Boutique', () => {
    expect(isBoutiqueSource('public/boutique/js/b-cart.js')).toBe(true);
    expect(isBoutiqueSource('public/boutique/css/cart.css')).toBe(false);
    expect(isBoutiqueSource('public/boutique/tests/unit/b-cart.test.js')).toBe(false);
  });

  test('separe les tests unitaires locaux des tests integration/E2E', () => {
    expect(isRootUnitTest('tests/unit/normalized-product.test.js')).toBe(true);
    expect(isRootUnitTest('tests/integration/orders.test.js')).toBe(false);
    expect(isBoutiqueUnitTest('public/boutique/tests/unit/b-cart.test.js')).toBe(true);
    expect(isBoutiqueUnitTest('public/boutique/tests/e2e/cart.spec.js')).toBe(false);
  });

  test('reconnait une migration ou le dump schema comme changement structurel non traçable finement', () => {
    expect(isSchemaOrMigrationChange('migrations/221_customs_fabrics_unsold_kmf_numeric.sql')).toBe(true);
    expect(isSchemaOrMigrationChange('docs/db/railway-live-schema.sql')).toBe(true);
    expect(isSchemaOrMigrationChange('services/orders.js')).toBe(false);
    expect(isSchemaOrMigrationChange('docs/db/notes.md')).toBe(false);
  });

  test('detecte un couplage par lecture textuelle (fs.readFileSync) invisible au graphe require()', () => {
    const testContent = `
      const loginSource = fs.readFileSync(
        path.join(__dirname, '../../public/js/login.js'),
        'utf8'
      );
    `;
    expect(contentReferencesSource(testContent, 'public/js/login.js')).toBe(true);
    expect(contentReferencesSource(testContent, 'public/js/checkout.js')).toBe(false);
  });

  test('detecte un chemin construit en segments separes (path.join multi-args) via nom de fichier + tous les dossiers significatifs', () => {
    const testContent = `
      const CANONICAL_ROOT = path.join(ROOT, 'public', 'dashboards', 'canonical');
      const appSource = fs.readFileSync(path.join(CANONICAL_ROOT, 'js', 'app.js'), 'utf8');
    `;
    // 'js' est un segment generique ignore ; 'public'/'dashboards'/'canonical'
    // sont tous presents dans le fichier -> lien retenu.
    expect(contentReferencesSource(testContent, 'public/dashboards/canonical/js/app.js')).toBe(true);
    // 'legacy' n'apparait nulle part dans le fichier -> pas de lien.
    expect(contentReferencesSource(testContent, 'public/dashboards/legacy/js/app.js')).toBe(false);
  });
});
