/**
 * @unit navigation-shell-v4-sync.test.js
 * @feature dashboard
 * @brief Le sync du shell V4 détruit les projections (topbar, tabs) quand un nouveau header
 *        devient propriétaire. Le sélecteur de marché et le compte appartiennent au header :
 *        ils doivent lui être rendus avant la destruction, sinon la topbar reconstruite naît
 *        sans marché et le bloc « Marché » de la surface réapparaît dans le Hero.
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'navigation-shell-v4-sync.js'),
  'utf8'
);

// Mini DOM : juste assez pour exécuter le script tel quel (sélecteurs simples uniquement).
class Node {
  constructor(className = '', attrs = {}) {
    this.className = className;
    this.attrs = attrs;
    this.id = attrs.id || '';
    this.children = [];
    this.parent = null;
  }
  append(...nodes) { nodes.forEach(node => { node.remove(); node.parent = this; this.children.push(node); }); }
  prepend(...nodes) { nodes.forEach(node => node.remove()); nodes.forEach(node => { node.parent = this; }); this.children.unshift(...nodes); }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    return selector.split(',').map(part => part.trim()).some(part => {
      if (part.startsWith('#')) return this.id === part.slice(1);
      if (part.startsWith('.')) return this.className.split(/\s+/).includes(part.slice(1));
      const attr = part.match(/^\[([\w-]+)="([^"]+)"\]$/);
      return !!attr && this.attrs[attr[1]] === attr[2];
    });
  }
  querySelectorAll(selector) {
    const found = [];
    this.children.forEach(child => {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    });
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeShell({ headerAlreadyOwnsMarket = false } = {}) {
  const body = new Node('kmc-shell-v4');
  const header = new Node('kmc-admin-navigation', { id: 'canonical-admin-navigation' });
  const utilities = new Node('kmc-admin-utility-nav');
  const ownMarket = new Node('kmc-admin-market-control');
  if (headerAlreadyOwnsMarket) utilities.append(ownMarket);
  header.append(utilities);

  const topbar = new Node('kmc-admin-topbar', { id: 'canonical-admin-topbar', 'data-canonical-shell-role': 'topbar' });
  const right = new Node('kmc-admin-topbar-right');
  const market = new Node('kmc-admin-market-control');
  const account = new Node('kmc-admin-account');
  right.append(market, account);
  topbar.append(right);
  body.append(header, topbar);

  const applied = [];
  const doc = {
    readyState: 'complete',
    body,
    getElementById: id => body.querySelectorAll(`#${id}`)[0] || null,
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
  };
  const nav = {
    _dedupeShell: () => {},
    _applyHybridShell: (appliedHeader, options) => {
      // reproduit createTopbar : la topbar reconstruite emprunte marché et compte au header
      const rebuilt = new Node('kmc-admin-topbar', { id: 'canonical-admin-topbar', 'data-canonical-shell-role': 'topbar' });
      const rebuiltRight = new Node('kmc-admin-topbar-right');
      const pool = appliedHeader.querySelector('.kmc-admin-utility-nav');
      ['.kmc-admin-market-control', '.kmc-admin-account'].forEach(selector => {
        const node = pool.querySelector(selector);
        if (node) rebuiltRight.append(node);
      });
      rebuilt.append(rebuiltRight);
      body.append(rebuilt);
      applied.push({ header: appliedHeader, options, rebuilt });
    },
    surfaceForPath: pathname => String(pathname || '').split('/').pop(),
  };
  const sandbox = {
    document: doc,
    KomerceCanonicalNavigation: nav,
    MutationObserver: function MutationObserver() { this.observe = () => {}; },
    location: { pathname: '/admin/pilotage' },
  };
  sandbox.window = sandbox;
  return { sandbox, header, utilities, ownMarket, market, account, topbar, applied, body };
}

describe('navigation-shell-v4-sync — le marché survit à la reconstruction de la topbar', () => {
  test('rend marché et compte au header avant de détruire la topbar, qui les récupère à la reconstruction', () => {
    const shell = makeShell();
    vm.runInNewContext(SOURCE, shell.sandbox);

    expect(shell.applied).toHaveLength(1);
    expect(shell.applied[0].header).toBe(shell.header);
    // l'ancienne topbar est détruite, une seule topbar subsiste
    expect(shell.body.querySelectorAll('.kmc-admin-topbar')).toHaveLength(1);
    expect(shell.body.querySelectorAll('.kmc-admin-topbar')[0]).toBe(shell.applied[0].rebuilt);
    // le marché et le compte d'origine sont portés par la topbar reconstruite
    const hosted = shell.applied[0].rebuilt;
    expect(hosted.querySelector('.kmc-admin-market-control')).toBe(shell.market);
    expect(hosted.querySelector('.kmc-admin-account')).toBe(shell.account);
    expect(shell.body.querySelectorAll('.kmc-admin-market-control')).toHaveLength(1);
  });

  test('ne duplique pas un marché que le nouveau header possède déjà', () => {
    const shell = makeShell({ headerAlreadyOwnsMarket: true });
    vm.runInNewContext(SOURCE, shell.sandbox);

    const hosted = shell.applied[0].rebuilt;
    expect(hosted.querySelector('.kmc-admin-market-control')).toBe(shell.ownMarket);
    expect(shell.body.querySelectorAll('.kmc-admin-market-control')).toHaveLength(1);
    // le compte, absent du header, est récupéré de l'ancienne topbar
    expect(hosted.querySelector('.kmc-admin-account')).toBe(shell.account);
  });

  test('ne fait rien sans header propriétaire', () => {
    const shell = makeShell();
    shell.header.remove();
    vm.runInNewContext(SOURCE, shell.sandbox);

    expect(shell.applied).toHaveLength(0);
    expect(shell.topbar.parent).toBe(shell.body);
  });
});
