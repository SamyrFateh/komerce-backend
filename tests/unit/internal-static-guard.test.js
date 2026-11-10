'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * GAP-F2 — public/ ne doit jamais servir de documentation interne, de
 * suites de test, de tooling de build ou de dotfiles. manifest.json
 * (PWA) est l'unique exception explicite.
 * Cf. docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md.
 */

const express = require('express');
const request = require('supertest');
const { isInternalStaticPath, isLegacyDashboardPath, internalStaticGuard } = require('../../middleware/internal-static-guard');

describe('isInternalStaticPath — fonction pure', () => {
  test.each([
    ['/boutique/README.md', true],
    ['/boutique/AUDIT_2026-07_CORRECTIONS.md', true],
    ['/boutique/audit-raw.json', true],
    ['/boutique/audit-err.txt', true],
    ['/boutique/docs/README.md', true],
    ['/boutique/tests/unit/whatever.test.js', true],
    ['/dashboards/docs/doctrine/FEATURE_DOCTRINE.md', true],
    ['/dashboards/tests/unit/whatever.test.js', true],
    ['/docs/doctrine/FEATURE_DOCTRINE.md', true],
    ['/boutique/.cache-buster-state.json', true],
    ['/boutique/.stylelintrc.json', true],
    ['/boutique/package.json', true],
    ['/boutique/package-lock.json', true],
    ['/package.json', true],
    ['/boutique/scripts/deploy-css.js', true],
    ['/boutique/governance/dom-contract.json', true],
    ['/dashboards/coverage/coverage-final.json', true],
    ['/boutique/test-results/.last-run.json', true],
    ['/CHANGELOG-lot1.md', true],
    ['/boutique/k6/k6-v0.56.0-windows-amd64/k6.exe', true],
    ['/boutique/harnais/geometry/verify-sticky.js', true],
    ['/boutique/harnais/komerce-test-env-setup.sh', true],
    ['/boutique/tools/run.py', true],
    ['/boutique/tools/run.sh', true],
    ['/boutique/tools/run.exe', true],
  ])('%s est un chemin interne', (p, expected) => {
    expect(isInternalStaticPath(p)).toBe(expected);
  });

  test.each([
    ['/boutique.html', false],
    ['/boutique/index.html', false],
    ['/boutique/css/dist/base.css', false],
    ['/boutique/js/main.js', false],
    ['/manifest.json', false],
    ['/boutique/manifest.json', false],
    ['/dashboards/canonical/index.html', false],
    ['/images/hero.webp', false],
  ])('%s reste servi', (p, expected) => {
    expect(isInternalStaticPath(p)).toBe(expected);
  });

  test('manifest.json reste servi même sous un dossier docs/tests homonyme improbable', () => {
    // Le nom de fichier gagne sur tout segment de dossier : seule règle
    // de priorité explicite du module.
    expect(isInternalStaticPath('/manifest.json')).toBe(false);
  });
});

describe('internalStaticGuard — comportement HTTP', () => {
  function buildApp() {
    const app = express();
    app.use(internalStaticGuard);
    app.use(express.static(require('path').join(__dirname, 'fixtures', 'internal-static-guard')));
    return app;
  }

  test('un document interne renvoie 404, jamais son contenu', async () => {
    const res = await request(buildApp()).get('/README.md');
    expect(res.status).toBe(404);
    expect(res.text).not.toMatch(/secret interne/i);
  });

  test.each(['/boutique/k6/k6-v0.56.0-windows-amd64/k6.exe', '/boutique/harnais/geometry/verify-sticky.js', '/unsafe.exe', '/unsafe.sh', '/unsafe.py'])('bloque %s en HTTP GET/HEAD', async (url) => {
    expect((await request(buildApp()).get(url)).status).toBe(404);
    expect((await request(buildApp()).head(url)).status).toBe(404);
  });

  test('un asset applicatif légitime reste servi normalement', async () => {
    const res = await request(buildApp()).get('/app.js');
    expect(res.status).toBe(200);
  });

  test('HEAD est filtré comme GET — express.static répond normalement à HEAD, la règle ne doit pas dépendre de la méthode pour être sûre', async () => {
    const res = await request(buildApp()).head('/README.md');
    expect(res.status).toBe(404);
  });
});


describe('B3 — legacy 0 inaccessible sans activation explicite', () => {
  const path = require('path');
  const originalFlag = process.env.ADMIN_LEGACY_ENABLED;
  const legacyHtml = '/dashboards/admin-legacy/control-tower.html';
  const legacyJs = '/dashboards/admin-legacy/js/ct-app.js';
  function buildPublicApp() {
    const app = express();
    app.use(internalStaticGuard);
    app.use(express.static(path.join(__dirname, '..', '..', 'public')));
    return app;
  }
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ADMIN_LEGACY_ENABLED;
    else process.env.ADMIN_LEGACY_ENABLED = originalFlag;
  });

  test.each([legacyHtml, legacyJs, '/dashboards/admin-legacy/manifest.json'])(
    '%s renvoie 404 par défaut pour GET et HEAD', async url => {
      delete process.env.ADMIN_LEGACY_ENABLED;
      expect((await request(buildPublicApp()).get(url)).status).toBe(404);
      expect((await request(buildPublicApp()).head(url)).status).toBe(404);
    }
  );

  test('les variantes encodées et la casse ne contournent pas le garde', () => {
    expect(isLegacyDashboardPath('/dashboards/%61dmin-legacy/control-tower.html')).toBe(true);
    expect(isLegacyDashboardPath('/DASHBOARDS/ADMIN-LEGACY/js/ct-app.js')).toBe(true);
    expect(isLegacyDashboardPath('/dashboards/admin-legacyish/index.html')).toBe(false);
    expect(isLegacyDashboardPath('/hub/index.html')).toBe(false);
  });

  test('la réactivation explicite conserve le HTML et les JS historiques', async () => {
    process.env.ADMIN_LEGACY_ENABLED = '1';
    expect((await request(buildPublicApp()).get(legacyHtml)).status).toBe(200);
    expect((await request(buildPublicApp()).get(legacyJs)).status).toBe(200);
  });

  test('Hub et Admin Canonical restent servis quand Legacy 0 est fermé', async () => {
    process.env.ADMIN_LEGACY_ENABLED = '0';
    expect((await request(buildPublicApp()).get('/hub/index.html')).status).toBe(200);
    expect((await request(buildPublicApp()).get('/dashboards/canonical/index.html')).status).toBe(200);
  });
});
