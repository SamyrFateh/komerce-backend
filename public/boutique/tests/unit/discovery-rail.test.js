'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { renderDiscoveryRail } = require('../../js/render/render-discovery-rail.js');

function target() {
  return document.getElementById('target');
}

beforeEach(() => {
  document.body.innerHTML = '<section id="target" hidden></section>';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

describe('renderDiscoveryRail', () => {
  it('reste absent si aucune carte exposable n’est fournie', () => {
    expect(renderDiscoveryRail(target(), [], { marketLabel: 'Comores' })).toBe(0);
    expect(target().hidden).toBe(true);
    expect(target().innerHTML).toBe('');
    expect(renderDiscoveryRail(target(), null)).toBe(0);
    expect(renderDiscoveryRail(null, [])).toBe(0);
  });

  it('rend Disponible ici dans un seul rail avec les trois intentions', () => {
    const cards = [
      {
        kind: 'product', title: 'Climatiseur', subtitle: 'Disponible maintenant',
        cta_label: 'Acheter', cta_action_ref: 'p-1', image_ref: '/images/product.webp',
        price: 195000, category_keys: ['Tech'],
      },
      {
        kind: 'physical_offer', title: 'Samboussas mariage', subtitle: 'Préparation sur commande',
        cta_label: 'Commander', cta_action_ref: 'o-1', image_ref: '/images/samboussas.webp',
        provider_name: 'Fatima Traiteur', zone: 'Moroni', category_keys: ['Maison'],
      },
      {
        kind: 'service', title: 'Plomberie', subtitle: 'Sur demande',
        cta_label: 'Demander', cta_action_ref: 's-1', image_ref: '/images/plombier.webp',
        provider_name: 'Ali Plomberie', zone: 'Mutsamudu', category_keys: ['Maison', 'Bricolage'],
      },
    ];

    expect(renderDiscoveryRail(target(), cards, {
      marketLabel: 'Comores',
      titleId: 'k-discovery-local-title-test',
    })).toBe(3);
    expect(target().hidden).toBe(false);
    expect(target().querySelectorAll('.k-discovery-card')).toHaveLength(3);
    expect(target().querySelectorAll('.k-discovery-img')).toHaveLength(3);
    expect(Array.from(target().querySelectorAll('.k-discovery-img')).map(img => img.getAttribute('src')))
      .toEqual(['/images/product.webp', '/images/samboussas.webp', '/images/plombier.webp']);
    expect(target().querySelectorAll('[role="listitem"]')).toHaveLength(3);
    expect(target().querySelector('.k-discovery-rail')?.getAttribute('role')).toBe('list');
    expect(target().querySelector('#k-discovery-local-title-test')?.textContent).toBe('Disponible ici');
    expect(target().textContent).toContain('Comores');

    const labels = Array.from(target().querySelectorAll('.k-discovery-cta')).map(button => button.textContent);
    expect(labels).toEqual(['Acheter', 'Commander', 'Demander']);

    expect(target().querySelectorAll('.k-discovery-status')).toHaveLength(3);
    expect(target().querySelectorAll('.k-discovery-subtitle')).toHaveLength(0);
    expect(target().querySelectorAll('.k-discovery-primary-slot')).toHaveLength(3);
    expect(target().querySelectorAll('.k-discovery-context-slot')).toHaveLength(3);

    expect(target().querySelector('.k-discovery-price')?.textContent).toContain('195');
    expect(target().querySelector('.k-discovery-price')?.textContent).toContain('KMF');

    const providers = Array.from(target().querySelectorAll('.k-discovery-provider')).map(el => el.textContent);
    expect(providers).toHaveLength(2);
    expect(providers[0]).toContain('Fatima Traiteur');
    expect(providers[0]).toContain('Moroni');
    expect(providers[1]).toContain('Ali Plomberie');
    expect(providers[1]).toContain('Mutsamudu');

    const productCard = target().querySelector('[data-discovery-kind="product"]');
    expect(productCard.querySelector('.k-discovery-provider')).toBeNull();
    expect(productCard.querySelector('.k-discovery-context-slot')).not.toBeNull();
    expect(target().querySelector('.k-discovery-card[data-discovery-ref="p-1"]')).not.toBeNull();
  });

  it('ignore un kind inconnu au lieu de créer une nouvelle taxonomie implicite', () => {
    const cards = [
      { kind: 'marketplace_item', title: 'Inconnu', cta_action_ref: 'x-1', cta_label: 'Voir' },
      { kind: 'service', title: 'Maçon', subtitle: 'Sur demande', cta_action_ref: 's-2', cta_label: 'Demander' },
    ];

    expect(renderDiscoveryRail(target(), cards)).toBe(1);
    expect(target().querySelectorAll('.k-discovery-card')).toHaveLength(1);
    expect(target().textContent).not.toContain('Inconnu');
  });

  it('utilise un fallback visuel natif quand image_ref est absent', () => {
    renderDiscoveryRail(target(), [
      { kind: 'physical_offer', title: 'Samboussas', subtitle: 'Préparation sur commande', cta_action_ref: 'o-2', cta_label: 'Commander' },
    ]);

    expect(target().querySelector('.k-discovery-fallback svg')).not.toBeNull();
    expect(target().querySelector('.k-discovery-img')).toBeNull();
  });

  it('échappe les valeurs de projection avant insertion HTML', () => {
    renderDiscoveryRail(target(), [
      {
        kind: 'service',
        title: '<img src=x onerror=alert(1)>',
        subtitle: '<script>alert(1)</script>',
        cta_action_ref: 's-3',
        cta_label: 'Demander',
      },
    ]);

    expect(target().querySelector('script')).toBeNull();
    expect(target().querySelector('img')).toBeNull();
    expect(target().textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('rend les 12 candidats éditoriaux sur desktop sans troncature silencieuse', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    const cards = Array.from({ length: 12 }, (_, index) => ({
      kind: index % 3 === 0 ? 'service' : 'product',
      title: `Carte ${index + 1}`,
      subtitle: index % 3 === 0 ? 'Sur demande' : 'Disponible maintenant',
      cta_action_ref: `ref-${index + 1}`,
      cta_label: index % 3 === 0 ? 'Demander' : 'Acheter',
    }));

    expect(renderDiscoveryRail(target(), cards, { marketLabel: 'Comores' })).toBe(12);
    expect(target().querySelectorAll('.k-discovery-card')).toHaveLength(12);
    expect(target().querySelector('.k-discovery-card:last-child')?.textContent).toContain('Carte 12');
  });

  it('applique les fallbacks minimaux et conserve category_keys comme metadata de contexte', () => {
    expect(normalizeCard({ kind: 'service', cta_action_ref: 's-missing-title' })).toBeNull();
    expect(normalizeCard({ kind: 'service', title: 'Sans référence' })).toBeNull();
    expect(formatPrice(null)).toBe('');

    const normalized = normalizeCard({
      kind: 'service',
      title: 'Diagnostic',
      cta_action_ref: 's-minimal',
      provider_name: 'Atelier local',
      description: 'Diagnostic sur place',
      category_keys: ['Maison', 'Maison', 'Bricolage'],
    });
    expect(normalized.ctaLabel).toBe('Demander');
    expect(normalized.description).toBe('Diagnostic sur place');
    expect(normalized.categoryKeys).toEqual(['Maison', 'Bricolage']);

    renderDiscoveryRail(target(), [{
      kind: 'service',
      title: 'Diagnostic',
      cta_action_ref: 's-minimal',
      provider_name: 'Atelier local',
    }]);
    expect(target().querySelector('.k-discovery-status')).toBeNull();
    expect(target().querySelector('.k-discovery-provider')?.textContent).toBe('Atelier local');
    expect(target().querySelector('.k-discovery-cta')?.textContent).toBe('Demander');
  });

  it('conserve la politique mobile 2×2', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const cards = [
      { kind: 'product', title: 'P1', cta_action_ref: 'p1' },
      { kind: 'product', title: 'P2', cta_action_ref: 'p2' },
      { kind: 'physical_offer', title: 'O1', cta_action_ref: 'o1' },
      { kind: 'service', title: 'S1', cta_action_ref: 's1' },
      { kind: 'service', title: 'S2', cta_action_ref: 's2' },
    ];

    expect(renderDiscoveryRail(target(), cards)).toBe(5);
    expect(target().querySelectorAll('.k-discovery-card')).toHaveLength(4);
  });
});

const { selectMobile, selectDesktop, normalizeCard, formatPrice } = require('../../js/render/render-discovery-rail.js');

describe('selectMobile — surface policy HOME V1', () => {
  function card(kind, id) {
    return normalizeCard({
      kind, title: `${kind}-${id}`, cta_action_ref: id, cta_label: 'Test',
    });
  }

  it('alternates 2 commerce + 2 services from a mixed pool', () => {
    const pool = [
      card('product', 'p1'), card('product', 'p2'), card('product', 'p3'),
      card('physical_offer', 'o1'),
      card('service', 's1'), card('service', 's2'), card('service', 's3'),
    ];
    const result = selectMobile(pool);
    expect(result).toHaveLength(4);
    expect(result.map(c => c.kind)).toEqual(['product', 'service', 'product', 'service']);
  });

  it('fills from commerce if fewer than 2 services', () => {
    const pool = [
      card('product', 'p1'), card('product', 'p2'), card('physical_offer', 'o1'),
      card('service', 's1'),
    ];
    const result = selectMobile(pool);
    expect(result).toHaveLength(4);
    expect(result[0].kind).toBe('product');
    expect(result[1].kind).toBe('service');
  });

  it('returns fewer than 4 if pool is small', () => {
    const pool = [card('product', 'p1'), card('service', 's1')];
    const result = selectMobile(pool);
    expect(result).toHaveLength(2);
  });

  it('never exceeds 4', () => {
    const pool = Array.from({ length: 12 }, (_, i) => card('product', `p${i}`));
    expect(selectMobile(pool)).toHaveLength(4);
  });
});

describe('selectDesktop — flat mixed rail', () => {
  function card(kind, id) {
    return normalizeCard({
      kind, title: `${kind}-${id}`, cta_action_ref: id, cta_label: 'Test',
    });
  }

  it('preserves the complete mixed editorial pool in order', () => {
    const pool = [
      card('product', 'p1'), card('physical_offer', 'o1'), card('service', 's1'),
      card('product', 'p2'), card('service', 's2'), card('product', 'p3'),
      card('product', 'p4'),
    ];
    const result = selectDesktop(pool);
    expect(result).toHaveLength(7);
    expect(result.map(c => c.kind)).toEqual([
      'product', 'physical_offer', 'service', 'product', 'service', 'product', 'product',
    ]);
  });

  it('keeps the 12 candidates already bounded by the backend', () => {
    const pool = Array.from({ length: 12 }, (_, i) => card('product', `p${i}`));
    expect(selectDesktop(pool)).toHaveLength(12);
  });

  it('returns fewer if pool is small', () => {
    const pool = [card('product', 'p1'), card('service', 's1')];
    expect(selectDesktop(pool)).toHaveLength(2);
  });
});
