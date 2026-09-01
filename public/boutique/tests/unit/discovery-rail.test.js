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
});

describe('renderDiscoveryRail', () => {
  it('reste absent si aucune carte exposable n’est fournie', () => {
    expect(renderDiscoveryRail(target(), [], { marketLabel: 'Comores' })).toBe(0);
    expect(target().hidden).toBe(true);
    expect(target().innerHTML).toBe('');
  });

  it('rend dans un seul rail les trois intentions avec contenu spécialisé par kind', () => {
    const cards = [
      {
        kind: 'product', title: 'Climatiseur', subtitle: 'Disponible maintenant',
        cta_label: 'Acheter', cta_action_ref: 'p-1', image_ref: '/images/product.webp',
        price: 195000,
      },
      {
        kind: 'physical_offer', title: 'Samboussas mariage', subtitle: 'Préparation sur commande',
        cta_label: 'Commander', cta_action_ref: 'o-1', image_ref: '/images/samboussas.webp',
        provider_name: 'Fatima Traiteur', zone: 'Moroni',
      },
      {
        kind: 'service', title: 'Plomberie', subtitle: 'Sur demande',
        cta_label: 'Demander', cta_action_ref: 's-1', image_ref: '/images/plombier.webp',
        provider_name: 'Ali Plomberie', zone: 'Mutsamudu',
      },
    ];

    expect(renderDiscoveryRail(target(), cards, { marketLabel: 'Comores' })).toBe(3);
    expect(target().hidden).toBe(false);
    expect(target().querySelectorAll('.k-discovery-card')).toHaveLength(3);
    expect(target().querySelectorAll('.k-discovery-img')).toHaveLength(3);
    expect(Array.from(target().querySelectorAll('.k-discovery-img')).map(img => img.getAttribute('src')))
      .toEqual(['/images/product.webp', '/images/samboussas.webp', '/images/plombier.webp']);
    expect(target().querySelectorAll('[role="listitem"]')).toHaveLength(3);
    // Desktop composition: role="list" is on the zone containers, not the rail wrapper
    const lists = target().querySelectorAll('[role="list"]');
    expect(lists.length).toBeGreaterThanOrEqual(1);
    expect(target().querySelector('#k-discovery-local-title')?.textContent).toBe('Près de vous');
    expect(target().textContent).toContain('Comores');

    const labels = Array.from(target().querySelectorAll('.k-discovery-cta')).map(button => button.textContent);
    expect(labels).toEqual(['Acheter', 'Commander', 'Demander']);

    // V2 — contenu spécialisé
    expect(target().querySelector('.k-discovery-price')?.textContent).toContain('195');
    expect(target().querySelector('.k-discovery-price')?.textContent).toContain('KMF');

    const providers = Array.from(target().querySelectorAll('.k-discovery-provider')).map(el => el.textContent);
    expect(providers).toHaveLength(2);
    expect(providers[0]).toContain('Fatima Traiteur');
    expect(providers[0]).toContain('Moroni');
    expect(providers[1]).toContain('Ali Plomberie');
    expect(providers[1]).toContain('Mutsamudu');

    // product card must NOT show provider
    const productCard = target().querySelector('[data-discovery-kind="product"]');
    expect(productCard.querySelector('.k-discovery-provider')).toBeNull();

    // cards are now clickable via data-discovery-ref on article
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
});

// ── selectMobile policy tests ───────────────────────────────────────────

const { selectMobile, selectDesktop, normalizeCard } = require('../../js/render/render-discovery-rail.js');

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

describe('selectDesktop — 75/25 composition policy', () => {
  function card(kind, id) {
    return normalizeCard({
      kind, title: `${kind}-${id}`, cta_action_ref: id, cta_label: 'Test',
    });
  }

  it('splits into 4 commerce + 2 services from a mixed pool', () => {
    const pool = [
      card('product', 'p1'), card('product', 'p2'), card('product', 'p3'),
      card('physical_offer', 'o1'), card('physical_offer', 'o2'),
      card('service', 's1'), card('service', 's2'), card('service', 's3'),
    ];
    const result = selectDesktop(pool);
    expect(result.commerce).toHaveLength(4);
    expect(result.services).toHaveLength(2);
    expect(result.commerce.every(c => c.kind === 'product' || c.kind === 'physical_offer')).toBe(true);
    expect(result.services.every(c => c.kind === 'service')).toBe(true);
  });

  it('returns empty services array when no services in pool', () => {
    const pool = [card('product', 'p1'), card('physical_offer', 'o1')];
    const result = selectDesktop(pool);
    expect(result.commerce).toHaveLength(2);
    expect(result.services).toHaveLength(0);
  });

  it('caps commerce at 4 even with large pool', () => {
    const pool = Array.from({ length: 10 }, (_, i) => card('product', `p${i}`));
    const result = selectDesktop(pool);
    expect(result.commerce).toHaveLength(4);
  });

  it('caps services at 2', () => {
    const pool = Array.from({ length: 6 }, (_, i) => card('service', `s${i}`));
    const result = selectDesktop(pool);
    expect(result.services).toHaveLength(2);
  });
});
