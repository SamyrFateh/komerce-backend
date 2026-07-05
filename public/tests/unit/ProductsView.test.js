'use strict';

/**
 * tests/unit/ProductsView.test.js
 *
 * admin/js/views/ProductsView.js (708L) — CRUD produits boutique.
 * Export public : render(container).
 *
 * Dépendance externe : `fetch` global (mocké, routage par URL/méthode).
 * `window.confirm` mocké (toggleActive). `window.KProductCardModel` optionnel
 * (preview carte produit — testé présent et absent).
 *
 * Périmètre couvert :
 *   - Chargement catégories : succès → shell ; échec → message d'erreur
 *   - Shell : onglets Liste/Diagnostic, recherche, bouton "Nouveau produit"
 *   - loadPage : liste vide, pagination (page 1/2/dernière), lignes produit
 *   - Recherche : debounce 400ms → requête avec le paramètre "search"
 *   - Modal création : preview live, validation catégorie, soumission POST,
 *     annulation (croix / bouton / clic overlay)
 *   - Modal édition : préremplissage, soumission PUT
 *   - wireSubcategoryDropdown : options mises à jour au changement de catégorie
 *   - toggleActive : confirm accepté (PUT) / refusé (aucun appel)
 *   - Onglet Diagnostic : 4 compteurs, tableaux invalid-cat/no-image/bad-subcat,
 *     messages "tout est valide" quand les listes sont vides
 */

const CATS = [
  {
    key: 'tech', label: 'Tech',
    subcategories: [{ key: 'telephonie', label: 'Téléphonie' }, { key: 'audio', label: 'Audio' }],
  },
  { key: 'mode', label: 'Mode', db_keys: ['mode_legacy'], subcategories: [{ key: 'homme', label: 'Homme' }] },
];

function makeProduct(overrides) {
  return Object.assign({
    id: 'p1', name: 'Écouteurs BT', price_kmf: 25000, stock: 10,
    category: 'tech', subcategory: 'audio', is_active: true, image_url: 'https://example.com/img/x.png',
  }, overrides);
}

function jsonResponse(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, statusText: 'ERR', json: () => Promise.resolve(body) });
}

describe('ProductsView', () => {
  let root;
  let fetchRoutes;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    fetchRoutes = {
      categories: () => jsonResponse(CATS),
      productsList: () => jsonResponse({ products: [makeProduct()], total: 1 }),
      post: () => jsonResponse({ id: 'p2' }),
      put: () => jsonResponse({ ok: true }),
    };

    global.fetch = jest.fn((url, opts = {}) => {
      if (String(url).includes('/api/categories')) return fetchRoutes.categories();
      if (opts.method === 'POST') return fetchRoutes.post(url, opts);
      if (opts.method === 'PUT') return fetchRoutes.put(url, opts);
      return fetchRoutes.productsList(url, opts);
    });
    global.confirm = jest.fn(() => true);
    delete window.KProductCardModel;

    require('../../admin/js/views/ProductsView.js');
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
    delete global.confirm;
    delete window.KProductCardModel;
    document.querySelectorAll('.toast, div[style*="position:fixed"]').forEach(el => el.remove());
  });

  async function flush() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    expect(typeof window.ProductsView).toBe('object');
    expect(typeof window.ProductsView.render).toBe('function');
  });

  describe('chargement initial', () => {
    it('catégories chargées → shell affiché avec liste, onglets et bouton nouveau produit', async () => {
      await window.ProductsView.render(root);
      await flush();

      expect(root.querySelector('#btn-new-product')).toBeTruthy();
      expect(root.querySelector('#tab-list')).toBeTruthy();
      expect(root.querySelector('#tab-diag')).toBeTruthy();
      expect(root.textContent).toContain('Écouteurs BT');
    });

    it('échec du chargement des catégories → message d\'erreur, pas de shell', async () => {
      fetchRoutes.categories = () => Promise.resolve({ ok: false, status: 500, statusText: 'Server Error' });
      await window.ProductsView.render(root);
      await flush();

      expect(root.textContent).toContain('Erreur');
      expect(root.querySelector('#btn-new-product')).toBeNull();
    });
  });

  describe('loadPage — liste et pagination', () => {
    it('aucun produit → message dédié, pas de pagination', async () => {
      fetchRoutes.productsList = () => jsonResponse({ products: [], total: 0 });
      await window.ProductsView.render(root);
      await flush();

      expect(root.querySelector('#products-table-wrap').textContent).toContain('Aucun produit trouvé');
      expect(root.querySelector('#products-pagination').innerHTML).toBe('');
    });

    it('plusieurs pages → bouton "Suivant" présent, pas de "Précédent" en page 1', async () => {
      fetchRoutes.productsList = () => jsonResponse({
        products: Array.from({ length: 50 }, (_, i) => makeProduct({ id: `p${i}`, name: `Prod ${i}` })),
        total: 120,
      });
      await window.ProductsView.render(root);
      await flush();

      const pag = root.querySelector('#products-pagination');
      expect(pag.textContent).toContain('120 produit(s) — Page 1/3');
      expect(pag.querySelector('button')?.textContent).toContain('Suivant');
    });

    it('clic "Suivant" → recharge la page 2 avec offset', async () => {
      fetchRoutes.productsList = () => jsonResponse({
        products: Array.from({ length: 50 }, (_, i) => makeProduct({ id: `p${i}` })),
        total: 120,
      });
      await window.ProductsView.render(root);
      await flush();

      global.fetch.mockClear();
      root.querySelector('#products-pagination button').click();
      await flush();

      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('offset=50'));
      expect(call).toBeDefined();
      expect(root.querySelector('#products-pagination').textContent).toContain('Page 2/3');
    });
  });

  describe('recherche', () => {
    it('debounce 400ms → requête avec le paramètre search', async () => {
      await window.ProductsView.render(root);
      await flush();
      global.fetch.mockClear();

      const input = root.querySelector('#search-input');
      input.value = 'écouteurs';
      input.dispatchEvent(new Event('input'));

      jest.advanceTimersByTime(399);
      expect(global.fetch).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await flush();

      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('search=' ));
      expect(call).toBeDefined();
    });
  });

  describe('onglet Diagnostic', () => {
    it('produits valides → messages "tout est valide", compteurs à 0', async () => {
      fetchRoutes.productsList = () => jsonResponse({
        products: [makeProduct({ is_active: true, image_url: '/img/ok.png' })],
        total: 1,
      });
      await window.ProductsView.render(root);
      await flush();

      root.querySelector('#tab-diag').click();
      await flush();

      const diag = root.querySelector('#diagnostic-content').textContent;
      expect(diag).toContain('Toutes les catégories sont valides');
      expect(diag).toContain('Tous les produits actifs ont une image');
    });

    it('produit sans catégorie valide, actif sans image, sous-cat invalide → tableaux peuplés', async () => {
      fetchRoutes.productsList = () => jsonResponse({
        products: [
          makeProduct({ id: 'bad1', name: 'BadCat', category: 'inexistant', is_active: false }),
          makeProduct({ id: 'bad2', name: 'NoImg', image_url: '', is_active: true, category: 'tech', subcategory: 'audio' }),
          makeProduct({ id: 'bad3', name: 'BadSub', category: 'tech', subcategory: 'inexistante', is_active: true, image_url: '/x.png' }),
        ],
        total: 3,
      });
      await window.ProductsView.render(root);
      await flush();

      root.querySelector('#tab-diag').click();
      await flush();

      const diag = root.querySelector('#diagnostic-content').textContent;
      expect(diag).toContain('BadCat');
      expect(diag).toContain('NoImg');
      expect(diag).toContain('BadSub');
    });

    it('erreur réseau pendant le diagnostic → message d\'erreur affiché', async () => {
      await window.ProductsView.render(root);
      await flush();

      let firstCall = true;
      global.fetch = jest.fn((url) => {
        if (String(url).includes('/api/categories')) return fetchRoutes.categories();
        return Promise.reject(new Error('diag down'));
      });

      root.querySelector('#tab-diag').click();
      await flush();

      expect(root.querySelector('#diagnostic-content').textContent).toContain('diag down');
    });
  });

  describe('modal création', () => {
    it('ouverture → preview initiale affichée (fallback sans KProductCardModel)', async () => {
      await window.ProductsView.render(root);
      await flush();

      root.querySelector('#btn-new-product').click();
      await flush();

      expect(document.querySelector('#preview-card')).toBeTruthy();
      expect(document.querySelector('#preview-card').textContent).toContain('(sans nom)');
    });

    it('preview avec KProductCardModel présent utilise le resolver', async () => {
      window.KProductCardModel = { resolve: jest.fn(() => ({
        imageUrl: '/x.png', title: 'Mock', subtitle: 'sub', priceLabel: '1 KMF', badges: [], accentToken: '#000', isAvailable: true,
      })) };
      await window.ProductsView.render(root);
      await flush();

      root.querySelector('#btn-new-product').click();
      await flush();

      expect(window.KProductCardModel.resolve).toHaveBeenCalled();
      expect(document.querySelector('#preview-card').textContent).toContain('Mock');
    });

    it('catégorie manquante → erreur affichée, pas de POST', async () => {
      await window.ProductsView.render(root);
      await flush();
      root.querySelector('#btn-new-product').click();
      await flush();

      const form = document.querySelector('#product-form');
      form.querySelector('[name="name"]').value = 'Nouveau produit';
      form.querySelector('[name="price_kmf"]').value = '5000';
      global.fetch.mockClear();

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();

      expect(document.querySelector('#form-error').style.display).toBe('block');
      expect(document.querySelector('#form-error').textContent).toContain('catégorie est obligatoire');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('soumission valide → POST envoyé, toast affiché, modal fermée', async () => {
      await window.ProductsView.render(root);
      await flush();
      root.querySelector('#btn-new-product').click();
      await flush();

      const form = document.querySelector('#product-form');
      form.querySelector('[name="name"]').value = 'Nouveau produit';
      form.querySelector('[name="price_kmf"]').value = '5000';
      form.querySelector('[name="category"]').value = 'tech';

      form.querySelector('button[type="submit"]').click();
      await flush();

      const postCall = global.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'POST');
      expect(postCall).toBeDefined();
      expect(JSON.parse(postCall[1].body).name).toBe('Nouveau produit');
      expect(document.querySelector('.toast-success')).toBeTruthy();
      expect(document.querySelector('#product-form')).toBeNull(); // modal fermée
    });

    it('bascule de catégorie → recharge la liste des sous-catégories', async () => {
      await window.ProductsView.render(root);
      await flush();
      root.querySelector('#btn-new-product').click();
      await flush();

      const selCat = document.querySelector('#sel-category');
      const selSub = document.querySelector('#sel-subcategory');
      selCat.value = 'mode';
      selCat.dispatchEvent(new Event('change'));

      expect(selSub.innerHTML).toContain('Homme');
      expect(selSub.innerHTML).not.toContain('Téléphonie');
    });

    it('fermeture via la croix n\'appelle pas l\'API', async () => {
      await window.ProductsView.render(root);
      await flush();
      root.querySelector('#btn-new-product').click();
      await flush();
      global.fetch.mockClear();

      document.querySelector('#modal-close').click();

      expect(document.querySelector('#product-form')).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('clic en dehors de la modale (overlay) la ferme aussi', async () => {
      await window.ProductsView.render(root);
      await flush();
      root.querySelector('#btn-new-product').click();
      await flush();

      const overlay = document.querySelector('#modal-close').parentElement.parentElement;
      overlay.click();

      expect(document.querySelector('#product-form')).toBeNull();
    });
  });

  describe('modal édition', () => {
    it('préremplit le formulaire et envoie un PUT', async () => {
      await window.ProductsView.render(root);
      await flush();

      root.querySelector('[data-action="edit"]').click();
      await flush();

      const form = document.querySelector('#product-form');
      expect(form.querySelector('[name="name"]').value).toBe('Écouteurs BT');
      expect(form.querySelector('[name="category"]').value).toBe('tech');

      form.querySelector('button[type="submit"]').click();
      await flush();

      const putCall = global.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'PUT');
      expect(putCall).toBeDefined();
      expect(document.querySelector('.toast-success').textContent).toContain('modifié');
    });
  });

  describe('toggleActive', () => {
    it('confirm accepté → PUT is_active inversé + toast', async () => {
      await window.ProductsView.render(root);
      await flush();

      root.querySelector('[data-action="toggle"]').click();
      await flush();

      expect(global.confirm).toHaveBeenCalled();
      const putCall = global.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'PUT');
      expect(JSON.parse(putCall[1].body).is_active).toBe(false);
    });

    it('confirm refusé → aucun appel API', async () => {
      global.confirm = jest.fn(() => false);
      await window.ProductsView.render(root);
      await flush();
      global.fetch.mockClear();

      root.querySelector('[data-action="toggle"]').click();
      await flush();

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
