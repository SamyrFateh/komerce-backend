'use strict';
/**
 * ClientsView.js (556L) — Lot suivant du plan.
 *
 * Comme ControlTowerView, dépend du vrai KmcFilters (filters-store.js,
 * petit et déjà couvert par sa propre suite). Seul KmcApi est mocké.
 * Particularité : la recherche est débouncée à 250ms (setTimeout) — on
 * utilise donc jest.useFakeTimers() + flush() pour dérouler la chaîne
 * input → debounce → loadList → rerender.
 */
const {
  loadView, mountContainer, makeKmcApi, flush, mockEscHelpers,
} = require('./helpers/dashboardTestKit');

const VIEW_PATH = '../../admin/js/views/ClientsView.js';
const VIEW_NAME = 'ClientsView';

function loadRealFilters() {
  jest.resetModules();
  require('../../admin/js/filters-store.js');
  window.KmcFilters.init();
}

const summaryPayload = () => ({
  kpi: { nb_clients: 120, commandes_valides: 300, panier_moyen_kmf: 25000, taux_recurrence_pct: 40 },
  segments: { nb_total: 120, new: 20, recurrent: 60, vip: 10, at_risk: 5, dormant: 25 },
  at_risk_clients: [{ phone: '+269111', ltv_kmf: 50000 }],
  vip_clients: [{ phone: '+269222', name: 'Fatima', nb_commandes: 12, ltv_kmf: 400000, derniere_commande: '2026-06-01', jours_silence: 10 }],
  evolution: [{ mois: '2026-06', nb_clients: 30, nb_commandes: 80, ca_kmf: 900000 }],
  par_relais: [{ relais: 'Moroni Centre', ile: 'Grande Comore', nb_commandes: 50, livrees: 45, ca_kmf: 700000 }],
});

const listPayload = (overrides = {}) => ({
  clients: [{ phone: '+269333', name: 'Ali', nb_commandes: 3, ltv_kmf: 60000, panier_moyen_kmf: 20000, premiere_commande: '2026-01-01', derniere_commande: '2026-06-01', jours_silence: 15 }],
  total: 1,
  total_pages: 1,
  ...overrides,
});

describe('ClientsView', () => {
  beforeEach(() => {
    mountContainer();
    mockEscHelpers();
    loadRealFilters();
  });

  it('expose render() (contrat app.js#invokeView)', () => {
    const view = loadView(VIEW_PATH, VIEW_NAME);
    expect(typeof view.render).toBe('function');
  });

  it('affiche KPI, bannière à risque, segments, VIP, liste et évolution une fois chargé', async () => {
    window.KmcApi = makeKmcApi({
      getClients: async () => summaryPayload(),
      getClientsList: async () => listPayload(),
    });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const main = document.getElementById('main');
    await view.render(main);
    await flush();

    expect(main.textContent).toContain('clients à risque détectés');
    expect(main.querySelector('.cli-seg-card.seg-vip')).not.toBeNull();
    expect(main.textContent).toContain('Fatima'); // VIP
    expect(main.textContent).toContain('Ali'); // liste paginée
    expect(main.textContent).toContain('Moroni Centre'); // par relais
    expect(main.textContent).toMatch(/900\s000/); // évolution CA (espace insécable fr-FR)
  });

  it('bascule de segment au clic et recharge la liste avec le bon paramètre', async () => {
    const getClientsList = jest.fn().mockResolvedValue(listPayload());
    window.KmcApi = makeKmcApi({ getClients: async () => summaryPayload(), getClientsList });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const main = document.getElementById('main');
    await view.render(main);
    await flush();

    main.querySelector('[data-segment="vip"]').click();
    await flush();

    expect(getClientsList).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ segment: 'vip', page: 1 }));
  });

  it('debounce la recherche (250ms) avant de recharger la liste', async () => {
    jest.useFakeTimers();
    const getClientsList = jest.fn().mockResolvedValue(listPayload());
    window.KmcApi = makeKmcApi({ getClients: async () => summaryPayload(), getClientsList });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const main = document.getElementById('main');
    await view.render(main);
    await flush();

    const search = main.querySelector('#cli-search');
    search.value = 'Ali';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    // Avant les 250ms : pas encore rechargé
    expect(getClientsList).toHaveBeenCalledTimes(1); // le chargement initial de render()
    jest.advanceTimersByTime(260);
    await flush();

    expect(getClientsList).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ search: 'Ali', page: 1 }));
    jest.useRealTimers();
  });

  it('filtre par île via le select et pagine (précédent/suivant)', async () => {
    const getClientsList = jest.fn()
      .mockResolvedValueOnce(listPayload())
      .mockResolvedValueOnce(listPayload({ total: 2, total_pages: 2 }))
      .mockResolvedValueOnce(listPayload({ total: 2, total_pages: 2 }));
    window.KmcApi = makeKmcApi({ getClients: async () => summaryPayload(), getClientsList });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const main = document.getElementById('main');
    await view.render(main);
    await flush();

    main.querySelector('#cli-island').value = 'Anjouan';
    main.querySelector('#cli-island').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(getClientsList).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ island: 'Anjouan' }));

    // total_pages=2 → bouton suivant actif
    main.querySelector('#cli-next').click();
    await flush();
    expect(getClientsList).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ page: 2 }));

    const prevBtn = main.querySelector('#cli-prev');
    expect(prevBtn.disabled).toBe(false);
  });

  it("ouvre la fiche client au clic sur une ligne et affiche profil + commandes + produits", async () => {
    window.KmcApi = makeKmcApi({
      getClients: async () => summaryPayload(),
      getClientsList: async () => listPayload(),
      getClientDetail: async (phone) => ({
        profile: { name: 'Ali', phone, ltv_kmf: 60000, nb_orders_valid: 3, panier_moyen_kmf: 20000, jours_silence: 15, nb_orders_cancelled: 1 },
        orders: [{ created_at: '2026-06-01', reference: 'CMD-1', status: 'livrée', payment_mode: 'cash_relais', relais: 'Moroni', ile: 'Grande Comore', total_kmf: 20000 }],
        top_products: [{ name: 'Batterie', categorie: 'tech', qty: 2, nb_orders: 2, total_kmf: 40000 }],
      }),
    });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const main = document.getElementById('main');
    await view.render(main);
    await flush();

    main.querySelector('.row-link[data-phone="+269333"]').click();
    await flush();

    const modal = document.getElementById('cli-modal');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain('CMD-1');
    expect(modal.textContent).toContain('Batterie');
    expect(modal.textContent).toContain('Annulées');

    modal.querySelector('.cli-modal-close').click();
    expect(document.getElementById('cli-modal')).toBeNull();
  });

  it('affiche une erreur inline dans la modale si getClientDetail échoue', async () => {
    window.KmcApi = makeKmcApi({
      getClients: async () => summaryPayload(),
      getClientsList: async () => listPayload(),
      getClientDetail: async () => { throw new Error('Client introuvable'); },
    });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const main = document.getElementById('main');
    await view.render(main);
    await flush();

    main.querySelector('.row-link[data-phone="+269333"]').click();
    await flush();

    expect(document.getElementById('cli-modal-body').textContent).toContain('Client introuvable');
  });

  it("affiche un état vide propre quand la liste est vide et masque la pagination", async () => {
    window.KmcApi = makeKmcApi({
      getClients: async () => ({ ...summaryPayload(), at_risk_clients: [], vip_clients: [], evolution: [], par_relais: [] }),
      getClientsList: async () => listPayload({ clients: [], total: 0, total_pages: 1 }),
    });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const main = document.getElementById('main');
    await view.render(main);
    await flush();

    expect(main.querySelector('.empty-state').textContent).toContain('Aucun client');
    expect(main.querySelector('.cli-pagination')).toBeNull();
  });

  it("affiche un état d'erreur si le chargement initial échoue", async () => {
    window.KmcApi = makeKmcApi({
      getClients: async () => { throw new Error('panne réseau'); },
      getClientsList: async () => listPayload(),
    });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const main = document.getElementById('main');
    await view.render(main);
    await flush();

    expect(document.getElementById('cli-body').textContent).toContain('panne réseau');
  });
});
