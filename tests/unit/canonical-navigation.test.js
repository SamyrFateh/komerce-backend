'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

function fakeNode(tagName = 'div') {
  return {
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    href: '',
    children: [],
    attributes: {},
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    prepend(child) {
      this.children.unshift(child);
      child.parentNode = this;
      return child;
    },
    insertBefore(child, before) {
      const index = this.children.indexOf(before);
      if (index < 0) return this.appendChild(child);
      this.children.splice(index, 0, child);
      child.parentNode = this;
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

function loadNavigation(pathname, surface) {
  jest.resetModules();

  const body = fakeNode('body');
  const root = fakeNode('main');
  root.id = 'canonical-admin-root';
  body.appendChild(root);

  const document = {
    readyState: 'loading',
    body,
    createElement: jest.fn(tagName => fakeNode(tagName)),
    addEventListener: jest.fn(),
    getElementById: jest.fn(id => {
      if (id === 'canonical-admin-root') return root;
      return null;
    }),
  };

  global.window = {
    location: { pathname },
    document,
    KomerceCanonicalAdmin: {
      surfaceForPath: jest.fn(() => surface),
    },
  };
  global.document = document;

  require('../../public/dashboards/canonical/js/navigation.js');

  return {
    api: global.window.KomerceCanonicalNavigation,
    document,
    body,
    root,
  };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe('canonical admin navigation', () => {
  test('expose exactement les quatre dashboards principaux', () => {
    const env = loadNavigation('/admin/pilotage', 'pilotage');

    expect(env.api.PRIMARY_NAV.map(item => item.id)).toEqual([
      'pilotage',
      'commerce',
      'operations',
      'finance',
    ]);
  });

  test('un workspace reste rattaché à son dashboard parent et affiche Retour', () => {
    const env = loadNavigation('/admin/workspaces/shipping-customs', 'shipping-customs-workspace');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/workspaces/shipping-customs',
      surface: 'shipping-customs-workspace',
    });

    expect(env.body.children[0]).toBe(header);

    const inner = header.children[0];
    const identity = inner.children[0];
    const primary = inner.children[1];
    const back = identity.children[1];
    const operations = primary.children.find(link => link.attributes['data-dashboard'] === 'operations');

    expect(back.textContent).toBe('← Retour');
    expect(back.href).toBe('/admin/operations');
    expect(operations.attributes['aria-current']).toBe('page');
  });

  test('une vue principale ne crée pas de bouton Retour', () => {
    const env = loadNavigation('/admin/finance', 'finance');
    const header = env.api.mount({ document: env.document, pathname: '/admin/finance', surface: 'finance' });
    const identity = header.children[0].children[0];

    expect(identity.children).toHaveLength(1);
    expect(header.children[0].children[1].children[3].attributes['aria-current']).toBe('page');
  });

  test('Action Center, Accès pays et Démo restent des utilitaires, pas des dashboards principaux', () => {
    const env = loadNavigation('/dashboards/canonical/access.html', 'market-access');
    const header = env.api.mount({
      document: env.document,
      pathname: '/dashboards/canonical/access.html',
      surface: 'market-access',
    });
    const inner = header.children[0];
    const primary = inner.children[1];
    const utilities = inner.children[2];

    expect(primary.children).toHaveLength(4);
    expect(utilities.children.map(link => link.textContent)).toEqual(['Actions', 'Accès pays', 'Démo staging']);
    expect(utilities.children[1].href).toBe('/dashboards/canonical/access.html');
    expect(utilities.children[1].attributes['aria-current']).toBe('page');
    expect(inner.children[0].children[1].href).toBe('/admin/pilotage');
  });
});
