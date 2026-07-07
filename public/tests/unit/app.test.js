'use strict';
/**
 * app.js (761L) — routeur SPA + shell CT/BO + auth + dispatch.
 *
 * app.js n'est pas une vue mais l'entrypoint : on recharge directement les
 * 3 dépendances de base (utils, filters-store, api-client) puis app.js,
 * comme le fait tests/views/critical-views.smoke.test.js pour les vues.
 *
 * dispatchView() lit `global[route.view]` (pas un require dynamique) — on
 * peut donc stubber une vue en assignant directement window.PilotageView
 * sans charger le vrai fichier de vue.
 *
 * Note jsdom : window.location.replace()/assign() ne sont pas mockables
 * (propriétés non-configurables sur l'instance Location) et la navigation
 * n'est de toute façon pas implémentée par jsdom — l'appel émet un warning
 * jsdomError (silencé ci-dessous) mais ne change pas window.location et ne
 * throw pas. On vérifie donc les redirections par leurs effets observables
 * (shell non construit, fetch appelé) plutôt que par l'URL passée à
 * replace().
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');

function requireFresh(relPath) {
  const abs = path.join(ROOT, relPath);
  delete require.cache[require.resolve(abs)];
  require(abs);
}

function loadApp() {
  requireFresh('admin/js/utils.js');
  requireFresh('admin/js/filters-store.js');
  requireFresh('admin/js/api-client.js');
  requireFresh('admin/js/app.js');
}

function stubFetch(handler) {
  global.fetch = jest.fn(handler);
  return global.fetch;
}

function okJson(payload) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
}

function setPath(pathAndQuery) {
  window.history.pushState({}, '', pathAndQuery);
}

describe('app.js (SPA entrypoint)', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.sessionStorage.clear();
    setPath('/admin/pilotage');
    window.alert = jest.fn();
    // Silence le warning jsdom "Not implemented: navigation" déclenché par
    // window.location.replace() — voir note en tête de fichier.
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    delete window.PilotageView;
    delete window.ClientsView;
    delete window.SettingsView;
    delete window.PricingView;
    delete window.ProblemsView;
  });

  test('charge sans crash dans jsdom (smoke)', () => {
    stubFetch(() => okJson({ role: 'admin' }));
    expect(() => loadApp()).not.toThrow();
  });

  describe('requireSession / init — auth', () => {
    test('session invalide (401) → ne construit pas le shell, ne throw pas', async () => {
      stubFetch(() => Promise.resolve({ ok: false, status: 401 }));
      loadApp();
      await expect(window.KmcApp.init()).resolves.not.toThrow();
      expect(document.querySelector('.app-shell')).toBeNull();
    });

    test('rôle inconnu (hors ROLE_SHELLS) → shell non construit', async () => {
      stubFetch(() => okJson({ role: 'ghost-role' }));
      loadApp();
      await window.KmcApp.init();
      expect(document.querySelector('.app-shell')).toBeNull();
    });

    test('session valide (admin) → construit le shell et la sidebar', async () => {
      stubFetch(() => okJson({ role: 'admin', full_name: 'Fatima' }));
      loadApp();
      await window.KmcApp.init();
      expect(document.querySelector('.app-shell')).not.toBeNull();
      expect(document.getElementById('sidebar-nav').children.length).toBeGreaterThan(0);
      expect(document.getElementById('user-name').textContent).toBe('Fatima');
    });

    test('rôle restreint (hub) → sidebar limitée au shell bo, pas de switcher', async () => {
      setPath('/admin/inventory');
      stubFetch(() => okJson({ role: 'hub' }));
      loadApp();
      await window.KmcApp.init();
      expect(document.getElementById('shell-switcher')).toBeNull();
      expect(document.getElementById('sidebar-shell-title').textContent).toContain('Back Office');
    });
  });

  describe('mode focus', () => {
    test('?focus=1 → rend le shell focus, pas la sidebar complète', async () => {
      setPath('/admin/pilotage?focus=1');
      stubFetch(() => okJson({ role: 'admin' }));
      loadApp();
      await window.KmcApp.init();
      expect(document.querySelector('.app-shell--focus')).not.toBeNull();
      expect(document.getElementById('sidebar-nav')).toBeNull();
    });
  });

  describe('navigation', () => {
    beforeEach(async () => {
      stubFetch(() => okJson({ role: 'admin' }));
      loadApp();
      await window.KmcApp.init();
    });

    test('navigateTo() dispatche vers la vue stubée du global correspondant', async () => {
      window.SettingsView = { render: jest.fn(() => Promise.resolve()) };
      const ok = window.KmcApp.navigateTo('/admin/settings');
      expect(ok).toBe(true);
      await Promise.resolve();
      expect(window.SettingsView.render).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe('/admin/settings');
    });

    test('navigateTo() sur un chemin inconnu retourne false, ne change rien', () => {
      const before = window.location.pathname;
      const ok = window.KmcApp.navigateTo('/admin/n-existe-pas');
      expect(ok).toBe(false);
      expect(window.location.pathname).toBe(before);
    });

    test('navigate() accepte un nom de vue (compat Lot 4)', async () => {
      window.PilotageView = { render: jest.fn(() => Promise.resolve()) };
      const ok = window.KmcApp.navigate('PilotageView');
      expect(ok).toBe(true);
      await Promise.resolve();
      expect(window.location.pathname).toBe('/admin/pilotage');
    });

    test('vue non chargée (global absent) → message "non chargée" sans throw', async () => {
      const ok = window.KmcApp.navigateTo('/admin/clients'); // ClientsView jamais assignée ici
      expect(ok).toBe(true);
      await Promise.resolve();
      expect(document.getElementById('main-content').innerHTML).toMatch(/non chargée/);
    });

    test('switchShell (clic shell-tab) reconstruit la sidebar pour le nouveau shell', async () => {
      const boTab = document.querySelector('.shell-tab[data-shell="bo"]');
      expect(boTab).not.toBeNull();
      boTab.click();
      await Promise.resolve();
      expect(document.getElementById('sidebar-shell-title').textContent).toContain('Back Office');
    });
  });

  describe('contrôle d\'accès par rôle', () => {
    test("route restreinte à admin, session support → 'Accès refusé', pas d'appel vue", async () => {
      stubFetch(() => okJson({ role: 'support' }));
      loadApp();
      await window.KmcApp.init(); // support -> shell bo par défaut
      window.SettingsView = { render: jest.fn() }; // roles: ['admin'] uniquement
      window.KmcApp.navigateTo('/admin/settings');
      await Promise.resolve();
      expect(window.SettingsView.render).not.toHaveBeenCalled();
      expect(document.getElementById('main-content').innerHTML).toMatch(/Accès refusé/);
    });
  });

  describe('actions header', () => {
    beforeEach(async () => {
      stubFetch(() => okJson({ role: 'admin' }));
      loadApp();
      await window.KmcApp.init();
    });

    test('_logout appelle /api/auth/logout puis ne throw pas', async () => {
      global.fetch.mockClear();
      global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: true }));
      await expect(window.KmcApp._logout()).resolves.not.toThrow();
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    });

    test('_logout ne throw pas même si le fetch échoue', async () => {
      global.fetch.mockClear();
      global.fetch.mockImplementationOnce(() => Promise.reject(new Error('network down')));
      await expect(window.KmcApp._logout()).resolves.not.toThrow();
    });

    test('_quickPeriod(days) remplit dp-from/dp-to avec la fenêtre glissante', () => {
      window.KmcApp._quickPeriod(7);
      const from = document.getElementById('dp-from').value;
      const to   = document.getElementById('dp-to').value;
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(from).getTime()).toBeLessThanOrEqual(new Date(to).getTime());
    });

    test('_applyPeriod refuse une plage inversée (from > to) et alerte', () => {
      document.getElementById('dp-from').value = '2026-07-10';
      document.getElementById('dp-to').value   = '2026-07-01';
      window.KmcApp._applyPeriod();
      expect(window.alert).toHaveBeenCalledTimes(1);
    });

    test('_applyPeriod applique une plage valide via KmcFilters', () => {
      document.getElementById('dp-from').value = '2026-07-01';
      document.getElementById('dp-to').value   = '2026-07-05';
      window.KmcApp._applyPeriod();
      expect(window.alert).not.toHaveBeenCalled();
      expect(window.KmcFilters.get().from).toBe('2026-07-01');
      expect(window.KmcFilters.get().to).toBe('2026-07-05');
    });

    test('_applyPeriod ne fait rien si un champ de date est vide', () => {
      document.getElementById('dp-from').value = '';
      document.getElementById('dp-to').value   = '2026-07-05';
      const before = window.KmcFilters.get();
      window.KmcApp._applyPeriod();
      expect(window.KmcFilters.get()).toEqual(before);
    });
  });
});
