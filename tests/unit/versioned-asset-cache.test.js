'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * GAP-F4 — un fichier versionné (?v=N) peut être mis en cache
 * indéfiniment, un contenu périmé ne peut jamais être servi puisqu'un
 * nouveau contenu change toujours son ?v=. Le HTML doit rester toujours
 * revalidé. Trouvé en vérifiant en conditions réelles : /boutique.html
 * (et toute route SPA équivalente) ne passe jamais par express.static
 * — aucun fichier de ce nom n'existe sur disque, c'est le catch-all
 * SPA (bootstrap/html-routes.js) qui répond, via sendHtml() qui a déjà
 * son propre no-cache par défaut.
 * Cf. docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md.
 */

const express = require('express');
const request = require('supertest');
const {
  markVersionedRequest,
  buildStaticCacheHeaders,
  staticSetHeaders,
} = require('../../middleware/versioned-asset-cache');

describe('buildStaticCacheHeaders — fonction pure', () => {
  function fakeRes() {
    const headers = {};
    return { headers, setHeader: (k, v) => { headers[k] = v; } };
  }

  test('un .html reste toujours no-cache, même avec ?v= présent', () => {
    const res = fakeRes();
    buildStaticCacheHeaders(res, '/app/public/boutique/index.html', true);
    expect(res.headers['Cache-Control']).toBe('no-cache, no-store, must-revalidate');
    expect(res.headers['Pragma']).toBe('no-cache');
    expect(res.headers['Expires']).toBe('0');
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
  });

  test('un fichier versionné (?v= présent) reçoit un cache long et immuable', () => {
    const res = fakeRes();
    buildStaticCacheHeaders(res, '/app/public/boutique/css/dist/base.css', true);
    expect(res.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  test('le même fichier SANS ?v= ne reçoit aucun cache long — jamais de contenu périmé', () => {
    const res = fakeRes();
    buildStaticCacheHeaders(res, '/app/public/boutique/css/dist/base.css', false);
    expect(res.headers['Cache-Control']).toBeUndefined();
  });

  test('une image versionnée reçoit aussi le cache long (pas seulement CSS/JS)', () => {
    const res = fakeRes();
    buildStaticCacheHeaders(res, '/app/public/images/hero.webp', true);
    expect(res.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });
});

describe('markVersionedRequest — lit req.query.v, jamais son contenu', () => {
  test('présence de ?v= (même vide) → hasVersionParam=true', () => {
    const res = { locals: {} };
    markVersionedRequest({ query: { v: '233' } }, res, () => {});
    expect(res.locals.hasVersionParam).toBe(true);
    markVersionedRequest({ query: { v: '' } }, res, () => {});
    expect(res.locals.hasVersionParam).toBe(true);
  });

  test('absence de ?v= → hasVersionParam=false', () => {
    const res = { locals: {} };
    let calledNext = false;
    markVersionedRequest({ query: {} }, res, () => { calledNext = true; });
    expect(res.locals.hasVersionParam).toBe(false);
    expect(calledNext).toBe(true);
  });
});

describe('Comportement HTTP réel (supertest, fichiers réels sur disque)', () => {
  function buildApp() {
    const app = express();
    app.use(markVersionedRequest);
    app.use(express.static(require('path').join(__dirname, 'fixtures', 'versioned-asset-cache'), {
      setHeaders: staticSetHeaders,
    }));
    return app;
  }

  test('CSS demandé avec ?v= : cache long immuable, contenu correct', async () => {
    const res = await request(buildApp()).get('/style.css?v=42');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  test('même CSS SANS ?v= : pas de cache long', async () => {
    const res = await request(buildApp()).get('/style.css');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).not.toMatch(/immutable/);
  });

  test('HTML avec ?v= reste quand même no-cache — jamais mis en cache long', async () => {
    const res = await request(buildApp()).get('/page.html?v=42');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });
});
