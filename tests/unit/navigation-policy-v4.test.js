'use strict';

const fs = require('fs');
const path = require('path');

test('navigation policy V4 porte la taxonomie métier cible complète', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'navigation-policy-v4.js'),
    'utf8'
  );
  ['Dashboard', 'Prix & économie', 'Catalogue', 'Commerce', 'Opérations', 'Finance', 'Live', 'Marchés'].forEach(label => {
    expect(source).toContain(`label: '${label}'`);
  });
  expect(source).toContain("id: 'import-runtime', label: 'Sourcing live'");
  expect(source).toContain("id: 'live-import-runtime'");
  // Pas d'écran liste « Fournisseurs » : la fiche /admin/suppliers/:id s'atteint depuis les achats, les produits et le sourcing.
  expect(source).not.toContain("id: 'entity-suppliers'");
  expect(source).not.toContain("href: '/admin/suppliers'");
});

test('Administration expose l’entrée Providers (lecture seule)', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/navigation-policy-v4.js'), 'utf8');
  expect(source).toContain("'admin-providers'");
  expect(source).toContain('/admin/providers');
});

test('Administration expose l’entrée Utilisateurs (lecture seule, admin)', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/navigation-policy-v4.js'), 'utf8');
  expect(source).toContain("id: 'admin-users'");
  expect(source).toContain("href: '/admin/users', roles: ['admin']");
});


test('la navigation groupée repart en haut au montage', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'navigation-policy-v4.js'),
    'utf8'
  );
  expect(source).toMatch(/primary\.scrollTop\s*=\s*0/);
  expect(source).toMatch(/requestAnimationFrame\(\(\)\s*=>\s*\{\s*primary\.scrollTop\s*=\s*0/);
});

test('la sidebar verticale commence en haut et garde identité/utilitaires fixes', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'css', 'canonical-shell-v4.css'),
    'utf8'
  );
  const primary = (css.match(/body\.kmc-shell-v4 \.kmc-admin-primary-nav\s*\{([\s\S]*?)\}/) || [])[1] || '';
  const identity = (css.match(/body\.kmc-shell-v4 \.kmc-admin-navigation-identity\s*\{([\s\S]*?)\}/) || [])[1] || '';
  const utility = (css.match(/body\.kmc-shell-v4 \.kmc-admin-utility-nav\s*\{([\s\S]*?)\}/) || [])[1] || '';

  expect(primary).toMatch(/justify-content:\s*flex-start/);
  expect(primary).toMatch(/overflow-y:\s*auto/);
  expect(identity).toMatch(/flex:\s*0 0 auto/);
  expect(utility).toMatch(/flex:\s*0 0 auto/);
});

const __src = fs.readFileSync(
  path.join(__dirname, '../../public/dashboards/canonical/js/navigation-policy-v4.js'),
  'utf8'
);

describe('navigation-policy-v4.js — Atelier prix', () => {
  test('la navigation locale prix se limite à la vue d’ensemble', () => {
    expect(__src).toContain("id: 'pricing-overview'");
    expect(__src).not.toMatch(/id: 'pricing-(products|costs|strategy)'/);
  });

  test('plus aucune ancre de section prix ne subsiste', () => {
    expect(__src).toMatch(/PRICING_SECTION_IDS = Object\.freeze\(\{\}\)/);
    expect(__src).not.toContain('#pricing-');
  });
});


test('la coque expose la surface courante pour le layout Hero-first', () => {
  expect(__src).toContain('doc.body.dataset.kmcSurface = surface');
});

test('withEntityReturnTo ne contextualise que les fiches 360 et les PO', () => {
  jest.resetModules();
  delete global.KomerceCanonicalNavigation;
  require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
  const nav = global.KomerceCanonicalNavigation;
  const wrap = href => nav.withEntityReturnTo(href, '/admin/operations', 'Retour aux opérations');
  expect(wrap('/admin/orders/CMD-1')).toContain('return_to=%2Fadmin%2Foperations');
  expect(wrap('/admin/clients/+269123')).toContain('return_label=');
  expect(wrap('/admin/workspaces/purchasing?po=PO-42')).toMatch(/^\/admin\/workspaces\/purchasing\?po=PO-42&return_to=/);
  expect(wrap('/admin/operations')).toBe('/admin/operations');
  expect(wrap('/admin/workspaces/pricing')).toBe('/admin/workspaces/pricing');
  // jamais de double contexte
  const once = wrap('/admin/orders/CMD-1');
  expect(wrap(once)).toBe(once);
  // retour invalide : lien inchangé
  expect(nav.withEntityReturnTo('/admin/orders/CMD-1', 'https://evil.test', 'x')).toBe('/admin/orders/CMD-1');
});

test('Marchés reste hero-first avec une illustration contextuelle propre à la surface', () => {
  const block = __src.match(/const HERO_FIRST_SURFACES = new Set\(\[([\s\S]*?)\]\)/)[1];
  for (const surface of ['market-access', 'market-autonomy', 'market-catalog']) {
    expect(block).toContain(`'${surface}'`);
  }
  expect(__src).toContain("classList?.toggle?.('kmc-hero-first', HERO_FIRST_SURFACES.has(surface))");
});

test('le lien actif est recentré dans le menu sans mouvement du document', () => {
  expect(__src).toContain('function revealActiveNavigation(doc)');
  expect(__src).toContain(".kmc-admin-primary-link.is-active");
  expect(__src).toContain('scrollParent.scrollTop = Math.max(0, Math.min(overflow, centered))');
  expect(__src).toContain('revealActiveNavigation(doc)');
  expect(__src).not.toContain("active.scrollIntoView(");
});

test('Mayotte : drapeau SVG fourni et référencé par la politique de navigation', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/navigation-policy-v4.js'), 'utf8');
  expect(src).toContain("YT: '/dashboards/canonical/assets/flags/YT.svg'");
  expect(fs.existsSync(path.join(__dirname, '../../public/dashboards/canonical/assets/flags/YT.svg'))).toBe(true);
});

test('Hub live expose l’onglet Exécution (vue execute) sans toucher aux autres onglets', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/navigation-policy-v4.js'), 'utf8');
  expect(src).toContain("{ id: 'hub-execution', label: 'Exécution', href: '/admin/hub-live?view=execute' }");
  expect(src).toContain("if (search.get('view') === 'execute') return 'hub-execution';");
});

describe('contexte transporté (marché, période, périmètre)', () => {
  let nav;
  beforeEach(() => {
    jest.resetModules();
    delete global.KomerceCanonicalNavigation;
    require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
    nav = global.KomerceCanonicalNavigation;
  });

  test('readContext valide et ignore les valeurs invalides', () => {
    expect(nav.readContext('?market=km&period=90&simulation_scope=RCT1')).toEqual({ market: 'KM', period: '90', simulation_scope: 'RCT1' });
    expect(nav.readContext('?market=KMF1&period=15&simulation_scope=x y')).toEqual({});
    expect(nav.readContext('')).toEqual({});
  });

  test('withContext ajoute le contexte, garde l’ancre et n’écrase pas un paramètre existant', () => {
    const ctx = { market: 'KM', period: '7', simulation_scope: 'RCT1' };
    expect(nav.withContext('/admin/finance', ctx)).toBe('/admin/finance?market=KM&period=7&simulation_scope=RCT1');
    expect(nav.withContext('/admin/operations#operations-control-chain', { period: '30' })).toBe('/admin/operations?period=30#operations-control-chain');
    expect(nav.withContext('/admin/workspaces/pricing?product_ref=P1&market=CM', ctx)).toBe('/admin/workspaces/pricing?product_ref=P1&market=CM&period=7&simulation_scope=RCT1');
    expect(nav.withContext('/admin/finance', { period: '15', simulation_scope: 'bad scope', market: null })).toBe('/admin/finance');
  });

  test('currentReturnTarget conserve la query de la page et se replie si non sûr', () => {
    expect(nav.currentReturnTarget('/admin/pilotage', { pathname: '/admin/commerce', search: '?market=KM&period=7' })).toBe('/admin/commerce?market=KM&period=7');
    expect(nav.currentReturnTarget('/admin/pilotage', { pathname: '/login.html', search: '' })).toBe('/admin/pilotage');
  });

  test('syncContext reflète marché et période dans l’URL sans toucher au reste', () => {
    const calls = [];
    const hist = { state: null, replaceState: (_s, _t, u) => calls.push(u) };
    const loc = { href: 'https://x.test/admin/finance?simulation_scope=RCT1&market=CM#a' };
    nav.syncContext({ period: '90' }, loc, hist);
    nav.syncContext({ market: null }, loc, hist);
    nav.syncContext({ market: 'KM', period: '15' }, loc, hist);
    expect(calls[0]).toBe('/admin/finance?simulation_scope=RCT1&market=CM&period=90#a');
    expect(calls[1]).toBe('/admin/finance?simulation_scope=RCT1#a');
    expect(calls[2]).toBe('/admin/finance?simulation_scope=RCT1&market=KM#a');
  });
});

test('canOpenEntity360 suit l’habilitation serveur (admin, market_operator) ; le retour contextuel est visible dans la coque', () => {
  jest.resetModules();
  delete global.KomerceCanonicalNavigation;
  require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
  const nav = global.KomerceCanonicalNavigation;
  expect(nav.canOpenEntity360({ role: 'admin' })).toBe(true);
  expect(nav.canOpenEntity360({ role: 'market_operator' })).toBe(true);
  ['agent_hub', 'agent_relais', 'agent_transitaire', 'finance', 'sourcing', 'support'].forEach(role => {
    expect(nav.canOpenEntity360({ role })).toBe(false);
  });
  expect(nav.canOpenEntity360(null)).toBe(false);
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/css/canonical-shell-v4.css'), 'utf8');
  expect(css).toMatch(/\.kmc-admin-back\[data-back-context="contextual"\]\s*\{\s*display:\s*inline-flex/);
  expect(css).toMatch(/body\.kmc-shell-v4 \.kmc-admin-back\s*\{\s*display:\s*none;/);
});

test('hasCapability : global = oui (le serveur re-valide) ; marché = capability déléguée ; sinon masqué', () => {
  jest.resetModules();
  delete global.KomerceCanonicalNavigation;
  require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
  const nav = global.KomerceCanonicalNavigation;
  expect(nav.hasCapability({ access: { mode: 'global' } }, 'catalog.expose', 'CM')).toBe(true);
  const ctx = { access: { mode: 'market', defaultMarket: 'KM', delegatedCapabilities: { KM: ['catalog.expose'], CM: [] } } };
  expect(nav.hasCapability(ctx, 'catalog.expose')).toBe(true);
  expect(nav.hasCapability(ctx, 'catalog.expose', 'CM')).toBe(false);
  expect(nav.hasCapability(null, 'catalog.expose', 'CM')).toBe(false);
  expect(nav.hasCapability(ctx, '', 'KM')).toBe(false);
});

describe('L7 — rattachement du workspace candidats à Live › Sourcing', () => {
  test('la surface sourcing-workspace appartient au domaine live, espace Sourcing live', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/navigation-policy-v4.js'), 'utf8');
    expect(src).toContain("'sourcing-workspace': 'live',");
    expect(src).not.toContain("'sourcing-workspace': 'catalog'");
    expect(src).toContain("'sourcing-workspace': 'import-runtime',");
    expect(src).not.toContain("id: 'sourcing-candidats', label: 'Exceptions source'");
  });
});

describe('L6 — autorité unique de navigation', () => {
  const vm = require('vm');
  function loadNav() {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/navigation-policy-v4.js'), 'utf8');
    const sandbox = { window: {}, document: {}, console };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox.window.KomerceCanonicalNavigation || sandbox.KomerceCanonicalNavigation;
  }

  test('chaque surface appartient à un seul item de sidebar', () => {
    const nav = loadNav();
    const owners = {};
    nav.SIDEBAR_GROUPS.forEach(group => group.items.forEach(item => (item.surfaces || []).forEach(surface => {
      (owners[surface] = owners[surface] || []).push(item.id);
    })));
    Object.entries(owners).forEach(([surface, ids]) => expect([surface, ids.length]).toEqual([surface, 1]));
    expect(owners['order-360']).toEqual(['flow-orders']);
  });

  test('Économie regroupe Prix & économie et Catalogue global, sans Raffinerie doublon', () => {
    const nav = loadNav();
    const ids = id => nav.SIDEBAR_GROUPS.find(group => group.id === id).items.map(item => item.id);
    expect(ids('economy')).toEqual(['workspace-pricing', 'workspace-catalog']);
    ['workspace-pricing', 'workspace-catalog'].forEach(id => expect(ids('commerce')).not.toContain(id));
    expect(nav.SIDEBAR_GROUPS.find(group => group.id === 'economy').label).toBe('Économie');
  });

  test('le retour d’Order 360 est Commandes ; les liens de tête ne portent plus de flèche de retour', () => {
    const nav = loadNav();
    expect(nav.BACK_TARGETS['order-360']).toEqual({ href: '/admin/orders', label: 'Retour aux commandes' });
    ['order-360', 'client-360', 'product-360'].forEach(file => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', `public/dashboards/canonical/js/${file}.js`), 'utf8');
      expect(src).not.toMatch(/'← (Opérations|Commerce)'/);
    });
  });

  test('chaque href de sidebar pointe une route déclarée par une surface ou un espace', () => {
    const nav = loadNav();
    const spaceHrefs = new Set();
    nav.DOMAINS.forEach(d => { if (d.href) spaceHrefs.add(d.href); (d.spaces || []).forEach(s => spaceHrefs.add(s.href)); });
    nav.SIDEBAR_GROUPS.forEach(group => group.items.forEach(item => {
      const base = item.href.split('?')[0];
      const inSpaces = [...spaceHrefs].some(h => h.split('?')[0] === base);
      expect([item.id, inSpaces || base.startsWith('/admin/') || base.startsWith('/dashboards/canonical/')]).toEqual([item.id, true]);
    }));
  });
});
