'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { buildCanonicalOfferProjection } = require('../../services/sourcing-canonical-offer-projection');

const row = (source, time, normalized, principal = null) => ({
  canonical_entity_id: 'offer-1', parent_entity_id: 'product-1', principal_id: principal,
  observation_id: source + time, source_id: source, adapter_type: 'api', observed_at: time,
  normalized,
});

test('même Product et deux fournisseurs restent deux Offers', () => {
  const a = buildCanonicalOfferProjection([row('cj:a', '2026-01-01', { purchase_price: 10 }, 'supplier-a')]);
  const b = buildCanonicalOfferProjection([{ ...row('ali:b', '2026-01-01', { purchase_price: 9 }, 'supplier-b'), canonical_entity_id: 'offer-2' }]);
  expect(a.canonical_product_id).toBe(b.canonical_product_id);
  expect(a.canonical_offer_id).not.toBe(b.canonical_offer_id);
  expect(a.identity.principal_id).not.toBe(b.identity.principal_id);
});

test('prix et stock changent: même Offer, état courant le plus récent et historique conservé', () => {
  const offer = buildCanonicalOfferProjection([
    row('cj:a', '2026-01-01', { purchase_price: 10, stock_available: 5 }, 'supplier-a'),
    row('cj:a', '2026-01-02', { purchase_price: 12, stock_available: 0 }, 'supplier-a'),
  ]);
  expect(offer.canonical_offer_id).toBe('offer-1');
  expect(offer.observation_count).toBe(2);
  expect(offer.current_state).toMatchObject({ purchase_price: 12, stock_available: 0 });
});

test('outage ou observation plus ancienne ne recrée pas identité', () => {
  const offer = buildCanonicalOfferProjection([row('cj:a', '2026-01-01', { availability: 'unavailable' }, 'supplier-a')]);
  expect(offer.identity.canonical_offer_id).toBe('offer-1');
  expect(offer.current_state.availability).toBe('unavailable');
});
