'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '../../public/dashboards/canonical/css/import-runtime.css'), 'utf8');

describe('import-runtime.css — le menu latéral appartient à la coque standard', () => {
  test('aucune règle :has(.kmc-import-runtime) ne redessine le menu ni le décalage de page', () => {
    const rules = css.match(/[^{}]*:has\(\.kmc-import-runtime\)[^{}]*\{[^{}]*\}/g) || [];
    const offenders = rules.filter((r) => /kmc-admin-(navigation|primary|home|secondary-link|account|settings-link|logout|utility-nav|capability-group-label)|padding-left|sidebar-width/.test(r));
    expect(offenders).toEqual([]);
  });

  test('les libellés d’étape du flux Sourcing reprennent la typographie de Hub / Relais (visuel seul)', () => {
    expect(css).toContain('.kmc-import-runtime .kir-run-flow .kir-run-flow-step strong{text-transform:uppercase');
  });

  test('le flux Sourcing porte des anneaux d’état (fait / en cours / attente) comme la chaîne Hub / Relais', () => {
    expect(css).toContain('.kir-run-flow-step.is-completed .kir-run-flow-marker{box-shadow:0 0 0 5px');
    expect(css).toContain('.kir-run-flow-step.is-pending{opacity:.72}');
  });
});


test('Sourcing conserve un seul rail Suivi / Passages / Sources lorsque le shell le porte', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/import-runtime.js'), 'utf8');
  expect(source).toContain('function domainNav()');
  expect(source).toContain('data-sourcing-single-screen');
  expect(source).toContain("return '';");
});

test('Sourcing remet les brouillons au Catalogue global sans promettre une vente', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/import-runtime.js'), 'utf8');
  expect(source).toContain('Retenus par Sourcing');
  expect(source).toContain('Retenus Sourcing');
  expect(source).toContain('/admin/workspaces/catalog?product_ref=');
  expect(source).toContain('Compléter dans le Catalogue global');
});

test('manual source update navigates to the actual returned KIR, never a guessed passage', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/import-runtime.js'), 'utf8');
  const handler = source.split('async function updateSourceNow(root, sourceRef) {')[1]
    .split('// ── Registre opérateur')[0];
  expect(handler).toContain('const runRef = response?.result?.run_ref;');
  expect(handler).toContain('if (runRef) goto(urlFor(runRef));');
  expect(handler).toContain('Aucune référence de passage retournée');
});

test('Sourcing Live : bande KPI agrégée des passages, lecture seule, non disponible jamais zéro', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/import-runtime.js'), 'utf8');
  expect(src).toContain('function passagesKpis(sourceControls, lots)');
  expect(src).toContain("const NA = 'Non disponible';");
  expect(src).toContain("['candidates', 'Candidats détectés', NA, 'agrégat non fourni par le serveur']");
  expect(src).toContain('renderPassages(run, payload?.passages, payload?.passages_page, payload?.source_controls, payload?.lots)');
});

test('les rejets historiques pour FX ont une remédiation lisible directement sur la population écartée', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/import-runtime.js'), 'utf8');
  expect(source).toContain('function fxRemediation(run)');
  expect(source).toContain("run?.diagnostics?.reject_reasons");
  expect(source).toContain("run?.diagnostics?.fx_pending");
  expect(source).toContain("data-fx-remediation");
  expect(source).toContain("/admin/workspaces/pricing#fx-authority");
  expect(source).toContain("Après récupération du cours officiel, relancez la source");
  expect(source).toContain("kind === 'discarded' || kind === 'deferred'");
});
