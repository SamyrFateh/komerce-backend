'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const navigation = require('../../public/dashboards/canonical/js/navigation');

const canonicalRoot = path.join(__dirname, '../../public/dashboards/canonical');

function node(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
  };
}

const document = { createElement: jest.fn(tagName => node(tagName)) };

describe('navigation globale Canonical', () => {
  test.each([
    ['pilotage', 'pilotage', null],
    ['commerce', 'commerce', '/admin/pilotage'],
    ['operations', 'operations', '/admin/pilotage'],
    ['finance', 'finance', '/admin/pilotage'],
    ['operations-workspace', 'operations', '/admin/operations'],
    ['shipping-customs-workspace', 'operations', '/admin/operations'],
    ['catalog-workspace', 'commerce', '/admin/commerce'],
    ['accounting-workspace', 'finance', '/admin/finance'],
    ['sourcing-workspace', 'commerce', '/admin/commerce'],
    ['pricing-workspace', 'finance', '/admin/finance'],
    ['action-center', 'pilotage', '/admin/pilotage'],
    ['order-360', 'operations', '/admin/operations'],
    ['client-index', 'commerce', '/admin/commerce'],
    ['client-360', 'commerce', '/admin/clients'],
    ['product-360', 'commerce', '/admin/workspaces/catalog'],
    ['demo', 'pilotage', '/admin/pilotage'],
  ])('%s possède le bon parent et le bon dashboard actif', (surface, activeSurface, parentHref) => {
    const context = navigation.contextForSurface(surface);
    expect(context.activeSurface).toBe(activeSurface);
    expect(context.parent && context.parent.href).toBe(parentHref);
  });

  test('une surface inconnue retombe sur la racine Pilotage', () => {
    expect(navigation.contextForSurface('unknown')).toBe(navigation.contextForSurface('pilotage'));
  });

  test('Order 360 affiche Retour à Opérations et les quatre entrées stables', () => {
    const root = node('main');
    const content = navigation.mount({ root, document, surface: 'order-360' });
    const inner = root.children[0].children[0];
    const location = inner.children[0];
    const primary = inner.children[1];

    expect(root.className).toBe('kmc-canonical-app');
    expect(content).toBe(root.children[1]);
    expect(content.attributes['data-canonical-content']).toBe('order-360');
    expect(location.children[1].textContent).toBe('← Retour à Opérations');
    expect(location.children[1].attributes).toEqual({ href: '/admin/operations', 'aria-label': 'Retour à Opérations' });
    expect(primary.attributes['aria-label']).toBe('Navigation principale');
    expect(primary.children.map(item => item.attributes.href)).toEqual([
      '/admin/pilotage', '/admin/commerce', '/admin/operations', '/admin/finance',
    ]);
    expect(primary.children[2].attributes['aria-current']).toBe('page');
  });

  test('Pilotage est la racine sans faux retour et devient le repli de montage', () => {
    const root = node('main');
    navigation.mount({ root, document, surface: 'unknown' });
    const inner = root.children[0].children[0];
    expect(root.children[1].attributes['data-canonical-content']).toBe('pilotage');
    expect(inner.children[0].children).toHaveLength(1);
    expect(inner.children[1].children[0].attributes['aria-current']).toBe('page');
  });

  test('le contrat refuse une racine ou un document invalide', () => {
    expect(() => navigation.mount()).toThrow('canonical_navigation_root_missing');
    expect(() => navigation.mount({ root: node('main') })).toThrow('canonical_navigation_document_missing');
  });

  test('le runtime charge la navigation avant le point d’entrée Canonical', () => {
    const index = fs.readFileSync(path.join(canonicalRoot, 'index.html'), 'utf8');
    expect(index).toContain('/dashboards/canonical/js/navigation.js');
    expect(index.indexOf('/dashboards/canonical/js/navigation.js'))
      .toBeLessThan(index.indexOf('/dashboards/canonical/js/app.js'));
  });

  test('la barre reste visible et utilisable sur mobile', () => {
    const css = fs.readFileSync(path.join(canonicalRoot, 'css/renderer.css'), 'utf8');
    expect(css).toContain('.kmc-canonical-nav {');
    expect(css).toContain('position: sticky;');
    expect(css).toContain('.kmc-canonical-primary-link[aria-current="page"]');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).toContain('overflow-x: auto;');
  });
});
