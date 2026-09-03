'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  renderDiscoveryRail,
  selectMobile,
  selectDesktop,
  normalizeCard,
  formatPrice,
} = require('../../js/render/render-discovery-rail.js');

function target() {
  return document.getElementById('target');
}

function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

beforeEach(() => {
  document.body.innerHTML = '<section id="target" hidden></section>';
  setViewport(1024);
});

describe('renderDiscoveryRail', () => {
  it('reste absent si aucune carte exposable n’est fournie', () => {
    expect(renderDiscoveryRail(target(), [], { marketLabel: 'Comores' })).toBe(0);
    expect(target().hidden).toBe(true);
    expect(target().innerHTML).toBe('');
    expect(renderDiscoveryRail(target(), null)).toBe(0);
    expect(renderDiscoveryRail(null, [])).toBe(0);
  });

  it('réutilise le shell k-card canonique sur desktop pour les trois intentions', () => {
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
    expect(target().querySelectorAll('.k-discovery-canonical-card')).toHaveLength(3);
    expect(target().querySelectorAll('.k-discovery-canonical-card.k-card')).toHaveLength(3);
    expect(target().querySelectorAll('.k-discovery-canonical-card .k-card-img-wrap')).toHaveLength(3);
    expect(target().querySelectorAll('.k-discovery-canonical-card .k-card-info')).toHaveLength(3);
    expect(target().querySelectorAll('.k-discovery-canonical-img')).toHaveLength(3);
    expect(Array.from(target().querySelectorAll('.k-discovery-canonical-img')).map(img => img.getAttribute('src')))
      .toEqual(['/images/product.webp', '/images/samboussas.webp', '/images/plombier.webp']);
    expect(target().querySelectorAll('[role="listitem"]')).toHaveLength(3);
    expect(target().querySelector('.k-discovery-rail')?.getAttribute('role')).toBe('list');
    expect(target().querySelector('#k-discovery-local-title-test')?.textContent).toBe('Disponible ici');
    expect(target().textContent).toContain('Comores');

    const labels = Array.from(target().querySelectorAll('.k-discovery-canonical-cta'))
      .map(button => button.textContent);
    expect(labels).toEqual(['Acheter', 'Commander', 'Demander']);

    expect(target().querySelectorAll('.k-discovery-status')).toHaveLength(3);
    expect(target().querySelector('[data-discovery-kind="product"] .k-card-price')?.textContent)
      .toContain('KMF');
    expect(target().querySelector('[data-discovery-kind="physical_offer"] .k-discovery-canonical-context')?.textContent)
      .toContain('Fatima Traiteur · Moroni');
    expect(target().querySelector('[data-discovery-kind="service"] .k-discovery-canonical-context')?.textContent)
      .toContain('Ali Plomberie · Mutsamudu');
  });

  it('ignore un kind inconnu au lieu de créer une taxonomie implicite', () => {
    const cards = [
      { kind: 'marketplace_item', title: 'Inconnu', cta_action_ref: 'x-1', cta_label: 'Voir' },
      { kind: 'service', title: 'Maçon', subtitle: 'Sur demande', cta_action_ref: 's-2', cta_label: 'Demander' },
    ];

    expect(renderDiscoveryRail(target(), cards)).toBe(1);
    expect(target().querySelectorAll('.k-discovery-canonical-card')).toHaveLength(1);
    expect(target().textContent).not.toContain('Inconnu');
  });

  it('utilise un fallback visuel natif quand image_ref est absent', () => {
    renderDiscoveryRail(target(), [
      { kind: 'physical_offer', title: 'Samboussas', subtitle: 'Préparation sur commande', cta_action_ref: 'o-2', cta_label: 'Commander' },
    ]);

    expect(target().querySelector('.k-discovery-canonical-fallback svg')).not.toBeNull();
    expect(target().querySelector('.k-discovery-canonical-img')).toBeNull();
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
    setViewport(1280);
    const cards = Array.from({ length: 12 }, (_, index) => ({
      kind: index % 3 === 0 ? 'service' : 'product',
      title: `Carte ${index + 1}`,
      subtitle: index % 3 === 0 ? 'Sur demande' : 'Disponible maintenant',
      cta_action_ref: `ref-${index + 1}`,
      cta_label: index % 3 === 0 ? 'Demander' : 'Acheter',
    }));

    expect(renderDiscoveryRail(target(), cards, { marketLabel: 'Comores' })).toBe(12);
    expect(target().querySelectorAll('.k-discovery-canonical-card')).toHaveLength(12);
    expect(target().querySelector('.k-discovery-canonical-card:last-child')?.textContent).toContain('Carte 12');
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
    expect(target().querySelector('.k-discovery-canonical-context')?.textContent).toBe('Atelier local');
    expect(target().querySelector('.k-discovery-canonical-cta')?.textContent).toBe('Demander');
  });

  it('conserve strictement la politique mobile 2×2 historique', () => {
    setViewport(390);
    const cards = [
      { kind: 'product', title: 'P1', cta_action_ref: 'p1' },
      { kind: 'product', title: 'P2', cta_action_ref: 'p2' },
      { kind: 'physical_offer', title: 'O1', cta_action_ref: 'o1' },
      { kind: 'service', title: 'S1', cta_action_ref: 's1' },
      { kind: 'service', title: 'S2', cta_action_ref: 's2' },
    ];

    expect(renderDiscoveryRail(target(), cards)).toBe(5);
    expect(target().querySelectorAll('.k-discovery-card')).toHaveLength(4);
    expect(target().querySelectorAll('.k-discovery-canonical-card')).toHaveLength(0);
    expect(target().querySelectorAll('.k-discovery-cta')).toHaveLength(4);
  });
});

describe('selectMobile — surface policy HOME V1', () => {
  function card(kind, id) {
    return normalizeCard({
      kind, title: `${kind}-${id}`, cta_action_ref: id, cta_label: 'Test',
    });
  }

  it('alterne 2 commerce + 2 services depuis un pool mixte', () => {
    const pool = [
      card('product', 'p1'), card('product', 'p2'), card('product', 'p3'),
      card('physical_offer', 'o1'),
      card('service', 's1'), card('service', 's2'), card('service', 's3'),
    ];
    const result = selectMobile(pool);
    expect(result).toHaveLength(4);
    expect(result.map(c => c.kind)).toEqual(['product', 'service', 'product', 'service']);
  });

  it('complète avec le commerce si les services sont insuffisants', () => {
    const pool = [
      card('product', 'p1'), card('product', 'p2'), card('physical_offer', 'o1'),
      card('service', 's1'),
    ];
    const result = selectMobile(pool);
    expect(result).toHaveLength(4);
    expect(result[0].kind).toBe('product');
    expect(result[1].kind).toBe('service');
  });

  it('reste sous quatre quand le pool est petit', () => {
    const pool = [card('product', 'p1'), card('service', 's1')];
    expect(selectMobile(pool)).toHaveLength(2);
  });

  it('ne dépasse jamais quatre', () => {
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

  it('préserve le pool éditorial complet et son ordre', () => {
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

  it('conserve les 12 candidats déjà bornés par le backend', () => {
    const pool = Array.from({ length: 12 }, (_, i) => card('product', `p${i}`));
    expect(selectDesktop(pool)).toHaveLength(12);
  });

  it('rend moins si le pool est petit', () => {
    const pool = [card('product', 'p1'), card('service', 's1')];
    expect(selectDesktop(pool)).toHaveLength(2);
  });
});
