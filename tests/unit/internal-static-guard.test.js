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
const { isInternalStaticPath, internalStaticGuard } = require('../../middleware/internal-static-guard');

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
    ['/boutique/harnais/komerce-test-env-setup.sh', true],
    ['/boutique/harnais/geometry/verify-sticky.js', true],
    ['/boutique/harnais/manifest.json', true],
    ['/boutique/run.sh', true],
    ['/boutique/audit.py', true],
    ['/boutique/installer.exe', true],
  ])('%s est un chemin interne', (p, expected) => {
    expect(isInternalStaticPath(p)).toBe(expected);
  });

  test.each([
    ['/boutique.html', false],
    ['/boutique/index.html', false],
    ['/boutique/css/dist/base.css', false],
    ['/boutique/js/main.js', false],
    ['/manifest.json', false],
    ['/dashboards/canonical/index.html', false],
    ['/images/hero.webp', false],
  ])('%s reste servi', (p, expected) => {
    expect(isInternalStaticPath(p)).toBe(expected);
  });

  test('manifest.json canonique reste servi sans contourner un répertoire interne', () => {
    expect(isInternalStaticPath('/manifest.json')).toBe(false);
    expect(isInternalStaticPath('/boutique/manifest.json')).toBe(false);
    expect(isInternalStaticPath('/boutique/harnais/manifest.json')).toBe(true);
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

  test('un asset applicatif légitime reste servi normalement', async () => {
    const res = await request(buildApp()).get('/app.js');
    expect(res.status).toBe(200);
  });

  test.each(['/boutique/k6/tool.exe', '/boutique/harnais/setup.sh', '/boutique/test.py'])('un outillage interne %s retourne 404 avant le serveur de fichiers', async (blockedPath) => {
    const app = express();
    app.use(internalStaticGuard);
    app.use((_req, res) => res.status(200).send('exposed'));
    const res = await request(app).get(blockedPath);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('exposed');
  });

  test('HEAD est filtré comme GET — express.static répond normalement à HEAD, la règle ne doit pas dépendre de la méthode pour être sûre', async () => {
    const res = await request(buildApp()).head('/README.md');
    expect(res.status).toBe(404);
  });
});
