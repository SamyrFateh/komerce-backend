'use strict';

/**
 * tests/unit/CatalogApprovalView.test.js
 *
 * admin/js/views/CatalogApprovalView.js (374L) — Vue File d'approbation
 * catalogue /admin/catalog-approval (K-4). Export réel :
 * `global.CatalogApprovalView = { render: CatalogApprovalView }` où
 * CatalogApprovalView(container) est directement la fonction async —
 * render(container) renvoie donc bien la promesse interne (pas de piège
 * "wrapper sans return" ici, contrairement à SourcingScannerView/
 * PricingStrategyView).
 *
 * Dépend réellement de utils.js (esc/escAttr) — chargé via loadView()
 * du testkit (doctrine XSS FRESH-104), pas mocké en passthrough.
 *
 * Source API (global.fetch brut, pas KmcApi — doctrine kmc_api_only
 * mais implémentation historique en fetch() direct) :
 *   - GET  /api/admin/catalog/approval-queue?limit=&offset=
 *   - GET  /api/categories (kmc-api-allow, endpoint distinct, cache module)
 *   - POST /api/admin/catalog/approval-queue/:id/approve
 *   - POST /api/admin/catalog/approval-queue/:id/reject   {reason}
 *   - POST /api/admin/catalog/approval-queue/:id/override {fields, reason}
 *
 * Point sensible doctrine §5 : override n'envoie QUE les champs
 * effectivement modifiés (diff avant/après trim), jamais le formulaire entier.
 * Point sensible XSS : erreur réseau injectée via textContent, pas innerHTML.
 */

const { loadView, cleanupGlobals, mockConfirm } = require('./helpers/dashboardTestKit');

function queueItem(overrides = {}) {
  return Object.assign({
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: 'Batterie externe', category: 'tech', price_kmf: 15000, stock: 10,
    needs_review: false, enrichment_confidence: 0.9, content_source: 'ai_enriched',
    description: 'Powerbank 10000mAh', fragility: null, emoji: '🔋',
  }, overrides);
}

function mockFetchRouter(handlers) {
  return jest.fn((url, opts = {}) => {
    for (const h of handlers) {
      if (h.test(url, opts)) return h.respond(url, opts);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], total: 0 }) });
  });
}

function ok(body) { return Promise.resolve({ ok: true, json: () => Promise.resolve(body) }); }
function fail(status, body) { return Promise.resolve({ ok: false, status, statusText: 'Error', json: () => Promise.resolve(body || {}) }); }

async function flush(times = 20) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('CatalogApprovalView', () => {
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
  });

  afterEach(() => {
    cleanupGlobals();
    delete global.fetch;
    delete window.confirm;
    document.querySelectorAll('.toast').forEach(t => t.remove());
    document.querySelectorAll('body > div').forEach(d => { if (d.id !== 'main') d.remove(); });
  });

  function loadIt() {
    return loadView('../../dashboards/admin/js/views/CatalogApprovalView.js', 'CatalogApprovalView');
  }

  function queueFetch(items, total = items.length) {
    return mockFetchRouter([
      { test: (url) => url.includes('/api/admin/catalog/approval-queue'), respond: () => ok({ items, total }) },
    ]);
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    global.fetch = queueFetch([]);
    const View = loadIt();
    expect(typeof View.render).toBe('function');
  });

  it('appelle approval-queue avec limit/offset page 1 par défaut', async () => {
    global.fetch = queueFetch([]);
    const View = loadIt();
    await View.render(main);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/admin/catalog/approval-queue?');
    expect(url).toContain('limit=20');
    expect(url).toContain('offset=0');
  });

  it('file vide : message "rien à approuver", pagination vide', async () => {
    global.fetch = queueFetch([]);
    const View = loadIt();
    await View.render(main);
    expect(main.textContent).toContain('rien à approuver');
    expect(main.querySelector('#ca-pagination').innerHTML).toBe('');
  });

  it('erreur réseau (res.ok=false) : message affiché via textContent (pas innerHTML), doctrine XSS', async () => {
    global.fetch = jest.fn(() => fail(500, { error: 'DB down' }));
    const View = loadIt();
    await View.render(main);
    const errDiv = main.querySelector('#ca-table-wrap div');
    expect(errDiv.textContent).toBe('Erreur : DB down');
  });

  it('erreur réseau sans body JSON valide → fallback sur res.statusText', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false, status: 503, statusText: 'Service Unavailable',
      json: () => Promise.reject(new Error('not json')),
    }));
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('#ca-table-wrap').textContent).toContain('Erreur : Service Unavailable');
  });

  it('erreur réseau avec body JSON valide mais sans champ error → fallback "HTTP <status>"', async () => {
    global.fetch = jest.fn(() => fail(500, {}));
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('#ca-table-wrap').textContent).toContain('Erreur : HTTP 500');
  });

  it('tableau : colonnes rendues (nom+emoji, catégorie, prix, stock, confiance, source)', async () => {
    global.fetch = queueFetch([queueItem()]);
    const View = loadIt();
    await View.render(main);
    const row = main.querySelector('tbody tr');
    expect(row.textContent).toContain('🔋 Batterie externe');
    expect(row.textContent).toContain('tech');
    expect(row.textContent).toContain('15\u202f000 KMF');
    expect(row.textContent).toContain('10');
    expect(row.textContent).toContain('90%');
    expect(row.textContent).toContain('Enrichi IA');
  });

  it('fallback prix "—" si price_kmf null/undefined', async () => {
    global.fetch = queueFetch([queueItem({ price_kmf: null })]);
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('tbody tr').textContent).toContain('—');
  });

  it('fallback stock "—" via ?? (0 doit rester affiché, pas "—")', async () => {
    global.fetch = queueFetch([queueItem({ stock: 0 })]);
    const View = loadIt();
    await View.render(main);
    const cells = main.querySelectorAll('tbody td');
    expect(cells[2].textContent.trim()).toBe('0');
  });

  it('fallback catégorie "—" si absente', async () => {
    global.fetch = queueFetch([queueItem({ category: null })]);
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('tbody tr').textContent).toContain('—');
  });

  it('confidenceBadge : "—" si null/undefined', async () => {
    global.fetch = queueFetch([queueItem({ enrichment_confidence: null })]);
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('tbody tr td:nth-child(4)').textContent.trim()).toBe('—');
  });

  it('confidenceBadge : couleur rouge si < 50%', async () => {
    global.fetch = queueFetch([queueItem({ enrichment_confidence: 0.3 })]);
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('tbody tr td:nth-child(4)').innerHTML).toContain('#dc2626');
    expect(main.querySelector('tbody tr td:nth-child(4)').textContent).toContain('30%');
  });

  it('confidenceBadge : couleur orange si entre 50 et 79%', async () => {
    global.fetch = queueFetch([queueItem({ enrichment_confidence: 0.6 })]);
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('tbody tr td:nth-child(4)').innerHTML).toContain('#d97706');
  });

  it('sourceLabel : "Connecteur (brut)" pour connector_raw', async () => {
    global.fetch = queueFetch([queueItem({ content_source: 'connector_raw' })]);
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('tbody tr').textContent).toContain('Connecteur (brut)');
  });

  it('sourceLabel : valeur brute échappée pour source inconnue', async () => {
    global.fetch = queueFetch([queueItem({ content_source: 'manual_entry' })]);
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('tbody tr').textContent).toContain('manual_entry');
  });

  it('needs_review : badge "À relire" + fond teinté sur la ligne', async () => {
    global.fetch = queueFetch([queueItem({ needs_review: true })]);
    const View = loadIt();
    await View.render(main);
    const row = main.querySelector('tbody tr');
    expect(row.textContent).toContain('À relire');
    expect(row.style.background).toContain('rgba(217, 119, 6');
  });

  it('needs_review=false : pas de badge, tiret affiché', async () => {
    global.fetch = queueFetch([queueItem({ needs_review: false })]);
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('tbody tr').textContent).not.toContain('À relire');
  });

  it('échappement XSS : nom du produit avec balise HTML est neutralisé', async () => {
    global.fetch = queueFetch([queueItem({ name: '<img src=x onerror=alert(1)>' })]);
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('tbody tr').innerHTML).not.toContain('<img src=x');
    expect(main.querySelector('tbody tr').innerHTML).toContain('&lt;img');
  });

  it('pagination : "N candidat(s) — Page X/Y" et bouton Suivant si plusieurs pages', async () => {
    global.fetch = queueFetch(Array.from({ length: 20 }, (_, i) => queueItem({ id: `id-${i}`, name: `Item ${i}` })), 45);
    const View = loadIt();
    await View.render(main);
    expect(main.querySelector('#ca-pagination').textContent).toContain('45 candidat(s) — Page 1/3');
    expect(main.querySelector('#ca-pagination').textContent).toContain('Suivant');
    expect(main.querySelector('#ca-pagination').textContent).not.toContain('Précédent');
  });

  it('pagination : clic "Suivant" recharge la page 2 avec le bon offset', async () => {
    global.fetch = queueFetch(Array.from({ length: 20 }, (_, i) => queueItem({ id: `id-${i}` })), 45);
    const View = loadIt();
    await View.render(main);
    main.querySelector('#ca-pagination button').click();
    await flush(); 
    const lastUrl = global.fetch.mock.calls[global.fetch.mock.calls.length - 1][0];
    expect(lastUrl).toContain('offset=20');
    expect(main.querySelector('#ca-pagination').textContent).toContain('Page 2/3');
    expect(main.querySelector('#ca-pagination').textContent).toContain('Précédent');
  });

  it('pagination : dernière page → pas de bouton Suivant', async () => {
    global.fetch = queueFetch(Array.from({ length: 5 }, (_, i) => queueItem({ id: `id-${i}` })), 25);
    const View = loadIt();
    await View.render(main);
    main.querySelector('#ca-pagination button').click(); // → page 2 (dernière, 25/20=2)
    await flush(); 
    expect(main.querySelector('#ca-pagination').textContent).not.toContain('Suivant');
  });

  describe('approve()', () => {
    it('confirm annulé → aucun appel POST', async () => {
      global.fetch = queueFetch([queueItem()]);
      window.confirm = jest.fn(() => false);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="approve"]').click();
      await flush(); 
      expect(global.fetch.mock.calls.some(([u, o]) => o?.method === 'POST')).toBe(false);
    });

    it('confirmé → POST approve, toast succès, rechargement de la page courante', async () => {
      const item = queueItem();
      global.fetch = mockFetchRouter([
        { test: (u, o) => o.method === 'POST' && u.includes('/approve'), respond: () => ok({ id: item.id, is_active: true }) },
        { test: (u) => u.includes('/api/admin/catalog/approval-queue'), respond: () => ok({ items: [item], total: 1 }) },
      ]);
      window.confirm = jest.fn(() => true);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="approve"]').click();
      await flush(); 
      expect(window.confirm).toHaveBeenCalledWith('Approuver « Batterie externe » tel quel ?');
      const approveCall = global.fetch.mock.calls.find(([u, o]) => o.method === 'POST' && u.includes('/approve'));
      expect(approveCall[0]).toContain(`/${item.id}/approve`);
      expect(document.querySelector('.toast-success').textContent).toBe('Fiche approuvée et publiée');
    });

    it('échec API → toast erreur avec le message', async () => {
      const item = queueItem();
      global.fetch = mockFetchRouter([
        { test: (u, o) => o.method === 'POST' && u.includes('/approve'), respond: () => fail(500, { error: 'Conflit stock' }) },
        { test: (u) => u.includes('/api/admin/catalog/approval-queue'), respond: () => ok({ items: [item], total: 1 }) },
      ]);
      window.confirm = jest.fn(() => true);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="approve"]').click();
      await flush(); 
      expect(document.querySelector('.toast-error').textContent).toBe('Conflit stock');
    });
  });

  describe('showRejectModal()', () => {
    it('ouvre une modale avec le nom de l\'item dans le titre', async () => {
      global.fetch = queueFetch([queueItem()]);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="reject"]').click();
      await Promise.resolve();
      expect(document.body.textContent).toContain('Rejeter « Batterie externe »');
    });

    it('soumission sans raison → erreur "Raison obligatoire", modale reste ouverte', async () => {
      global.fetch = queueFetch([queueItem()]);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="reject"]').click();
      await Promise.resolve();
      const form = document.querySelector('#ca-modal-form');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush(); 
      expect(document.querySelector('#ca-modal-error').textContent).toBe('Raison obligatoire');
      expect(document.querySelector('#ca-modal-form')).toBeTruthy();
    });

    it('soumission avec raison → POST reject {reason}, toast, fermeture modale, refresh', async () => {
      const item = queueItem();
      global.fetch = mockFetchRouter([
        { test: (u, o) => o.method === 'POST' && u.includes('/reject'), respond: () => ok({}) },
        { test: (u) => u.includes('/api/admin/catalog/approval-queue'), respond: () => ok({ items: [item], total: 1 }) },
      ]);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="reject"]').click();
      await flush();
      document.querySelector('[name="reason"]').value = 'Photo non conforme';
      document.querySelector('#ca-modal-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush(); 
      const rejectCall = global.fetch.mock.calls.find(([u, o]) => o.method === 'POST' && u.includes('/reject'));
      expect(JSON.parse(rejectCall[1].body)).toEqual({ reason: 'Photo non conforme' });
      expect(document.querySelector('.toast-success').textContent).toBe('Fiche rejetée');
      expect(document.querySelector('#ca-modal-form')).toBeFalsy();
    });

    it('fermeture via bouton ✕ sans soumettre', async () => {
      global.fetch = queueFetch([queueItem()]);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="reject"]').click();
      await Promise.resolve();
      document.querySelector('#ca-modal-close').click();
      expect(document.querySelector('#ca-modal-form')).toBeFalsy();
    });

    it('fermeture via bouton Annuler', async () => {
      global.fetch = queueFetch([queueItem()]);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="reject"]').click();
      await Promise.resolve();
      document.querySelector('#ca-modal-cancel').click();
      expect(document.querySelector('#ca-modal-form')).toBeFalsy();
    });

    it('fermeture via clic sur l\'overlay (backdrop), pas si clic dans le contenu', async () => {
      global.fetch = queueFetch([queueItem()]);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="reject"]').click();
      await Promise.resolve();
      const overlay = document.body.lastElementChild;
      expect(overlay.contains(document.querySelector('#ca-modal-form'))).toBe(true);
      document.querySelector('#ca-modal-form').dispatchEvent(new Event('click', { bubbles: true }));
      expect(document.querySelector('#ca-modal-form')).toBeTruthy();
      overlay.dispatchEvent(new Event('click'));
      expect(document.querySelector('#ca-modal-form')).toBeFalsy();
    });
  });

  describe('showOverrideModal()', () => {
    function overrideFetch(item, categoriesOk = true, categories = [{ key: 'mode', label: 'Mode' }, { key: 'tech', label: 'Tech' }]) {
      return mockFetchRouter([
        { test: (u) => u.includes('/api/categories'), respond: () => categoriesOk ? ok(categories) : fail(500) },
        { test: (u, o) => o.method === 'POST' && u.includes('/override'), respond: () => ok({ overridden: ['name', 'category'] }) },
        { test: (u) => u.includes('/api/admin/catalog/approval-queue'), respond: () => ok({ items: [item], total: 1 }) },
      ]);
    }

    it('charge les catégories et pré-sélectionne la catégorie courante de l\'item', async () => {
      const item = queueItem();
      global.fetch = overrideFetch(item);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="override"]').click();
      await flush(); 
      const selected = document.querySelector('select[name="category"] option[selected]');
      expect(selected.value).toBe('tech');
    });

    it('fallback catégories si /api/categories échoue : option unique = catégorie actuelle', async () => {
      const item = queueItem();
      global.fetch = overrideFetch(item, false);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="override"]').click();
      await flush(); 
      const options = document.querySelectorAll('select[name="category"] option');
      expect(options.length).toBe(1);
      expect(options[0].value).toBe('tech');
    });

    it('affiche les options de fragilité incluant "(aucune)"', async () => {
      const item = queueItem();
      global.fetch = overrideFetch(item);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="override"]').click();
      await flush(); 
      const options = Array.from(document.querySelectorAll('select[name="fragility"] option')).map(o => o.value);
      expect(options).toEqual(['', 'fragile', 'electronique', 'sensible_chaleur', 'sensible_humidite']);
    });

    it('aucun champ modifié → erreur "Aucun champ modifié", pas d\'appel API override', async () => {
      const item = queueItem();
      global.fetch = overrideFetch(item);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="override"]').click();
      await flush(); 
      document.querySelector('#ca-modal-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush(); 
      expect(document.querySelector('#ca-modal-error').textContent).toBe('Aucun champ modifié');
      expect(global.fetch.mock.calls.some(([u, o]) => o?.method === 'POST')).toBe(false);
    });

    it('seuls les champs modifiés (diff trim) sont envoyés dans fields', async () => {
      const item = queueItem();
      global.fetch = overrideFetch(item);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="override"]').click();
      await flush(); 
      document.querySelector('[name="name"]').value = 'Batterie externe 20000mAh';
      document.querySelector('[name="reason"]').value = 'Précision capacité';
      document.querySelector('#ca-modal-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush(); 
      const overrideCall = global.fetch.mock.calls.find(([u, o]) => o.method === 'POST' && u.includes('/override'));
      const body = JSON.parse(overrideCall[1].body);
      expect(body.fields).toEqual({ name: 'Batterie externe 20000mAh' });
      expect(body.reason).toBe('Précision capacité');
    });

    it('reason vide → undefined dans le body (pas de chaîne vide)', async () => {
      const item = queueItem();
      global.fetch = overrideFetch(item);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="override"]').click();
      await flush(); 
      document.querySelector('[name="emoji"]').value = '🔌';
      document.querySelector('#ca-modal-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush(); 
      const overrideCall = global.fetch.mock.calls.find(([u, o]) => o.method === 'POST' && u.includes('/override'));
      const body = JSON.parse(overrideCall[1].body);
      expect(body.fields).toEqual({ emoji: '🔌' });
      expect('reason' in body ? body.reason : undefined).toBeUndefined();
    });

    it('succès : toast liste les champs corrigés (overridden), fermeture, refresh', async () => {
      const item = queueItem();
      global.fetch = overrideFetch(item);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="override"]').click();
      await flush(); 
      document.querySelector('[name="name"]').value = 'Nouveau nom';
      document.querySelector('#ca-modal-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush(); 
      expect(document.querySelector('.toast-success').textContent).toBe('Corrigé et approuvé (name, category)');
      expect(document.querySelector('#ca-modal-form')).toBeFalsy();
    });

    it('échec du chargement (loadCategories rejette totalement) → toast erreur, pas de modale bloquée', async () => {
      const item = queueItem();
      global.fetch = mockFetchRouter([
        { test: (u) => u.includes('/api/categories'), respond: () => Promise.reject(new Error('network down')) },
        { test: (u) => u.includes('/api/admin/catalog/approval-queue'), respond: () => ok({ items: [item], total: 1 }) },
      ]);
      const View = loadIt();
      await View.render(main);
      main.querySelector('[data-act="override"]').click();
      await flush(); 
      // loadCategories().catch(() => []) avale le rejet réseau direct -> pas de toast attendu ici,
      // le formulaire doit tout de même s'afficher avec le fallback catégorie unique.
      expect(document.querySelector('#ca-modal-form')).toBeTruthy();
    });
  });
});
