'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const semantic = require('../../services/suppliers/discovery-semantic-relevance');

describe('provider-independent supplier discovery semantic relevance', () => {
  test('accepts plural and possessive morphology without provider-specific rules', () => {
    const result = semantic.audit({
      product_name: "Women's Summer Dresses Casual Beach Dress",
      supplier_category: 'Apparel',
    }, 'women dress');
    expect(result.relevant).toBe(true);
    expect(result.matched_tokens).toEqual(expect.arrayContaining(['women', 'dress']));
    expect(result.gate_version).toBe(semantic.GATE_VERSION);
  });

  test('rejects a technically rich product that is outside the discovery query', () => {
    const result = semantic.audit({
      product_name: 'Motorcycle Rear View Mirror CNC Aluminum',
      supplier_category: 'Motorcycle Parts',
      description: 'Universal handlebar mirror pair',
    }, 'women dress');
    expect(result.relevant).toBe(false);
    expect(result.matched_intent_anchors).toEqual([]);
  });

  test('uses the same contract regardless of supplier identity', () => {
    const product = {
      product_name: 'Wireless Bluetooth Headphones Over Ear Headset',
      supplier_category: 'Consumer Electronics',
    };
    expect(semantic.audit({ ...product, supplier_name: 'CJdropshipping' }, 'wireless headphones'))
      .toEqual(semantic.audit({ ...product, supplier_name: 'AliExpress' }, 'wireless headphones'));
  });

  test('keeps the specific intent anchor mandatory', () => {
    const result = semantic.audit({
      product_name: 'USB C Fast Charging Cable 100W Digital Display',
      supplier_category: 'Cables',
    }, 'usb c digital power meter tester');
    expect(result.relevant).toBe(false);
    expect(result.matched_intent_anchors).toEqual([]);
  });
});
