const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'css', 'contextual-heroes-v2.css'),
  'utf8'
);
const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'index.html'),
  'utf8'
);

describe('contextual heroes v2', () => {
  test('chaque grande rubrique possède une signature métier distincte', () => {
    [
      '[data-dashboard-id="commerce"]',
      '[data-dashboard-id="orders"]',
      '[data-dashboard-id="finance"]',
      '[data-dashboard-id="markets"]',
      '.kmc-action-center',
      '[data-workspace-kind="sourcing"]',
      '[data-workspace-kind="purchasing"]',
      '[data-workspace-kind="shipping-customs"]',
      '[data-workspace-kind="accounting"]',
      '[data-workspace-kind="hub-relay"]',
    ].forEach(selector => expect(css).toContain(selector));
  });

  test('le langage visuel reste compact et presentation-only', () => {
    expect(css).toContain('Palette authority lives in komerce-visual-canon-v1.css');
    expect(css).toContain('Presentation only');
    expect(css).toContain('@media (max-width: 760px)');
  });

  test('la couche V2 est chargée après les thèmes existants et avant le canon final', () => {
    const legacy = html.indexOf('/dashboards/canonical/css/canonical-legacy-theme-v1.css');
    const heroes = html.indexOf('/dashboards/canonical/css/contextual-heroes-v2.css');
    expect(legacy).toBeGreaterThan(-1);
    expect(heroes).toBeGreaterThan(legacy);
    const canon = html.indexOf('/dashboards/canonical/css/komerce-visual-canon-v1.css');
    expect(canon).toBeGreaterThan(heroes);
  });
  test('les quatre écrans de référence portent une illustration métier réelle dans la palette Komerce', () => {
    expect(css).toContain('/dashboards/canonical/assets/pilotage-control-tower-hero-gold.svg');
    expect(css).toContain('/dashboards/canonical/assets/commerce-hero-gold.svg');
    expect(css).toContain('/dashboards/canonical/assets/action-center-hero-gold.svg');
    expect(css).toContain('/dashboards/canonical/assets/operations-logistics-hero-gold.svg');
    expect(css).toContain('var(--kmc-brand-gold');
    expect(css).toContain('var(--kmc-brand-navy');
    expect(css).not.toMatch(/#(?:ec4899|db2777|f472b6)/i);
  });

});

describe('contextual-heroes-v2 — canon visuel validé (parité mocks)', () => {
  test('contrat de la feuille', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/contextual-heroes-v2.css'), 'utf8');
    for (const svg of ['pilotage-control-tower-hero-gold.svg','commerce-hero-gold.svg','action-center-hero-gold.svg','operations-logistics-hero-gold.svg']) expect(css).toContain(svg);
    expect(css).toContain('mask-image: linear-gradient(90deg, transparent 0, #000 24%)');
  });
});

test('Commandes et Finance partagent le même mécanisme d\'illustration or que les autres domaines', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/css/contextual-heroes-v2.css'), 'utf8');
  for (const svg of ['orders-hero-gold.svg', 'finance-hero-gold.svg']) {
    expect(css).toContain(svg);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/assets', svg))).toBe(true);
  }
  expect(css).not.toContain('POSITION • RAPPROCHEMENT • CLÔTURE');
  expect(css).not.toContain('01 • 02 • 03 • 04');
});

test('le Hero démarre son illustration sous la rangée de contrôles (recherche / marché)', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/contextual-heroes-v2.css'), 'utf8');
  expect(css).toContain('inset: 34px 0 0 auto;');
});

test('les workspaces empruntent les scènes or des domaines qu\'ils servent, sans légende décorative', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/contextual-heroes-v2.css'), 'utf8');
  expect(css).toContain('.kmc-catalog-decision-overview > .kmc-dashboard-header::before');
  expect(css).toContain('.kmc-pricing-decision-overview > .kmc-dashboard-header::before');
  expect(css).toMatch(/\.kmc-purchasing-workspace\[data-workspace-kind="purchasing"\][^{]*::before \{\s*background: url\('\/dashboards\/canonical\/assets\/orders-hero-gold\.svg'\)/);
  expect(css).toMatch(/\.kmc-operations-workspace\) > \.kmc-workspace-header::after \{\s*content: none;/);
});

test('la page Clients porte l\'illustration Commerce or', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/contextual-heroes-v2.css'), 'utf8');
  expect(css).toMatch(/\.kmc-client-index > \.kmc-workspace-header::before \{\s*background: url\('\/dashboards\/canonical\/assets\/commerce-hero-gold\.svg'\)/);
});

test('Utilisateurs et Providers partagent la scène tour de contrôle, portée par le body', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/contextual-heroes-v2.css'), 'utf8');
  expect(css).toContain('body.kmc-shell-v4:is([data-kmc-surface="users-admin"], [data-kmc-surface="providers-admin"]) #canonical-admin-root > .kmc-workspace-header::before');
});

test('contextual-heroes-v2.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('contextual-heroes-v2.css')).toEqual([]);
});
