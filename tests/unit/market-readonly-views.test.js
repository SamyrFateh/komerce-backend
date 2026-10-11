'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const js = read('public/dashboards/canonical/js/market-readonly-views.js');
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Mon Market — projections en lecture seule (S-3)', () => {
  test('la page Autonomie charge le script externe (CSP-safe) après le module Règlements', () => {
    const html = read('public/dashboards/canonical/market-autonomy.html');
    expect(html).toMatch(/market-settlement\.js\?v=1"><\/script>\s*<script src="\/dashboards\/canonical\/js\/market-readonly-views\.js\?v=1"><\/script>/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  test('consomme exactement les quatre projections existantes, jamais d’écriture ni de Market ID navigateur', () => {
    for (const p of ['performance', 'cost-statement', 'customs-shipments', 'payment-accounts']) {
      expect(code).toContain(`path: '${p}'`);
    }
    expect(code).toContain('/api/market-delegation/markets/${encodeURIComponent(marketCode)}/${view.path}');
    expect(code).toContain("method: 'GET'");
    expect(code).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(code).not.toMatch(/createElement\('(button|input|form|select|textarea)'\)|innerHTML|body:/);
    expect(code).not.toMatch(/market_id|marketId/);
    expect(code).toContain('access.allowedMarkets');
  });

  test('aucun secret ni calcul métier : pas de credentials_ref, pas d’opération arithmétique sur les montants', () => {
    expect(code).not.toMatch(/credentials_ref|verified_by|vault/);
    expect(code).not.toMatch(/\.reduce\(|parseFloat|Math\.(round|floor|ceil)|\*\s*100|\/\s*100/);
  });

  test('capacité absente = section absente ; l’échec reste visible', () => {
    expect(code).toContain('error.status === 403');
    expect(code).toContain("el('div', 'kmc-team-empty', `${error.message}");
  });
});
