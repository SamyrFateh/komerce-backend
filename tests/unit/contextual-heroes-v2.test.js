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
    expect(css).toContain('min-height: 124px');
    expect(css).toContain('Presentation only');
    expect(css).toContain('@media (max-width: 760px)');
  });

  test('la couche V2 est chargée après les thèmes existants', () => {
    const legacy = html.indexOf('/dashboards/canonical/css/canonical-legacy-theme-v1.css');
    const heroes = html.indexOf('/dashboards/canonical/css/contextual-heroes-v2.css');
    expect(legacy).toBeGreaterThan(-1);
    expect(heroes).toBeGreaterThan(legacy);
  });
});
