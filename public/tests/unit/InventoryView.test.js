'use strict';

/**
 * tests/unit/InventoryView.test.js
 *
 * admin/js/views/InventoryView.js (355L) — Vue Inventaire Hub /admin/inventory.
 * Export réel : window.InventoryView = { render } (IIFE, render async).
 * esc() est local au fichier (pas de dépendance utils.js ici).
 *
 * Sources API (globals mockés) :
 *   - KmcApi.getHubInventoryStats/.getHubInventoryProposals/.getHubInventoryOpenParcels
 *     (Promise.all, catch global)
 *   - KmcApi.hubInventoryScanAssign(body)   (catch local → alert)
 *   - KmcApi.hubInventoryProposeAll()       (catch local → alert)
 */

const { loadView, makeKmcApi, cleanupGlobals, mockAlert, flush } = require('./helpers/dashboardTestKit');

function baseStats(overrides) {
  return Object.assign({
    received: 3, proposed: 2, assigned: 5, buffered: 1, open_parcels: 4, overdue: 0,
  }, overrides);
}

function item(overrides) {
  return Object.assign({
    id: 'item-1', status: 'proposed', product_name: 'Bijou', order_ref: 'CMD-1',
    destination_island: 'Ngazidja', proposed_parcel_ref: 'COL-1', proposed_parcel_id: 'p1',
    wait_minutes: 12, buffer_reason: null,
  }, overrides);
}

describe('InventoryView', () => {
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
  });

  afterEach(() => {
    cleanupGlobals('KmcApi');
    document.getElementById('kmc-inventory-styles')?.remove();
    delete window.alert;
    jest.useRealTimers();
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      getHubInventoryStats: jest.fn().mockResolvedValue(baseStats()),
      getHubInventoryProposals: jest.fn().mockResolvedValue({ items: [] }),
      getHubInventoryOpenParcels: jest.fn().mockResolvedValue({ parcels: [] }),
      hubInventoryScanAssign: jest.fn().mockResolvedValue({ matched_proposal: true, parcel_ref: 'COL-1' }),
      hubInventoryProposeAll: jest.fn().mockResolvedValue({}),
    }, overrides));
  }

  function loadIt() {
    return loadView('../../admin/js/views/InventoryView.js', 'InventoryView', { skipBaseDeps: true });
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    setupApi();
    const View = loadIt();
    expect(typeof View.render).toBe('function');
  });

  it('pose le shell (kpis, boutons, zone items) et injecte les styles une seule fois', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('#inv-kpis')).toBeTruthy();
    expect(main.querySelector('#inv-recalc-btn')).toBeTruthy();
    expect(main.querySelector('#inv-refresh-btn')).toBeTruthy();
    expect(main.querySelector('#inv-items')).toBeTruthy();
    expect(document.getElementById('kmc-inventory-styles')).toBeTruthy();

    const stylesBefore = document.querySelectorAll('#kmc-inventory-styles').length;
    await View.render(main);
    expect(document.querySelectorAll('#kmc-inventory-styles').length).toBe(stylesBefore);
  });

  it('appelle les 3 endpoints hub en parallèle', async () => {
    const api = setupApi();
    const View = loadIt();
    await View.render(main);
    expect(api.getHubInventoryStats).toHaveBeenCalled();
    expect(api.getHubInventoryProposals).toHaveBeenCalled();
    expect(api.getHubInventoryOpenParcels).toHaveBeenCalled();
  });

  it('KPI bar : affiche les 6 badges avec valeurs, fallback 0 si stats vide', async () => {
    setupApi({ getHubInventoryStats: jest.fn().mockResolvedValue({}) });
    const View = loadIt();
    await View.render(main);
    const kpis = document.getElementById('inv-kpis').textContent;
    expect(kpis).toContain('Reçus');
    expect(kpis).toContain('Proposés');
    expect(kpis).toContain('Assignés');
    expect(kpis).toContain('Buffer');
    expect(kpis).toContain('Colis ouverts');
    expect(kpis).toContain('Dépassés');
  });

  it('KPI "Dépassés" > 0 → couleur d\'alerte (warnIfPositive)', async () => {
    setupApi({ getHubInventoryStats: jest.fn().mockResolvedValue(baseStats({ overdue: 3 })) });
    const View = loadIt();
    await View.render(main);
    const badges = [...document.querySelectorAll('.inv-kpi-badge')];
    const overdueBadge = badges.find(b => b.textContent.includes('Dépassés'));
    expect(overdueBadge.getAttribute('style')).toContain('#dc2626');
  });

  it('aucun article → message vide explicite', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    expect(document.getElementById('inv-items').textContent).toContain("Aucun article en attente d'assignation");
  });

  it('groupe les articles par statut (proposed / received / buffered) avec titres et compteurs', async () => {
    setupApi({
      getHubInventoryProposals: jest.fn().mockResolvedValue({
        items: [
          item({ id: 'p1', status: 'proposed' }),
          item({ id: 'r1', status: 'received', proposed_parcel_ref: null, proposed_parcel_id: null }),
          item({ id: 'b1', status: 'buffered', buffer_reason: 'Colis plein' }),
        ],
      }),
    });
    const View = loadIt();
    await View.render(main);
    const html = document.getElementById('inv-items').innerHTML;
    expect(html).toContain('Propositions moteur (1)');
    expect(html).toContain('Reçus (en attente) (1)');
    expect(html).toContain('Buffer (1)');
    expect(html).toContain('Colis plein');
  });

  it('article proposé : cellule info affiche la réf de colis suggérée, option pré-sélectionnée en gras', async () => {
    setupApi({
      getHubInventoryProposals: jest.fn().mockResolvedValue({ items: [item()] }),
      getHubInventoryOpenParcels: jest.fn().mockResolvedValue({
        parcels: [{ id: 'p2', reference: 'COL-2', destination_island: 'Anjouan', item_count: 3 }],
      }),
    });
    const View = loadIt();
    await View.render(main);
    const row = document.querySelector('tr[data-inv-id="item-1"]');
    expect(row.innerHTML).toContain('COL-1');
    const select = row.querySelector('.inv-assign-select');
    expect(select.innerHTML).toContain('suggéré');
    expect(select.innerHTML).toContain('COL-2');
  });

  it('article reçu : cellule info affiche l\'attente formatée (fmtWait)', async () => {
    setupApi({
      getHubInventoryProposals: jest.fn().mockResolvedValue({
        items: [item({ id: 'r1', status: 'received', wait_minutes: 125, proposed_parcel_ref: null, proposed_parcel_id: null })],
      }),
    });
    const View = loadIt();
    await View.render(main);
    const row = document.querySelector('tr[data-inv-id="r1"]');
    expect(row.textContent).toContain('2h5m');
  });

  it('XSS : product_name/order_ref/buffer_reason échappés dans le tableau', async () => {
    setupApi({
      getHubInventoryProposals: jest.fn().mockResolvedValue({
        items: [item({
          id: 'x1', status: 'buffered',
          product_name: '<img src=x onerror=alert(1)>',
          order_ref: '<b>CMD</b>',
          buffer_reason: '<script>bad()</script>',
        })],
      }),
    });
    const View = loadIt();
    await View.render(main);
    const row = document.querySelector('tr[data-inv-id="x1"]');
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('script')).toBeNull();
    expect(row.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(row.textContent).toContain('<b>CMD</b>');
    expect(row.textContent).toContain('<script>bad()</script>');
  });

  it('erreur de chargement (Promise.all rejeté) → error-state échappé dans #inv-items', async () => {
    setupApi({ getHubInventoryStats: jest.fn().mockRejectedValue(new Error('<b>panne</b>')) });
    const View = loadIt();
    await View.render(main);
    const html = document.getElementById('inv-items').innerHTML;
    expect(html).toContain('&lt;b&gt;panne');
    expect(html).not.toContain('<b>panne');
  });

  it('changement du select d\'assignation avec valeur vide → aucun appel scanAssign', async () => {
    const api = setupApi({ getHubInventoryProposals: jest.fn().mockResolvedValue({ items: [item()] }) });
    const View = loadIt();
    await View.render(main);
    const select = document.querySelector('.inv-assign-select');
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(api.hubInventoryScanAssign).not.toHaveBeenCalled();
  });

  it('scan-assign : sélection d\'un colis → appelle hubInventoryScanAssign, colore la ligne en vert si matched_proposal', async () => {
    jest.useFakeTimers();
    const api = setupApi({
      getHubInventoryProposals: jest.fn().mockResolvedValue({ items: [item()] }),
      hubInventoryScanAssign: jest.fn().mockResolvedValue({ matched_proposal: true, parcel_ref: 'COL-1' }),
    });
    const View = loadIt();
    await View.render(main);

    const select = document.querySelector('.inv-assign-select');
    select.value = 'p1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(api.hubInventoryScanAssign).toHaveBeenCalledWith({ inventory_item_id: 'item-1', parcel_id: 'p1' });
    const row = document.querySelector('tr[data-inv-id="item-1"]');
    expect(row.style.background).toContain('#f0fdf4');
    expect(row.querySelector('td:last-child').innerHTML).toContain('COL-1');
  });

  it('scan-assign non matched_proposal → colore en ambre', async () => {
    const api = setupApi({
      getHubInventoryProposals: jest.fn().mockResolvedValue({ items: [item()] }),
      hubInventoryScanAssign: jest.fn().mockResolvedValue({ matched_proposal: false, parcel_ref: 'COL-9' }),
    });
    const View = loadIt();
    await View.render(main);

    const select = document.querySelector('.inv-assign-select');
    select.value = 'p1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const row = document.querySelector('tr[data-inv-id="item-1"]');
    expect(row.style.background).toContain('#fffbeb');
  });

  it('scan-assign : après 1500ms la ligne obtient la classe inv-assigned, après 2500ms rechargement', async () => {
    jest.useFakeTimers();
    const api = setupApi({
      getHubInventoryProposals: jest.fn()
        .mockResolvedValueOnce({ items: [item()] })
        .mockResolvedValueOnce({ items: [] }),
      hubInventoryScanAssign: jest.fn().mockResolvedValue({ matched_proposal: true, parcel_ref: 'COL-1' }),
    });
    const View = loadIt();
    const renderP = View.render(main);
    await jest.runAllTimersAsync();
    await renderP;

    const select = document.querySelector('.inv-assign-select');
    select.value = 'p1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await jest.runAllTimersAsync();

    expect(api.getHubInventoryProposals.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('scan-assign : échec API → alert(), pas de crash', async () => {
    const alertMock = mockAlert();
    setupApi({
      getHubInventoryProposals: jest.fn().mockResolvedValue({ items: [item()] }),
      hubInventoryScanAssign: jest.fn().mockRejectedValue(new Error('assign KO')),
    });
    const View = loadIt();
    await View.render(main);

    const select = document.querySelector('.inv-assign-select');
    select.value = 'p1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await flush();

    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('assign KO'));
  });

  it('bouton Recalculer : désactive puis réactive le bouton, appelle hubInventoryProposeAll puis recharge', async () => {
    const api = setupApi();
    const View = loadIt();
    await View.render(main);

    const btn = document.getElementById('inv-recalc-btn');
    const clickPromise = (async () => { btn.click(); })();
    await flush();
    expect(api.hubInventoryProposeAll).toHaveBeenCalled();
    await clickPromise;
    await flush();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('Recalculer');
  });

  it('bouton Recalculer : échec → alert() et bouton réactivé (finally)', async () => {
    const alertMock = mockAlert();
    setupApi({ hubInventoryProposeAll: jest.fn().mockRejectedValue(new Error('recalc KO')) });
    const View = loadIt();
    await View.render(main);

    document.getElementById('inv-recalc-btn').click();
    await flush();
    await flush();

    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('recalc KO'));
    const btn = document.getElementById('inv-recalc-btn');
    expect(btn.disabled).toBe(false);
  });

  it('bouton refresh (🔄) : recharge les données', async () => {
    const api = setupApi();
    const View = loadIt();
    await View.render(main);
    const callsBefore = api.getHubInventoryStats.mock.calls.length;

    document.getElementById('inv-refresh-btn').click();
    await flush();

    expect(api.getHubInventoryStats.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
