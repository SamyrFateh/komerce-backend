'use strict';

/**
 * Cockpit imports — fidélité au mock 1672×941 (#1965) et pulsation unique.
 * Tests de présentation : aucune règle métier, aucun endpoint.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const source = fs.readFileSync(path.join(CANONICAL, 'js', 'import-runtime.js'), 'utf8');
const css = fs.readFileSync(path.join(CANONICAL, 'css', 'import-runtime.css'), 'utf8');

describe('import-runtime — étape courante unique', () => {
  test('le JS désigne une seule étape courante (première étape en cours)', () => {
    expect(source).toContain("steps.findIndex(step => step.state === 'running')");
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

  test('les 4 résultats du cockpit (reçus, prêts, écartés, action requise) sont réels et cliquables', () => {
    expect(css).toContain('.kmc-import-runtime .kir-run-truth-grid.is-four{grid-template-columns:repeat(4,minmax(0,1fr)) !important}');
    for (const label of ['Produits reçus', 'Prêts pour le Catalogue', 'Écartés automatiquement', 'Action requise']) {
      expect(source).toContain(`['${label}'`);
    }
    for (const gone of ['Entrées source', "['Acceptées'", "['Doublons'", "['En quarantaine'"]) {
      expect(source).not.toContain(gone);
    }
    expect(source).toContain('num(a.duplicates)');
    expect(source).toContain('produits comptabilisés');
    expect(source).not.toContain('Temps restant');
  });

  test('le pipeline N1 a quatre étapes ; les six étapes réelles restent la source de vérité', () => {
    for (const label of ["'Source'", "'Produits reçus'", "'Contrôle automatique'", "'Remise Catalogue'"]) {
      expect(source).toContain(`label:${label}`);
    }
    expect(source).toContain("const CONTROL_STAGES = Object.freeze(['REFINERY', 'TAXONOMY', 'CERTIFICATION'])");
    expect(css).toContain('.kmc-import-runtime .kir-run-flow .kir-run-flow-track{grid-template-columns:repeat(4,minmax(0,1fr))}');
  });

  test('trois commandes humaines, sur les endpoints existants, avec leur présence visuelle', () => {
    for (const label of ['Mettre à jour maintenant', "'Arrêter'", "'Redémarrer'", 'Mise à jour…', 'Arrêt…', 'Redémarrage…']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('/import-now');
    expect(source).toContain("enabled ? 'deactivate' : 'activate'");
    expect(source).not.toMatch(/\/(stop|restart|reset)['`"]/);
    expect(css).toContain('.kmc-import-runtime .kir-cmd-update{background:#1D5CD6');
    expect(css).toContain('.kmc-import-runtime .kir-cmd-stop{background:#3A1218');
    expect(css).toContain('.kmc-import-runtime .kir-cmd-restart{background:#0F3D2A');
  });

  test('l’activité est en phrases métier, sans libellé technique ; le produit courant reste honnête', () => {
    expect(source).toContain('function liveEventDetail(run, event)');
    expect(source).not.toContain('${esc(event.stage)} · ${esc(event.kind)}');
    expect(source).toContain('Dernier produit mis à jour');
    expect(source).not.toContain('Produit actuellement traité');
    expect(source).not.toContain('produits traités</small>');
  });

  test('la page reste transparente sur le fond noir (plus de carte blanche)', () => {
    expect(css).toContain('.kmc-import-runtime .kir-page{background:transparent !important');
  });

  test('ordre canonique LIVE : pipeline → KPI → activité/objet courant, sans zone secondaire empilée', () => {
    const flow = source.indexOf('${persistentRunFlow(run, sourceControls)}');
    const truth = source.indexOf('${runTruthStrip(run)}');
    const progress = source.indexOf('${activationState ? \'\' : runProgressRow(run)}');
    const live = source.indexOf('${renderLiveCore(run)}');
    expect(flow).toBeGreaterThan(-1);
    expect(truth).toBeGreaterThan(flow);
    expect(progress).toBeGreaterThan(truth);
    expect(live).toBeGreaterThan(progress);
    expect(source).not.toContain('data-cockpit-zone="secondary"');
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

describe('import-runtime — doctrine LIVE Operations', () => {
  test('le JS reste syntaxiquement valide', () => {
    expect(() => new vm.Script(source)).not.toThrow();
  });

  test('le niveau 1 expose activité, objet courant et produits récents sans recalcul métier', () => {
    expect(source).toContain('function renderLiveActivity(run)');
    expect(source).toContain('function renderCurrentItem(run)');
    expect(source).toContain('function renderRecentItems(run)');
    expect(source).toContain('run.current_item');
    expect(source).toContain('run.recent_items');
    expect(source).toContain('run.events');
  });

  test('pipeline et KPI ouvrent des drill-downs du même KIR', () => {
    expect(source).toContain('function stageUrl(runRef, stageKey');
    expect(source).toContain('data-cockpit-nav');
    expect(source).toContain('ouvrir le détail');
  });

  test('le cockpit live porte le langage noir dédié aux surfaces opérationnelles', () => {
    expect(css).toContain('LIVE OPS dark authority');
    expect(css).toContain('--kir-bg:#07111F');
    expect(css).toContain('background:#07111F !important');
    expect(source).toContain("data-cockpit-language', 'live-ops'");
  });

  test('la frontière Catalogue est une remise automatique, sans décision prix ni CTA manuelle', () => {
    expect(source).toContain("reason === 'automatic_catalogue_handoff_pending'");
    expect(source).toContain('Remise automatique');
    expect(source).not.toContain('manual_label');
    expect(source).not.toContain('awaiting_explicit_operator_promotion');
  });
});
