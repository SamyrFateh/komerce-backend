'use strict';

/**
 * Smoke tests — Vues admin @criticality high (sans dépendance Chart.js/canvas).
 *
 * Objectif (N3 — premier filet de sécurité) : garantir que chaque vue
 * critique se monte sans exception non interceptée, avec un fetch() mocké,
 * et produit un DOM non vide. Ce ne sont pas des tests fonctionnels complets —
 * juste un garde-fou contre les régressions de rendu/crash.
 */

const { loadView, stubFetchOk } = require('../../helpers/loadView');

// [fichier de vue, dépendances supplémentaires, nom global exposé]
const VIEWS = [
  ['AccountingView.js',      [],                                                                                'AccountingView'],
  ['ControlTowerView.js',    [
    'dashboards/admin/js/api-client-unsold.js',
    'dashboards/admin/js/components/KpiCard.js',
    'dashboards/admin/js/components/UI.js',
  ],                                                                                                             'ControlTowerView'],
  ['CustomsView.js',         [],                                                                                'CustomsView'],
  ['HubRelaisView.js',       [],                                                                                'HubRelaisView'],
  ['InvoicesView.js',        ['dashboards/admin/js/components/UI.js'],                                          'InvoicesView'],
  ['OrdersLogisticsView.js', ['dashboards/admin/js/components/KpiCard.js', 'dashboards/admin/js/components/UI.js'], 'OrdersLogisticsView'],
  ['ProblemsView.js',        ['dashboards/admin/js/components/UI.js'],                                          'ProblemsView'],
  ['SharedCartsView.js',     [],                                                                                'SharedCartsView'],
];

describe('Smoke — vues admin critiques (N3)', () => {
  beforeEach(() => {
    stubFetchOk({}); // payload générique ; les vues gèrent les champs manquants via leurs catch internes
  });

  test.each(VIEWS)('%s se monte sans exception et rend du contenu', async (file, extraDeps, globalName) => {
    loadView(file, { extraDeps });

    const View = window[globalName];
    expect(View).toBeDefined();

    const root = document.createElement('div');
    document.body.appendChild(root);

    // ── Détection du pattern d'export (3 variantes dans la codebase) ──────
    // 1. Objet littéral  { render, destroy }  → View.render est une fonction
    // 2. Constructeur    function Foo() { this.render = … }  → new View().render
    // 3. Fonction directe (ex. SharedCartsView = async function render(root){…})
    let renderFn;

    if (typeof View.render === 'function') {
      // Pattern 1 — objet avec .render
      renderFn = View.render.bind(View);
    } else if (typeof View === 'function') {
      // Pattern 2 ou 3 — essayer le constructeur d'abord
      try {
        const instance = new View();
        if (typeof instance.render === 'function') {
          renderFn = instance.render.bind(instance); // Pattern 2 — constructeur
        } else {
          renderFn = View; // Pattern 3 — fonction directe (new échoue ou render absent)
        }
      } catch (_) {
        renderFn = View; // Pattern 3 — appel direct (ex. fonction async non instanciable)
      }
    }

    expect(typeof renderFn).toBe('function');

    await renderFn(root); // si la promesse rejette, le test échoue naturellement

    // Le DOM doit avoir été peuplé (état de chargement, données, ou état d'erreur géré)
    expect(root.innerHTML.trim().length).toBeGreaterThan(0);

    document.body.removeChild(root);
  });
});
