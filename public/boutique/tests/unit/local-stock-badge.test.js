'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/local-stock-badge.test.js
 *
 * Module js/local-stock-badge.js — Vague 2 D6.
 *
 * Couverture :
 *   ✓ exposable=false -> container vide, aucun DOM ajouté
 *   ✓ availability=UNAVAILABLE mais exposable=true (incohérence défensive) -> vide
 *   ✓ fetch retourne null (échec réseau/404) -> container vide, jamais un throw
 *   ✓ nominal : exposable=true + AVAILABLE_NOW -> badge rendu avec le texte exact
 *   ✓ container déjà rempli -> vidé avant tout nouveau rendu (pas d'empilement)
 *   ✓ container null -> no-op, jamais un throw
 */

jest.mock('../../js/discovery-api.js', () => ({
  fetchLocalStockAvailability: jest.fn(),
}));

const { fetchLocalStockAvailability } = require('../../js/discovery-api.js');
const { renderLocalStockBadge } = require('../../js/local-stock-badge.js');

const PRODUCT_ID = 'prod-1';

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '<div id="target"></div>';
});

describe('renderLocalStockBadge', () => {
  it('container null -> no-op, jamais un throw', async () => {
    await expect(renderLocalStockBadge(null, PRODUCT_ID)).resolves.toBeUndefined();
    expect(fetchLocalStockAvailability).not.toHaveBeenCalled();
  });

  it('fetch retourne null (échec réseau/404) -> container vide', async () => {
    fetchLocalStockAvailability.mockResolvedValue(null);
    const container = document.getElementById('target');
    await renderLocalStockBadge(container, PRODUCT_ID);
    expect(container.innerHTML).toBe('');
  });

  it('exposable=false -> container vide, aucun DOM ajouté', async () => {
    fetchLocalStockAvailability.mockResolvedValue({ availability: 'AVAILABLE_NOW', exposable: false });
    const container = document.getElementById('target');
    await renderLocalStockBadge(container, PRODUCT_ID);
    expect(container.innerHTML).toBe('');
    expect(container.querySelector('.k-local-stock-badge')).toBeNull();
  });

  it('availability=UNAVAILABLE malgré exposable=true (incohérence défensive) -> vide', async () => {
    fetchLocalStockAvailability.mockResolvedValue({ availability: 'UNAVAILABLE', exposable: true });
    const container = document.getElementById('target');
    await renderLocalStockBadge(container, PRODUCT_ID);
    expect(container.innerHTML).toBe('');
  });

  it('nominal : exposable=true + AVAILABLE_NOW -> badge rendu avec le texte exact', async () => {
    fetchLocalStockAvailability.mockResolvedValue({ availability: 'AVAILABLE_NOW', exposable: true });
    const container = document.getElementById('target');
    await renderLocalStockBadge(container, PRODUCT_ID);

    const badge = container.querySelector('.k-local-stock-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('Disponible maintenant');
    expect(badge.textContent).toContain('Déjà en stock aux Comores');
  });

  it('container déjà rempli -> vidé avant tout nouveau rendu, jamais d\'empilement', async () => {
    fetchLocalStockAvailability.mockResolvedValue({ availability: 'AVAILABLE_NOW', exposable: true });
    const container = document.getElementById('target');
    container.innerHTML = '<div class="stale">ancien contenu</div>';

    await renderLocalStockBadge(container, PRODUCT_ID);

    expect(container.querySelectorAll('.k-local-stock-badge').length).toBe(1);
    expect(container.querySelector('.stale')).toBeNull();
  });

  it('appelle fetchLocalStockAvailability avec le bon productId', async () => {
    fetchLocalStockAvailability.mockResolvedValue(null);
    await renderLocalStockBadge(document.getElementById('target'), PRODUCT_ID);
    expect(fetchLocalStockAvailability).toHaveBeenCalledWith(PRODUCT_ID);
  });
});
