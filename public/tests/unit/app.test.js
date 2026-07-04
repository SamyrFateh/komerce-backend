'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────

function setPath(path) {
  window.history.pushState({}, '', path);
}

function loadApp() {
  jest.resetModules();
  document.body.innerHTML = '';
  require('../../admin/js/app.js');
  return window.KmcApp;
}

function mockAuthFetch(user, ok = true) {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/auth/me')) {
      return Promise.resolve({ ok, json: () => Promise.resolve(user || {}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

async function bootApp(user, path) {
  mockAuthFetch(user, true);
  setPath(path || '/admin/pilotage');
  const app = loadApp();
  await app.init();
  // laisser les micro-tasks (loadFxRate, etc.) se résoudre
  await Promise.resolve();
  await Promise.resolve();
  return app;
}

beforeEach(() => {
  document.body.innerHTML = '';
  setPath('/admin/pilotage');
  Object.defineProperty(document, 'referrer', { value: '', configurable: true });
  sessionStorage.clear();

  global.KmcFilters = {
    init: jest.fn(),
    get: jest.fn(() => ({})),
    set: jest.fn(),
    reset: jest.fn(),
    subscribe: jest.fn(),
    FILTER_KEYS: [],
  };
  global.KmcApi = {
    getFinanceConfig: jest.fn(() => Promise.resolve({ aed_to_kmf_rate: 305 })),
  };

  // Vues par défaut (objets render, suffisant pour la plupart des routes)
  const viewNames = [
    'PilotageView', 'SanteView', 'ControlTowerView', 'CostingView', 'OrdersLogisticsView',
    'EventWorkspacesView', 'SalesView', 'EconomicView', 'PilotageFinView', 'InvoicesView',
    'SourcingView', 'SourcingScannerView', 'PricingView', 'PricingWorkshopView',
    'PricingStrategyView', 'EconomicFlowView', 'CategoriesView', 'ProductsView',
    'CatalogApprovalView', 'ProblemsView', 'ActionCenterView', 'ClientsView', 'HubRelaisView',
    'TransitaireView', 'InventoryView', 'AccountingView', 'CustomsView', 'SuppliersView',
    'SettingsView', 'SimulatorView', 'SharedCartsView',
  ];
  viewNames.forEach(name => {
    global[name] = { render: jest.fn(() => Promise.resolve()) };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('app.js (SPA entrypoint)', () => {
  it('charge sans crash et expose l\'API publique KmcApp', () => {
    const app = loadApp();
    expect(app).toBeDefined();
    expect(typeof app.init).toBe('function');
    expect(typeof app.navigateTo).toBe('function');
    expect(typeof app.navigate).toBe('function');
    expect(typeof app._logout).toBe('function');
    expect(typeof app._quickPeriod).toBe('function');
    expect(typeof app._applyPeriod).toBe('function');
  });

  describe('requireSession / init — auth', () => {
    it('rend le shell et dispatch la vue quand la session est valide (rôle admin)', async () => {
      await bootApp({ role: 'admin', full_name: 'Amina Test' }, '/admin/pilotage');
      expect(document.querySelector('.sidebar')).not.toBeNull();
      expect(document.getElementById('main-content')).not.toBeNull();
      expect(global.PilotageView.render).toHaveBeenCalled();
      expect(document.getElementById('user-name').textContent).toBe('Amina Test');
    });

    it('ne rend pas le shell si /api/auth/me répond ko (redirection login)', async () => {
      mockAuthFetch({}, false);
      const app = loadApp();
      await app.init();
      expect(document.querySelector('.sidebar')).toBeNull();
    });

    it('ne rend pas le shell si le rôle utilisateur est inconnu (redirection racine)', async () => {
      await bootApp({ role: 'inconnu-role' }, '/admin/pilotage');
      expect(document.querySelector('.sidebar')).toBeNull();
    });

    it('positionne le shell initial sur bo pour un rôle hub même si l\'URL vise une route ct', async () => {
      await bootApp({ role: 'hub', full_name: 'Hub User' }, '/admin/pilotage');
      const sidebarTitle = document.getElementById('sidebar-shell-title').textContent;
      expect(sidebarTitle).toContain('Back Office');
    });

    it('affiche le shell-switcher pour un rôle ayant accès à ct et bo', async () => {
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      expect(document.getElementById('shell-switcher')).not.toBeNull();
    });

    it('n\'affiche pas le shell-switcher pour un rôle mono-shell (hub)', async () => {
      await bootApp({ role: 'hub' }, '/admin/problems');
      expect(document.getElementById('shell-switcher')).toBeNull();
    });
  });

  describe('dispatchView (via navigateTo)', () => {
    it('affiche "Accès refusé" quand le rôle courant est exclu de la route', async () => {
      const app = await bootApp({ role: 'support' }, '/admin/problems');
      app.navigateTo('/admin/settings');
      await Promise.resolve();
      expect(document.getElementById('main-content').innerHTML).toContain('Accès refusé');
      expect(global.SettingsView.render).not.toHaveBeenCalled();
    });

    it('affiche une erreur si la vue globale n\'est pas chargée', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      delete global.SanteView;
      app.navigateTo('/admin/sante');
      await Promise.resolve();
      expect(document.getElementById('main-content').innerHTML).toContain('non chargée');
    });

    it('invoque une vue exposée comme objet { render }', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      app.navigateTo('/admin/sante');
      await Promise.resolve();
      expect(global.SanteView.render).toHaveBeenCalledWith(document.getElementById('main-content'));
    });

    it('invoque une vue exposée comme simple fonction', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      global.CostingView = jest.fn(() => Promise.resolve());
      app.navigateTo('/admin/costing');
      await Promise.resolve();
      expect(global.CostingView).toHaveBeenCalled();
    });

    it('invoque une vue exposée comme constructeur (this.render = ...)', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      const renderSpy = jest.fn();
      global.SalesView = function () { this.render = renderSpy; };
      app.navigateTo('/admin/sales');
      await Promise.resolve();
      expect(renderSpy).toHaveBeenCalled();
    });

    it('lève une erreur si le constructeur de vue n\'attache pas de méthode render', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      global.SalesView = function () { if (false) { this.render = () => {}; } };
      app.navigateTo('/admin/sales');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(document.getElementById('main-content').innerHTML).toContain('constructeur de vue sans méthode render');
    });

    it('lève une erreur pour un format de vue incompatible (ni objet render, ni fonction)', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      global.SalesView = { notARenderFn: true };
      app.navigateTo('/admin/sales');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(document.getElementById('main-content').innerHTML).toContain('format de vue incompatible');
    });

    it('affiche une erreur si la vue rejette une promesse', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      global.SanteView = { render: jest.fn(() => Promise.reject(new Error('boom'))) };
      app.navigateTo('/admin/sante');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(document.getElementById('main-content').innerHTML).toContain('Erreur: boom');
    });
  });

  describe('dispatchView — accès direct à une URL inconnue', () => {
    it('affiche l\'état vide 🚧 quand l\'URL chargée ne correspond à aucune route', async () => {
      await bootApp({ role: 'admin' }, '/admin/route-totalement-inconnue');
      expect(document.getElementById('main-content').innerHTML).toContain('🚧');
      expect(document.getElementById('main-content').innerHTML).toContain('Vue indisponible');
    });
  });

  describe('navigateTo / navigate', () => {
    it('retourne false et ne navigue pas pour un chemin inexistant', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      const result = app.navigateTo('/admin/inexistant');
      expect(result).toBe(false);
      expect(window.location.pathname).toBe('/admin/pilotage');
    });

    it('met à jour l\'URL (pushState) lors d\'une navigation valide', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      const result = app.navigateTo('/admin/sante');
      expect(result).toBe(true);
      expect(window.location.pathname).toBe('/admin/sante');
    });

    it('change de shell silencieusement en naviguant vers une route bo depuis ct', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      app.navigateTo('/admin/problems'); // shell bo
      expect(document.getElementById('sidebar-shell-title').textContent).toContain('Back Office');
    });

    it('navigate() résout un nom de vue vers son chemin (compat Lot 4)', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      const result = app.navigate('PricingView');
      expect(result).toBe(true);
      expect(window.location.pathname).toBe('/admin/pricing');
    });

    it('navigate() résout un chemin relatif court (compat Lot 4)', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      const result = app.navigate('sante');
      expect(result).toBe(true);
      expect(window.location.pathname).toBe('/admin/sante');
    });

    it('navigate() renvoie false pour une valeur non résolue', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      expect(app.navigate('ViewInconnue')).toBe(false);
    });

    it('met à jour la classe is-active du lien sidebar correspondant', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      app.navigateTo('/admin/sante');
      const activeLink = document.querySelector('.sidebar-link.is-active');
      expect(activeLink.dataset.path).toBe('/admin/sante');
    });
  });

  describe('sidebar navigation', () => {
    it('ne montre que les routes du shell actif et respecte les restrictions de rôle', async () => {
      await bootApp({ role: 'support' }, '/admin/problems');
      const links = Array.from(document.querySelectorAll('.sidebar-link[data-path]')).map(a => a.dataset.path);
      expect(links).toContain('/admin/problems'); // pas de restriction
      expect(links).toContain('/admin/clients');  // support autorisé
      expect(links).not.toContain('/admin/settings'); // admin uniquement
      expect(links).not.toContain('/admin/pilotage'); // route ct, shell bo actif
    });

    it('affiche toujours la section Applis Terrain avec ses liens externes', async () => {
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      const labels = Array.from(document.querySelectorAll('.sidebar-section-label')).map(el => el.textContent);
      expect(labels).toContain('APPLIS TERRAIN');
      const hrefs = Array.from(document.querySelectorAll('.sidebar-link')).map(a => a.getAttribute('href'));
      expect(hrefs).toContain('/hub');
      expect(hrefs).toContain('/relais');
    });

    it('navigue via un clic sur un lien sidebar', async () => {
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      const link = document.querySelector('.sidebar-link[data-path="/admin/sante"]');
      link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(window.location.pathname).toBe('/admin/sante');
    });
  });

  describe('shell switcher', () => {
    it('bascule de shell et navigue vers la route par défaut du nouveau shell', async () => {
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      const boTab = document.querySelector('[data-shell="bo"]');
      boTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(document.getElementById('sidebar-shell-title').textContent).toContain('Back Office');
      expect(window.location.pathname).toBe('/admin/problems');
    });
  });

  describe('mode focus', () => {
    it('active le mode focus via ?focus=1 et masque la sidebar', async () => {
      await bootApp({ role: 'admin' }, '/admin/pilotage?focus=1');
      expect(document.querySelector('.sidebar')).toBeNull();
      expect(document.querySelector('.app-shell--focus')).not.toBeNull();
      expect(document.getElementById('main-content')).not.toBeNull();
    });

    it('active le mode focus via document.referrer = /portail', async () => {
      Object.defineProperty(document, 'referrer', { value: 'https://kmc.test/portail', configurable: true });
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      expect(document.querySelector('.app-shell--focus')).not.toBeNull();
    });

    it('active le mode focus via sessionStorage kmc_focus_origin=portail (et le consomme)', async () => {
      sessionStorage.setItem('kmc_focus_origin', 'portail');
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      expect(document.querySelector('.app-shell--focus')).not.toBeNull();
      expect(sessionStorage.getItem('kmc_focus_origin')).toBeNull();
    });

    it('ouvre le menu utilisateur en mode focus', async () => {
      await bootApp({ role: 'admin', full_name: 'Focus User' }, '/admin/pilotage?focus=1');
      const btn = document.getElementById('header-user-btn');
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(document.getElementById('user-menu-popup').style.display).toBe('block');
    });
  });

  describe('header — popups et période', () => {
    it('ouvre le popup date-picker et le pré-remplit depuis KmcFilters', async () => {
      global.KmcFilters.get = jest.fn(() => ({ from: '2026-01-01', to: '2026-01-31' }));
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      const periodBtn = document.getElementById('header-period');
      periodBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(document.getElementById('date-picker-popup').style.display).toBe('flex');
      expect(document.getElementById('dp-from').value).toBe('2026-01-01');
      expect(document.getElementById('dp-to').value).toBe('2026-01-31');
    });

    it('ferme tous les popups au clic ailleurs', async () => {
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      document.getElementById('header-period').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(document.getElementById('date-picker-popup').style.display).toBe('none');
    });

    it('ouvre le menu utilisateur et affiche nom/rôle', async () => {
      await bootApp({ role: 'finance', full_name: 'Fin User' }, '/admin/pilotage');
      const btn = document.getElementById('header-user-btn');
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(document.getElementById('user-menu-popup').style.display).toBe('block');
      expect(document.getElementById('user-menu-name').textContent).toBe('Fin User');
      expect(document.getElementById('user-menu-role').textContent).toBe('finance');
    });

    it('_quickPeriod remplit dp-from/dp-to sur N jours', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      document.getElementById('header-period').click();
      app._quickPeriod(7);
      expect(document.getElementById('dp-from').value).not.toBe('');
      expect(document.getElementById('dp-to').value).not.toBe('');
    });

    it('clic sur un bouton rapide (7j/30j/90j) déclenche _quickPeriod', async () => {
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      document.getElementById('header-period').click();
      const quickBtn = document.querySelector('[data-quick="30"]');
      quickBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(document.getElementById('dp-from').value).not.toBe('');
      expect(document.getElementById('dp-to').value).not.toBe('');
    });

    it('_applyPeriod appelle KmcFilters.set avec des dates valides et ferme le popup', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      document.getElementById('header-period').click();
      document.getElementById('dp-from').value = '2026-01-01';
      document.getElementById('dp-to').value = '2026-01-31';
      app._applyPeriod();
      expect(global.KmcFilters.set).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31' });
      expect(document.getElementById('date-picker-popup').style.display).toBe('none');
    });

    it('_applyPeriod refuse si date de début postérieure à la date de fin', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      window.alert = jest.fn();
      document.getElementById('dp-from').value = '2026-02-01';
      document.getElementById('dp-to').value = '2026-01-01';
      app._applyPeriod();
      expect(window.alert).toHaveBeenCalled();
      expect(global.KmcFilters.set).not.toHaveBeenCalled();
    });

    it('_applyPeriod ne fait rien si les champs sont vides', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      app._applyPeriod();
      expect(global.KmcFilters.set).not.toHaveBeenCalled();
    });

    it('renderHeaderPeriod affiche la période courante quand KmcFilters a from/to (callback subscribe)', async () => {
      global.KmcFilters.get = jest.fn(() => ({ from: '2026-01-01', to: '2026-01-31' }));
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      const subscribedCb = global.KmcFilters.subscribe.mock.calls[0][0];
      subscribedCb();
      expect(document.getElementById('header-period').textContent).toContain('2026');
    });
  });

  describe('logout', () => {
    it('_logout appelle /api/auth/logout puis tente la redirection', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      const logoutFetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
      global.fetch = logoutFetch;
      await app._logout();
      expect(logoutFetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    });

    it('_logout tente quand même la redirection si le fetch réseau échoue', async () => {
      const app = await bootApp({ role: 'admin' }, '/admin/pilotage');
      global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
      await expect(app._logout()).resolves.toBeUndefined();
    });

    it('déclenche _logout au clic sur le bouton de déconnexion', async () => {
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      const logoutFetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
      global.fetch = logoutFetch;
      document.getElementById('header-user-btn').click();
      document.getElementById('logout-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      expect(logoutFetch).toHaveBeenCalledWith('/api/auth/logout', expect.any(Object));
    });
  });

  describe('taux de change (loadFxRate)', () => {
    it('affiche le taux formaté quand KmcApi répond', async () => {
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      expect(document.getElementById('sidebar-fx-rate').textContent).toContain('305');
    });

    it('affiche "Indisponible" quand KmcApi échoue', async () => {
      global.KmcApi.getFinanceConfig = jest.fn(() => Promise.reject(new Error('down')));
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      expect(document.getElementById('sidebar-fx-delta').textContent).toBe('Indisponible');
    });
  });

  describe('popstate', () => {
    it('redéclenche dispatchView et met à jour le shell au retour navigateur', async () => {
      await bootApp({ role: 'admin' }, '/admin/pilotage');
      window.history.pushState({}, '', '/admin/problems');
      window.dispatchEvent(new window.PopStateEvent('popstate'));
      await Promise.resolve();
      expect(document.getElementById('sidebar-shell-title').textContent).toContain('Back Office');
      expect(global.ProblemsView.render).toHaveBeenCalled();
    });
  });
});
