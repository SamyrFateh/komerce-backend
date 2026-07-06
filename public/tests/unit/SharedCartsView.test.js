'use strict';

/**
 * tests/unit/SharedCartsView.test.js
 *
 * admin/js/views/SharedCartsView.js (368L) — Vue support Paniers partagés /admin/shared-carts.
 * Export réel : window.SharedCartsView = async function render(root) (fonction bare, pas {render}).
 * _esc() est local au fichier (pas de dépendance utils.js).
 * État module-level (_state) → jest.resetModules() nécessaire entre tests (fait par loadView).
 *
 * Source API (globals mockés, appelés via global.KmcApi directement, pas d'import) :
 *   - KmcApi.getSharedCarts(filters)          (catch global → error-state)
 *   - KmcApi.getSharedCart(id)                (catch local sur ouverture drawer → alert)
 *   - KmcApi.extendSharedCart(id, {days})     (catch local → alert)
 *   - KmcApi.expireSharedCart(id, {reason})   (catch local → alert)
 *   - KmcApi.noteSharedCart(id, {note})       (catch local → alert)
 */

const { loadView, makeKmcApi, cleanupGlobals, mockAlert, mockConfirm, mockPrompt, flush } = require('./helpers/dashboardTestKit');

function cart(overrides) {
  return Object.assign({
    id: 'cart-1', title: 'Cadeau Fatima', status: 'active',
    beneficiary_full_name: 'Fatima Ali', beneficiary_email: 'fatima@example.com',
    total_kmf_snapshot: 10000, contributed_kmf: 4000, remaining_kmf: 6000,
    contributors_count: 2, contributions_total_count: 3, expires_at: '2026-08-01T00:00:00Z',
  }, overrides);
}

function detail(overrides) {
  return Object.assign({
    cart: cart(),
    items: [{ product_name_snapshot: 'Bracelet', product_category_snapshot: 'bijoux', quantity: 1, unit_price_kmf_snapshot: 10000, line_total_kmf_snapshot: 10000 }],
    contributions: [],
    events: [],
  }, overrides);
}

describe('SharedCartsView', () => {
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
  });

  afterEach(() => {
    cleanupGlobals('KmcApi');
    document.getElementById('scv-styles')?.remove();
    delete window.alert;
    delete window.confirm;
    delete window.prompt;
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      getSharedCarts: jest.fn().mockResolvedValue({ carts: [] }),
      getSharedCart: jest.fn().mockResolvedValue(detail()),
      extendSharedCart: jest.fn().mockResolvedValue({}),
      expireSharedCart: jest.fn().mockResolvedValue({}),
      noteSharedCart: jest.fn().mockResolvedValue({}),
    }, overrides));
  }

  function loadIt() {
    return loadView('../../admin/js/views/SharedCartsView.js', 'SharedCartsView', { skipBaseDeps: true });
  }

  it('expose render en fonction bare (contrat app.js#invokeView)', () => {
    setupApi();
    const View = loadIt();
    expect(typeof View.render).toBe('function');
  });

  it('affiche un état de chargement avant résolution', async () => {
    let resolveIt;
    setupApi({ getSharedCarts: jest.fn(() => new Promise((r) => { resolveIt = r; })) });
    const View = loadIt();
    const p = View.render(main);
    expect(main.textContent).toContain('Chargement des paniers partagés');
    resolveIt({ carts: [] });
    await p;
    expect(document.getElementById('scv-styles')).toBeTruthy();
  });

  it('injecte les styles une seule fois même après plusieurs render()', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    const before = document.querySelectorAll('#scv-styles').length;
    await View.render(main);
    expect(document.querySelectorAll('#scv-styles').length).toBe(before);
  });

  it('liste vide → message "Aucun panier partagé trouvé"', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    expect(main.textContent).toContain('Aucun panier partagé trouvé');
  });

  it('erreur de chargement global → message d\'erreur échappé', async () => {
    setupApi({ getSharedCarts: jest.fn().mockRejectedValue(new Error('<b>boom</b>')) });
    const View = loadIt();
    await View.render(main);
    expect(main.innerHTML).toContain('&lt;b&gt;boom');
    expect(main.innerHTML).not.toContain('<b>boom');
  });

  it('affiche une ligne de tableau avec statut, montants formatés et progression', async () => {
    setupApi({ getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }) });
    const View = loadIt();
    await View.render(main);

    const row = main.querySelector('tr[data-id="cart-1"]');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Fatima Ali');
    expect(row.textContent).toContain('Actif');
    expect(row.textContent).toContain('40%'); // 4000/10000
    expect(row.textContent).toContain('2 / 3');
  });

  it('statut inconnu → fallback gris avec le code brut comme label', async () => {
    setupApi({ getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart({ status: 'weird_status' })] }) });
    const View = loadIt();
    await View.render(main);
    const row = main.querySelector('tr[data-id="cart-1"]');
    expect(row.textContent).toContain('weird_status');
  });

  it('XSS : beneficiary_full_name/title échappés dans le tableau', async () => {
    setupApi({
      getSharedCarts: jest.fn().mockResolvedValue({
        carts: [cart({ beneficiary_full_name: '<img src=x onerror=alert(1)>', title: '<script>bad()</script>' })],
      }),
    });
    const View = loadIt();
    await View.render(main);
    const row = main.querySelector('tr[data-id="cart-1"]');
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('script')).toBeNull();
    expect(row.innerHTML).toContain('&lt;img');
  });

  it('changement du filtre statut → recharge getSharedCarts avec le statut choisi', async () => {
    const api = setupApi({ getSharedCarts: jest.fn().mockResolvedValue({ carts: [] }) });
    const View = loadIt();
    await View.render(main);

    const select = document.getElementById('scv-filter');
    select.value = 'expired';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    const lastCall = api.getSharedCarts.mock.calls[api.getSharedCarts.mock.calls.length - 1][0];
    expect(lastCall).toEqual({ status: 'expired' });
  });

  it('filtre "all" → getSharedCarts appelé sans filtre status', async () => {
    const api = setupApi();
    const View = loadIt();
    await View.render(main);
    expect(api.getSharedCarts).toHaveBeenCalledWith({});
  });

  it('clic sur une ligne ouvre le drawer, affiche "Chargement" puis le détail', async () => {
    const api = setupApi({
      getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }),
      getSharedCart: jest.fn(() => new Promise((r) => setTimeout(() => r(detail()), 0))),
    });
    const View = loadIt();
    await View.render(main);

    main.querySelector('tr[data-id="cart-1"]').click();
    await Promise.resolve();
    expect(main.querySelector('.scv-drawer.open')).toBeTruthy();
    expect(main.textContent).toContain('Chargement');

    await new Promise((r) => setTimeout(r, 10));
    expect(api.getSharedCart).toHaveBeenCalledWith('cart-1');
    expect(main.textContent).toContain('Cadeau Fatima');
    expect(main.textContent).toContain('Bracelet');
  });

  it('clic sur une ligne : échec getSharedCart → alert() et fermeture du drawer', async () => {
    const alertMock = mockAlert();
    setupApi({
      getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }),
      getSharedCart: jest.fn().mockRejectedValue(new Error('detail KO')),
    });
    const View = loadIt();
    await View.render(main);

    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();

    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('detail KO'));
    expect(main.querySelector('.scv-drawer.open')).toBeNull();
  });

  it('bouton fermer (data-act="close") ferme le drawer', async () => {
    setupApi({ getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }) });
    const View = loadIt();
    await View.render(main);

    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();
    expect(main.querySelector('.scv-drawer.open')).toBeTruthy();

    main.querySelector('[data-act="close"]').click();
    await flush();
    expect(main.querySelector('.scv-drawer.open')).toBeNull();
  });

  it('drawer : actions +7 jours / expiration visibles seulement pour statut active/partially_funded', async () => {
    setupApi({
      getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart({ status: 'fully_funded' })] }),
      getSharedCart: jest.fn().mockResolvedValue(detail({ cart: cart({ status: 'fully_funded' }) })),
    });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();

    expect(main.querySelector('[data-act="extend"]')).toBeNull();
    expect(main.querySelector('[data-act="expire"]')).toBeNull();
    expect(main.querySelector('[data-act="add-note"]')).toBeTruthy();
  });

  it('action extend : prompt invalide (0/vide/hors bornes) → aucun appel API', async () => {
    const api = setupApi({ getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }) });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();

    mockPrompt('0');
    main.querySelector('[data-act="extend"]').click();
    await flush();
    expect(api.extendSharedCart).not.toHaveBeenCalled();

    mockPrompt('100');
    main.querySelector('[data-act="extend"]').click();
    await flush();
    expect(api.extendSharedCart).not.toHaveBeenCalled();

    mockPrompt(null);
    main.querySelector('[data-act="extend"]').click();
    await flush();
    expect(api.extendSharedCart).not.toHaveBeenCalled();
  });

  it('action extend : prompt valide → appelle extendSharedCart puis recharge liste + détail', async () => {
    const api = setupApi({ getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }) });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();

    mockPrompt('14');
    main.querySelector('[data-act="extend"]').click();
    await flush();
    await flush();

    expect(api.extendSharedCart).toHaveBeenCalledWith('cart-1', { days: 14 });
    expect(api.getSharedCarts.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('action extend : échec API → alert()', async () => {
    const alertMock = mockAlert();
    setupApi({
      getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }),
      extendSharedCart: jest.fn().mockRejectedValue(new Error('extend KO')),
    });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();
    mockPrompt('7');
    main.querySelector('[data-act="extend"]').click();
    await flush();
    await flush();
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('extend KO'));
  });

  it('action expire : confirm() refusé → aucun appel API', async () => {
    mockConfirm(false);
    const api = setupApi({ getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }) });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();
    main.querySelector('[data-act="expire"]').click();
    await flush();
    expect(api.expireSharedCart).not.toHaveBeenCalled();
  });

  it('action expire : confirm() accepté → prompt raison optionnel puis appelle expireSharedCart', async () => {
    mockConfirm(true);
    mockPrompt(null); // raison optionnelle non renseignée
    const api = setupApi({ getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }) });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();
    main.querySelector('[data-act="expire"]').click();
    await flush();
    await flush();
    expect(api.expireSharedCart).toHaveBeenCalledWith('cart-1', { reason: '' });
  });

  it('action expire : échec API → alert()', async () => {
    mockConfirm(true);
    mockPrompt('raison');
    const alertMock = mockAlert();
    setupApi({
      getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }),
      expireSharedCart: jest.fn().mockRejectedValue(new Error('expire KO')),
    });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();
    main.querySelector('[data-act="expire"]').click();
    await flush();
    await flush();
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('expire KO'));
  });

  it('action add-note : prompt vide/blanc → aucun appel API', async () => {
    const api = setupApi({ getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }) });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();

    mockPrompt('   ');
    main.querySelector('[data-act="add-note"]').click();
    await flush();
    expect(api.noteSharedCart).not.toHaveBeenCalled();

    mockPrompt(null);
    main.querySelector('[data-act="add-note"]').click();
    await flush();
    expect(api.noteSharedCart).not.toHaveBeenCalled();
  });

  it('action add-note : prompt valide → appelle noteSharedCart puis recharge détail', async () => {
    const api = setupApi({ getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }) });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();

    mockPrompt('Arbitrage OK');
    main.querySelector('[data-act="add-note"]').click();
    await flush();
    await flush();

    expect(api.noteSharedCart).toHaveBeenCalledWith('cart-1', { note: 'Arbitrage OK' });
  });

  it('action add-note : échec API → alert()', async () => {
    const alertMock = mockAlert();
    setupApi({
      getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }),
      noteSharedCart: jest.fn().mockRejectedValue(new Error('note KO')),
    });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();
    mockPrompt('note');
    main.querySelector('[data-act="add-note"]').click();
    await flush();
    await flush();
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('note KO'));
  });

  it('affiche les contributions et les événements d\'audit dans le drawer', async () => {
    setupApi({
      getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }),
      getSharedCart: jest.fn().mockResolvedValue(detail({
        contributions: [{ contributor_name: 'Ali', contributor_email: 'ali@x.com', status: 'paid', amount_kmf: 4000, amount_paid: 4000, currency_paid: 'KMF', paid_at: '2026-07-01T10:00:00Z', message: 'Bravo !' }],
        events: [{ created_at: '2026-07-01T09:00:00Z', event_type: 'created', payload: { x: 1 } }],
      })),
    });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();

    expect(main.textContent).toContain('Ali');
    expect(main.textContent).toContain('Bravo !');
    expect(main.textContent).toContain('created');
  });

  it('aucune contribution → message "Aucune contribution."', async () => {
    setupApi({
      getSharedCarts: jest.fn().mockResolvedValue({ carts: [cart()] }),
      getSharedCart: jest.fn().mockResolvedValue(detail({ contributions: [] })),
    });
    const View = loadIt();
    await View.render(main);
    main.querySelector('tr[data-id="cart-1"]').click();
    await flush();
    expect(main.textContent).toContain('Aucune contribution.');
  });
});
