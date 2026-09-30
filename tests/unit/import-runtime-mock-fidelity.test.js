'use strict';

/**
 * Cockpit imports — fidélité au mock 1672×941 (#1965) et pulsation unique.
 * Tests de présentation : aucune règle métier, aucun endpoint.
 */

const fs = require('fs');
const path = require('path');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const source = fs.readFileSync(path.join(CANONICAL, 'js', 'import-runtime.js'), 'utf8');
const css = fs.readFileSync(path.join(CANONICAL, 'css', 'import-runtime.css'), 'utf8');

describe('import-runtime — étape courante unique', () => {
  test('le JS désigne une seule étape courante (première étape en cours)', () => {
    expect(source).toContain("stages.findIndex(stage => flowStageMeta(stage).state === 'running')");
    expect(source).toContain("index === currentIndex ? 'is-current' : ''");
    expect(source).toContain('aria-current="step"');
  });

  test("seule .is-current anime le marqueur, tout le reste est neutralisé", () => {
    expect(css).toContain('.kmc-import-runtime .kir-run-flow-step.is-current .kir-run-flow-marker');
    expect(css).toContain('animation:kir-current-step 1.15s ease-in-out infinite !important');
    expect(css).toContain('.kmc-import-runtime .kir-run-flow.is-live .kir-run-flow-marker');
    expect(css).toContain('animation:none !important');
    expect(css).toContain('prefers-reduced-motion:reduce');
  });

  test('le point de la source ne pulse que si Source est courante ou sans flux affiché', () => {
    expect(css).toContain('.kir-run-flow-step.is-current:first-child) .kir-source-pill.is-live .kir-source-dot');
    expect(css).toContain(':not(:has(.kir-run-flow)) .kir-source-pill.is-live .kir-source-dot');
  });
});

describe('import-runtime — fidélité visuelle au mock', () => {
  test('les icônes SVG existent pour les KPI, la synthèse, le statut et l’alerte', () => {
    expect(source).toContain('const ICON_PATHS');
    expect(source).toContain('function ico(name)');
    for (const name of ['file', 'accepted', 'gear', 'tag', 'shield', 'box', 'bookmark', 'chart', 'list', 'flag', 'clock', 'alert']) {
      expect(source).toContain(`${name}:'<`);
    }
    expect(source).toContain("ico('clock')");
    expect(source).toContain("ico('alert')");
  });

  test('les 6 KPI du suivi de lot n’ont pas de filet haut coloré', () => {
    expect(css).toContain('.kmc-import-runtime .kir-run-truth-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))');
    expect(css).toContain('border-top:1px solid #E2E8F0 !important');
  });

  test('les 4 cartes de synthèse ont un filet haut de 3px vert / orange / bleu / neutre', () => {
    expect(css).toContain('.kir-lot-summary>div:nth-child(1){border-top:3px solid #16A34A}');
    expect(css).toContain('.kir-lot-summary>div:nth-child(2){border-top:3px solid #F59E0B}');
    expect(css).toContain('.kir-lot-summary>div:nth-child(3){border-top:3px solid #2563EB}');
    expect(css).toContain('.kir-lot-summary>div:nth-child(4){border-top:3px solid #CBD5E1}');
  });

  test('le flux est orange seulement quand une validation manuelle attend', () => {
    expect(css).toContain('.kmc-import-runtime .kir-run-flow.is-complete{border:1px solid #E2E8F0;border-left:4px solid #16A34A}');
    expect(css).toContain('.kir-run-flow.is-complete.has-manual-action{border-left-color:#F59E0B}');
    expect(css).toContain('.kir-run-flow.is-complete.has-manual-action .kir-run-flow-head em{color:#F59E0B !important}');
  });

  test('les blocs mock-fidelity et animation ciblée restent les derniers du fichier, dans cet ordre', () => {
    const v5 = css.indexOf('V5 FINAL interaction authority');
    const mock = css.indexOf('MOCK-FIDELITY');
    const anim = css.indexOf('ANIMATION CIBLÉE');
    expect(v5).toBeGreaterThan(-1);
    expect(mock).toBeGreaterThan(v5);
    expect(anim).toBeGreaterThan(mock);
    expect(css.indexOf('/* ====', anim + 1)).toBe(-1);
  });
});
