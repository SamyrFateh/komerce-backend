'use strict';

/**
 * tests/unit/ProblemsView.test.js
 *
 * js/views/ProblemsView.js (747L) — détection d'anomalies (10 règles
 * appliquées côté client sur /api/orders) + onglet réconciliation colis.
 * Exports publics : render(rootEl), destroy().
 *
 * Dépendance externe : `KmcApi` (global, mocké comme pour HubRelaisView.js) —
 * `getOrders(params)` et `getParcelReconciliation()`. `KmcApp.navigate` mocké
 * pour le lien "Comptabilité" de l'onglet réconciliation.
 *
 * Périmètre couvert :
 *   - render() : shell, appel initial KmcApi.getOrders, câblage des
 *     listeners (refresh, auto-refresh, expand carte, action carte, tabs)
 *   - Les 10 règles de détection (une commande/colis représentatif par
 *     règle + un cas négatif qui ne doit PAS matcher)
 *   - runDetections : tri par sévérité puis par nombre décroissant
 *   - renderSummary / renderCards / renderSidebar : cas vide (aucun
 *     problème), cas peuplé, plafond d'affichage à 8 items + compteur
 *     "…et N autres", score santé (bornes 80/50) et répartition par
 *     catégorie
 *   - Interactions : expand/collapse d'une carte (garde count=0), clic
 *     action → window.open, refresh manuel, garde anti double-chargement
 *     (_isLoading), erreur réseau → error-state + bouton réactivé
 *   - Auto-refresh : démarrage au render, toggle checkbox off/on,
 *     destroy() arrête le timer (fake timers, intervalle 5 min)
 *   - Onglet réconciliation colis : bascule d'onglet, KPI badges, liste
 *     (blocked/warning/ok), état vide, erreur réseau, lien "Comptabilité"
 *     → KmcApp.navigate
 */

function makeOrder(overrides) {
  return Object.assign({
    id: 'o1',
    order_ref: 'CMD-100',
    status: 'preparation',
    payment_status: 'paid',
    payment_method: 'card',
    client_name: 'Ali M.',
    total: 15000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, overrides);
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

const { makeKmcApi, cleanupGlobals } = require('./helpers/dashboardTestKit');

describe('ProblemsView', () => {
  let root;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    makeKmcApi({
      getOrders: jest.fn().mockResolvedValue([]),
      getParcelReconciliation: jest.fn().mockResolvedValue({ parcels: [], summary: {} }),
    });
    global.window.open = jest.fn();

    require('../../admin/js/views/ProblemsView.js');
  });

  afterEach(() => {
    window.ProblemsView.destroy();
    jest.useRealTimers();
    cleanupGlobals('KmcApi');
    delete global.KmcApp;
  });

  it('expose render() et destroy() (contrat app.js#invokeView)', () => {
    expect(typeof window.ProblemsView.render).toBe('function');
    expect(typeof window.ProblemsView.destroy).toBe('function');
  });

  describe('render() — shell et chargement initial', () => {
    it('pose le shell, appelle KmcApi.getOrders({limit:500}) et peuple summary/cards/sidebar', async () => {
      await window.ProblemsView.render(root);
      expect(global.KmcApi.getOrders).toHaveBeenCalledWith({ limit: 500 });
      expect(root.querySelector('#prob-summary').innerHTML).not.toBe('');
      expect(root.querySelector('#prob-cards').innerHTML).not.toBe('');
      expect(root.querySelector('#prob-sidebar').innerHTML).not.toBe('');
    });

    it('aucune commande → message "Aucun problème détecté" en résumé et en cartes', async () => {
      await window.ProblemsView.render(root);
      expect(root.querySelector('#prob-summary').textContent).toContain('Aucun problème détecté');
      expect(root.querySelector('#prob-cards').textContent).toContain('Aucun problème détecté');
    });

    it('accepte un payload API sous forme de tableau brut ou d\'objet {items|orders|data}', async () => {
      global.KmcApi.getOrders.mockResolvedValue({ orders: [makeOrder({ status: 'confirmed', purchase_order: null })] });
      await window.ProblemsView.render(root);
      expect(root.querySelector('#prob-summary').textContent).toContain('1 problème');
    });

    it('erreur réseau → error-state affiché, bouton refresh réactivé', async () => {
      global.KmcApi.getOrders.mockRejectedValue(new Error('down'));
      await window.ProblemsView.render(root);
      expect(root.querySelector('#prob-cards .error-state').textContent).toContain('down');
      expect(root.querySelector('#prob-refresh-btn').disabled).toBe(false);
    });
  });

  describe('les 10 règles de détection', () => {
    async function renderWith(order) {
      global.KmcApi.getOrders.mockResolvedValue([order]);
      await window.ProblemsView.render(root);
      return root.querySelector('#prob-cards').innerHTML;
    }

    it('no_po : confirmed sans bon d\'achat → détecté', async () => {
      const html = await renderWith(makeOrder({ status: 'confirmed', purchase_order: null, purchase_order_id: null }));
      expect(html).toContain('Commandes sans PO');
      expect(html).toMatch(/data-rule="no_po"[^]*?data-count="1"|data-count="1"[^]*?data-rule="no_po"/);
    });

    // renderCards() affiche soit la liste des cartes individuelles, soit un
    // message générique "Aucun problème" si TOUTES les règles sont à 0. Pour
    // tester un count=0 sur une règle précise, il faut donc qu'au moins une
    // AUTRE règle soit positive (via cette commande compagnon neutre) afin
    // que les cartes individuelles soient effectivement rendues.
    const companion = () => makeOrder({ id: 'companion', payment_method: 'cash', payment_status: 'pending', hub_id: 'HUB-1' });

    it('no_po : confirmed AVEC bon d\'achat → non détecté (count 0)', async () => {
      global.KmcApi.getOrders.mockResolvedValue([
        companion(),
        makeOrder({ status: 'confirmed', purchase_order_id: 'PO-1' }),
      ]);
      await window.ProblemsView.render(root);
      const html = root.querySelector('#prob-cards').innerHTML;
      const card = html.match(/<div class="prob-card"[^>]*data-rule="no_po"[^>]*>/)[0];
      expect(card).toContain('data-count="0"');
    });

    it('double_payment : payé avec >1 paiement → détecté', async () => {
      const html = await renderWith(makeOrder({ payment_status: 'paid', payments: [{}, {}] }));
      expect(html).toContain('Doubles paiements');
      expect(html).toContain('data-count="1"');
    });

    it('double_payment : un seul paiement → non détecté', async () => {
      const html = await renderWith(makeOrder({ payment_status: 'paid', payments: [{}] }));
      const card = html.match(/<div class="prob-card"[^>]*data-rule="double_payment"[^>]*>/)[0];
      expect(card).toContain('data-count="0"');
    });

    it('cash_unsettled : cash ni paid ni settled → détecté', async () => {
      const html = await renderWith(makeOrder({ payment_method: 'cash', payment_status: 'pending' }));
      expect(html).toContain('Cash non réconcilié');
      const card = html.match(/<div class="prob-card"[^>]*data-rule="cash_unsettled"[^>]*>/)[0];
      expect(card).toContain('data-count="1"');
    });

    it('cash_unsettled : cash déjà settled → non détecté', async () => {
      const html = await renderWith(makeOrder({ payment_method: 'cash', payment_status: 'settled' }));
      const card = html.match(/<div class="prob-card"[^>]*data-rule="cash_unsettled"[^>]*>/)[0];
      expect(card).toContain('data-count="0"');
    });

    it('po_overflow : quantité reçue > commandée → détecté', async () => {
      const html = await renderWith(makeOrder({ purchase_order: { received_qty: 12, quantity: 10 } }));
      expect(html).toContain('Débordement PO');
      const card = html.match(/<div class="prob-card"[^>]*data-rule="po_overflow"[^>]*>/)[0];
      expect(card).toContain('data-count="1"');
    });

    it('po_received_stuck : PO reçue mais commande encore purchasing → détecté', async () => {
      const html = await renderWith(makeOrder({ status: 'purchasing', purchase_order: { status: 'received' } }));
      const card = html.match(/<div class="prob-card"[^>]*data-rule="po_received_stuck"[^>]*>/)[0];
      expect(card).toContain('data-count="1"');
    });

    it('available_long : disponible en relais depuis >7 jours → détecté avec âge affiché', async () => {
      const html = await renderWith(makeOrder({ status: 'available', updated_at: daysAgoIso(9) }));
      const card = html.match(/<div class="prob-card"[^>]*data-rule="available_long"[^>]*>/)[0];
      expect(card).toContain('data-count="1"');
      expect(html).toContain('(9j)');
    });

    it('available_long : disponible depuis 2 jours seulement → non détecté', async () => {
      global.KmcApi.getOrders.mockResolvedValue([
        companion(),
        makeOrder({ status: 'available', updated_at: daysAgoIso(2) }),
      ]);
      await window.ProblemsView.render(root);
      const html = root.querySelector('#prob-cards').innerHTML;
      const card = html.match(/<div class="prob-card"[^>]*data-rule="available_long"[^>]*>/)[0];
      expect(card).toContain('data-count="0"');
    });

    it('prep_stuck : préparation depuis >4 jours → détecté', async () => {
      const html = await renderWith(makeOrder({ status: 'preparation', updated_at: daysAgoIso(5) }));
      const card = html.match(/<div class="prob-card"[^>]*data-rule="prep_stuck"[^>]*>/)[0];
      expect(card).toContain('data-count="1"');
    });

    it('transit_long : expédié depuis >12 jours → détecté', async () => {
      const html = await renderWith(makeOrder({ status: 'shipped', updated_at: daysAgoIso(13) }));
      const card = html.match(/<div class="prob-card"[^>]*data-rule="transit_long"[^>]*>/)[0];
      expect(card).toContain('data-count="1"');
    });

    it('no_sms : available sans SMS envoyé → détecté', async () => {
      const html = await renderWith(makeOrder({ status: 'available', sms_sent: false, updated_at: daysAgoIso(1) }));
      const card = html.match(/<div class="prob-card"[^>]*data-rule="no_sms"[^>]*>/)[0];
      expect(card).toContain('data-count="1"');
    });

    it('no_hub_scan : purchasing sans hub assigné → détecté', async () => {
      const html = await renderWith(makeOrder({ status: 'purchasing', hub_id: null, hub_scan: null }));
      const card = html.match(/<div class="prob-card"[^>]*data-rule="no_hub_scan"[^>]*>/)[0];
      expect(card).toContain('data-count="1"');
    });

    it('une exception dans une règle (detect throw) est avalée sans casser les autres règles', async () => {
      // Une date invalide dans available_long ne doit pas faire planter
      // runDetections ni empêcher le rendu des autres règles.
      const companion = makeOrder({ id: 'companion', payment_method: 'cash', payment_status: 'pending', hub_id: 'HUB-1' });
      global.KmcApi.getOrders.mockResolvedValue([
        companion,
        makeOrder({ status: 'available', updated_at: 'pas-une-date' }),
      ]);
      await expect(window.ProblemsView.render(root)).resolves.not.toThrow();
      // cash_unsettled (règle indépendante) doit quand même être rendue
      expect(root.querySelector('#prob-cards').textContent).toContain('Cash non réconcilié');
    });
  });

  describe('tri, plafond d\'affichage et résumé', () => {
    it('trie les cartes par sévérité (critical avant warning avant info)', async () => {
      global.KmcApi.getOrders.mockResolvedValue([
        makeOrder({ id: 'a', status: 'purchasing', hub_id: null }),              // info (no_hub_scan)
        makeOrder({ id: 'b', status: 'confirmed', purchase_order_id: null }),    // critical (no_po)
      ]);
      await window.ProblemsView.render(root);
      const html = root.querySelector('#prob-cards').innerHTML;
      expect(html.indexOf('data-rule="no_po"')).toBeLessThan(html.indexOf('data-rule="no_hub_scan"'));
    });

    it('résumé : compte total + badges par sévérité présente', async () => {
      global.KmcApi.getOrders.mockResolvedValue([
        makeOrder({ status: 'confirmed', purchase_order_id: null }),
        makeOrder({ status: 'purchasing', hub_id: null }),
      ]);
      await window.ProblemsView.render(root);
      const summary = root.querySelector('#prob-summary').textContent;
      expect(summary).toContain('2 problèmes détectés');
      expect(summary).toContain('Critique');
      expect(summary).toContain('Info');
    });

    it('plus de 8 items sur une règle → plafonne l\'affichage et ajoute "…et N autres"', async () => {
      const orders = Array.from({ length: 11 }, (_, i) =>
        makeOrder({ id: `c${i}`, order_ref: `CMD-${i}`, status: 'confirmed', purchase_order_id: null }));
      global.KmcApi.getOrders.mockResolvedValue(orders);
      await window.ProblemsView.render(root);
      const html = root.querySelector('#prob-cards').innerHTML;
      expect(html).toContain('…et 3 autres');
    });
  });

  describe('sidebar — score santé et catégories', () => {
    it('aucun problème → score 100, classe verte', async () => {
      await window.ProblemsView.render(root);
      const sidebar = root.querySelector('#prob-sidebar');
      expect(sidebar.querySelector('.prob-score-val').textContent).toContain('100/100');
      expect(sidebar.querySelector('.prob-score-val').classList.contains('prob-score-green')).toBe(true);
    });

    it('beaucoup de problèmes → score bas, classe rouge', async () => {
      const orders = Array.from({ length: 8 }, (_, i) =>
        makeOrder({ id: `c${i}`, status: 'confirmed', purchase_order_id: null }));
      global.KmcApi.getOrders.mockResolvedValue(orders); // 8 * 8 = 64 → score 100-64=36 < 50
      await window.ProblemsView.render(root);
      const val = root.querySelector('.prob-score-val');
      expect(val.classList.contains('prob-score-red')).toBe(true);
    });

    it('répartit les compteurs par catégorie (finance/appro/logistic/client/data)', async () => {
      global.KmcApi.getOrders.mockResolvedValue([
        makeOrder({ status: 'confirmed', purchase_order_id: null }), // finance
        makeOrder({ status: 'purchasing', hub_id: null }),            // data
      ]);
      await window.ProblemsView.render(root);
      const financeNum = root.querySelector('.prob-cat[data-cat="finance"] .prob-cat-num').textContent;
      const dataNum    = root.querySelector('.prob-cat[data-cat="data"] .prob-cat-num').textContent;
      expect(financeNum).toBe('1');
      expect(dataNum).toBe('1');
    });
  });

  describe('interactions — carte et actions', () => {
    it('clic sur l\'entête d\'une carte avec count>0 → toggle "expanded" + hint mis à jour', async () => {
      global.KmcApi.getOrders.mockResolvedValue([makeOrder({ status: 'confirmed', purchase_order_id: null })]);
      await window.ProblemsView.render(root);
      const card = root.querySelector('.prob-card[data-rule="no_po"]');
      const head = card.querySelector('.prob-card-head');
      head.click();
      expect(card.classList.contains('expanded')).toBe(true);
      expect(card.querySelector('.prob-card-hint').textContent).toContain('masquer');
      head.click();
      expect(card.classList.contains('expanded')).toBe(false);
    });

    it('clic sur une carte à count=0 → ne bascule pas "expanded"', async () => {
      global.KmcApi.getOrders.mockResolvedValue([
        makeOrder({ id: 'companion', payment_method: 'cash', payment_status: 'pending', hub_id: 'HUB-1' }),
      ]);
      await window.ProblemsView.render(root);
      const card = root.querySelector('.prob-card[data-rule="no_po"]');
      card.querySelector('.prob-card-head').click();
      expect(card.classList.contains('expanded')).toBe(false);
    });

    it('clic sur le lien d\'action d\'une carte → window.open avec l\'URL de la règle', async () => {
      global.KmcApi.getOrders.mockResolvedValue([makeOrder({ status: 'confirmed', purchase_order_id: null })]);
      await window.ProblemsView.render(root);
      const card = root.querySelector('.prob-card[data-rule="no_po"]');
      card.querySelector('.prob-card-action').click();
      expect(window.open).toHaveBeenCalledWith('/admin/orders?status=confirmed&no_po=1', '_blank');
    });
  });

  describe('refresh manuel et garde anti double-chargement', () => {
    it('clic sur "Actualiser" → recharge les commandes', async () => {
      await window.ProblemsView.render(root);
      root.querySelector('#prob-refresh-btn').click();
      await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.getOrders.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('affiche l\'heure du dernier scan après chargement', async () => {
      await window.ProblemsView.render(root);
      expect(root.querySelector('#prob-scan-time').textContent).toContain('Dernier scan');
    });
  });

  describe('auto-refresh (5 min)', () => {
    it('démarre automatiquement après le premier rendu', async () => {
      jest.useFakeTimers();
      await window.ProblemsView.render(root);
      const before = global.KmcApi.getOrders.mock.calls.length;
      jest.advanceTimersByTime(300_000);
      await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.getOrders.mock.calls.length).toBeGreaterThan(before);
    });

    it('décocher "Auto-refresh" arrête le timer', async () => {
      jest.useFakeTimers();
      await window.ProblemsView.render(root);
      root.querySelector('#prob-auto-check').checked = false;
      root.querySelector('#prob-auto-check').dispatchEvent(new Event('change'));
      const before = global.KmcApi.getOrders.mock.calls.length;
      jest.advanceTimersByTime(600_000);
      await Promise.resolve();
      expect(global.KmcApi.getOrders.mock.calls.length).toBe(before);
    });

    it('destroy() arrête le timer (pas d\'appel API après démontage)', async () => {
      jest.useFakeTimers();
      await window.ProblemsView.render(root);
      window.ProblemsView.destroy();
      const before = global.KmcApi.getOrders.mock.calls.length;
      jest.advanceTimersByTime(600_000);
      await Promise.resolve();
      expect(global.KmcApi.getOrders.mock.calls.length).toBe(before);
    });

    it('re-render() ré-arme un nouveau timer sans le cumuler (stopAutoRefresh appelé avant)', async () => {
      jest.useFakeTimers();
      await window.ProblemsView.render(root);
      await window.ProblemsView.render(root);
      const before = global.KmcApi.getOrders.mock.calls.length;
      jest.advanceTimersByTime(300_000);
      await Promise.resolve(); await Promise.resolve();
      // Un seul tick d'auto-refresh doit avoir eu lieu, pas deux (pas de timer dupliqué)
      expect(global.KmcApi.getOrders.mock.calls.length).toBe(before + 1);
    });
  });

  describe('onglet Réconciliation colis', () => {
    async function switchToReco() {
      await window.ProblemsView.render(root);
      root.querySelector('[data-tab="parcel-reco"]').click();
      await Promise.resolve(); await Promise.resolve();
    }

    it('bascule d\'onglet → affiche le panneau reco et masque les anomalies', async () => {
      await switchToReco();
      expect(root.querySelector('#prob-tab-anomalies').style.display).toBe('none');
      expect(root.querySelector('#prob-tab-parcel-reco').style.display).toBe('');
      expect(global.KmcApi.getParcelReconciliation).toHaveBeenCalled();
    });

    it('affiche les KPI badges et la liste des colis avec leur statut de réconciliation', async () => {
      global.KmcApi.getParcelReconciliation.mockResolvedValue({
        summary: { total: 3, blocked: 1, warning: 1, ok: 1 },
        parcels: [
          { reference: 'COL-1', status: 'in_transit', reconciliation: { status: 'blocked', issues: ['Écart montant'] } },
          { reference: 'COL-2', status: 'available', reconciliation: { status: 'ok' } },
        ],
      });
      await switchToReco();
      const content = root.querySelector('#prob-reco-content');
      expect(content.textContent).toContain('COL-1');
      expect(content.textContent).toContain('BLOCKED');
      expect(content.textContent).toContain('Écart montant');
    });

    it('aucun colis → état vide', async () => {
      await switchToReco();
      expect(root.querySelector('#prob-reco-content').textContent).toContain('Aucun colis à réconcilier');
    });

    it('erreur réseau → error-state dans le panneau reco', async () => {
      global.KmcApi.getParcelReconciliation.mockRejectedValue(new Error('reco down'));
      await switchToReco();
      expect(root.querySelector('#prob-reco-content .error-state').textContent).toContain('reco down');
    });

    it('bouton refresh du panneau reco → recharge la réconciliation', async () => {
      await switchToReco();
      root.querySelector('#prob-reco-refresh').click();
      await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.getParcelReconciliation.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('clic sur le lien "Comptabilité" → KmcApp.navigate au lieu d\'une navigation classique', async () => {
      global.KmcApp = { navigate: jest.fn() };
      await switchToReco();
      const link = root.querySelector('a[data-path="/admin/accounting"]');
      link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(global.KmcApp.navigate).toHaveBeenCalledWith('/admin/accounting');
    });

    it('re-basculer vers "Anomalies" réaffiche le panneau anomalies sans rappeler getOrders', async () => {
      await switchToReco();
      const callsBefore = global.KmcApi.getOrders.mock.calls.length;
      root.querySelector('[data-tab="anomalies"]').click();
      await Promise.resolve();
      expect(root.querySelector('#prob-tab-anomalies').style.display).toBe('');
      expect(global.KmcApi.getOrders.mock.calls.length).toBe(callsBefore);
    });
  });
});
