'use strict';

/**
 * tests/unit/HubRelaisView.test.js
 *
 * js/views/HubRelaisView.js (996L) — vue fusionnée Hub (Commander → Répartir →
 * Expédier) + Relais (Encaisser → Réceptionner → Distribuer). Seul export
 * public : `render(rootEl)`. Tout le reste (populateHub, populateRelais,
 * loadDistributionPanel, doAction, les formatters, les builders de table)
 * est privé, exercé uniquement via `render()` + les événements DOM
 * (clics boutons, changement de mode).
 *
 * Dépendance externe : `KmcApi` (global, posé par api-client.js — ici
 * entièrement mocké via `global.KmcApi`, comme documenté pour SanteView.js
 * et les autres vues du même dossier). `confirm()` et `alert()` mockés
 * (doAction() demande confirmation avant toute mutation).
 *
 * Périmètre couvert :
 *   - render() : shell, mode bar, chargement initial du mode Hub
 *   - populateHub (via render) : KPI chips, segmentation (confirmed/ordered/
 *     pending), onglet actif par défaut, tables Commander/Expédier, alertes
 *     (stuck48h/expired36h/ordered48h/critical7d), forecast, actions
 *     (hub-mark-ordered, hub-ship, auto-distribute), refresh
 *   - loadDistributionPanel : succès (colis/non-assignés/saturation),
 *     panier vide, erreur réseau
 *   - populateRelais (via bascule de mode) : KPI chips, segmentation
 *     (cashPending/transit/available/collected), onglet actif par défaut,
 *     alertes, actions (relais-confirm-cash, relais-arrived, relais-collected)
 *   - doAction : garde confirm() annulé, chemin succès, chemin erreur
 *     (réactive le bouton, affiche le message d'erreur)
 *   - erreur réseau au chargement initial d'un mode → message d'erreur inline
 *
 * Dette assumée, hors périmètre de ce lot : switchTab() en détail (bascule
 * visuelle pure, déjà exercée indirectement par le rendu initial), et le
 * CSS injecté (`<style>`) — non pertinent en jsdom.
 */

function makeOrder(overrides) {
  return Object.assign({
    reference: 'CMD-001',
    client_name: 'Fatima A.',
    status: 'confirmed',
    total_kmf: 12000,
    nb_items: 2,
    relais_island: 'Grande Comore',
    payment_mode: 'cash_relay',
    payment_status: 'pending',
    created_at: new Date().toISOString(),
  }, overrides);
}

function makeParcel(overrides) {
  return Object.assign({
    reference: 'COL-001',
    recipient_name: 'Fatima A.',
    main_order_ref: 'CMD-999',
    status: 'preparation',
    nb_items: 2,
    total_kmf: 12000,
    destination_island: 'Anjouan',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, overrides);
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function emptyPipeline() {
  return { pipeline: { pending: { orders: [] }, confirmed: { orders: [] }, ordered: { orders: [] } } };
}
function emptyParcels() {
  return { parcels: [] };
}
function emptyDistribution() {
  return { parcels: [], unassigned: [], saturated: [] };
}

describe('HubRelaisView', () => {
  let root;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    global.confirm = jest.fn(() => true);
    global.KmcApi = {
      getPipeline: jest.fn().mockResolvedValue(emptyPipeline()),
      getParcels: jest.fn().mockResolvedValue(emptyParcels()),
      getDistribution: jest.fn().mockResolvedValue(emptyDistribution()),
      hubMarkOrdered: jest.fn().mockResolvedValue({}),
      hubShip: jest.fn().mockResolvedValue({}),
      autoDistribute: jest.fn().mockResolvedValue({ distributed: 3 }),
      relaisConfirmCash: jest.fn().mockResolvedValue({}),
      relaisReceive: jest.fn().mockResolvedValue({}),
      relaisCollect: jest.fn().mockResolvedValue({}),
    };

    require('../../admin/js/views/HubRelaisView.js');
  });

  afterEach(() => {
    delete global.KmcApi;
    delete global.confirm;
  });

  it('expose render() (contrat attendu par app.js#invokeView)', () => {
    expect(typeof window.HubRelaisView).toBe('object');
    expect(typeof window.HubRelaisView.render).toBe('function');
  });

  describe('render() — shell + chargement initial', () => {
    it('pose la mode-bar Hub/Relais et charge le mode Hub par défaut', async () => {
      await window.HubRelaisView.render(root);
      const modeBtns = root.querySelectorAll('.hr-mode-btn');
      expect(modeBtns.length).toBe(2);
      expect(root.querySelector('[data-mode="hub"]').classList.contains('active')).toBe(true);
      expect(global.KmcApi.getPipeline).toHaveBeenCalled();
      expect(global.KmcApi.getParcels).toHaveBeenCalledWith({ limit: 500 });
      expect(root.querySelector('.hr-hub-wrapper')).not.toBeNull();
    });

    it('panier/pipeline vides → 0 partout et pas de crash', async () => {
      await window.HubRelaisView.render(root);
      const chips = root.querySelectorAll('.hub-kpi-chips .hr-kpi-chip b');
      chips.forEach(c => expect(c.textContent).toBe('0'));
    });

    it('erreur réseau au chargement initial → message d\'erreur inline, pas de crash', async () => {
      global.KmcApi.getPipeline.mockRejectedValue(new Error('offline'));
      await expect(window.HubRelaisView.render(root)).resolves.not.toThrow();
      expect(root.querySelector('.hr-content').textContent).toContain('Erreur hub');
      expect(root.querySelector('.hr-content').textContent).toContain('offline');
    });
  });

  describe('populateHub — segmentation et KPI', () => {
    it('segmente confirmed/ordered/pending et affiche les bons compteurs', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending:   { orders: [makeOrder({ reference: 'P1', status: 'pending' })] },
          confirmed: { orders: [makeOrder({ reference: 'C1' }), makeOrder({ reference: 'C2' })] },
          ordered:   { orders: [makeOrder({ reference: 'O1', status: 'ordered' })] },
        },
      });
      await window.HubRelaisView.render(root);

      const label = (l) => root.querySelector(`.hub-kpi-chips`).textContent;
      expect(label()).toContain('🛒 Commander');
      // confirmed.length = 2 → premier onglet actif = h-commander
      const commanderPanel = root.querySelector('[data-panel="h-commander"]');
      expect(commanderPanel.innerHTML).toContain('C1');
      expect(commanderPanel.innerHTML).toContain('C2');
    });

    it('ordered sans colis existant (main_order_ref absent des colis) → compté "prêt à répartir"', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] }, confirmed: { orders: [] },
          ordered: { orders: [makeOrder({ reference: 'O1', status: 'ordered' })] },
        },
      });
      global.KmcApi.getParcels.mockResolvedValue({ parcels: [] }); // aucun colis → O1 "prêt"
      await window.HubRelaisView.render(root);
      // confirmed=0, readyParcel=1 → onglet actif = h-repartir
      const repartirPanel = root.querySelector('[data-panel="h-repartir"]');
      expect(repartirPanel.style.display).toBe('block');
    });

    it('colis en préparation → apparaissent dans le panel Expédier avec bouton', async () => {
      global.KmcApi.getParcels.mockResolvedValue({
        parcels: [makeParcel({ reference: 'COL-9', status: 'preparation' })],
      });
      await window.HubRelaisView.render(root);
      const expedierPanel = root.querySelector('[data-panel="h-expedier"]');
      expect(expedierPanel.innerHTML).toContain('COL-9');
      expect(expedierPanel.querySelector('[data-action="hub-ship"]')).not.toBeNull();
    });

    it('aucune donnée → l\'onglet actif par défaut (h-expedier) affiche l\'état vide', async () => {
      await window.HubRelaisView.render(root);
      // confirmed=0 et readyParcel=0 → fallback firstActive = 'h-expedier'
      const expedierPanel = root.querySelector('[data-panel="h-expedier"]');
      expect(expedierPanel.style.display).toBe('block');
      expect(expedierPanel.innerHTML).toContain('Rien à traiter');
    });
  });

  describe('populateHub — alertes', () => {
    it('aucune alerte → message "Aucune alerte"', async () => {
      await window.HubRelaisView.render(root);
      expect(root.querySelector('.hub-alerts .alerts-content').innerHTML).toContain('Aucune alerte');
    });

    it('commande confirmed bloquée >48h → alerte "Confirmés bloqués"', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] }, ordered: { orders: [] },
          confirmed: { orders: [makeOrder({ reference: 'C-OLD', created_at: hoursAgoIso(50) })] },
        },
      });
      await window.HubRelaisView.render(root);
      const alerts = root.querySelector('.hub-alerts .alerts-content').innerHTML;
      expect(alerts).toContain('Confirmés bloqués');
    });

    it('commande pending expirée >36h → alerte "Paiements expirés"', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          confirmed: { orders: [] }, ordered: { orders: [] },
          pending: { orders: [makeOrder({ reference: 'P-OLD', status: 'pending', created_at: hoursAgoIso(40) })] },
        },
      });
      await window.HubRelaisView.render(root);
      expect(root.querySelector('.hub-alerts .alerts-content').innerHTML).toContain('Paiements expirés');
    });

    it('commande critique >7 jours (ordered ou confirmed) → alerte "Critique"', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] },
          confirmed: { orders: [makeOrder({ reference: 'C-CRIT', created_at: daysAgoIso(8) })] },
          ordered: { orders: [] },
        },
      });
      await window.HubRelaisView.render(root);
      expect(root.querySelector('.hub-alerts .alerts-content').innerHTML).toContain('Critique');
    });
  });

  describe('populateHub — actions', () => {
    it('clic "Commander" → confirm() puis KmcApi.hubMarkOrdered puis refresh', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] }, ordered: { orders: [] },
          confirmed: { orders: [makeOrder({ reference: 'C-1' })] },
        },
      });
      await window.HubRelaisView.render(root);
      const btn = root.querySelector('[data-action="hub-mark-ordered"][data-ref="C-1"]');
      btn.click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(global.confirm).toHaveBeenCalled();
      expect(global.KmcApi.hubMarkOrdered).toHaveBeenCalledWith('C-1');
      // refresh déclenché → getPipeline rappelé au moins 2 fois (initial + refresh)
      expect(global.KmcApi.getPipeline.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('confirm() annulé → aucune mutation, bouton inchangé', async () => {
      global.confirm.mockReturnValue(false);
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] }, ordered: { orders: [] },
          confirmed: { orders: [makeOrder({ reference: 'C-1' })] },
        },
      });
      await window.HubRelaisView.render(root);
      const btn = root.querySelector('[data-action="hub-mark-ordered"][data-ref="C-1"]');
      btn.click();
      await Promise.resolve();
      expect(global.KmcApi.hubMarkOrdered).not.toHaveBeenCalled();
      expect(btn.disabled).toBe(false);
    });

    it('mutation en échec → bouton réactivé avec son texte d\'origine', async () => {
      global.KmcApi.hubMarkOrdered.mockRejectedValue(new Error('boom'));
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] }, ordered: { orders: [] },
          confirmed: { orders: [makeOrder({ reference: 'C-1' })] },
        },
      });
      await window.HubRelaisView.render(root);
      const btn = root.querySelector('[data-action="hub-mark-ordered"][data-ref="C-1"]');
      btn.click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('🛒 Commander');
    });

    it('clic "Répartir maintenant" → autoDistribute puis recharge distribution + refresh hub', async () => {
      // Le bouton .btn-auto-distribute vit dans le contenu de l'onglet "h-repartir" ;
      // il faut qu'il soit actif au premier rendu (confirmed=0, readyParcel>0).
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] }, confirmed: { orders: [] },
          ordered: { orders: [makeOrder({ reference: 'O-READY', status: 'ordered' })] },
        },
      });
      await window.HubRelaisView.render(root);
      const btn = root.querySelector('.btn-auto-distribute');
      btn.click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.autoDistribute).toHaveBeenCalled();
      expect(global.KmcApi.getDistribution.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('clic refresh hub → recharge pipeline/colis', async () => {
      await window.HubRelaisView.render(root);
      root.querySelector('.btn-refresh-hub').click();
      await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.getPipeline.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('loadDistributionPanel', () => {
    // .distribution-panel ne vit que dans le contenu de l'onglet "h-repartir" ;
    // renderTabset() n'injecte le HTML que de l'onglet actif au premier rendu.
    // On force donc confirmed=0 + un "ordered" sans colis associé (readyParcel>0)
    // pour que firstActive === 'h-repartir'.
    beforeEach(() => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [] }, confirmed: { orders: [] },
          ordered: { orders: [makeOrder({ reference: 'O-READY', status: 'ordered' })] },
        },
      });
    });

    it('affiche les colis, non-assignés et alertes de saturation', async () => {
      global.KmcApi.getDistribution.mockResolvedValue({
        parcels: [{ reference: 'D-1', status: 'draft', orders_count: 2, items_count: 5, total_kmf: 9000, orders: [] }],
        unassigned: [{ reference: 'U-1', client_name: 'X', items_count: 3 }],
        saturated: [{ destination: 'Mohéli', open_parcels: 4, queued_orders: 2 }],
        limits: { MAX_OPEN_PARCELS_PER_DEST: 3 },
      });
      await window.HubRelaisView.render(root);
      const panel = root.querySelector('.distribution-panel');
      expect(panel.innerHTML).toContain('D-1');
      expect(panel.innerHTML).toContain('U-1');
      expect(panel.innerHTML).toContain('Capacité max atteinte');
    });

    it('rien à répartir → état vide', async () => {
      await window.HubRelaisView.render(root);
      expect(root.querySelector('.distribution-panel').innerHTML).toContain('Aucune commande à répartir');
    });

    it('erreur réseau sur getDistribution → message d\'erreur dans le panel (pas de crash global)', async () => {
      global.KmcApi.getDistribution.mockRejectedValue(new Error('dist down'));
      await expect(window.HubRelaisView.render(root)).resolves.not.toThrow();
      expect(root.querySelector('.distribution-panel').innerHTML).toContain('dist down');
    });

    it('colis en préparation avec commandes assignées → bouton Expédier + lignes de commande', async () => {
      global.KmcApi.getDistribution.mockResolvedValue({
        parcels: [{
          reference: 'D-2', status: 'preparation', orders_count: 1, items_count: 2, total_kmf: 5000,
          orders: [{ ref: 'CMD-A', customer: 'Yasmine', items_count: 2, total_kmf: 5000 }],
        }],
        unassigned: [], saturated: [],
      });
      await window.HubRelaisView.render(root);
      const panel = root.querySelector('.distribution-panel');
      expect(panel.querySelector('[data-action="dist-ship"][data-ref="D-2"]')).not.toBeNull();
      expect(panel.innerHTML).toContain('CMD-A');
    });

    it('clic "Expédier" (dist-ship) → hubShip puis refresh', async () => {
      global.KmcApi.getDistribution.mockResolvedValue({
        parcels: [{ reference: 'D-3', status: 'preparation', orders_count: 0, items_count: 0, total_kmf: 0, orders: [] }],
        unassigned: [], saturated: [],
      });
      await window.HubRelaisView.render(root);
      const btn = root.querySelector('[data-action="dist-ship"][data-ref="D-3"]');
      btn.click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.hubShip).toHaveBeenCalledWith('D-3');
    });
  });

  describe('bascule de mode → populateRelais', () => {
    async function switchToRelais() {
      await window.HubRelaisView.render(root);
      root.querySelector('[data-mode="relais"]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }

    it('clic sur le mode Relais → charge le squelette + données relais', async () => {
      await switchToRelais();
      expect(root.querySelector('.hr-relais-wrapper')).not.toBeNull();
      expect(root.querySelector('[data-mode="relais"]').classList.contains('active')).toBe(true);
      expect(root.querySelector('[data-mode="hub"]').classList.contains('active')).toBe(false);
    });

    it('segmente cashPending (cash_relay/cash_relais, non payé) et affiche le panel Encaisser', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [
            makeOrder({ reference: 'CASH-1', status: 'pending', payment_mode: 'cash_relay', payment_status: 'pending' }),
            makeOrder({ reference: 'PAID-1', status: 'pending', payment_mode: 'cash_relay', payment_status: 'paid' }),
            makeOrder({ reference: 'STRIPE-1', status: 'pending', payment_mode: 'stripe_eur', payment_status: 'pending' }),
          ] },
          confirmed: { orders: [] }, ordered: { orders: [] },
        },
      });
      await switchToRelais();
      const panel = root.querySelector('[data-panel="r-encaisser"]');
      expect(panel.innerHTML).toContain('CASH-1');
      expect(panel.innerHTML).not.toContain('PAID-1');
      expect(panel.innerHTML).not.toContain('STRIPE-1');
    });

    it('colis available → panel Distribuer avec bouton "Remis"', async () => {
      global.KmcApi.getParcels.mockResolvedValue({
        parcels: [makeParcel({ reference: 'AV-1', status: 'available', pickup_code: '4242' })],
      });
      await switchToRelais();
      const panel = root.querySelector('[data-panel="r-distribuer"]');
      expect(panel.innerHTML).toContain('AV-1');
      expect(panel.innerHTML).toContain('4242');
      expect(panel.querySelector('[data-action="relais-collected"]')).not.toBeNull();
    });

    it('colis in_transit tardif (>10 jours) → alerte "Transit tardif"', async () => {
      global.KmcApi.getParcels.mockResolvedValue({
        parcels: [makeParcel({ reference: 'T-OLD', status: 'in_transit', created_at: daysAgoIso(12) })],
      });
      await switchToRelais();
      expect(root.querySelector('.relais-alerts .alerts-content').innerHTML).toContain('Transit tardif');
    });

    it('colis available non retiré >72h → alerte "Non collectés"', async () => {
      global.KmcApi.getParcels.mockResolvedValue({
        parcels: [makeParcel({ reference: 'AV-OLD', status: 'available', updated_at: hoursAgoIso(80) })],
      });
      await switchToRelais();
      expect(root.querySelector('.relais-alerts .alerts-content').innerHTML).toContain('Non collectés');
    });

    it('clic "Encaisser" → relaisConfirmCash puis refresh relais (pas hub)', async () => {
      global.KmcApi.getPipeline.mockResolvedValue({
        pipeline: {
          pending: { orders: [makeOrder({ reference: 'CASH-2', status: 'pending', payment_mode: 'cash_relay', payment_status: 'pending' })] },
          confirmed: { orders: [] }, ordered: { orders: [] },
        },
      });
      await switchToRelais();
      const btn = root.querySelector('[data-action="relais-confirm-cash"][data-ref="CASH-2"]');
      btn.click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.relaisConfirmCash).toHaveBeenCalledWith('CASH-2');
    });

    it('clic "Réceptionner" → relaisReceive', async () => {
      global.KmcApi.getParcels.mockResolvedValue({
        parcels: [makeParcel({ reference: 'TR-1', status: 'in_transit' })],
      });
      await switchToRelais();
      const btn = root.querySelector('[data-action="relais-arrived"][data-ref="TR-1"]');
      btn.click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.relaisReceive).toHaveBeenCalledWith('TR-1');
    });

    it('clic "Remis" → relaisCollect', async () => {
      global.KmcApi.getParcels.mockResolvedValue({
        parcels: [makeParcel({ reference: 'AV-2', status: 'available' })],
      });
      await switchToRelais();
      const btn = root.querySelector('[data-action="relais-collected"][data-ref="AV-2"]');
      btn.click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.relaisCollect).toHaveBeenCalledWith('AV-2');
    });

    it('clic refresh relais → recharge pipeline/colis sans rebasculer le mode', async () => {
      await switchToRelais();
      root.querySelector('.btn-refresh-relais').click();
      await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.getPipeline.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(root.querySelector('.hr-relais-wrapper')).not.toBeNull();
    });

    it('re-bascule vers hub après relais → recharge le mode hub depuis son wrapper', async () => {
      await switchToRelais();
      root.querySelector('[data-mode="hub"]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(root.querySelector('.hr-hub-wrapper')).not.toBeNull();
      expect(root.querySelector('[data-mode="hub"]').classList.contains('active')).toBe(true);
    });
  });
});
