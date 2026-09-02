'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const { renderCard, normalizeCard } = require('../../js/render/render-discovery-rail.js');

function card(kind, overrides = {}) {
  return normalizeCard({
    kind,
    title: overrides.title || `${kind} test`,
    subtitle: overrides.subtitle || 'Disponible localement',
    cta_action_ref: overrides.ref || `${kind}-1`,
    cta_label: overrides.cta || (kind === 'service' ? 'Demander' : kind === 'physical_offer' ? 'Commander' : 'Acheter'),
    image_ref: '/images/test.webp',
    price: kind === 'product' ? 42000 : null,
    provider_name: kind === 'product' ? null : 'Provider local',
    zone: kind === 'product' ? null : 'Mutsamudu',
  });
}

describe('Discovery — canonical Komerce card contract', () => {
  test.each(['product', 'physical_offer', 'service'])(
    '%s réutilise le shell k-card au lieu de créer un second modèle visuel',
    (kind) => {
      document.body.innerHTML = renderCard(card(kind));
      const root = document.querySelector('[data-discovery-kind]');

      expect(root).not.toBeNull();
      expect(root.matches('.k-card.k-discovery-card.k-card--discovery')).toBe(true);
      expect(root.querySelector('.k-card-img-wrap')).not.toBeNull();
      expect(root.querySelector('.k-card-img.k-discovery-img')).not.toBeNull();
      expect(root.querySelector('.k-card-info')).not.toBeNull();
      expect(root.querySelector('.k-card-name.k-discovery-name')).not.toBeNull();
      expect(root.querySelector('.k-card-bottom.k-card-prices-row.k-discovery-bottom')).not.toBeNull();
      expect(root.querySelector('.k-card-add.k-discovery-action-slot')).not.toBeNull();
      expect(root.querySelector('.k-discovery-cta')).not.toBeNull();

      expect(root.querySelector('.k-discovery-media')).toBeNull();
      expect(root.querySelector('.k-discovery-info')).toBeNull();
    }
  );

  test('discovery-rail.css ne possède aucune géométrie de shell parallèle', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../css/discovery-rail.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    expect(css).not.toMatch(/\.k-discovery-card\s*(?:[:.#\[][^,{]*)?\{/);
    expect(css).not.toMatch(/\.k-discovery-media\s*(?:[:.#\[][^,{]*)?\{/);
    expect(css).not.toMatch(/\.k-discovery-info\s*(?:[:.#\[][^,{]*)?\{/);
    expect(css).not.toMatch(/\.k-discovery-name\s*(?:[:.#\[][^,{]*)?\{/);
  });
});
