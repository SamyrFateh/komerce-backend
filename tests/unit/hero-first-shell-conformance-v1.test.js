'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const css = fs.readFileSync(
  path.join(ROOT, 'public/dashboards/canonical/css/hero-first-shell-conformance-v1.css'),
  'utf8'
);
const html = fs.readFileSync(
  path.join(ROOT, 'public/dashboards/canonical/index.html'),
  'utf8'
);

describe('Hero-first shell conformance v1', () => {
  test('les dashboards overview démarrent sur le Hero, sans rangée N2 au-dessus', () => {
    expect(css).toContain('[data-kmc-surface="pilotage"]');
    expect(css).toContain('> .kmc-admin-domain-tabs');
    expect(css).toContain('display: none');
    expect(css).toContain('[data-kmc-surface="operations"]');
    expect(css).toContain('> .kmc-admin-topbar'); 
    expect(css).toContain('position: absolute');
  });

  test('la recherche et le marché appartiennent visuellement à la bande Hero', () => {
    expect(css).toContain('--kmc-hero-search-w: 280px');
    expect(css).toContain('--kmc-hero-market-w: 240px');
    expect(css).toContain('> .kmc-admin-topbar .kmc-admin-market-select');
    expect(css).toContain('top: var(--kmc-hero-controls-top)');
    expect(css).toContain('[data-dashboard-role="hero"]');
  });

  test('la période Commerce rejoint la rangée de contrôles et un feedback vide ne décentre pas le Hero', () => {
    expect(css).toContain('[data-dashboard-role="hero"] > .kmc-decision-toolbar');
    expect(css).toContain('.kmc-workspace-feedback:empty');
    expect(css).toContain('.kmc-cockpit-decisions');
  });

  test('la couche est chargée après le Visual Canon et le Layout Canon', () => {
    const visual = html.indexOf('/dashboards/canonical/css/komerce-visual-canon-v1.css');
    const layout = html.indexOf('/dashboards/canonical/css/komerce-layout-canon-v1.css');
    const shell = html.indexOf('/dashboards/canonical/css/hero-first-shell-conformance-v1.css');
    expect(visual).toBeGreaterThan(-1);
    expect(layout).toBeGreaterThan(visual);
    expect(shell).toBeGreaterThan(layout);
  });

  test('le mobile revient au flux naturel', () => {
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('position: static');
  });
});

describe('Hero-first shell conformance v1 — Commandes', () => {
  test('Commandes (decision dashboard sans classe cockpit) reçoit le même cadre de page', () => {
    expect(css).toContain('[data-kmc-surface="orders"] .kmc-dashboard.kmc-decision-dashboard');
    expect(css).toContain('padding: var(--kmc-layout-page-pad-top, 18px)');
  });
});

describe('Hero-first shell conformance v1 — cadre des contrôles', () => {
  test('les contrôles suivent le cadre de page centré du Hero (écran large) sans capter les clics', () => {
    expect(css).toContain('--kmc-hero-sidebar-w: var(--kmc-shell-sidebar-width, 260px)');
    expect(css).toContain('pointer-events: none');
    expect(css).toContain('flex-wrap: nowrap');
  });
});

describe('Hero-first shell conformance v1 — cadre commun Action Center / Commandes', () => {
  test('Action Center et Commandes plafonnent leur cadre au Layout Canon (comme les cockpits)', () => {
    expect(css).toContain('width: min(100%, var(--kmc-layout-max, 1680px))');
    expect(css).toContain('max-width: none;');
    expect(css).toContain('[data-kmc-surface="action-center"] #canonical-admin-root {\n  box-sizing: border-box;');
  });
});
