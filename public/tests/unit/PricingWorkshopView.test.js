'use strict';

/**
 * tests/unit/PricingWorkshopView.test.js
 *
 * admin/js/views/PricingWorkshopView.js (637L) — Atelier de configuration
 * des cost_components (écran expert, appelé depuis PricingView via
 * "open-workshop" / back-to-pricing dans l'autre sens).
 *
 * Export réel : `window.PricingWorkshopView` EST directement la fonction
 * bare `async function(container)` (pas d'objet `{ render }`), même
 * pattern que PricingView. Malgré le header `@depends api-client.js,
 * filters-store.js, utils.js` et `@doctrine kmc_api_only`, tous les appels
 * passent par `fetch` global brut (`_api()` local) — KmcApi/KmcFilters ne
 * sont jamais référencés.
 *
 * BUG PRODUCTION CONFIRMÉ (non corrigé ici — hors périmètre "tests only") :
 * `_bindEvents(container)` est rappelé à CHAQUE `_renderHTML(container)`,
 * et `container` n'est jamais remplacé (seul son `innerHTML` l'est) → les
 * listeners `change`/`input`/`click` s'accumulent à chaque re-rendu. Pas de
 * debounce ici (pas de timer partagé comme `_recalcTimer` dans PricingView)
 * donc aucun mécanisme ne masque l'effet : une action synchrone sans garde
 * d'idempotence (ex. `back-to-pricing`) après plusieurs re-rendus se
 * déclenche autant de fois qu'il y a de listeners empilés. Test dédié
 * ci-dessous, documenté sans être corrigé.
 *
 * Piège de ciblage `closest('[data-act]')` confirmé en lisant le code :
 * le bouton `edit-comp` et le toggle `toggle-comp` vivent tous les deux
 * dans des `<td class="cc-td-norow">`, mais seul le handler `row-edit` /
 * `edit-comp` vérifie `e.target.closest('.cc-td-norow')` pour se
 * neutraliser — `toggle-comp` n'a pas cette garde. Conséquence observable :
 * cliquer précisément sur le bouton crayon (`edit-comp`) ne fait RIEN (le
 * `act` résolu est bien 'edit-comp', mais la garde `.cc-td-norow` le
 * bloque) ; seul un clic sur la ligne en dehors des colonnes toggle/actions
 * ouvre le tiroir d'édition. Testé tel quel (comportement réel, pas un bug
 * de test).
 *
 * Périmètre couvert :
 *   - Contrat : fonction bare, pas d'objet render
 *   - Chargement : "Chargement..." synchrone, erreur réseau initiale →
 *     message d'erreur (catch externe de _render, atteignable ici —
 *     contrairement à PricingView/SanteView — car _loadAll ne catch rien
 *     lui-même en dehors du finally)
 *   - _loadAll : construction des query params (family/channel/island/
 *     scope/allocation_method/is_active/is_exceptional), cache de _meta
 *     (un seul fetch tant que _cc.meta est déjà posé)
 *   - Rendu : stats par famille, table triée/groupée, message vide,
 *     colonnes triables (toggle asc/desc)
 *   - Filtres : search (client-side + reload redondant), family/channel/
 *     island/scope/allocation (reload avec query param), show_inactive/
 *     show_exceptional (reload sans le param correspondant)
 *   - Ligne → tiroir édition : fetch détail, piège closest('.cc-td-norow')
 *     sur edit-comp, erreur réseau → alert
 *   - Toggle actif/inactif : POST toggle + reload, pas de garde .cc-td-norow
 *   - Suppression : confirm() requis, refus → pas d'appel, DELETE + reload
 *   - Tiroir création : valeurs par défaut, validation champs requis,
 *     nettoyage des champs optionnels vides avant POST, échec → alert +
 *     réactivation bouton
 *   - Tiroir édition : strip id/key/created_at/updated_at/created_by/
 *     updated_by avant PUT, guard sans f.id, échec → alert
 *   - Changement de famille dans le tiroir → re-rendu (options catégorie)
 *   - Fermeture tiroir, retour pricing (avec/sans KmcApp.navigate)
 *   - Bug listeners accumulés : documenté (pas corrigé)
 */

function jsonResponse(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) });
}

const COMPONENTS = [
  { id: 1, key: 'product_purchase_default', label: 'Achat produit', emoji: '🛒', description: 'Coût fournisseur de base', family: 'landed_relay', category: 'product_purchase', default_value: 1000, unit: 'kmf', scope: 'global', scope_value: '', channel: '', island: '', source: 'real', confidence: 'high', is_active: true, is_exceptional: false, is_deletable: true },
  { id: 2, key: 'freight_air', label: 'Fret aérien', emoji: '', description: '', family: 'landed_relay', category: 'freight', default_value: 500, unit: 'kmf_per_kg', scope: 'global', scope_value: '', channel: '', island: '', source: 'manual', confidence: 'medium', is_active: false, is_exceptional: false, is_deletable: false },
  { id: 3, key: 'payment_fee', label: 'Frais paiement', emoji: '', description: '', family: 'business', category: 'payment', default_value: 2, unit: 'pct', scope: 'global', scope_value: '', channel: 'diaspora', island: '', source: 'default', confidence: 'low', is_active: true, is_exceptional: false, is_deletable: true },
  { id: 4, key: 'incident_logistique', label: 'Incident logistique', emoji: '⚠️', description: '', family: 'exceptional', category: 'incident', default_value: 5000, unit: 'kmf', scope: 'order', scope_value: '', channel: '', island: 'anjouan', source: 'manual', confidence: 'medium', is_active: true, is_exceptional: true, is_deletable: true },
];

function groupComponents(list) {
  const grouped = { landed_relay: {}, business: {}, exceptional: {} };
  list.forEach((c) => {
    grouped[c.family] = grouped[c.family] || {};
    grouped[c.family][c.category] = grouped[c.family][c.category] || [];
    grouped[c.family][c.category].push(c);
  });
  return grouped;
}

const META = {
  categories: {
    landed_relay: ['product_purchase', 'sourcing', 'hub', 'packaging', 'freight', 'customs', 'port_transitary', 'local_distribution', 'relay'],
    business: ['payment', 'risk_provision', 'fixed_overhead'],
    exceptional: ['incident', 'marketing_campaign'],
  },
};

describe('PricingWorkshopView', () => {
  let main;
  let routes;
  let fetchMock;

  function router(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const u = String(url);
    const path = u.split('?')[0];

    if (path.endsWith('/_meta')) return routes.meta();

    const toggleMatch = path.match(/\/cost-components\/([^/]+)\/toggle$/);
    if (toggleMatch && method === 'POST') return routes.toggle(toggleMatch[1]);

    const idMatch = path.match(/\/cost-components\/([^/]+)$/);
    if (idMatch) {
      if (method === 'GET') return routes.detail(idMatch[1]);
      if (method === 'PUT') return routes.update(idMatch[1], opts);
      if (method === 'DELETE') return routes.remove(idMatch[1]);
    }

    if (path.endsWith('/cost-components')) {
      if (method === 'POST') return routes.create(opts);
      if (method === 'GET') return routes.list(u);
    }

    return jsonResponse({}, false, 404);
  }

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
    document.getElementById('cc-styles')?.remove();

    routes = {
      meta: jest.fn(() => jsonResponse(META)),
      list: jest.fn(() => jsonResponse({ components: COMPONENTS, grouped: groupComponents(COMPONENTS) })),
      detail: jest.fn((id) => jsonResponse({ component: COMPONENTS.find((c) => String(c.id) === String(id)), events: [{ event_type: 'created', created_at: '2026-01-01T00:00:00Z', notes: 'init' }] })),
      create: jest.fn(() => jsonResponse({ ok: true })),
      update: jest.fn(() => jsonResponse({ ok: true })),
      toggle: jest.fn(() => jsonResponse({ ok: true })),
      remove: jest.fn(() => jsonResponse({ ok: true })),
    };

    fetchMock = jest.fn((url, opts) => router(url, opts));
    global.fetch = fetchMock;

    window.KmcApp = { navigate: jest.fn() };
    window.confirm = jest.fn(() => true);
    window.alert = jest.fn();
    window.location.hash = '';

    require('../../dashboards/admin/js/views/PricingWorkshopView.js');
  });

  afterEach(() => {
    delete global.fetch;
    delete window.KmcApp;
    delete window.confirm;
    delete window.alert;
  });

  async function flush() {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  }

  function lastFetchUrl() {
    return String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]);
  }

  function fetchUrlsFor(fragment) {
    return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes(fragment));
  }

  /* ─── CONTRAT ─────────────────────────────────────────────────────────── */
  it('expose une fonction bare (pas un objet { render })', () => {
    expect(typeof window.PricingWorkshopView).toBe('function');
    expect(window.PricingWorkshopView.render).toBeUndefined();
  });

  /* ─── CHARGEMENT ──────────────────────────────────────────────────────── */
  describe('chargement initial', () => {
    it('affiche "Chargement..." de façon synchrone avant résolution des fetch', () => {
      window.PricingWorkshopView(main);
      expect(main.innerHTML).toContain('Chargement des composants de coût');
    });

    it('rendu nominal : table + stats après résolution', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      expect(main.querySelector('.cc-table-wrap')).toBeTruthy();
      expect(main.querySelector('.cc-stats')).toBeTruthy();
      expect(main.querySelector('.cc-drawer.open')).toBeFalsy();
    });

    it('erreur réseau au premier chargement → catch externe de _render, message d\'erreur affiché', async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
      await window.PricingWorkshopView(main);
      await flush();
      expect(main.innerHTML).toContain('Erreur');
      expect(main.innerHTML).toContain('network down');
      expect(main.querySelector('.cc-table-wrap')).toBeFalsy();
    });

    it('réponse cost-components non-ok (ex. 500) → catch externe de _render également atteint', async () => {
      routes.list = jest.fn(() => jsonResponse({}, false, 500));
      await window.PricingWorkshopView(main);
      await flush();
      expect(main.innerHTML).toContain('Erreur');
    });

    it('_meta n\'est chargé qu\'une seule fois même après un reload de filtre', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      expect(fetchUrlsFor('_meta').length).toBe(1);

      const familySelect = main.querySelector('[data-filter="family"]');
      familySelect.value = 'business';
      familySelect.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      expect(fetchUrlsFor('_meta').length).toBe(1);
    });

    it('params par défaut : is_active=true et is_exceptional=false présents sans autre filtre', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      const listCall = urls.find((u) => u.includes('/api/admin/cost-components') && !u.includes('_meta'));
      expect(listCall).toContain('is_active=true');
      expect(listCall).toContain('is_exceptional=false');
    });
  });

  /* ─── RENDU : STATS / TABLE / TRI ─────────────────────────────────────── */
  describe('rendu table et stats', () => {
    it('regroupe les compteurs par famille dans les stats', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const stats = main.querySelectorAll('.cc-stat-value');
      // total, landed_relay(2), business(1), exceptional(1)
      expect(stats[0].textContent).toBe('4');
      expect(stats[1].textContent).toBe('2');
      expect(stats[2].textContent).toBe('1');
      expect(stats[3].textContent).toBe('1');
    });

    it('affiche le message vide quand aucun composant ne correspond au filtre famille', async () => {
      routes.list = jest.fn((u) => {
        if (String(u).includes('family=business')) return jsonResponse({ components: [], grouped: { landed_relay: {}, business: {}, exceptional: {} } });
        return jsonResponse({ components: COMPONENTS, grouped: groupComponents(COMPONENTS) });
      });
      await window.PricingWorkshopView(main);
      await flush();
      const familySelect = main.querySelector('[data-filter="family"]');
      familySelect.value = 'business';
      familySelect.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(main.querySelector('.cc-table-empty')).toBeTruthy();
      expect(main.textContent).toContain('Aucun composant ne correspond');
    });

    it('tri : premier clic sur une nouvelle colonne trie en ascendant, sans reload réseau', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const callsBefore = fetchMock.mock.calls.length;

      main.querySelector('[data-act="sort"][data-sort="label"]').click();
      await flush();
      expect(main.querySelector('[data-sort="label"]').className).toContain('sorted');
      expect(main.querySelector('[data-sort="label"] .cc-sort-arrow').textContent).toBe('▲');
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
    });

    it('tri : cliquer sur la colonne déjà triée (family, tri par défaut) inverse la direction', async () => {
      // Clic effectué juste après le chargement initial : à ce stade un seul
      // listener 'click' est attaché au container (_bindEvents n'a encore été
      // rappelé qu'une fois, par _render). C'est nécessaire pour observer un
      // toggle "propre" — un second clic après un re-rendu intermédiaire
      // cumulerait les listeners (bug documenté plus bas) et annulerait
      // l'inversion en la déclenchant deux fois pour un seul clic.
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('[data-act="sort"][data-sort="family"]').click();
      await flush();
      expect(main.querySelector('[data-sort="family"] .cc-sort-arrow').textContent).toBe('▼');
    });

    it.each(['category', 'value', 'scope', 'source', 'confidence', 'is_active'])(
      'tri par colonne "%s" ne crashe pas (couvre chaque branche de getVal)',
      async (sortKey) => {
        await window.PricingWorkshopView(main);
        await flush();
        main.querySelector(`[data-act="sort"][data-sort="${sortKey}"]`).click();
        await flush();
        expect(main.querySelector(`[data-sort="${sortKey}"]`).className).toContain('sorted');
      }
    );

    it('tri par défaut : sortKey="family" est marqué "sorted" au premier rendu', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      expect(main.querySelector('[data-sort="family"]').className).toContain('sorted');
    });
  });

  /* ─── FILTRES ─────────────────────────────────────────────────────────── */
  describe('filtres', () => {
    it('recherche : filtre côté client ET déclenche un reload réseau redondant (searchTerm absent des query params)', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const callsBefore = fetchMock.mock.calls.length;

      const search = main.querySelector('[data-filter="search"]');
      search.value = 'fret';
      search.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
      const listCall = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/api/admin/cost-components') && !u.includes('_meta'));
      expect(listCall).not.toContain('search=');
    });

    it('filtre famille ajoute family=... à la query et recharge', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const familySelect = main.querySelector('[data-filter="family"]');
      familySelect.value = 'exceptional';
      familySelect.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(lastFetchUrl()).toContain('family=exceptional');
    });

    it('filtre canal/île/scope/allocation ajoutent leurs query params respectifs', async () => {
      await window.PricingWorkshopView(main);
      await flush();

      main.querySelector('[data-filter="channel"]').value = 'diaspora';
      main.querySelector('[data-filter="channel"]').dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(lastFetchUrl()).toContain('channel=diaspora');

      main.querySelector('[data-filter="island"]').value = 'anjouan';
      main.querySelector('[data-filter="island"]').dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(lastFetchUrl()).toContain('island=anjouan');

      main.querySelector('[data-filter="scope"]').value = 'category';
      main.querySelector('[data-filter="scope"]').dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(lastFetchUrl()).toContain('scope=category');

      main.querySelector('[data-filter="allocation"]').value = 'by_weight';
      main.querySelector('[data-filter="allocation"]').dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(lastFetchUrl()).toContain('allocation_method=by_weight');
    });

    it('show_inactive cochée → is_active absent de la query ; décochée → is_active=true présent', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const cb = main.querySelector('[data-filter="show_inactive"]');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(lastFetchUrl()).not.toContain('is_active=true');
    });

    it('show_exceptional cochée → is_exceptional absent de la query', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const cb = main.querySelector('[data-filter="show_exceptional"]');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(lastFetchUrl()).not.toContain('is_exceptional=false');
    });

    it('échec réseau pendant un reload de filtre → alert, pas de crash', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      global.fetch = jest.fn(() => Promise.reject(new Error('timeout filtre')));
      const familySelect = main.querySelector('[data-filter="family"]');
      familySelect.value = 'business';
      familySelect.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('timeout filtre'));
    });
  });

  /* ─── LIGNE → TIROIR ÉDITION ──────────────────────────────────────────── */
  describe('édition depuis une ligne', () => {
    it('clic sur une cellule normale de la ligne ouvre le tiroir en mode édition avec les données du composant', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const row = main.querySelector('tr[data-id="1"]');
      row.querySelector('td').click();
      await flush();
      expect(routes.detail).toHaveBeenCalledWith('1');
      expect(main.querySelector('.cc-drawer.open')).toBeTruthy();
      expect(main.querySelector('[data-form="label"]').value).toBe('Achat produit');
      expect(main.querySelector('.cc-events')).toBeTruthy();
    });

    it('piège closest(".cc-td-norow") : cliquer précisément sur le bouton crayon (edit-comp) n\'ouvre PAS le tiroir', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const editBtn = main.querySelector('tr[data-id="1"] [data-act="edit-comp"]');
      editBtn.click();
      await flush();
      expect(routes.detail).not.toHaveBeenCalled();
      expect(main.querySelector('.cc-drawer.open')).toBeFalsy();
    });

    it('échec réseau à l\'ouverture du tiroir édition → alert, tiroir reste fermé', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      routes.detail = jest.fn(() => jsonResponse({}, false, 404));
      const row = main.querySelector('tr[data-id="2"]');
      row.querySelector('td').click();
      await flush();
      expect(window.alert).toHaveBeenCalled();
      expect(main.querySelector('.cc-drawer.open')).toBeFalsy();
    });

    it('fermeture du tiroir réinitialise drawerForm/drawerEvents', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('tr[data-id="1"] td').click();
      await flush();
      main.querySelector('[data-act="close-drawer"]').click();
      await flush();
      expect(main.querySelector('.cc-drawer.open')).toBeFalsy();
    });
  });

  /* ─── TOGGLE / SUPPRESSION ────────────────────────────────────────────── */
  describe('toggle actif et suppression', () => {
    it('toggle-comp n\'a pas la garde .cc-td-norow : le clic sur le toggle fonctionne malgré la cellule', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const toggle = main.querySelector('tr[data-id="1"] [data-act="toggle-comp"]');
      toggle.click();
      await flush();
      expect(routes.toggle).toHaveBeenCalledWith('1');
    });

    it('échec réseau du toggle → alert', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      routes.toggle = jest.fn(() => jsonResponse({}, false, 500));
      main.querySelector('tr[data-id="1"] [data-act="toggle-comp"]').click();
      await flush();
      expect(window.alert).toHaveBeenCalled();
    });

    it('suppression : confirm() refusé → pas d\'appel DELETE', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      window.confirm = jest.fn(() => false);
      const delBtn = main.querySelector('tr[data-id="1"] [data-act="delete-comp"]');
      expect(delBtn).toBeTruthy();
      delBtn.click();
      await flush();
      expect(routes.remove).not.toHaveBeenCalled();
    });

    it('suppression : confirm() accepté → DELETE puis reload', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('tr[data-id="1"] [data-act="delete-comp"]').click();
      await flush();
      expect(routes.remove).toHaveBeenCalledWith('1');
    });

    it('bouton supprimer absent quand is_deletable=false', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      expect(main.querySelector('tr[data-id="2"] [data-act="delete-comp"]')).toBeFalsy();
    });

    it('échec réseau de la suppression → alert', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      routes.remove = jest.fn(() => jsonResponse({}, false, 500));
      main.querySelector('tr[data-id="1"] [data-act="delete-comp"]').click();
      await flush();
      expect(window.alert).toHaveBeenCalled();
    });
  });

  /* ─── CRÉATION ────────────────────────────────────────────────────────── */
  describe('création d\'un composant', () => {
    it('open-create initialise un formulaire avec les valeurs par défaut', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('[data-act="open-create"]').click();
      await flush();
      expect(main.querySelector('.cc-drawer.open')).toBeTruthy();
      expect(main.querySelector('[data-form="key"]').value).toBe('');
      expect(main.querySelector('[data-form="family"]').value).toBe('landed_relay');
      expect(main.querySelector('[data-form="unit"]').value).toBe('kmf');
      expect(main.querySelector('[data-form="is_active"]').checked).toBe(true);
    });

    it('validation : champs requis manquants → alert, pas d\'appel API', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('[data-act="open-create"]').click();
      await flush();
      main.querySelector('[data-act="save-create"]').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Champs requis'));
      expect(routes.create).not.toHaveBeenCalled();
    });

    it('formulaire rempli via input → POST avec les champs optionnels vides nettoyés', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('[data-act="open-create"]').click();
      await flush();

      const setField = (name, value) => {
        const el = main.querySelector(`[data-form="${name}"]`);
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setField('key', 'nouveau_cout');
      setField('label', 'Nouveau coût');

      main.querySelector('[data-act="save-create"]').click();
      await flush();

      expect(routes.create).toHaveBeenCalled();
      const body = JSON.parse(routes.create.mock.calls[0][0].body);
      expect(body.key).toBe('nouveau_cout');
      expect(body.label).toBe('Nouveau coût');
      expect(body).not.toHaveProperty('channel');
      expect(body).not.toHaveProperty('island');
      expect(body).not.toHaveProperty('scope_value');
      expect(body).not.toHaveProperty('active_from');
      expect(body).not.toHaveProperty('active_until');
    });

    it('succès création → ferme le tiroir et recharge la liste', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('[data-act="open-create"]').click();
      await flush();
      const keyInput = main.querySelector('[data-form="key"]');
      keyInput.value = 'x';
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));
      const labelInput = main.querySelector('[data-form="label"]');
      labelInput.value = 'X';
      labelInput.dispatchEvent(new Event('input', { bubbles: true }));

      const callsBefore = fetchMock.mock.calls.length;
      main.querySelector('[data-act="save-create"]').click();
      await flush();
      expect(main.querySelector('.cc-drawer.open')).toBeFalsy();
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('échec réseau création → alert, bouton réactivé avec son texte initial', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      routes.create = jest.fn(() => jsonResponse({}, false, 500));
      main.querySelector('[data-act="open-create"]').click();
      await flush();
      const keyInput = main.querySelector('[data-form="key"]');
      keyInput.value = 'x';
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));
      const labelInput = main.querySelector('[data-form="label"]');
      labelInput.value = 'X';
      labelInput.dispatchEvent(new Event('input', { bubbles: true }));

      const btn = main.querySelector('[data-act="save-create"]');
      btn.click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Erreur création'));
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('+ Créer');
    });

    it('changement de famille dans le tiroir création re-rend les options de catégorie', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('[data-act="open-create"]').click();
      await flush();

      const famSelect = main.querySelector('[data-form="family"]');
      famSelect.value = 'business';
      famSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      const catOptions = Array.from(main.querySelectorAll('[data-form="category"] option')).map((o) => o.value);
      expect(catOptions).toEqual(META.categories.business);
    });
  });

  /* ─── ÉDITION ──────────────────────────────────────────────────────────── */
  describe('édition d\'un composant existant', () => {
    it('save-edit envoie un PUT sans id/key/created_at/updated_at/created_by/updated_by', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('tr[data-id="1"] td').click();
      await flush();

      main.querySelector('[data-act="save-edit"]').click();
      await flush();

      expect(routes.update).toHaveBeenCalledWith('1', expect.anything());
      const body = JSON.parse(routes.update.mock.calls[0][1].body);
      expect(body).not.toHaveProperty('id');
      expect(body).not.toHaveProperty('key');
      expect(body).not.toHaveProperty('created_at');
      expect(body).not.toHaveProperty('updated_at');
      expect(body).not.toHaveProperty('created_by');
      expect(body).not.toHaveProperty('updated_by');
      expect(body.label).toBe('Achat produit');
    });

    it('succès édition → ferme le tiroir et recharge', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('tr[data-id="1"] td').click();
      await flush();
      main.querySelector('[data-act="save-edit"]').click();
      await flush();
      expect(main.querySelector('.cc-drawer.open')).toBeFalsy();
    });

    it('échec réseau édition → alert, bouton réactivé avec son texte initial', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('tr[data-id="1"] td').click();
      await flush();
      routes.update = jest.fn(() => jsonResponse({}, false, 500));
      const btn = main.querySelector('[data-act="save-edit"]');
      btn.click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Erreur sauvegarde'));
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('💾 Enregistrer');
    });

    it('checkbox is_active/is_exceptional dans le tiroir édition mettent à jour le form via "change"', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('tr[data-id="2"] td').click(); // composant #2 : is_active=false
      await flush();

      const activeCb = main.querySelector('[data-form="is_active"]');
      expect(activeCb.checked).toBe(false);
      activeCb.checked = true;
      activeCb.dispatchEvent(new Event('change', { bubbles: true }));

      main.querySelector('[data-act="save-edit"]').click();
      await flush();
      const body = JSON.parse(routes.update.mock.calls[0][1].body);
      expect(body.is_active).toBe(true);
    });
  });

  /* ─── NAVIGATION ──────────────────────────────────────────────────────── */
  describe('retour vers Pricing', () => {
    it('back-to-pricing utilise KmcApp.navigate si disponible', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('[data-act="back-to-pricing"]').click();
      expect(window.KmcApp.navigate).toHaveBeenCalledWith('pricing');
    });

    it('back-to-pricing retombe sur window.location.hash si KmcApp absent', async () => {
      delete window.KmcApp;
      await window.PricingWorkshopView(main);
      await flush();
      main.querySelector('[data-act="back-to-pricing"]').click();
      expect(window.location.hash).toBe('#pricing');
    });

    it('le lien dans le bandeau d\'avertissement expert déclenche aussi back-to-pricing', async () => {
      await window.PricingWorkshopView(main);
      await flush();
      const link = main.querySelector('.cc-expert-warning [data-act="back-to-pricing"]');
      expect(link).toBeTruthy();
      link.click();
      expect(window.KmcApp.navigate).toHaveBeenCalledWith('pricing');
    });
  });

  /* ─── BUG CONNU : accumulation de listeners sur re-rendu ─────────────── */
  it('[bug documenté, non corrigé] un re-rendu préalable fait déclencher les actions data-act plusieurs fois pour un seul clic', async () => {
    await window.PricingWorkshopView(main);
    await flush();

    // Provoque plusieurs re-rendus (chacun rappelle _bindEvents sur le même container)
    main.querySelector('[data-act="sort"][data-sort="label"]').click();
    await flush();
    main.querySelector('[data-act="sort"][data-sort="label"]').click();
    await flush();
    main.querySelector('[data-act="open-create"]').click();
    await flush();
    main.querySelector('[data-act="close-drawer"]').click();
    await flush();

    window.KmcApp.navigate.mockClear();
    main.querySelector('[data-act="back-to-pricing"]').click();

    expect(window.KmcApp.navigate.mock.calls.length).toBeGreaterThan(1);
  });
});
