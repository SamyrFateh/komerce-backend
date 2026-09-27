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
  workspaceSourceFiles,
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

  test('classe le runtime Boutique JS et le CSS source (hors bundle dist) dans le workspace Boutique', () => {
    expect(isBoutiqueSource('public/boutique/js/b-cart.js')).toBe(true);
    // Incident 2026-09 (8 suites cassées, dérive silencieuse) : le CSS
    // Boutique doit être un "source" au même titre que le JS, sinon les
    // tests de doctrine qui le lisent en texte (readCss / fs.readFileSync)
    // ne sont jamais sélectionnés par ce gate quand seul du CSS est modifié.
    expect(isBoutiqueSource('public/boutique/css/cart.css')).toBe(true);
    // css/dist est un bundle généré, jamais une source de vérité — même
    // frontière que boutiqueCss dans pr-enforcement-scope.js.
    expect(isBoutiqueSource('public/boutique/css/dist/components.css')).toBe(false);
    expect(isBoutiqueSource('public/boutique/tests/unit/b-cart.test.js')).toBe(false);
  });

  test('scope les sources content-aware au workspace et ne fait pas fuiter Boutique vers le Jest backend', () => {
    const files = [
      'services/orders.js',
      'public/boutique/js/discovery-inquiry.js',
      'public/boutique/tests/unit/discovery-inquiry.test.js',
    ];
    expect(workspaceSourceFiles(files, isRootSource)).toEqual(['services/orders.js']);
    expect(workspaceSourceFiles(files, isBoutiqueSource)).toEqual(['public/boutique/js/discovery-inquiry.js']);
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

  test('un test de doctrine Boutique qui lit du CSS en texte est repere par contentReferencesSource (incident 2026-09)', () => {
    // Reproduit tel quel le pattern de tests/unit/visual-geometry-css-invariants.test.js
    // et tests/unit/boutique-desktop.test.js : lecture via fs.readFileSync,
    // jamais require() — invisible a --findRelatedTests, capte seulement par
    // ce fallback textuel. Avant le fix, ce fallback etait desactive pour le
    // workspace Boutique (contentAware: false), donc un changement CSS pur
    // ne selectionnait jamais ce test malgre ce couplage explicite.
    const testContent = `
      const CSS = path.resolve(__dirname, '../../css');
      function readCss(name) { return fs.readFileSync(path.join(CSS, name), 'utf8'); }
      const desktop = readCss('boutique-desktop.css');
    `;
    expect(contentReferencesSource(testContent, 'public/boutique/css/boutique-desktop.css')).toBe(true);
    expect(contentReferencesSource(testContent, 'public/boutique/css/cart.css')).toBe(false);
  });
});
