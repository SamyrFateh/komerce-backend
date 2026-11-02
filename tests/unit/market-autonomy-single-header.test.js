'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * Régression : le marché autonome n'affiche qu'un seul Hero, un seul choix de
 * marché et ne répète pas les produits entre synthèse et liste éditable.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
function source(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

describe('Marché — composition sans doublon', () => {
  test('les actions et le retour utilisateur habitent le Hero existant', () => {
    const s = source('public/dashboards/canonical/js/markets-decision-bootstrap.js');
    const start = s.indexOf('async function renderCountryOverview()');
    const country = s.slice(start, s.indexOf('function boot()', start));
    expect(country).toContain("const hero = overview && overview.querySelector('[data-dashboard-role=\"hero\"]')");
    expect(country).toContain("controls.appendChild(navigation)");
    expect(country).toContain("hero.appendChild(feedback)");
    expect(country).toContain("workspaceHeader.remove()");
    expect(country).toContain("if (selector) controls.appendChild(selector)");
    expect(country).not.toMatch(/cloneNode\(/);
  });

  test('la projection ne duplique plus les décisions locales de la liste éditable', () => {
    const s = source('public/dashboards/canonical/js/markets-decision.js');
    const start = s.indexOf('function renderCountryOverview(');
    const country = s.slice(start, s.indexOf('return Object.freeze', start));
    expect(country).toContain('rankedItems: []');
    expect(country).toContain('metrics: countryMetricItems(workspace, prices)');
  });

  test('la barre transversale est masquée seulement sur cette page', () => {
    const css = source('public/dashboards/canonical/css/market-autonomy-business-ui.css');
    expect(css).toContain('data-kmc-surface="market-autonomy"] > .kmc-admin-topbar');
    expect(css).toContain('kmc-autonomy-hero-controls');
    expect(css).toContain('.kmc-autonomy-hero-controls .kmc-autonomy-selector');
    const html = source('public/dashboards/canonical/market-autonomy.html');
    expect(html).toContain('market-autonomy-business-ui.css?v=261102-2');
    expect(html).toContain('markets-decision-bootstrap.js?v=261102-2');
  });
});
