'use strict';

/**
 * tests/unit/HubRelaisView.test.js
 *
 * admin/js/views/HubRelaisView.js (996L) — fusion Hub (Commander → Répartir →
 * Expédier) + Relais (Encaisser → Réceptionner → Distribuer).
 * Export public unique : render(rootEl).
 *
 * Dépendance externe : `KmcApi` (global, mocké) — getPipeline(), getParcels(params),
 * hubMarkOrdered(ref), hubShip(ref), autoDistribute(), getDistribution(),
 * relaisConfirmCash(ref), relaisReceive(ref), relaisCollect(ref).
 * `window.confirm` mocké (doAction() demande confirmation avant chaque mutation).
 *
 * Périmètre couvert :
 *   - render() : shell, mode bar (Hub actif par défaut), chargement initial Hub
 *   - populateHub : segmentation orders/parcels, KPI chips, onglet par défaut
 *     selon les données, alertes (stuck48h/expired36h/critical7d), forecast
 *     (mini-tables + plafond "+N autres")
 *   - Panneau répartition (loadDistributionPanel) : cas peuplé (colis + cmds +
 *     saturation + non-assignés), cas vide, erreur réseau
 *   - Actions Hub : hub-mark-ordered, hub-ship, auto-distribute (confirm annulé,
 *     succès, échec API)
 *   - Bascule d'onglet (switchTab) et refresh manuel (btn-refresh-hub)
 *   - populateRelais : segmentation cash/transit/available/collected, KPI,
 *     alertes (uncollected72/lateTransit/cashExpired), onglet par défaut
 *   - Actions Relais : relais-confirm-cash, relais-arrived, relais-collected
 *   - Bascule de mode (Hub ↔ Relais) via .hr-mode-btn
 *   - Erreur réseau dans refreshView (getPipeline/getParcels qui échoue)
 */

function makeOrder(overrides) {
  return Object.assign({
    reference: 'CMD-100',
    status: 'confirmed',
    client_name: 'Ali M.',
    total_kmf: 15000,
    nb_items: 2,
    items: [],
    relais_island: 'Ngazidja',
    created_at: new Date().toISOString(),
    payment_mode: 'card',
    payment_status: 'paid',
  }, overrides);
}

function makeParcel(overrides) {
  return Object.assign({
    reference: 'COL-100',
    status: 'preparation',
    recipient_name: 'Fatima B.',
    main_order_ref: 'CMD-999',
    nb_items: 3,
    total_kmf: 20000,
    destination_island: 'Ndzuwani',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, overrides);
}

function emptyPipeline() {
  return { pipeline: { pending: { orders: [] }, confirmed: { orders: [] }, ordered: { orders: [] } } };
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

const { makeKmcApi, cleanupGlobals } = require('./helpers/dashboardTestKit');

describe('HubRelaisView', () => {
  let root;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    makeKmcApi({
      getPipeline: jest.fn().mockResolvedValue(emptyPipeline()),
      getParcels: jest.fn().mockResolvedValue({ parcels: [] }),
      getDistribution: jest.fn().mockResolvedValue({ parcels: [], unassigned: [], saturated: [] }),
      hubMarkOrdered: jest.fn().mockResolvedValue({}),
      hubShip: jest.fn().mockResolvedValue({}),
      autoDistribute: jest.fn().mockResolvedValue({ distributed: 1 }),
      relaisConfirmCash: jest.fn().mockResolvedValue({}),
      relaisReceive: jest.fn().mockResolvedValue({}),
      relaisCollect: jest.fn().mockResolvedValue({}),
    });
    global.confirm = jest.fn(() => true);

    require('../../admin/js/views/HubRelaisView.js');
  });

  afterEach(() => {
    cleanupGlobals('KmcApi');
    delete global.confirm;
  });

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    expect(typeof window.HubRelaisView).toBe('object');
    expect(typeof window.HubRelaisView.render).toBe('function');
  });

  describe('render() — shell et chargement initial (Hub par défaut)', () => {
    it('pose le shell, active l\'onglet Hub, appelle getPipeline + getParcels + getDistribution', async () => {
      await window.HubRelaisView.render(root);
      await flush();

      expect(root.querySelector('.hr-mode-btn[data-mode="hub"]').classList.contains('active')).toBe(true);
      expect(global.KmcApi.getPipeline).toHaveBeenCalled();
      expect(global.KmcApi.getParcels).toHaveBeenCalledWith({ limit: 500 });
      expect(root.querySelector('.hub-kpi-chips').innerHTML).not.toBe('');
    });

    it('aucune donnée → onglet par défaut "Expédier" (aucun confirmé ni ordered)', async () => {
      await window.HubRelaisView.render(root);
      await flush();
      const panel = root.querySelector('[data-panel="h-expedier"]');
      expect(panel.style.display).toBe('block');
    });

    it('des commandes confirmées → onglet par défaut "Commander" et table peuplée', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [makeOrder({ reference: 'CMD-1', status: 'confirmed' })] },
          ordered: { orders: [] },
        },
      });
      await window.HubRelaisView.render(root);
      await flush();

      expect(root.querySelector('[data-panel="h-commander"]').style.display).toBe('block');
      expect(root.querySelector('[data-panel="h-commander"]').textContent).toContain('CMD-1');
    });

    it('des ordered sans colis existant → onglet par défaut "Répartir"', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [] },
          ordered: { orders: [makeOrder({ reference: 'CMD-2', status: 'ordered' })] },
        },
      });
      global.KmcApi.getParcels.mockResolvedValue({ parcels: [] });
      await window.HubRelaisView.render(root);
      await flush();

      expect(root.querySelector('[data-panel="h-repartir"]').style.display).toBe('block');
    });
  });

  describe('alertes Hub', () => {
    it('aucune alerte → "Aucune alerte"', async () => {
      await window.HubRelaisView.render(root);
      await flush();
      expect(root.querySelector('.alerts-content').textContent).toContain('Aucune alerte');
    });

    it('commandes confirmées bloquées >48h et pending expirées >36h → chips d\'alerte', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [makeOrder({ reference: 'CMD-3', status: 'pending', created_at: hoursAgoIso(40) })] },
          confirmed: { orders: [makeOrder({ reference: 'CMD-4', status: 'confirmed', created_at: hoursAgoIso(50) })] },
          ordered: { orders: [] },
        },
      });
      await window.HubRelaisView.render(root);
      await flush();

      const alerts = root.querySelector('.alerts-content').textContent;
      expect(alerts).toContain('Confirmés bloqués');
      expect(alerts).toContain('Paiements expirés');
      expect(root.querySelector('.hub-kpi-chips').textContent).toContain('🚨 Alertes');
    });

    it('forecast : plus de 8 commandes en attente → "+ N autres…"', async () => {
      const pending = Array.from({ length: 10 }, (_, i) =>
        makeOrder({ reference: `CMD-P${i}`, status: 'pending', created_at: new Date().toISOString() }));
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: { pending: { orders: pending }, confirmed: { orders: [] }, ordered: { orders: [] } },
      });
      await window.HubRelaisView.render(root);
      await flush();

      expect(root.querySelector('.forecast-content').textContent).toContain('autres');
    });
  });

  describe('panneau répartition (loadDistributionPanel)', () => {
    // Le panneau distribution n'est injecté dans le DOM que si "Répartir" est
    // l'onglet actif par défaut (renderTabset ne peuple que l'onglet actif ;
    // switchTab ne fait que basculer l'affichage, sans re-populer le contenu).
    // → on force cet état via confirmed=[] + un "ordered" sans colis existant.
    function readyToDispatchPipeline() {
      return {
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [] },
          ordered: { orders: [makeOrder({ reference: 'CMD-RDY', status: 'ordered' })] },
        },
      };
    }

    beforeEach(() => {
      global.KmcApi.getPipeline.mockResolvedValue(readyToDispatchPipeline());
      global.KmcApi.getParcels.mockResolvedValue({ parcels: [] });
    });

    it('cas peuplé : colis + saturation + non-assignés', async () => {
      global.KmcApi.getDistribution.mockResolvedValue({
        parcels: [{
          reference: 'COL-A', status: 'preparation', relais_island: 'Ngazidja',
          orders_count: 2, items_count: 5, total_kmf: 30000,
          orders: [{ ref: 'CMD-A1', customer: 'Ali', items_count: 2, total_kmf: 10000 }],
        }],
        saturated: [{ destination: 'Ngazidja', open_parcels: 3, queued_orders: 4 }],
        unassigned: [{ reference: 'CMD-U1', client_name: 'Zena', items_count: 1, relais_island: 'Ndzuwani' }],
        limits: { MAX_OPEN_PARCELS_PER_DEST: 3 },
      });
      await window.HubRelaisView.render(root);
      await flush();

      const dist = root.querySelector('.distribution-panel').textContent;
      expect(dist).toContain('COL-A');
      expect(dist).toContain('Capacité max atteinte');
      expect(dist).toContain('non assignée');
    });

    it('cas vide : aucune commande à répartir', async () => {
      global.KmcApi.getDistribution.mockResolvedValue({ parcels: [], unassigned: [], saturated: [] });
      await window.HubRelaisView.render(root);
      await flush();
      expect(root.querySelector('.distribution-panel').textContent).toContain('Aucune commande à répartir');
    });

    it('erreur réseau → message d\'erreur affiché dans le panneau', async () => {
      global.KmcApi.getDistribution.mockRejectedValue(new Error('boom'));
      await window.HubRelaisView.render(root);
      await flush();
      expect(root.querySelector('.distribution-panel').textContent).toContain('boom');
    });

    it('clic sur "Expédier" dans une carte de répartition → hubShip puis refresh', async () => {
      global.KmcApi.getDistribution.mockResolvedValue({
        parcels: [{ reference: 'COL-B', status: 'preparation', orders_count: 1, items_count: 1, total_kmf: 5000, orders: [] }],
        unassigned: [], saturated: [],
      });
      await window.HubRelaisView.render(root);
      await flush();

      const btn = root.querySelector('[data-action="dist-ship"]');
      expect(btn).toBeTruthy();
      btn.click();
      await flush();
      expect(global.KmcApi.hubShip).toHaveBeenCalledWith('COL-B');
    });
  });

  describe('actions Hub (doAction)', () => {
    it('hub-mark-ordered : confirm accepté → appelle l\'API et rafraîchit', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [makeOrder({ reference: 'CMD-5', status: 'confirmed' })] },
          ordered: { orders: [] },
        },
      });
      await window.HubRelaisView.render(root);
      await flush();

      const btn = root.querySelector('[data-action="hub-mark-ordered"]');
      btn.click();
      await flush();

      expect(global.confirm).toHaveBeenCalled();
      expect(global.KmcApi.hubMarkOrdered).toHaveBeenCalledWith('CMD-5');
    });

    it('hub-mark-ordered : confirm annulé → n\'appelle pas l\'API', async () => {
      global.confirm = jest.fn(() => false);
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [makeOrder({ reference: 'CMD-6', status: 'confirmed' })] },
          ordered: { orders: [] },
        },
      });
      await window.HubRelaisView.render(root);
      await flush();

      root.querySelector('[data-action="hub-mark-ordered"]').click();
      await flush();

      expect(global.KmcApi.hubMarkOrdered).not.toHaveBeenCalled();
    });

    it('hub-mark-ordered : échec API → bouton réactivé, texte original restauré', async () => {
      global.KmcApi.hubMarkOrdered.mockRejectedValue(new Error('conflit'));
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [makeOrder({ reference: 'CMD-7', status: 'confirmed' })] },
          ordered: { orders: [] },
        },
      });
      await window.HubRelaisView.render(root);
      await flush();

      const btn = root.querySelector('[data-action="hub-mark-ordered"]');
      const original = btn.textContent;
      btn.click();
      await flush();

      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe(original);
    });

    it('hub-ship : clic → appelle hubShip', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [] },
          ordered: { orders: [] },
        },
      });
      global.KmcApi.getParcels.mockResolvedValue({ parcels: [makeParcel({ reference: 'COL-C', status: 'preparation' })] });
      await window.HubRelaisView.render(root);
      await flush();

      const btn = root.querySelector('[data-action="hub-ship"]');
      expect(btn).toBeTruthy();
      btn.click();
      await flush();
      expect(global.KmcApi.hubShip).toHaveBeenCalledWith('COL-C');
    });

    it('auto-distribute : succès → toast et rechargement du panneau', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [] },
          ordered: { orders: [makeOrder({ reference: 'CMD-RDY2', status: 'ordered' })] },
        },
      });
      global.KmcApi.getParcels.mockResolvedValue({ parcels: [] });
      await window.HubRelaisView.render(root);
      await flush();

      const btn = root.querySelector('.btn-auto-distribute');
      expect(btn).toBeTruthy();
      btn.click();
      await flush();

      expect(global.KmcApi.autoDistribute).toHaveBeenCalled();
      expect(btn.disabled).toBe(false);
    });

    it('auto-distribute : échec API → toast d\'erreur, bouton réactivé', async () => {
      global.KmcApi.autoDistribute.mockRejectedValue(new Error('indispo'));
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [] },
          ordered: { orders: [makeOrder({ reference: 'CMD-RDY3', status: 'ordered' })] },
        },
      });
      global.KmcApi.getParcels.mockResolvedValue({ parcels: [] });
      await window.HubRelaisView.render(root);
      await flush();

      const btn = root.querySelector('.btn-auto-distribute');
      btn.click();
      await flush();

      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toContain('Répartir maintenant');
    });
  });

  describe('onglets et refresh manuel (Hub)', () => {
    it('bascule d\'onglet via clic sur le tab bar', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [makeOrder({ reference: 'CMD-8', status: 'confirmed' })] },
          ordered: { orders: [] },
        },
      });
      await window.HubRelaisView.render(root);
      await flush();

      expect(root.querySelector('[data-panel="h-commander"]').style.display).toBe('block');
      root.querySelector('.hr-tabbar [data-tab="h-expedier"]').click();

      expect(root.querySelector('[data-panel="h-expedier"]').style.display).toBe('block');
      expect(root.querySelector('[data-panel="h-commander"]').style.display).toBe('none');
    });

    it('clic sur "Actualiser" (Hub) → recharge getPipeline', async () => {
      await window.HubRelaisView.render(root);
      await flush();
      global.KmcApi.getPipeline.mockClear();

      root.querySelector('.btn-refresh-hub').click();
      await flush();

      expect(global.KmcApi.getPipeline).toHaveBeenCalled();
    });
  });

  describe('mode Relais', () => {
    async function switchToRelais() {
      await window.HubRelaisView.render(root);
      await flush();
      root.querySelector('.hr-mode-btn[data-mode="relais"]').click();
      await flush();
    }

    it('bascule vers Relais → charge getPipeline/getParcels, KPI chips peuplés', async () => {
      await switchToRelais();
      expect(root.querySelector('.hr-mode-btn[data-mode="relais"]').classList.contains('active')).toBe(true);
      expect(root.querySelector('.relais-kpi-chips').innerHTML).not.toBe('');
    });

    it('cash en attente → onglet par défaut "Encaisser" avec la table peuplée', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: {
            orders: [makeOrder({
              reference: 'CMD-CASH', status: 'pending', payment_mode: 'cash_relay',
              payment_status: 'unpaid', cash_code: 'X123',
            })],
          },
          confirmed: { orders: [] }, ordered: { orders: [] },
        },
      });
      await switchToRelais();

      expect(root.querySelector('[data-panel="r-encaisser"]').style.display).toBe('block');
      expect(root.querySelector('[data-panel="r-encaisser"]').textContent).toContain('CMD-CASH');
    });

    it('colis en transit sans cash → onglet par défaut "Réceptionner"', async () => {
      global.KmcApi.getParcels.mockResolvedValue({ parcels: [makeParcel({ reference: 'COL-T', status: 'in_transit' })] });
      await switchToRelais();
      expect(root.querySelector('[data-panel="r-receptionner"]').style.display).toBe('block');
    });

    it('alertes relais : non collectés >72h, transit tardif >10j, cash expiré >36h', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: {
            orders: [makeOrder({
              reference: 'CMD-EXP', status: 'pending', payment_mode: 'cash_relais',
              payment_status: 'unpaid', created_at: hoursAgoIso(40),
            })],
          },
          confirmed: { orders: [] }, ordered: { orders: [] },
        },
      });
      global.KmcApi.getParcels.mockResolvedValue({
        parcels: [
          makeParcel({ reference: 'COL-LATE', status: 'in_transit', created_at: daysAgoIso(11) }),
          makeParcel({ reference: 'COL-STALE', status: 'available', updated_at: hoursAgoIso(80) }),
        ],
      });
      await switchToRelais();

      const alerts = root.querySelector('.alerts-content').textContent;
      expect(alerts).toContain('Cash expiré');
      expect(alerts).toContain('Non collectés');
      expect(alerts).toContain('Transit tardif');
    });

    // Comme pour Hub, seul l'onglet actif par défaut reçoit son contenu réel
    // (renderTabset) ; on force donc chaque onglet à être celui par défaut
    // pour tester son action, plutôt que de cliquer dessus après coup.

    it('relais-confirm-cash : cash en attente (onglet "Encaisser" par défaut)', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: {
            orders: [makeOrder({
              reference: 'CMD-CASH2', status: 'pending', payment_mode: 'cash_relay', payment_status: 'unpaid',
            })],
          },
          confirmed: { orders: [] }, ordered: { orders: [] },
        },
      });
      global.KmcApi.getParcels.mockResolvedValue({ parcels: [] });
      await switchToRelais();

      root.querySelector('[data-action="relais-confirm-cash"]').click();
      await flush();
      expect(global.KmcApi.relaisConfirmCash).toHaveBeenCalledWith('CMD-CASH2');
    });

    it('relais-arrived : colis en transit sans cash (onglet "Réceptionner" par défaut)', async () => {
      global.KmcApi.getPipeline.mockResolvedValue(emptyPipeline());
      global.KmcApi.getParcels.mockResolvedValue({
        parcels: [makeParcel({ reference: 'COL-ARR', status: 'in_transit' })],
      });
      await switchToRelais();

      const btn = root.querySelector('[data-action="relais-arrived"]');
      expect(btn).toBeTruthy();
      btn.click();
      await flush();
      expect(global.KmcApi.relaisReceive).toHaveBeenCalledWith('COL-ARR');
    });

    it('relais-collected : colis disponibles sans cash ni transit (onglet "Distribuer" par défaut)', async () => {
      global.KmcApi.getPipeline.mockResolvedValue(emptyPipeline());
      global.KmcApi.getParcels.mockResolvedValue({
        parcels: [makeParcel({ reference: 'COL-AVA', status: 'available' })],
      });
      await switchToRelais();

      const btn = root.querySelector('[data-action="relais-collected"]');
      expect(btn).toBeTruthy();
      btn.click();
      await flush();
      expect(global.KmcApi.relaisCollect).toHaveBeenCalledWith('COL-AVA');
    });

    it('clic sur "Actualiser" (Relais) → recharge getPipeline', async () => {
      await switchToRelais();
      global.KmcApi.getPipeline.mockClear();

      root.querySelector('.btn-refresh-relais').click();
      await flush();

      expect(global.KmcApi.getPipeline).toHaveBeenCalled();
    });

    it('revenir sur Hub après Relais recharge le mode Hub', async () => {
      await switchToRelais();
      root.querySelector('.hr-mode-btn[data-mode="hub"]').click();
      await flush();

      expect(root.querySelector('.hr-mode-btn[data-mode="hub"]').classList.contains('active')).toBe(true);
      expect(root.querySelector('.hub-kpi-chips')).toBeTruthy();
    });
  });

  describe('erreur réseau au chargement d\'un mode', () => {
    it('getPipeline échoue → message d\'erreur affiché à la place du contenu', async () => {
      global.KmcApi.getPipeline.mockRejectedValue(new Error('réseau HS'));
      await window.HubRelaisView.render(root);
      await flush();

      expect(root.querySelector('.hr-content').textContent).toContain('réseau HS');
    });
  });
});
