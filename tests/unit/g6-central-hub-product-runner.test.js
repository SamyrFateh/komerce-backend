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
const { nextStep, recettePrice, G6_SUPPLIER_PRODUCT_ID, G6_PREFIX } = require('../../scripts/recette/g6-central-hub-product-chromium');

const P = { candidate_ref: 'KSC-1', product_ref: 'KPR-1', is_active: false, lifecycle_status: 'candidate' };
const step = c => nextStep({ sellable: [], candidate: c });

describe('G6 central Hub product: resume by step read from PG', () => {
  test('one step per state, in the screen order', () => {
    expect(step(null)).toEqual({ step: 'manual-import' });
    expect(step({ candidate_ref: 'KSC-1', product_ref: null, state: 'imported', decision: null }))
      .toEqual({ step: 'scan-candidate', candidate_ref: 'KSC-1' });
    expect(step({ candidate_ref: 'KSC-1', product_ref: null, state: 'scanned', decision: 'TEST' }))
      .toEqual({ step: 'promote-candidate', candidate_ref: 'KSC-1' });
    expect(step(P)).toEqual({ step: 'catalog-media', product_ref: 'KPR-1' });
    const withMedia = { ...P, media_count: 1, visual_review_ready: true };
    expect(step(withMedia)).toEqual({ step: 'catalog-editorial', product_ref: 'KPR-1' });
    const fr = { ...withMedia, description: 'Texte', needs_review: false };
    expect(step(fr)).toEqual({ step: 'catalog-taxonomy', product_ref: 'KPR-1' });
    expect(step({ ...fr, boutique_category_key: 'Bricolage', boutique_subcategory_key: 'Outillage' }))
      .toEqual({ step: 'catalog-approve', product_ref: 'KPR-1' });
    const ok = { ...P, is_active: true, lifecycle_status: 'active' };
    expect(step(ok)).toEqual({ step: 'price-draft', product_ref: 'KPR-1' });
    expect(step({ ...ok, price_status: 'DRAFT_PENDING_GATE' }).step).toBe('price-activate');
    expect(step({ ...ok, price_status: 'LOCAL_AUTHORIZED_PENDING_CUTOVER' }).step).toBe('price-activate');
    expect(step({ ...ok, price_status: 'LOCAL_ACTIVE', pid: 'u', exposure: null }))
      .toEqual({ step: 'market-expose', product_ref: 'KPR-1', product_id: 'u' });
  });

  test('reviews a canonical image before editorial preparation or approval', () => {
    expect(step({ ...P, pid: 'product-id', media_count: 1, visual_review_ready: false }))
      .toEqual({ step: 'catalog-visual-review', product_ref: 'KPR-1', product_id: 'product-id' });
  });

  test('WATCH without calculation family: one human category gesture, then a screen-missing verdict, never forced', () => {
    const w = { candidate_ref: 'K', product_ref: null, state: 'scanned', decision: 'WATCH', komerce_category: null, category_source: 'default' };
    expect(step(w)).toEqual({ step: 'resolve-category', candidate_ref: 'K' });
    expect(step({ ...w, komerce_category: 'vaisselle', category_source: 'manual' }))
      .toMatchObject({ verdict: 'SCREEN_MISSING_CANDIDATE_DECISION', fail: true });
    expect(step({ ...w, komerce_category: 'vaisselle', category_source: 'keyword' }).verdict)
      .toBe('SCREEN_MISSING_CANDIDATE_DECISION');
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

  test('V2 import: new supplier id (V1 candidate ignored), object name and supplier category given', () => {
    expect(G6_SUPPLIER_PRODUCT_ID).toBe('G6-CENTRAL-KM-V2');
    expect(G6_PREFIX).toBe('[G6-HUB] ');
    const src = fs.readFileSync('scripts/recette/g6-central-hub-product-chromium.js', 'utf8');
    expect(src).toMatch(/Screwdriver set/);
    expect(src).toMatch(/Tools > Hand Tools/);
  });
});
