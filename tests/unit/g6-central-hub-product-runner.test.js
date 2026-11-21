'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));
jest.mock('../../scripts/recette/target-guard', () => ({ confirmTarget: jest.fn() }));
process.env.G6_TARGET_MARKET = 'KM';
const fs = require('node:fs');
const { nextStep, recettePrice } = require('../../scripts/recette/g6-central-hub-product-chromium');

const P = { candidate_ref: 'KSC-1', product_ref: 'KPR-1', is_active: false, lifecycle_status: 'candidate' };
const step = c => nextStep({ sellable: [], candidate: c });

describe('G6 central Hub product: resume by step read from PG', () => {
  test('one step per state, in the screen order', () => {
    expect(step(null)).toEqual({ step: 'manual-import' });
    expect(step({ candidate_ref: 'KSC-1', product_ref: null, state: 'imported', decision: null }))
      .toEqual({ step: 'scan-candidate', candidate_ref: 'KSC-1' });
    expect(step({ candidate_ref: 'KSC-1', product_ref: null, state: 'scanned', decision: 'TEST' }))
      .toEqual({ step: 'promote-candidate', candidate_ref: 'KSC-1' });
    expect(step(P)).toEqual({ step: 'catalog-approve', product_ref: 'KPR-1' });
    const ok = { ...P, is_active: true, lifecycle_status: 'active' };
    expect(step(ok)).toEqual({ step: 'price-draft', product_ref: 'KPR-1' });
    expect(step({ ...ok, price_status: 'DRAFT_PENDING_GATE' }).step).toBe('price-activate');
    expect(step({ ...ok, price_status: 'LOCAL_AUTHORIZED_PENDING_CUTOVER' }).step).toBe('price-activate');
    expect(step({ ...ok, price_status: 'LOCAL_ACTIVE', pid: 'u', exposure: null }))
      .toEqual({ step: 'market-expose', product_ref: 'KPR-1', product_id: 'u' });
  });

  test('a scanned candidate that is not TEST stops, never forced', () => {
    expect(step({ candidate_ref: 'K', product_ref: null, state: 'scanned', decision: 'REJECT' }))
      .toMatchObject({ verdict: 'G6_CANDIDATE_SCAN_NOT_TEST', fail: true });
  });

  test('sellable guards stay ahead of every gesture', () => {
    expect(nextStep({ sellable: [{ product_ref: 'KPR-1' }], candidate: null }).done).toBe(true);
    expect(nextStep({ sellable: [{}, {}], candidate: null }).fail).toBe(true);
    const full = { ...P, is_active: true, lifecycle_status: 'active', price_status: 'LOCAL_ACTIVE', exposure: 'ENABLED' };
    expect(step(full)).toMatchObject({ verdict: 'G6_CENTRAL_HUB_PRODUCT_READBACK_NOT_SELLABLE', fail: true });
  });

  test('recette price: explicit floor, raised to the canonical coverage reference rounded to 100', () => {
    expect(recettePrice(null)).toBe(15000);
    expect(recettePrice({ selected: { economics: { coverage_reference_price_kmf: 9000 } } })).toBe(15000);
    expect(recettePrice({ selected: { economics: { coverage_reference_price_kmf: 20041 } } })).toBe(20100);
    expect(recettePrice(null, 'CM')).toBe(10000);
    expect(() => recettePrice(null, 'XX')).toThrow('G6_RECETTE_PRICE_FLOOR_MISSING');
  });

  test('one mutation per gesture: single armed route, no retry, no raw write', () => {
    const src = fs.readFileSync('scripts/recette/g6-central-hub-product-chromium.js', 'utf8');
    expect(src).toMatch(/calls\+\+===0/);
    expect(src).toMatch(/G6_CENTRAL_NO_PROGRESS_/);
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM)?\s*\w+\s+(SET|VALUES)/i);
    expect(src).toMatch(/mode=manual/);
  });
});
