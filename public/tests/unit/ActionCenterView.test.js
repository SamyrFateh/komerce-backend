'use strict';

/**
 * tests/unit/ActionCenterView.test.js
 *
 * admin/js/views/ActionCenterView.js (309L) — Vue Centre d'actions
 * /admin/action-center. Export réel : window.ActionCenterView = { render }
 * (IIFE, render async).
 *
 * Sources API (globals mockés) :
 *   - KmcApi.getSignalsStats() + KmcApi.getSignalsList({ limit: 100 })
 *     appelés en Promise.all dans _loadData ; erreur (l'un ou l'autre)
 *     → catch englobant, message échappé dans #ac-families
 *   - KmcApi.acknowledgeSignal(id) / snoozeSignal(id, 24) / resolveSignal(id)
 *     — chacun catché localement (`.catch(() => {})`), ne remonte jamais,
 *     toujours suivi d'un reload() (nouvel appel _loadData, non attendu)
 *   - KmcApi.generateSignals() — bouton rafraîchir, erreur affichée dans
 *     #ac-refresh-status (non catchée localement → visible)
 *
 * Pas de KmcFilters ni de KpiCard ici : la vue construit ses propres cartes
 * KPI en HTML brut (kpiCard()) et n'a pas de filtres de période.
 *
 * Périmètre couvert :
 *   - render() : shell (kpis + refresh bar + families en loading), appelle
 *     _loadData puis _bindRefresh
 *   - KPIs : urgent+critique cumulés, avertissements, infos, total actifs
 *   - Regroupement par famille (FAMILY_MAP, défaut 'ops' si type inconnu),
 *     tri par sévérité (urgent < critique < avertissement < info < inconnu)
 *   - Familles vides exclues du rendu
 *   - Débordement (>3 signaux) : cartes cachées + bouton "+N de plus", clic
 *     révèle et retire le bouton
 *   - Carte signal : échappement XSS (titre/résumé/recommandation), bouton
 *     "Voir" conditionnel (target_view), pied (type + horodatage relatif)
 *   - Bouton drill : dispatch window CustomEvent 'kmc:navigate' avec le
 *     détail (view/filters/highlightId)
 *   - Actions vu/snooze/résolu : désactivation du bouton, appel API
 *     correspondant, rechargement ; erreur API avalée silencieusement
 *   - Erreur globale de chargement (Promise.all rejeté) → message échappé
 *   - Bouton rafraîchir : génère les signaux puis recharge ; erreur affichée
 *     dans le statut, bouton réactivé (finally)
 */

const {
  loadView, makeKmcApi, cleanupGlobals, flush,
} = require('./helpers/dashboardTestKit');

function makeSignal(overrides) {
  return Object.assign({
    id: 's1',
    signal_type: 'parcel_blocked',
    severity: 'critical',
    title: 'Colis bloqué',
    summary: null,
    recommendation: null,
    target_view: null,
    target_filters: null,
    entity_id: null,
    created_at: new Date().toISOString(),
  }, overrides);
}

describe('ActionCenterView', () => {
  let View;
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');
    View = loadView('../../admin/js/views/ActionCenterView.js', 'ActionCenterView');
  });

  afterEach(() => {
    cleanupGlobals('KmcApi');
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      getSignalsStats: jest.fn().mockResolvedValue({ total: 0 }),
      getSignalsList: jest.fn().mockResolvedValue({ signals: [] }),
      generateSignals: jest.fn().mockResolvedValue({}),
      acknowledgeSignal: jest.fn().mockResolvedValue({}),
      snoozeSignal: jest.fn().mockResolvedValue({}),
      resolveSignal: jest.fn().mockResolvedValue({}),
    }, overrides));
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    setupApi();
    expect(typeof View.render).toBe('function');
  });

  describe('render() — shell et chargement', () => {
    it('pose le shell (kpis + barre rafraîchir + familles) avant résolution des données', () => {
      setupApi();
      View.render(root);
      expect(root.querySelector('#ac-kpis')).toBeTruthy();
      expect(root.querySelector('#ac-refresh')).toBeTruthy();
      expect(root.querySelector('#ac-refresh-status')).toBeTruthy();
      expect(root.querySelector('#ac-families').innerHTML).toContain('Chargement');
    });

    it('appelle getSignalsStats et getSignalsList({ limit: 100 })', async () => {
      const api = setupApi();
      await View.render(root);
      expect(api.getSignalsStats).toHaveBeenCalledTimes(1);
      expect(api.getSignalsList).toHaveBeenCalledWith({ limit: 100 });
    });
  });

  describe('KPIs', () => {
    it('cumule urgent+critique, compte avertissements/infos, affiche le total', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 5 }),
        getSignalsList: jest.fn().mockResolvedValue({
          signals: [
            makeSignal({ id: '1', severity: 'urgent' }),
            makeSignal({ id: '2', severity: 'critical' }),
            makeSignal({ id: '3', severity: 'warning' }),
            makeSignal({ id: '4', severity: 'info' }),
            makeSignal({ id: '5', severity: 'info' }),
          ],
        }),
      });
      await View.render(root);
      const values = [...root.querySelectorAll('.ac-kpi-value')].map(el => el.textContent);
      expect(values).toEqual(['2', '1', '2', '5']);
    });

    it('total absent (stats.total falsy) → 0', async () => {
      setupApi({ getSignalsStats: jest.fn().mockResolvedValue({}) });
      await View.render(root);
      const values = [...root.querySelectorAll('.ac-kpi-value')].map(el => el.textContent);
      expect(values).toEqual(['0', '0', '0', '0']);
    });
  });

  describe('État vide', () => {
    it('total actifs à 0 → message "Tout est en ordre"', async () => {
      setupApi();
      await View.render(root);
      expect(root.querySelector('#ac-families').innerHTML).toContain('Tout est en ordre');
      expect(root.querySelectorAll('.ac-fam-block').length).toBe(0);
    });
  });

  describe('Regroupement par famille', () => {
    it('mappe signal_type vers la bonne famille via FAMILY_MAP', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 4 }),
        getSignalsList: jest.fn().mockResolvedValue({
          signals: [
            makeSignal({ id: '1', signal_type: 'parcel_blocked' }),   // ops
            makeSignal({ id: '2', signal_type: 'margin_drift' }),     // eco
            makeSignal({ id: '3', signal_type: 'sourcing_arbitrage' }), // sourcing
            makeSignal({ id: '4', signal_type: 'dispute_sensitive' }),  // disputes
          ],
        }),
      });
      await View.render(root);
      expect(root.querySelectorAll('.ac-fam-block').length).toBe(4);
      const titles = [...root.querySelectorAll('.ac-fam-title')].map(t => t.textContent);
      expect(titles).toEqual([
        'Opérations bloquées', 'Alertes économiques', 'Sourcing à arbitrer', 'Incidents & litiges',
      ]);
    });

    it('signal_type inconnu → famille "ops" par défaut', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({
          signals: [makeSignal({ id: '1', signal_type: 'totally_unknown_type' })],
        }),
      });
      await View.render(root);
      expect(root.querySelectorAll('.ac-fam-block').length).toBe(1);
      expect(root.querySelector('.ac-fam-title').textContent).toBe('Opérations bloquées');
    });

    it('familles sans signal sont exclues du rendu', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({
          signals: [makeSignal({ id: '1', signal_type: 'dispute_sensitive' })],
        }),
      });
      await View.render(root);
      expect(root.querySelectorAll('.ac-fam-block').length).toBe(1);
      expect(root.querySelector('.ac-fam-title').textContent).toBe('Incidents & litiges');
    });

    it('trie les signaux d\'une même famille par sévérité (urgent < critique < warning < info < inconnu)', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 4 }),
        getSignalsList: jest.fn().mockResolvedValue({
          signals: [
            makeSignal({ id: 'a', title: 'Info', severity: 'info' }),
            makeSignal({ id: 'b', title: 'Urgent', severity: 'urgent' }),
            makeSignal({ id: 'c', title: 'Inconnu', severity: 'mystere' }),
            makeSignal({ id: 'd', title: 'Critique', severity: 'critical' }),
          ],
        }),
      });
      await View.render(root);
      const titles = [...root.querySelectorAll('.signal-card strong')].map(t => t.textContent);
      expect(titles).toEqual(['Urgent', 'Critique', 'Info', 'Inconnu']);
    });
  });

  describe('Débordement (>3 signaux dans une famille)', () => {
    function fiveOpsSignals() {
      return [1, 2, 3, 4, 5].map(i => makeSignal({ id: String(i), title: `Sig ${i}` }));
    }

    it('affiche seulement 3 cartes, cache les 2 suivantes, bouton "+2 de plus"', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 5 }),
        getSignalsList: jest.fn().mockResolvedValue({ signals: fiveOpsSignals() }),
      });
      await View.render(root);
      const cards = root.querySelectorAll('.signal-card');
      expect(cards.length).toBe(5);
      expect(cards[3].getAttribute('style')).toContain('display:none');
      expect(cards[4].getAttribute('style')).toContain('display:none');
      const moreBtn = root.querySelector('.ac-show-more');
      expect(moreBtn.textContent).toContain('+ 2 de plus');
    });

    it('clic sur "+N de plus" révèle les cartes cachées et retire le bouton', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 5 }),
        getSignalsList: jest.fn().mockResolvedValue({ signals: fiveOpsSignals() }),
      });
      await View.render(root);
      root.querySelector('.ac-show-more').click();
      const cards = root.querySelectorAll('.signal-card');
      expect(cards[3].style.display).toBe('');
      expect(cards[4].style.display).toBe('');
      expect(root.querySelector('.ac-show-more')).toBeFalsy();
    });

    it("pas de bouton 'plus' si 3 signaux ou moins", async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 2 }),
        getSignalsList: jest.fn().mockResolvedValue({ signals: [makeSignal({ id: '1' }), makeSignal({ id: '2' })] }),
      });
      await View.render(root);
      expect(root.querySelector('.ac-show-more')).toBeFalsy();
    });
  });

  describe('Carte signal', () => {
    it('échappe le XSS dans titre/résumé/recommandation', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({
          signals: [makeSignal({
            title: '<script>alert(1)</script>',
            summary: '<img src=x onerror=alert(2)>',
            recommendation: '<b>injecte</b>',
          })],
        }),
      });
      await View.render(root);
      const html = root.querySelector('#ac-families').innerHTML;
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).not.toContain('<img src=x onerror=alert(2)>');
      expect(html).not.toContain('<b>injecte</b>');
    });

    it('résumé et recommandation absents → sections non rendues', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({ signals: [makeSignal()] }),
      });
      await View.render(root);
      expect(root.querySelector('.ac-signal-summary')).toBeFalsy();
      expect(root.querySelector('.ac-signal-reco')).toBeFalsy();
    });

    it('résumé et recommandation présents → affichés', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({
          signals: [makeSignal({ summary: 'Résumé X', recommendation: 'Faire Y' })],
        }),
      });
      await View.render(root);
      expect(root.querySelector('.ac-signal-summary').textContent).toBe('Résumé X');
      expect(root.querySelector('.ac-signal-reco').textContent).toContain('Faire Y');
    });

    it('pas de target_view → aucun bouton "Voir"', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({ signals: [makeSignal({ target_view: null })] }),
      });
      await View.render(root);
      expect(root.querySelector('[data-signal-drill]')).toBeFalsy();
    });

    it('footer affiche le type de signal et un horodatage relatif', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({
          signals: [makeSignal({
            signal_type: 'parcel_blocked',
            created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          })],
        }),
      });
      await View.render(root);
      const footer = root.querySelector('.ac-signal-footer').textContent;
      expect(footer).toContain('parcel_blocked');
      expect(footer).toContain('min');
    });
  });

  describe('Bouton drill (target_view)', () => {
    it('dispatch kmc:navigate avec view/filters/highlightId au clic', async () => {
      setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({
          signals: [makeSignal({
            target_view: 'orders-logistics',
            target_filters: { status: 'blocked' },
            entity_id: 'ord-42',
          })],
        }),
      });
      await View.render(root);

      const handler = jest.fn();
      window.addEventListener('kmc:navigate', handler);

      root.querySelector('[data-signal-drill]').click();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({
        view: 'orders-logistics',
        filters: { status: 'blocked' },
        highlightId: 'ord-42',
      });
      window.removeEventListener('kmc:navigate', handler);
    });
  });

  describe('Actions vu / snooze / résolu', () => {
    it('"Vu" désactive le bouton, appelle acknowledgeSignal, puis recharge', async () => {
      const api = setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({ signals: [makeSignal({ id: 'sig-1' })] }),
      });
      await View.render(root);

      const btn = root.querySelector('[data-signal-ack="sig-1"]');
      btn.click();
      expect(btn.disabled).toBe(true);
      await flush();
      await flush();

      expect(api.acknowledgeSignal).toHaveBeenCalledWith('sig-1');
      expect(api.getSignalsStats).toHaveBeenCalledTimes(2);
    });

    it('"24h" appelle snoozeSignal(id, 24)', async () => {
      const api = setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({ signals: [makeSignal({ id: 'sig-2' })] }),
      });
      await View.render(root);

      root.querySelector('[data-signal-snooze="sig-2"]').click();
      await flush();
      await flush();

      expect(api.snoozeSignal).toHaveBeenCalledWith('sig-2', 24);
    });

    it('"Résolu" appelle resolveSignal(id)', async () => {
      const api = setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({ signals: [makeSignal({ id: 'sig-3' })] }),
      });
      await View.render(root);

      root.querySelector('[data-signal-resolve="sig-3"]').click();
      await flush();
      await flush();

      expect(api.resolveSignal).toHaveBeenCalledWith('sig-3');
    });

    it('échec API sur une action → avalé silencieusement, le rechargement a bien lieu', async () => {
      const api = setupApi({
        getSignalsStats: jest.fn().mockResolvedValue({ total: 1 }),
        getSignalsList: jest.fn().mockResolvedValue({ signals: [makeSignal({ id: 'sig-4' })] }),
        acknowledgeSignal: jest.fn().mockRejectedValue(new Error('boom')),
      });
      await View.render(root);

      root.querySelector('[data-signal-ack="sig-4"]').click();
      await flush();
      await flush();

      expect(api.getSignalsStats).toHaveBeenCalledTimes(2);
    });
  });

  describe('Erreur globale de chargement', () => {
    it('getSignalsStats rejeté → message d\'erreur échappé dans #ac-families', async () => {
      setupApi({ getSignalsStats: jest.fn().mockRejectedValue(new Error('<script>x</script>panne')) });
      await View.render(root);
      const html = root.querySelector('#ac-families').innerHTML;
      expect(html).toContain('panne');
      expect(html).not.toContain('<script>x</script>');
    });

    it('getSignalsList rejeté → message d\'erreur affiché aussi', async () => {
      setupApi({ getSignalsList: jest.fn().mockRejectedValue(new Error('réseau KO')) });
      await View.render(root);
      expect(root.querySelector('#ac-families').innerHTML).toContain('réseau KO');
    });
  });

  describe('Bouton rafraîchir', () => {
    it('succès : statut "Génération en cours…" puis "✅ Signaux régénérés", recharge les données', async () => {
      const api = setupApi();
      await View.render(root);

      const btn = root.querySelector('#ac-refresh');
      const status = root.querySelector('#ac-refresh-status');

      const clickPromise = btn.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
      expect(status.textContent).toContain('Génération en cours');
      expect(btn.disabled).toBe(true);

      await flush();
      await flush();

      expect(api.generateSignals).toHaveBeenCalledTimes(1);
      expect(status.textContent).toContain('Signaux régénérés');
      expect(api.getSignalsStats).toHaveBeenCalledTimes(2);
      expect(btn.disabled).toBe(false);
      void clickPromise;
    });

    it('échec : affiche le message d\'erreur dans le statut, réactive le bouton (finally)', async () => {
      setupApi({ generateSignals: jest.fn().mockRejectedValue(new Error('quota dépassé')) });
      await View.render(root);

      const btn = root.querySelector('#ac-refresh');
      const status = root.querySelector('#ac-refresh-status');
      btn.click();
      await flush();
      await flush();

      expect(status.textContent).toContain('quota dépassé');
      expect(btn.disabled).toBe(false);
    });
  });
});
