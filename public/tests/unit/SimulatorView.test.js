'use strict';

/**
 * tests/unit/SimulatorView.test.js
 *
 * admin/js/views/SimulatorView.js (364L) — Vue Simulateur métier /admin/simulator.
 * Export réel : window.SimulatorView = async function render(root) {...}
 * (fonction bare, PAS un objet {render} — loadView() la normalise).
 *
 * API (globals mockés) :
 *   - KmcApi.simStatus()   (catché localement en cascade — jamais throw)
 *   - KmcApi.simStart(config) / simStop() / simCleanup() / simJournal()
 */

const { loadView, makeKmcApi, cleanupGlobals, mockConfirm, mockAlert, flush } = require('./helpers/dashboardTestKit');

function stoppedStatus(overrides) {
  return Object.assign({ running: false, tick_count: 0, orders_tracked: 0 }, overrides);
}

function runningStatus(overrides) {
  return Object.assign({
    running: true, tick_count: 5, orders_tracked: 12,
    config: { cadence_minutes: 3, chaos_level: 0.2 },
    stats: { transitions_ok: 10, errors: 0, completed: 4, chaos_events: 1 },
  }, overrides);
}

describe('SimulatorView', () => {
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
  });

  afterEach(() => {
    cleanupGlobals('KmcApi');
    document.getElementById('simv-styles')?.remove();
    delete window.alert;
    delete window.confirm;
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      simStatus: jest.fn().mockResolvedValue(stoppedStatus()),
      simStart: jest.fn().mockResolvedValue({}),
      simStop: jest.fn().mockResolvedValue({}),
      simCleanup: jest.fn().mockResolvedValue({ message: 'Nettoyage terminé' }),
      simJournal: jest.fn().mockResolvedValue({ entries: [] }),
    }, overrides));
  }

  function loadIt() {
    return loadView('../../admin/js/views/SimulatorView.js', 'SimulatorView', { skipBaseDeps: true });
  }

  it('expose une fonction render (contrat app.js#invokeView, normalisée par loadView)', () => {
    setupApi();
    const View = loadIt();
    expect(typeof View.render).toBe('function');
  });

  it('injecte les styles une seule fois', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    expect(document.querySelectorAll('#simv-styles').length).toBe(1);
    await View.render(main);
    expect(document.querySelectorAll('#simv-styles').length).toBe(1);
  });

  it('appelle simStatus() et affiche la bannière "arrêtée" par défaut', async () => {
    const api = setupApi();
    const View = loadIt();
    await View.render(main);
    expect(api.simStatus).toHaveBeenCalled();
    expect(main.querySelector('.simv-banner.stopped')).toBeTruthy();
    expect(main.textContent).toContain('Simulation arrêtée');
    expect(main.querySelector('#simv-start')).toBeTruthy();
    expect(main.querySelector('#simv-stop')).toBeNull();
  });

  it('simStatus() rejeté (catch en cascade) → fallback état arrêté, pas de crash', async () => {
    setupApi({ simStatus: jest.fn().mockRejectedValue(new Error('boom')) });
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('.simv-banner.stopped')).toBeTruthy();
  });

  it('état arrêté : affiche le formulaire de config avec valeurs par défaut', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('#simv-cadence').value).toBe('3');
    expect(main.querySelector('#simv-max').value).toBe('20');
    expect(main.querySelector('#simv-chaos').value).toBe('0.2');
    expect(main.querySelectorAll('.simv-cb').length).toBeGreaterThan(0);
  });

  it('scénarios cochés par défaut correspondent à `checked: true` dans SCENARIOS', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    const checked = [...main.querySelectorAll('.simv-cb:checked')].map(cb => cb.value);
    expect(checked).toEqual(expect.arrayContaining(['nominal', 'late_cash', 'abandoned', 'cancelled']));
    const unchecked = [...main.querySelectorAll('.simv-cb:not(:checked)')].map(cb => cb.value);
    expect(unchecked).toEqual(expect.arrayContaining(['express', 'customs_delay']));
  });

  it('état "running" : pas de formulaire de config, bouton Arrêter présent, méta affichée', async () => {
    setupApi({ simStatus: jest.fn().mockResolvedValue(runningStatus()) });
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('.simv-banner.running')).toBeTruthy();
    expect(main.querySelector('#simv-start')).toBeNull();
    expect(main.querySelector('#simv-stop')).toBeTruthy();
    expect(main.querySelector('.simv-config-grid')).toBeNull();
    expect(main.textContent).toContain('Tick #5');
    expect(main.textContent).toContain('12 commandes suivies');
    expect(main.textContent).toContain('20%');
  });

  it('KPIs affichés seulement si tick_count > 0 ou running', async () => {
    setupApi({ simStatus: jest.fn().mockResolvedValue(stoppedStatus({ tick_count: 0 })) });
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('.simv-kpi-grid')).toBeNull();
  });

  it('KPIs : affichés avec stats et couleur rouge sur les erreurs', async () => {
    setupApi({ simStatus: jest.fn().mockResolvedValue(runningStatus({ stats: {
      transitions_ok: 8, errors: 2, completed: 3, chaos_events: 0,
    } })) });
    const View = loadIt();
    await View.render(main);
    const kpiGrid = main.querySelector('.simv-kpi-grid');
    expect(kpiGrid).toBeTruthy();
    const errKpi = [...main.querySelectorAll('.simv-kpi')].find(k => k.textContent.includes('Erreurs'));
    expect(errKpi.className).toContain('red');
  });

  it('KPIs : 0 erreur → classe verte', async () => {
    setupApi({ simStatus: jest.fn().mockResolvedValue(runningStatus({ stats: {
      transitions_ok: 8, errors: 0, completed: 3, chaos_events: 0,
    } })) });
    const View = loadIt();
    await View.render(main);
    const errKpi = [...main.querySelectorAll('.simv-kpi')].find(k => k.textContent.includes('Erreurs'));
    expect(errKpi.className).toContain('green');
  });

  it('répartition par scénario : tableau rendu avec pourcentage de complétion', async () => {
    setupApi({ simStatus: jest.fn().mockResolvedValue(runningStatus({
      stats: {
        transitions_ok: 10, errors: 1, completed: 5, chaos_events: 2,
        scenarioBreakdown: { nominal: { total: 10, completed: 5, errors: 1, chaos: 2 } },
      },
    })) });
    const View = loadIt();
    await View.render(main);
    const table = main.querySelector('.simv-table');
    expect(table).toBeTruthy();
    expect(table.textContent).toContain('nominal');
    expect(table.textContent).toContain('(50%)');
  });

  it('pas de scenarioBreakdown → aucun tableau de répartition', async () => {
    setupApi({ simStatus: jest.fn().mockResolvedValue(runningStatus({ stats: { transitions_ok: 1 } })) });
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('.simv-table')).toBeNull();
  });

  it('journal vide → message "Aucune entrée."', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('#simv-journal').textContent).toContain('Aucune entrée');
  });

  it('journal : entrées avec classes ok/err/chaos/tick/meta et XSS échappé', async () => {
    setupApi({ simStatus: jest.fn().mockResolvedValue(stoppedStatus({
      recent_journal: [
        { time: '10:00', ref: '<b>CMD1</b>', scenario: 'nominal', success: true, message: 'ok <script>x</script>' },
        { time: '10:01', success: false, message: 'échec' },
        { time: '10:02', message: '🎲 chaos event' },
        { time: '10:03', message: '═══ tick ═══' },
        { time: '10:04', message: 'info générique' },
      ],
    })) });
    const View = loadIt();
    await View.render(main);
    const journal = main.querySelector('#simv-journal');
    expect(journal.querySelectorAll('.jline.ok').length).toBe(1);
    expect(journal.querySelectorAll('.jline.err').length).toBe(1);
    expect(journal.querySelectorAll('.jline.chaos').length).toBe(1);
    expect(journal.querySelectorAll('.jline.tick').length).toBe(1);
    expect(journal.querySelectorAll('.jline.meta').length).toBe(1);
    expect(journal.querySelector('script')).toBeNull();
    expect(journal.textContent).toContain('<script>x</script>');
    expect(journal.textContent).toContain('CMD1');
  });

  it('preset Minimal : coche nominal+express, chaos=0.05', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    main.querySelector('#simv-preset-minimal').click();
    const checked = [...main.querySelectorAll('.simv-cb:checked')].map(cb => cb.value);
    expect(checked.sort()).toEqual(['express', 'nominal']);
    expect(main.querySelector('#simv-chaos').value).toBe('0.05');
  });

  it('preset Réaliste : coche 8 scénarios, chaos=0.2', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    main.querySelector('#simv-preset-realistic').click();
    const checked = [...main.querySelectorAll('.simv-cb:checked')].map(cb => cb.value);
    expect(checked.length).toBe(8);
    expect(main.querySelector('#simv-chaos').value).toBe('0.2');
  });

  it('preset Chaos total : coche tous les scénarios, chaos=0.7', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    main.querySelector('#simv-preset-chaos').click();
    const checked = main.querySelectorAll('.simv-cb:checked').length;
    const all = main.querySelectorAll('.simv-cb').length;
    expect(checked).toBe(all);
    expect(main.querySelector('#simv-chaos').value).toBe('0.7');
  });

  it('Démarrer sans scénario coché → alert() et aucun appel simStart', async () => {
    const alertMock = mockAlert();
    const api = setupApi();
    const View = loadIt();
    await View.render(main);
    main.querySelectorAll('.simv-cb:checked').forEach(cb => { cb.checked = false; });

    main.querySelector('#simv-start').click();
    await flush();

    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Sélectionnez au moins un scénario'));
    expect(api.simStart).not.toHaveBeenCalled();
  });

  it('Démarrer avec config : appelle simStart avec cadence/max/chaos/scenarios puis re-render', async () => {
    const api = setupApi({
      simStatus: jest.fn()
        .mockResolvedValueOnce(stoppedStatus())
        .mockResolvedValueOnce(runningStatus()),
    });
    const View = loadIt();
    await View.render(main);

    main.querySelector('#simv-cadence').value = '5';
    main.querySelector('#simv-max').value = '30';
    main.querySelector('#simv-chaos').value = '0.4';

    main.querySelector('#simv-start').click();
    await flush();
    await flush();

    expect(api.simStart).toHaveBeenCalledWith(expect.objectContaining({
      cadence_minutes: 5, max_orders: 30, chaos_level: 0.4,
    }));
    expect(main.querySelector('.simv-banner.running')).toBeTruthy();
  });

  it('Démarrer : échec simStart → alert(), bouton réactivé avec texte initial', async () => {
    const alertMock = mockAlert();
    setupApi({ simStart: jest.fn().mockRejectedValue(new Error('start KO')) });
    const View = loadIt();
    await View.render(main);

    const startBtn = main.querySelector('#simv-start');
    startBtn.click();
    await flush();
    await flush();

    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('start KO'));
    expect(startBtn.disabled).toBe(false);
    expect(startBtn.textContent).toContain('Démarrer');
  });

  it('Arrêter : appelle simStop() puis re-render en état arrêté', async () => {
    const api = setupApi({
      simStatus: jest.fn()
        .mockResolvedValueOnce(runningStatus())
        .mockResolvedValueOnce(stoppedStatus()),
    });
    const View = loadIt();
    await View.render(main);

    main.querySelector('#simv-stop').click();
    await flush();
    await flush();

    expect(api.simStop).toHaveBeenCalled();
    expect(main.querySelector('.simv-banner.stopped')).toBeTruthy();
  });

  it('Arrêter : échec simStop → alert()', async () => {
    const alertMock = mockAlert();
    setupApi({
      simStatus: jest.fn().mockResolvedValue(runningStatus()),
      simStop: jest.fn().mockRejectedValue(new Error('stop KO')),
    });
    const View = loadIt();
    await View.render(main);

    main.querySelector('#simv-stop').click();
    await flush();
    await flush();

    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('stop KO'));
  });

  it('bouton refresh (🔄) : relance le rendu (nouvel appel simStatus)', async () => {
    const api = setupApi();
    const View = loadIt();
    await View.render(main);
    const callsBefore = api.simStatus.mock.calls.length;

    main.querySelector('#simv-refresh').click();
    await flush();

    expect(api.simStatus.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('Nettoyer : confirm() refusé → aucun appel simCleanup', async () => {
    mockConfirm(false);
    const api = setupApi();
    const View = loadIt();
    await View.render(main);

    main.querySelector('#simv-cleanup').click();
    await flush();

    expect(api.simCleanup).not.toHaveBeenCalled();
  });

  it('Nettoyer : confirm() accepté → simCleanup(), alert succès, re-render', async () => {
    mockConfirm(true);
    const alertMock = mockAlert();
    const api = setupApi();
    const View = loadIt();
    await View.render(main);

    main.querySelector('#simv-cleanup').click();
    await flush();
    await flush();

    expect(api.simCleanup).toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Nettoyage terminé'));
  });

  it('Nettoyer : échec → alert erreur, bouton réactivé', async () => {
    mockConfirm(true);
    const alertMock = mockAlert();
    setupApi({ simCleanup: jest.fn().mockRejectedValue(new Error('cleanup KO')) });
    const View = loadIt();
    await View.render(main);

    const btn = main.querySelector('#simv-cleanup');
    btn.click();
    await flush();
    await flush();

    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('cleanup KO'));
    expect(btn.disabled).toBe(false);
  });

  it('Charger tout (journal) : appelle simJournal() et remplace le contenu du journal', async () => {
    const api = setupApi({
      simJournal: jest.fn().mockResolvedValue({ entries: [{ time: '11:00', message: 'entrée complète' }] }),
    });
    const View = loadIt();
    await View.render(main);

    const btn = main.querySelector('#simv-journal-load');
    btn.click();
    await flush();
    await flush();

    expect(api.simJournal).toHaveBeenCalled();
    expect(main.querySelector('#simv-journal').textContent).toContain('entrée complète');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('Charger tout');
  });

  it('Charger tout : journal vide côté serveur → "Journal vide."', async () => {
    setupApi({ simJournal: jest.fn().mockResolvedValue({ entries: [] }) });
    const View = loadIt();
    await View.render(main);

    main.querySelector('#simv-journal-load').click();
    await flush();
    await flush();

    expect(main.querySelector('#simv-journal').textContent).toContain('Journal vide');
  });

  it('Charger tout : échec → alert()', async () => {
    const alertMock = mockAlert();
    setupApi({ simJournal: jest.fn().mockRejectedValue(new Error('journal KO')) });
    const View = loadIt();
    await View.render(main);

    main.querySelector('#simv-journal-load').click();
    await flush();
    await flush();

    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('journal KO'));
  });
});
