'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/komerce-api.test.js
 *
 * js/komerce-api.js (356L) — client API central (utilisé par toute la
 * boutique et les dashboards). Pas de module ES : le fichier s'exécute en
 * IIFE et pose son unique surface publique sur `window.K` (request, auth,
 * parcels, hub, scans, orders, logistics, carriers, products, purchasing,
 * ui). On `require()` le fichier une fois (exécution du script, comme dans
 * un <script> classique) puis on pilote tout via `window.K`.
 *
 * `global.fetch` est réassigné directement dans chaque test plutôt que via
 * `mockResolvedValueOnce` :
 * la config `restoreMocks: true` ne restaure que les spies `jest.spyOn`,
 * pas un `jest.fn()` brut posé par `setup.js` — réassigner évite tout état
 * résiduel entre tests.
 *
 * `_state` (api/user) et le rate limiter (`_rl`) sont des singletons
 * module-level non exposés : ils persistent entre tous les tests de ce
 * fichier (le module n'est chargé qu'une fois). On les remet à un état
 * connu via l'API publique (`auth.setUrl`, `auth.logout`) en `beforeEach`
 * plutôt que de les recréer.
 *
 * Le rate limiter impose un espacement minimal réel de 150ms entre deux
 * requêtes (MIN_DELAY_MS) — on utilise les timers réels (pas de fake
 * timers) pour ne pas avoir à simuler l'boucle setTimeout/µtask du drain de
 * la queue ; le timeout de test est augmenté en conséquence.
 *
 * Priorité donnée à : `_doFetch`/`request` (succès, erreur HTTP, retry sur
 * 429/503/502, épuisement des retries, en-tête Idempotency-Key,
 * `credentials: 'include'`), `auth.*` (login/logout/restore/getUser/
 * isConnected/setUrl), `normalizeApiUrl` (via `auth.setUrl`, casse
 * same-origin / cross-origin / dev localhost / URL invalide), un
 * échantillon représentatif des namespaces CRUD (parcels, hub, scans,
 * orders, logistics, carriers, products, purchasing — un test par méthode
 * vérifiant chemin/méthode/corps plutôt qu'une couverture exhaustive
 * ligne à ligne de wrappers quasi identiques), et `ui.*` (badge, toast,
 * flash, fmtDate, fmtAge, ts).
 *
 * Laissé de côté (dette assumée) : le comportement fin du rate limiter
 * (MAX_CONC=2, ordonnancement exact de la queue sous forte concurrence) —
 * couvert seulement par un test de fumée vérifiant que 3 requêtes
 * simultanées aboutissent toutes, sans vérifier l'ordonnancement précis
 * (plus adapté à un test de charge qu'à de l'unitaire).
 */

jest.setTimeout(15000);

require('../../js/komerce-api.js');
const K = window.K;

function mockFetchOnce(status, jsonBody) {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(jsonBody === undefined ? {} : jsonBody),
  }));
}

function mockFetchSequence(responses) {
  // responses: array of {status, json} consumed dans l'ordre des appels fetch
  let i = 0;
  global.fetch = jest.fn(() => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.json || {}),
    });
  });
}

describe('komerce-api (window.K)', () => {
  beforeEach(async () => {
    K.auth.setUrl('http://localhost');
    mockFetchOnce(200, {});
    await K.auth.logout();
    localStorage.clear();
    mockFetchOnce(200, {});
  });

  describe('request / _doFetch — coeur réseau', () => {
    it('succès : renvoie le JSON parsé, credentials include, Content-Type json', async () => {
      mockFetchOnce(200, { ok: true, value: 42 });
      const res = await K.request('/api/health', 'GET', null, 0);
      expect(res).toEqual({ ok: true, value: 42 });
      expect(global.fetch).toHaveBeenCalledWith('http://localhost/api/health', expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }));
    });

    it('POST avec body : sérialise le body en JSON', async () => {
      mockFetchOnce(200, { id: 1 });
      await K.request('/api/orders', 'POST', { total: 5000 }, 0);
      const call = global.fetch.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[1].body).toBe(JSON.stringify({ total: 5000 }));
    });

    it('options.idempotencyKey ajoute l\'en-tête Idempotency-Key', async () => {
      mockFetchOnce(200, {});
      await K.request('/api/orders', 'POST', { a: 1 }, 0, { idempotencyKey: 'abc-123' });
      const call = global.fetch.mock.calls[0];
      expect(call[1].headers['Idempotency-Key']).toBe('abc-123');
    });

    it('réponse non-ok : rejette avec le message d\'erreur du body', async () => {
      mockFetchOnce(400, { error: 'Payload invalide' });
      await expect(K.request('/api/orders', 'POST', {}, 0)).rejects.toThrow('Payload invalide');
    });

    it('réponse non-ok sans champ error : rejette avec "HTTP {status}"', async () => {
      mockFetchOnce(500, {});
      await expect(K.request('/api/orders', 'GET', null, 0)).rejects.toThrow('HTTP 500');
    });

    it('body JSON illisible : traité comme objet vide (pas de crash), erreur générique si non-ok', async () => {
      global.fetch = jest.fn(() => Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('bad json')),
      }));
      await expect(K.request('/api/x', 'GET', null, 0)).rejects.toThrow('HTTP 502');
    });

    it('retry sur 429 puis succès : réessaie et renvoie la 2e réponse', async () => {
      mockFetchSequence([
        { status: 429, json: {} },
        { status: 200, json: { retried: true } },
      ]);
      const res = await K.request('/api/x', 'GET', null, 1);
      expect(res).toEqual({ retried: true });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('retry épuisé sur 503 persistant : finit par rejeter', async () => {
      mockFetchOnce(503, {});
      await expect(K.request('/api/x', 'GET', null, 1)).rejects.toThrow();
      expect(global.fetch).toHaveBeenCalledTimes(2); // tentative initiale + 1 retry
    });

    it('erreur réseau (fetch rejette) avec retries=0 : rejette immédiatement', async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
      await expect(K.request('/api/x', 'GET', null, 0)).rejects.toThrow('network down');
    });

    it('3 requêtes simultanées aboutissent toutes (fumée rate-limiter, pas d\'assertion d\'ordonnancement)', async () => {
      mockFetchOnce(200, { ok: true });
      const results = await Promise.all([
        K.request('/api/a', 'GET', null, 0),
        K.request('/api/b', 'GET', null, 0),
        K.request('/api/c', 'GET', null, 0),
      ]);
      expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    });
  });

  describe('download — document privé', () => {
    it('récupère le PDF avec la session et extrait son nom', async () => {
      const blob = new Blob(['%PDF-test'], { type: 'application/pdf' });
      global.fetch = jest.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: jest.fn(() => 'attachment; filename="facture-FAC-001.pdf"') },
        blob: jest.fn().mockResolvedValue(blob),
      }));

      await expect(K.download('/api/auth/me/documents/doc-1/download')).resolves.toEqual({
        blob,
        filename: 'facture-FAC-001.pdf',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost/api/auth/me/documents/doc-1/download',
        expect.objectContaining({ method: 'GET', credentials: 'include' })
      );
    });

    it('propage une erreur authentifiée sans exposer de lien alternatif', async () => {
      global.fetch = jest.fn(() => Promise.resolve({
        ok: false,
        status: 404,
        json: jest.fn().mockResolvedValue({ error: 'Document introuvable' }),
      }));

      await expect(K.download('/api/auth/me/documents/foreign/download'))
        .rejects.toMatchObject({ message: 'Document introuvable', status: 404 });
    });
  });

  describe('auth', () => {
    it('login : appelle /api/health puis /api/auth/login, stocke user + flag localStorage', async () => {
      mockFetchSequence([
        { status: 200, json: { status: 'ok' } },
        { status: 200, json: { user: { id: 1, email: 'a@b.com' } } },
      ]);
      const res = await K.auth.login('a@b.com', 'secret');
      expect(res.user).toEqual({ id: 1, email: 'a@b.com' });
      expect(res.health).toEqual({ status: 'ok' });
      expect(K.auth.getUser()).toEqual({ id: 1, email: 'a@b.com' });
      expect(K.auth.isConnected()).toBe(true);
      expect(localStorage.getItem('komerce_session')).toBe('1');
      const loginCall = global.fetch.mock.calls[1];
      expect(loginCall[0]).toBe('http://localhost/api/auth/login');
      expect(JSON.parse(loginCall[1].body)).toEqual({ email: 'a@b.com', password: 'secret' });
    });

    it('login avec apiUrl fourni : bascule _state.api et persiste komerce_api_url', async () => {
      mockFetchSequence([
        { status: 200, json: {} },
        { status: 200, json: { user: { id: 2 } } },
      ]);
      await K.auth.login('x@y.com', 'pw', 'http://localhost');
      expect(localStorage.getItem('komerce_api_url')).toBe('http://localhost');
    });

    it('logout : appelle /api/auth/logout, efface user + flag localStorage', async () => {
      K._testSetUser = null; // no-op, K n'expose pas de setter direct hors login
      mockFetchOnce(200, {});
      await K.auth.logout();
      expect(K.auth.getUser()).toBeNull();
      expect(K.auth.isConnected()).toBe(false);
      expect(localStorage.getItem('komerce_session')).toBeNull();
      expect(global.fetch).toHaveBeenCalledWith('http://localhost/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    });

    it('logout : n\'échoue pas si la requête réseau échoue (erreur avalée)', async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
      await expect(K.auth.logout()).resolves.toBeUndefined();
      expect(K.auth.getUser()).toBeNull();
    });

    it('restore : succès -> stocke l\'utilisateur retourné par /api/auth/me', async () => {
      mockFetchOnce(200, { id: 9, email: 'z@z.com' });
      const user = await K.auth.restore();
      expect(user).toEqual({ id: 9, email: 'z@z.com' });
      expect(K.auth.getUser()).toEqual({ id: 9, email: 'z@z.com' });
      expect(localStorage.getItem('komerce_session')).toBe('1');
    });

    it('restore : échec -> user null, flag localStorage effacé, retourne null', async () => {
      mockFetchOnce(401, { error: 'unauthorized' });
      const user = await K.auth.restore();
      expect(user).toBeNull();
      expect(K.auth.getUser()).toBeNull();
      expect(localStorage.getItem('komerce_session')).toBeNull();
    });

    it('setUrl : met à jour _state.api (visible via les appels réseau suivants) et localStorage', async () => {
      K.auth.setUrl('http://localhost');
      expect(localStorage.getItem('komerce_api_url')).toBe('http://localhost');
      mockFetchOnce(200, {});
      await K.request('/api/ping', 'GET', null, 0);
      expect(global.fetch).toHaveBeenCalledWith('http://localhost/api/ping', expect.anything());
    });

    it('normalizeApiUrl (via setUrl) : URL cross-origin non-locale -> retombe sur l\'origine courante', () => {
      K.auth.setUrl('https://evil-tracker.example.com');
      expect(localStorage.getItem('komerce_api_url')).toBe('http://localhost');
    });

    it('normalizeApiUrl (via setUrl) : protocole non http/https -> retombe sur l\'origine courante', () => {
      K.auth.setUrl('ftp://localhost/foo');
      expect(localStorage.getItem('komerce_api_url')).toBe('http://localhost');
    });

    it('normalizeApiUrl (via setUrl) : URL invalide -> retombe sur l\'origine courante sans throw', () => {
      expect(() => K.auth.setUrl('::not a url::')).not.toThrow();
      expect(localStorage.getItem('komerce_api_url')).toBe('http://localhost');
    });

    it('normalizeApiUrl (via setUrl) : valeur vide -> retombe sur l\'origine courante', () => {
      K.auth.setUrl('');
      expect(localStorage.getItem('komerce_api_url')).toBe('http://localhost');
    });
  });

  describe('namespaces CRUD — échantillon représentatif', () => {
    beforeEach(() => { mockFetchOnce(200, {}); });

    it('parcels.list avec filtres construit la query string', async () => {
      await K.parcels.list({ status: 'draft' });
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/parcels?status=draft');
    });

    it('parcels.get / create / update / addItem', async () => {
      await K.parcels.get(5);
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/parcels/5');

      mockFetchOnce(200, {});
      await K.parcels.create({ x: 1 });
      expect(global.fetch.mock.calls[0]).toEqual(['http://localhost/api/parcels', expect.objectContaining({ method: 'POST' })]);

      mockFetchOnce(200, {});
      await K.parcels.update(5, { y: 2 });
      expect(global.fetch.mock.calls[0]).toEqual(['http://localhost/api/parcels/5', expect.objectContaining({ method: 'PUT' })]);

      mockFetchOnce(200, {});
      await K.parcels.addItem(5, { sku: 'A' });
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/parcels/5/items');
    });

    it('parcels.optimize / bootstrap', async () => {
      await K.parcels.optimize(10, { fast: true });
      expect(global.fetch.mock.calls[0]).toEqual(['http://localhost/api/parcels/optimize', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ order_id: 10, config: { fast: true } }),
      })]);

      mockFetchOnce(200, {});
      await K.parcels.bootstrap(10);
      expect(global.fetch.mock.calls[0]).toEqual(['http://localhost/api/parcels/bootstrap/10', expect.objectContaining({ method: 'POST' })]);
    });

    it('hub.scanItem / pack / seal / getDraftParcels', async () => {
      await K.hub.scanItem('BC123', 'agent1');
      expect(global.fetch.mock.calls[0]).toEqual(['http://localhost/api/hub/scan', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ barcode: 'BC123', scanned_by: 'agent1' }),
      })]);

      mockFetchOnce(200, {});
      await K.hub.pack(7);
      expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ parcel_id: 7 });

      mockFetchOnce(200, {});
      await K.hub.seal(7);
      expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ parcel_id: 7 });

      mockFetchOnce(200, {});
      await K.hub.getDraftParcels();
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/parcels?status=draft');
    });

    it('scans.create / list', async () => {
      await K.scans.create({ code: 'X' });
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/scans');

      mockFetchOnce(200, {});
      await K.scans.list({ type: 'in' });
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/scans?type=in');
    });

    it('orders.list / get / create', async () => {
      await K.orders.list();
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/orders');

      mockFetchOnce(200, {});
      await K.orders.get(3);
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/orders/3');

      mockFetchOnce(200, {});
      await K.orders.create({ total: 100 });
      expect(global.fetch.mock.calls[0]).toEqual(['http://localhost/api/orders', expect.objectContaining({ method: 'POST' })]);
    });

    it('logistics.shipments.list / get / create', async () => {
      await K.logistics.shipments.list({ carrier: 'DHL' });
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/logistics/shipments?carrier=DHL');

      mockFetchOnce(200, {});
      await K.logistics.shipments.get(1);
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/logistics/shipments/1');

      mockFetchOnce(200, {});
      await K.logistics.shipments.create({ a: 1 });
      expect(global.fetch.mock.calls[0]).toEqual(['http://localhost/api/logistics/shipments', expect.objectContaining({ method: 'POST' })]);
    });

    it('carriers.list / get / create / update', async () => {
      await K.carriers.list();
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/carriers');

      mockFetchOnce(200, {});
      await K.carriers.get(2);
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/carriers/2');

      mockFetchOnce(200, {});
      await K.carriers.create({ name: 'DHL' });
      expect(global.fetch.mock.calls[0]).toEqual(['http://localhost/api/carriers', expect.objectContaining({ method: 'POST' })]);

      mockFetchOnce(200, {});
      await K.carriers.update(2, { name: 'UPS' });
      expect(global.fetch.mock.calls[0]).toEqual(['http://localhost/api/carriers/2', expect.objectContaining({ method: 'PUT' })]);
    });

    it('products.list / get', async () => {
      await K.products.list({ cat: 'Chaussures' });
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/products?cat=Chaussures');

      mockFetchOnce(200, {});
      await K.products.get(4);
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/products/4');
    });

    it('purchasing.suppliers.list / get', async () => {
      await K.purchasing.suppliers.list();
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/purchasing/suppliers');

      mockFetchOnce(200, {});
      await K.purchasing.suppliers.get(6);
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost/api/purchasing/suppliers/6');
    });
  });

  describe('ui — helpers partagés', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('badge : statut connu -> label + classe corrects', () => {
      const html = K.ui.badge('shipped');
      expect(html).toContain('Expédié');
      expect(html).toContain('b-teal');
    });

    it('badge : statut inconnu -> fallback (label = statut brut, classe grise)', () => {
      const html = K.ui.badge('unknown_status');
      expect(html).toContain('unknown_status');
      expect(html).toContain('b-gray');
    });

    it('badge : accepte une map personnalisée', () => {
      const html = K.ui.badge('foo', { foo: { label: 'Perso', badge: 'b-pink' } });
      expect(html).toContain('Perso');
      expect(html).toContain('b-pink');
    });

    it('toast : crée #k-toast au premier appel, réutilise ensuite', () => {
      K.ui.toast('Bien joué');
      const t1 = document.getElementById('k-toast');
      expect(t1.textContent).toBe('Bien joué');
      expect(t1.className).toBe('toast ok show');

      K.ui.toast('Erreur', 'error');
      const t2 = document.getElementById('k-toast');
      expect(t2).toBe(t1); // même élément réutilisé
      expect(t2.className).toBe('toast error show');
    });

    it('toast : retire la classe "show" après 3500ms', () => {
      jest.useFakeTimers();
      K.ui.toast('Test');
      jest.advanceTimersByTime(3500);
      expect(document.getElementById('k-toast').classList.contains('show')).toBe(false);
      jest.useRealTimers();
    });

    it('flash : ajoute puis retire .success-flash après 700ms', () => {
      jest.useFakeTimers();
      K.ui.flash();
      expect(document.querySelector('.success-flash')).not.toBeNull();
      jest.advanceTimersByTime(700);
      expect(document.querySelector('.success-flash')).toBeNull();
      jest.useRealTimers();
    });

    it('fmtDate : null/undefined -> "—"', () => {
      expect(K.ui.fmtDate(null)).toBe('—');
      expect(K.ui.fmtDate(undefined)).toBe('—');
    });

    it('fmtDate : date valide -> chaîne formatée non vide', () => {
      const out = K.ui.fmtDate('2026-01-15T10:30:00Z');
      expect(typeof out).toBe('string');
      expect(out).not.toBe('—');
      expect(out.length).toBeGreaterThan(0);
    });

    it('fmtAge : falsy -> "—", 0 jour -> "Aujourd\'hui", 1 jour -> "1j", N jours -> "Nj"', () => {
      expect(K.ui.fmtAge(null)).toBe('—');
      expect(K.ui.fmtAge(new Date().toISOString())).toBe('Aujourd\'hui');
      expect(K.ui.fmtAge(new Date(Date.now() - 86400000).toISOString())).toBe('1j');
      expect(K.ui.fmtAge(new Date(Date.now() - 3 * 86400000).toISOString())).toBe('3j');
    });

    it('ts : renvoie une chaîne d\'heure non vide', () => {
      const out = K.ui.ts();
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    });
  });
});
