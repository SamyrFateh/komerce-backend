'use strict';

/**
 * tests/unit/ControlTowerView.test.js
 *
 * admin/js/views/ControlTowerView.js (569L) — vue Tour de contrôle : KPI bar,
 * activité (line chart), statuts (donut), alertes critiques, commandes à
 * traiter, performance relais, SLA & délais, invendus & stock.
 * Export public : render(rootEl).
 *
 * Dépendances externes (globals mockés) :
 *   - KmcFilters.get()
 *   - KmcApi.getControlTower(filters) / getOps(filters) (catch→null) /
 *     getUnsoldStats() (catch→null) / ApiError (branche 401)
 *   - KpiCard.renderBar(container, kpis)
 *   - Charts.renderLineChart(container, timeline) / renderDonutChart(container, breakdown, opts)
 *   - AlertList.renderList(container, alerts, opts)
 *   - DataTable.render(container, { columns, rows, onRowClick, emptyText })
 *   - BadgeStatus.status(status)
 *
 * Périmètre couvert :
 *   - render() : shell posé de façon synchrone avant tout await
 *   - loadData réussi : KPI bar, charts (présents/absents), alertes,
 *     tables commandes/relais (colonnes, rendus de cellule, onRowClick),
 *     seuils badge taux de retrait
 *   - Section SLA (_renderSla, via #ct-sla) : indisponible, buckets, délais
 *     moyens, table retard (échappement HTML), message "aucun retard"
 *   - Section Invendus (_renderUnsold, via #ct-unsold) : indisponible, stock
 *     à zéro, KPIs + remise, répartition canaux (partielle et absente)
 *   - Meta data_quality (cache / frais, warnings)
 *   - Garde navigation : rootEl détaché du DOM pendant le fetch
 *   - Erreur générique et ApiError 401 (message session expirée)
 */

function baseCtData(overrides) {
  return Object.assign({
    kpis: [{ key: 'ca_jour', label: 'CA du jour', value: 100000 }],
    charts: {
      activity_timeline: { points: [{ date: '2026-07-01', commandes: 5, ca_kmf: 50000 }] },
      status_breakdown: [{ status: 'confirmed', count: 3 }],
    },
    alerts: [{ key: 'critical', level: 'critical', message: 'Stock bloqué' }],
    tables: {
      orders_to_handle: [
        { id: 1, reference: 'CMD-1', payment_status: 'paid', status: 'confirmed', total_kmf: 15000, relais_name: 'Moroni' },
      ],
      relais_performance: [
        { relais_name: 'Moroni', orders_count: 10, available: 4, collected: 6, taux_retrait_pct: 80 },
      ],
    },
    data_quality: {
      generated_at: '2026-07-05T10:00:00.000Z',
      is_cached: false,
      warnings: [],
    },
  }, overrides);
}

function baseOps(overrides) {
  return Object.assign({
    sla: { on_time: 10, warning: 2, late: 0, blocked: 0, details: { late: [] } },
    delais: { avg_preparation_jours: 1.5, avg_livraison_totale_jours: 3.2 },
  }, overrides);
}

function baseUnsold(overrides) {
  return Object.assign({
    total_actifs: 0,
    valeur_liquidation_kmf: 0,
    valeur_initiale_kmf: 0,
    jours_moy_en_stock: 0,
    canal_whatsapp: 0,
    canal_revendeur: 0,
    canal_both: 0,
  }, overrides);
}

describe('ControlTowerView', () => {
  let root;
  let dataTableCalls;
  let badgeCalls;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    dataTableCalls = [];
    badgeCalls = [];

    global.KmcFilters = { get: jest.fn(() => ({ from: null, to: null })) };
    global.KmcApi = {
      getControlTower: jest.fn().mockResolvedValue(baseCtData()),
      getOps: jest.fn().mockResolvedValue(baseOps()),
      getUnsoldStats: jest.fn().mockResolvedValue(baseUnsold()),
      ApiError: class ApiError extends Error {
        constructor(msg, status) { super(msg); this.status = status; }
      },
    };
    global.KpiCard = { renderBar: jest.fn() };
    global.Charts = {
      renderLineChart: jest.fn(),
      renderDonutChart: jest.fn(),
    };
    global.AlertList = { renderList: jest.fn() };
    global.DataTable = {
      render: jest.fn((container, opts) => { dataTableCalls.push(opts); }),
    };
    global.BadgeStatus = {
      status: jest.fn((s) => { badgeCalls.push(s); return `<span class="badge">${s}</span>`; }),
    };

    require('../../admin/js/views/ControlTowerView.js');
  });

  afterEach(() => {
    delete global.KmcFilters;
    delete global.KmcApi;
    delete global.KpiCard;
    delete global.Charts;
    delete global.AlertList;
    delete global.DataTable;
    delete global.BadgeStatus;
  });

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    expect(typeof window.ControlTowerView).toBe('object');
    expect(typeof window.ControlTowerView.render).toBe('function');
  });

  describe('render() — shell', () => {
    it('pose le shell de façon synchrone, avant même la résolution du fetch', () => {
      const p = window.ControlTowerView.render(root);
      expect(root.querySelector('#ct-kpis')).toBeTruthy();
      expect(root.querySelector('#ct-activity-chart')).toBeTruthy();
      expect(root.querySelector('#ct-status-chart')).toBeTruthy();
      expect(root.querySelector('#ct-alerts')).toBeTruthy();
      expect(root.querySelector('#ct-orders-table')).toBeTruthy();
      expect(root.querySelector('#ct-relais-table')).toBeTruthy();
      expect(root.querySelector('#ct-sla')).toBeTruthy();
      expect(root.querySelector('#ct-unsold')).toBeTruthy();
      return p;
    });

    it('appelle getControlTower + getOps + getUnsoldStats avec les filtres courants', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      expect(global.KmcApi.getControlTower).toHaveBeenCalledWith({ from: null, to: null });
      expect(global.KmcApi.getOps).toHaveBeenCalledWith({ from: null, to: null });
      expect(global.KmcApi.getUnsoldStats).toHaveBeenCalled();
    });
  });

  describe('KPIs et charts', () => {
    it('appelle KpiCard.renderBar avec data.kpis', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      expect(global.KpiCard.renderBar).toHaveBeenCalledWith(
        document.getElementById('ct-kpis'),
        baseCtData().kpis
      );
    });

    it('kpis manquants → renderBar appelé avec []', async () => {
      global.KmcApi.getControlTower.mockResolvedValue(baseCtData({ kpis: undefined }));
      await window.ControlTowerView.render(root);
      await flush();
      expect(global.KpiCard.renderBar).toHaveBeenCalledWith(document.getElementById('ct-kpis'), []);
    });

    it('renderLineChart appelé si activity_timeline présent', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      expect(global.Charts.renderLineChart).toHaveBeenCalledWith(
        document.getElementById('ct-activity-chart'),
        baseCtData().charts.activity_timeline
      );
    });

    it('renderLineChart non appelé si activity_timeline absent', async () => {
      global.KmcApi.getControlTower.mockResolvedValue(baseCtData({ charts: {} }));
      await window.ControlTowerView.render(root);
      await flush();
      expect(global.Charts.renderLineChart).not.toHaveBeenCalled();
    });

    it('renderDonutChart appelé avec keyField/valueField si status_breakdown présent', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      expect(global.Charts.renderDonutChart).toHaveBeenCalledWith(
        document.getElementById('ct-status-chart'),
        baseCtData().charts.status_breakdown,
        { keyField: 'status', valueField: 'count' }
      );
    });

    it('renderDonutChart non appelé si status_breakdown absent', async () => {
      global.KmcApi.getControlTower.mockResolvedValue(baseCtData({ charts: {} }));
      await window.ControlTowerView.render(root);
      await flush();
      expect(global.Charts.renderDonutChart).not.toHaveBeenCalled();
    });
  });

  describe('Alertes', () => {
    it('appelle AlertList.renderList avec les alertes et les options', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      expect(global.AlertList.renderList).toHaveBeenCalledWith(
        document.getElementById('ct-alerts'),
        baseCtData().alerts,
        { limit: 8, emptyText: 'Aucune alerte critique en cours' }
      );
    });

    it('alerts manquantes → renderList appelé avec []', async () => {
      global.KmcApi.getControlTower.mockResolvedValue(baseCtData({ alerts: undefined }));
      await window.ControlTowerView.render(root);
      await flush();
      expect(global.AlertList.renderList).toHaveBeenCalledWith(
        document.getElementById('ct-alerts'), [], expect.any(Object)
      );
    });
  });

  describe('Table commandes à traiter', () => {
    it('appelle DataTable.render avec les bonnes rows et le bon emptyText', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      const call = dataTableCalls.find(c => c.emptyText === 'Aucune commande à traiter');
      expect(call.rows).toEqual(baseCtData().tables.orders_to_handle);
      expect(call.columns.map(c => c.key)).toEqual(
        ['reference', 'payment_status', 'status', 'total_kmf', 'relais_name']
      );
    });

    it('colonnes payment_status/status délèguent à BadgeStatus.status avec fallback "pending"', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      const call = dataTableCalls.find(c => c.emptyText === 'Aucune commande à traiter');
      const payCol = call.columns.find(c => c.key === 'payment_status');
      const statCol = call.columns.find(c => c.key === 'status');

      payCol.render({ payment_status: 'paid' });
      expect(badgeCalls).toContain('paid');
      statCol.render({ status: undefined });
      expect(badgeCalls).toContain('pending');
    });

    it('colonne total_kmf formate en KMF', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      const call = dataTableCalls.find(c => c.emptyText === 'Aucune commande à traiter');
      const totalCol = call.columns.find(c => c.key === 'total_kmf');
      expect(totalCol.render({ total_kmf: 15000 })).toBe((15000).toLocaleString('fr-FR') + ' KMF');
      expect(totalCol.render({})).toBe((0).toLocaleString('fr-FR') + ' KMF');
    });

    it('colonne relais_name retombe sur "—" si absent', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      const call = dataTableCalls.find(c => c.emptyText === 'Aucune commande à traiter');
      const relaisCol = call.columns.find(c => c.key === 'relais_name');
      expect(relaisCol.render({ relais_name: 'Moroni' })).toBe('Moroni');
      expect(relaisCol.render({})).toBe('—');
    });

    it('onRowClick est câblé et ne lève pas d\'exception (navigation via window.location.href)', async () => {
      // Note : jsdom rend window.location non reconfigurable dans cet environnement,
      // on ne peut donc pas espionner la valeur assignée ici — seule l'absence de
      // crash est vérifiable côté unitaire ; le comportement de navigation réel
      // relève de l'e2e.
      await window.ControlTowerView.render(root);
      await flush();
      const call = dataTableCalls.find(c => c.emptyText === 'Aucune commande à traiter');
      expect(() => call.onRowClick({ id: 42 })).not.toThrow();
    });

    it('orders_to_handle manquant → rows = []', async () => {
      global.KmcApi.getControlTower.mockResolvedValue(baseCtData({ tables: {} }));
      await window.ControlTowerView.render(root);
      await flush();
      const call = dataTableCalls.find(c => c.emptyText === 'Aucune commande à traiter');
      expect(call.rows).toEqual([]);
    });
  });

  describe('Table performance relais', () => {
    it('appelle DataTable.render avec les bonnes rows', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      const call = dataTableCalls.find(c => c.emptyText === 'Aucune donnée relais');
      expect(call.rows).toEqual(baseCtData().tables.relais_performance);
    });

    it('taux_retrait_pct : vert ≥70%, orange ≥40%, rouge sinon', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      const call = dataTableCalls.find(c => c.emptyText === 'Aucune donnée relais');
      const col = call.columns.find(c => c.key === 'taux_retrait_pct');
      expect(col.render({ taux_retrait_pct: 80 })).toContain('is-green');
      expect(col.render({ taux_retrait_pct: 50 })).toContain('is-orange');
      expect(col.render({ taux_retrait_pct: 10 })).toContain('is-red');
    });

    it('relais_performance manquant → rows = []', async () => {
      global.KmcApi.getControlTower.mockResolvedValue(baseCtData({ tables: {} }));
      await window.ControlTowerView.render(root);
      await flush();
      const call = dataTableCalls.find(c => c.emptyText === 'Aucune donnée relais');
      expect(call.rows).toEqual([]);
    });
  });

  describe('Section SLA (#ct-sla)', () => {
    it('ops indisponible → message "Données SLA indisponibles"', async () => {
      global.KmcApi.getOps.mockResolvedValue(null);
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-sla').innerHTML).toContain('Données SLA indisponibles');
    });

    it('ops.sla absent → même message', async () => {
      global.KmcApi.getOps.mockResolvedValue({});
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-sla').innerHTML).toContain('Données SLA indisponibles');
    });

    it('affiche les 4 buckets SLA avec leurs valeurs', async () => {
      global.KmcApi.getOps.mockResolvedValue(baseOps({
        sla: { on_time: 5, warning: 2, late: 1, blocked: 3, details: { late: [] } },
      }));
      await window.ControlTowerView.render(root);
      await flush();
      const html = document.getElementById('ct-sla').innerHTML;
      expect(html).toContain('Dans les délais');
      expect(html).toContain('En approche');
      expect(html).toContain('En retard');
      expect(html).toContain('Bloquées');
    });

    it('affiche les délais moyens quand présents', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      const html = document.getElementById('ct-sla').innerHTML;
      expect(html).toContain('1.5j');
      expect(html).toContain('3.2j');
    });

    it('délais absent → pas de ligne délais', async () => {
      global.KmcApi.getOps.mockResolvedValue(baseOps({ delais: null }));
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-sla').innerHTML).not.toContain('ctv-delays-row');
    });

    it('aucune commande en retard → message OK', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-sla').innerHTML).toContain('Aucune commande en retard détecté');
    });

    it('commandes en retard → table avec échappement HTML', async () => {
      global.KmcApi.getOps.mockResolvedValue(baseOps({
        sla: {
          on_time: 1, warning: 0, late: 1, blocked: 0,
          details: { late: [{ id: 7, reference: '<b>CMD-X</b>', status: 'confirmed', jours: 4 }] },
        },
      }));
      await window.ControlTowerView.render(root);
      await flush();
      const html = document.getElementById('ct-sla').innerHTML;
      expect(html).toContain('Commandes en retard (1)');
      expect(html).toContain('&lt;b&gt;CMD-X&lt;/b&gt;');
      expect(html).not.toContain('<b>CMD-X</b>');
      expect(html).toContain('order_id=7');
      expect(html).toContain('4');
    });
  });

  describe('Section Invendus (#ct-unsold)', () => {
    it('stats indisponibles → message "indisponibles"', async () => {
      global.KmcApi.getUnsoldStats.mockResolvedValue(null);
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-unsold').innerHTML).toContain('Données invendus indisponibles');
    });

    it('total_actifs = 0 → message "bonne santé du stock"', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-unsold').innerHTML).toContain('bonne santé du stock');
    });

    it('total_actifs > 0 → affiche les 4 KPIs et le % de remise', async () => {
      global.KmcApi.getUnsoldStats.mockResolvedValue(baseUnsold({
        total_actifs: 12,
        valeur_liquidation_kmf: 300000,
        valeur_initiale_kmf: 1000000,
        jours_moy_en_stock: 45,
      }));
      await window.ControlTowerView.render(root);
      await flush();
      const html = document.getElementById('ct-unsold').innerHTML;
      expect(html).toContain('Articles actifs');
      expect(html).toContain('12');
      expect(html).toContain('45j');
      expect(html).toContain('−70%'); // 1 - 300000/1000000 = 70%
    });

    it('valeur_initiale_kmf = 0 → remise à 0% (pas de division par zéro)', async () => {
      global.KmcApi.getUnsoldStats.mockResolvedValue(baseUnsold({
        total_actifs: 3, valeur_initiale_kmf: 0, valeur_liquidation_kmf: 0,
      }));
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-unsold').innerHTML).toContain('−0%');
    });

    it('répartition canaux affichée quand au moins un canal > 0', async () => {
      global.KmcApi.getUnsoldStats.mockResolvedValue(baseUnsold({
        total_actifs: 5, canal_whatsapp: 2, canal_revendeur: 1, canal_both: 0,
      }));
      await window.ControlTowerView.render(root);
      await flush();
      const html = document.getElementById('ct-unsold').innerHTML;
      expect(html).toContain('2 WhatsApp');
      expect(html).toContain('1 Revendeur');
      expect(html).not.toContain('Les deux');
    });

    it('aucun canal renseigné → pas de barre canaux', async () => {
      global.KmcApi.getUnsoldStats.mockResolvedValue(baseUnsold({ total_actifs: 5 }));
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-unsold').innerHTML).not.toContain('ctv-channel-bar');
    });
  });

  describe('Meta (data_quality)', () => {
    it('cache actif → affiche l\'âge du cache', async () => {
      global.KmcApi.getControlTower.mockResolvedValue(baseCtData({
        data_quality: {
          generated_at: '2026-07-05T10:00:00.000Z',
          is_cached: true, cache_age_seconds: 12, cache_ttl_seconds: 60, warnings: [],
        },
      }));
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-meta').textContent).toContain('cache 12s/60s');
    });

    it('pas de cache → "données fraîches"', async () => {
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-meta').textContent).toContain('données fraîches');
    });

    it('warnings ajoutés au texte meta', async () => {
      global.KmcApi.getControlTower.mockResolvedValue(baseCtData({
        data_quality: {
          generated_at: '2026-07-05T10:00:00.000Z', is_cached: false,
          warnings: ['stock partiel'],
        },
      }));
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-meta').textContent).toContain('stock partiel');
    });

    it('data_quality absent → meta reste vide, pas d\'erreur', async () => {
      global.KmcApi.getControlTower.mockResolvedValue(baseCtData({ data_quality: undefined }));
      await expect(window.ControlTowerView.render(root)).resolves.not.toThrow();
      await flush();
      expect(document.getElementById('ct-meta').textContent).toBe('');
    });
  });

  describe('Garde navigation (rootEl détaché pendant le fetch)', () => {
    it('rootEl retiré du DOM avant résolution → aucun rendu déclenché', async () => {
      global.KmcApi.getControlTower.mockImplementation(() => {
        root.remove();
        return Promise.resolve(baseCtData());
      });
      await window.ControlTowerView.render(root);
      await flush();
      expect(global.KpiCard.renderBar).not.toHaveBeenCalled();
    });
  });

  describe('Erreurs', () => {
    it('erreur générique → error-state dans #ct-kpis, sans mention 401', async () => {
      global.KmcApi.getControlTower.mockRejectedValue(new Error('boom'));
      await window.ControlTowerView.render(root);
      await flush();
      const html = document.getElementById('ct-kpis').innerHTML;
      expect(html).toContain('boom');
      expect(html).not.toContain('connectez-vous');
    });

    it('ApiError 401 → message session/connexion admin', async () => {
      global.KmcApi.getControlTower.mockRejectedValue(new global.KmcApi.ApiError('unauthorized', 401));
      await window.ControlTowerView.render(root);
      await flush();
      expect(document.getElementById('ct-kpis').innerHTML).toContain('connectez-vous comme admin');
    });

    it('getOps en échec → traité comme null (pas de crash, section SLA en indisponible)', async () => {
      global.KmcApi.getOps.mockRejectedValue(new Error('network'));
      await expect(window.ControlTowerView.render(root)).resolves.not.toThrow();
      await flush();
      expect(document.getElementById('ct-sla').innerHTML).toContain('Données SLA indisponibles');
    });

    it('getUnsoldStats en échec → traité comme null (pas de crash, section invendus en indisponible)', async () => {
      global.KmcApi.getUnsoldStats.mockRejectedValue(new Error('network'));
      await expect(window.ControlTowerView.render(root)).resolves.not.toThrow();
      await flush();
      expect(document.getElementById('ct-unsold').innerHTML).toContain('Données invendus indisponibles');
    });
  });
});
