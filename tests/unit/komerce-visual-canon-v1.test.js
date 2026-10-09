const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(ROOT, 'public/dashboards/canonical/css/komerce-visual-canon-v1.css'), 'utf8');
const heroes = fs.readFileSync(path.join(ROOT, 'public/dashboards/canonical/css/contextual-heroes-v2.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/dashboards/canonical/index.html'), 'utf8');
const doctrine = fs.readFileSync(path.join(ROOT, 'docs/doctrine/KOMERCE_VISUAL_CANON_V1.md'), 'utf8');

describe('Komerce visual canon v1', () => {
  test('fige Navy + Or/Champagne + Ivoire comme langage de marque', () => {
    expect(css).toContain('--kmc-brand-navy: #071A3D');
    expect(css).toContain('--kmc-brand-gold: #C9A227');
    expect(css).toContain('--kmc-brand-champagne: #E7D7A3');
    expect(css).toContain('--kmc-brand-ivory: #FFF9F0');
  });

  test('réserve les couleurs fortes aux états métier', () => {
    expect(css).toContain('--kmc-state-critical: #DC2626');
    expect(css).toContain('--kmc-state-warning: #D97706');
    expect(css).toContain('--kmc-state-positive: #16A34A');
    expect(doctrine).toContain("Une couleur d'état ne sert jamais à décorer un Hero");
  });

  test('la couche canonique est chargée après les thèmes historiques', () => {
    const legacy = html.indexOf('/dashboards/canonical/css/canonical-legacy-theme-v1.css');
    const contextual = html.indexOf('/dashboards/canonical/css/contextual-heroes-v2.css');
    const canon = html.indexOf('/dashboards/canonical/css/komerce-visual-canon-v1.css');
    expect(legacy).toBeGreaterThan(-1);
    expect(contextual).toBeGreaterThan(legacy);
    expect(canon).toBeGreaterThan(contextual);
  });

  test('les heroes sont reliés aux tokens canon et couvrent les domaines clés', () => {
    expect(heroes).toContain('var(--kmc-brand-gold)');
    expect(heroes).toContain('var(--kmc-brand-navy');
    expect(heroes).toContain('[data-dashboard-id="commerce"]');
    expect(heroes).toContain('[data-dashboard-id="finance"]');
    expect(heroes).toContain('.kmc-action-center');
    expect(heroes).toContain('[data-workspace-kind="purchasing"]');
    expect(heroes).toContain('[data-workspace-kind="shipping-customs"]');
  });
});

describe('komerce-visual-canon-v1 — canon visuel validé (parité mocks)', () => {
  test('contrat de la feuille', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/komerce-visual-canon-v1.css'), 'utf8');
    expect(css).toContain('--metric-accent');
    expect(css).toContain('#071A3D');
  });
});

test('le canon des cartes KPI couvre aussi les decision dashboards (Commandes)', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/komerce-visual-canon-v1.css'), 'utf8');
  expect(css).toContain(':is(.kmc-domain-cockpit, .kmc-action-center, .kmc-decision-dashboard) .kmc-metric-card');
});
