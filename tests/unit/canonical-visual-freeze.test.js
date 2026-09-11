'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('canonical visual freeze v1', () => {
  test('la couche de finition est chargée en dernier sur toutes les portes d’entrée Canonical', () => {
    const files = [
      'public/dashboards/canonical/index.html',
      'public/dashboards/canonical/access.html',
      'public/dashboards/canonical/market-autonomy.html',
      'public/dashboards/canonical/market-catalog.html',
    ];

    files.forEach(relative => {
      const html = read(relative);
      const freeze = html.indexOf('/dashboards/canonical/css/visual-freeze-v1.css?v=1701');
      const navigation = html.indexOf('/dashboards/canonical/css/navigation.css');
      expect(freeze).toBeGreaterThan(navigation);
      expect(freeze).toBeGreaterThanOrEqual(0);
    });
  });

  test('le shell, les dashboards et les workspaces partagent une même largeur canonique', () => {
    const css = read('public/dashboards/canonical/css/visual-freeze-v1.css');
    expect(css).toContain('--kmc-shell-max: 1480px');
    expect(css).toContain('.kmc-admin-navigation-inner');
    expect(css).toContain('.kmc-admin-secondary-nav');
    expect(css).toContain('.kmc-dashboard');
    expect(css).toContain('.kmc-operations-workspace');
    expect(css).toContain('[data-canonical-surface="pricing-workspace"]');
    expect(css).toContain('.kmc-workspace');
    expect(css).toContain('.kmc-access-shell');
    expect(css).toContain('.kmc-entity-shell');
  });

  test('N1 reste sombre, N2 devient contextuel clair et le desktop garde une seule ligne tant que possible', () => {
    const css = read('public/dashboards/canonical/css/visual-freeze-v1.css');
    expect(css).toContain('--kmc-freeze-nav: #0f1a2e');
    expect(css).toContain('--kmc-freeze-n2: #f8fafc');
    expect(css).toContain('.kmc-admin-secondary-link.is-active');
    expect(css).toContain('@media (min-width: 1321px) and (max-width: 1660px)');
    expect(css).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
  });

  test('la finition unifie en-têtes, cartes, actions, tables et responsive sans masquer les états métier', () => {
    const css = read('public/dashboards/canonical/css/visual-freeze-v1.css');
    expect(css).toContain('.kmc-dashboard-header');
    expect(css).toContain('.kmc-workspace-header');
    expect(css).toContain('.kmc-decision-card');
    expect(css).toContain('.kmc-metric-card');
    expect(css).toContain('.kmc-workspace-action');
    expect(css).toContain('.kmc-workspace-table-wrap');
    expect(css).toContain('.kmc-ui-state.is-empty');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).not.toMatch(/\.is-(?:critical|warning|positive)\s*\{\s*display\s*:\s*none/);
  });

  test('Catalogue pays ne rend pas un deuxième sélecteur Market ID sous la navigation', () => {
    const css = read('public/dashboards/canonical/css/visual-freeze-v1.css');
    expect(css).toContain('body:has(.kmc-admin-market-select) #market-catalog-root > .kmc-section:has(.kmc-market-context-select)');
    expect(css).toMatch(/#market-catalog-root[^\{]+\{\s*display:\s*none;/s);
  });

  test('les workspaces N2 ne rendent plus de faux retour vers un overview potentiellement interdit', () => {
    const css = read('public/dashboards/canonical/css/visual-freeze-v1.css');
    expect(css).toContain('.kmc-workspace-nav-link:first-child[href="/admin/operations"]');
    expect(css).toContain('.kmc-workspace-nav-link:first-child[href="/admin/finance"]');
    expect(css).toContain('.kmc-workspace-nav:has(> .kmc-workspace-nav-link:only-child[href="/admin/operations"])');
    expect(css).toContain('.kmc-workspace-nav:has(> .kmc-workspace-nav-link:only-child[href="/admin/finance"])');
  });
});
