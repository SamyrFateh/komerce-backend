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
