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
    expect(country).not.toContain('kmc-market-hero-integrated');
    expect(country).not.toContain('controls.appendChild(selector)');
    expect(country).not.toMatch(/cloneNode\(/);
  });

  test('la projection ne duplique plus les décisions locales de la liste éditable', () => {
    const s = source('public/dashboards/canonical/js/markets-decision.js');
    const start = s.indexOf('function renderCountryOverview(');
    const country = s.slice(start, s.indexOf('return Object.freeze', start));
    expect(country).toContain('rankedItems: []');
    expect(country).toContain('metrics: countryMetricItems(workspace, prices)');
  });

  test('le drapeau et la sélection sont uniquement dans la topbar canonique', () => {
    const css = source('public/dashboards/canonical/css/market-autonomy-business-ui.css');
    const workspace = source('public/dashboards/canonical/js/market-autonomy.js');
    const shell = source('public/dashboards/canonical/js/navigation-policy-v4.js');
    const html = source('public/dashboards/canonical/market-autonomy.html');
    expect(css).not.toContain('> .kmc-admin-topbar {');
    expect(css).not.toContain('.kmc-autonomy-hero-controls .kmc-autonomy-selector');
    expect(workspace).not.toContain('renderMarketSelector(');
    expect(shell).toContain("flag.className = 'kmc-admin-market-flag'");
    expect(shell).toContain("select.className = 'kmc-admin-market-select'");
    expect(css).toContain('kmc-autonomy-hero-controls');
    expect(html).toContain('market-autonomy-business-ui.css?v=261102-4');
    expect(html).toContain('market-autonomy.js?v=261102-4');
    expect(html).toContain('markets-decision-bootstrap.js?v=261102-4');
  });
});
