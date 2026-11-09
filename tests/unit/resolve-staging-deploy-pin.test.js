'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { decidePin } = require('../../scripts/recette/resolve-staging-deploy-pin');
const A = 'a'.repeat(40); const B = 'b'.repeat(40);

describe('pin de deploiement staging', () => {
  test('SHA identiques : accepte', () => {
    expect(decidePin({ stagingSha: A, headSha: A, isAncestor: true, changedFiles: [] }).decision).toBe('ACCEPTED_EXACT');
  });
  test('ancetre + seulement chemins non deployes : accepte et consigne les fichiers', () => {
    const r = decidePin({ stagingSha: A, headSha: B, isAncestor: true, changedFiles: ['.github/workflows/x.yml', 'docs/a.json', 'tests/unit/t.test.js', 'README.md'] });
    expect(r.decision).toBe('ACCEPTED_NON_DEPLOYED_DIFF_ONLY');
    expect(r.staging_sha).toBe(A); expect(r.head_sha).toBe(B); expect(r.changed_files).toHaveLength(4);
  });
  test('un chemin deploye differe : refuse', () => {
    const r = decidePin({ stagingSha: A, headSha: B, isAncestor: true, changedFiles: ['docs/a.md', 'routes/purchasing.js'] });
    expect(r.decision).toBe('REFUSED'); expect(r.deployed_paths_differing).toEqual(['routes/purchasing.js']);
  });
  test('staging non ancetre de HEAD ou SHA invalide : refuse', () => {
    expect(decidePin({ stagingSha: A, headSha: B, isAncestor: false, changedFiles: [] }).decision).toBe('REFUSED');
    expect(decidePin({ stagingSha: 'unknown', headSha: B, isAncestor: true, changedFiles: [] }).reason).toBe('SHA_INVALID');
  });
  test('pin exact accepte seulement la config native Playwright test non deployee', () => {
    const r = decidePin({stagingSha:A,headSha:B,isAncestor:true,changedFiles:[
      '.github/workflows/staging-relay-local-native-clicks.yml',
      'playwright.staging-relay-local-native.config.js',
      'tests/staging-clicks/local-stock-native-clicks.spec.js',
    ]});
    expect(r.decision).toBe('ACCEPTED_NON_DEPLOYED_DIFF_ONLY');
    expect(r.changed_files).toHaveLength(3);
  });
  test('pin refuse toute autre config Playwright et tout changement runtime', () => {
    for(const candidate of [
      'playwright.staging-relay-local-native.config.js.bak',
      'playwright.staging-other.config.js',
      'public/playwright.staging-relay-local-native.config.js',
      'scripts/recette/resolve-staging-deploy-pin.js',
      'server.js',
    ]) {
      const r=decidePin({stagingSha:A,headSha:B,isAncestor:true,changedFiles:[candidate]});
      expect(r.decision).toBe('REFUSED');
      expect(r.deployed_paths_differing).toContain(candidate);
    }
  });
  test('un fichier .md-like cache dans un chemin deploye ne passe pas par prefixe trompeur', () => {
    expect(decidePin({ stagingSha: A, headSha: B, isAncestor: true, changedFiles: ['services/.github/x.js', 'docsx/y.js'] }).decision).toBe('REFUSED');
  });
});
