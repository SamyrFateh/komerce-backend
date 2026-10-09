const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(ROOT, 'public/dashboards/canonical/css/komerce-layout-canon-v1.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/dashboards/canonical/index.html'), 'utf8');
const doctrine = fs.readFileSync(path.join(ROOT, 'docs/doctrine/KOMERCE_LAYOUT_CANON_V1.md'), 'utf8');

describe('Komerce layout canon v1', () => {
  test('fige la géométrie desktop issue des mocks', () => {
    expect(css).toContain('--kmc-layout-page-pad-x: 24px');
    expect(css).toContain('--kmc-layout-page-pad-top: 18px');
    expect(css).toContain('--kmc-layout-gap: 12px');
    expect(css).toContain('--kmc-layout-hero-h: 150px');
    expect(css).toContain('--kmc-layout-attention-h: 104px');
  });

  test('impose Hero puis Attention puis Primary puis Secondary', () => {
    expect(doctrine).toContain('Hero → Attention/KPI → Primary → Secondary');
    expect(css).toContain('[data-dashboard-role="hero"]');
    expect(css).toContain('[data-dashboard-role="attention"]');
    expect(css).toContain('[data-dashboard-role="primary"]');
  });

  test('le sélecteur marché appartient visuellement au Hero', () => {
    expect(css).toContain('.kmc-admin-shell > .kmc-market-context');
    expect(doctrine).toContain('carte Périmètre séparée au-dessus du Hero');
  });

  test('la couche layout est chargée après le visual canon', () => {
    const visual = html.indexOf('/dashboards/canonical/css/komerce-visual-canon-v1.css');
    const layout = html.indexOf('/dashboards/canonical/css/komerce-layout-canon-v1.css');
    expect(visual).toBeGreaterThan(-1);
    expect(layout).toBeGreaterThan(visual);
  });

  test('préserve le responsive sans imposer le viewport desktop au mobile', () => {
    expect(css).toContain('@media (max-width: 1180px)');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('max-height: none');
  });
});
