'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/reference.test.js
 *
 * Tests de utils/reference.js — générateurs de références/codes uniques.
 *
 * Couverture :
 *   ✓ generateOrderRef    : format KOM-YYYY-NNNNNN via séquence DB mockée
 *   ✓ generateShipmentRef : format EXP-YYYY-NNNN via séquence DB mockée
 *   ✓ generateParcelRef   : format KOM-P-YYYY-NNNNNN via séquence DB mockée
 *   ✓ generateCashCode    : 6 chiffres, dans la plage crypto.randomInt
 *   ✓ generateBasketCode  : format K-XXXX, alphabet restreint sans ambiguïté
 */

const {
  generateOrderRef,
  generateCashCode,
  generateBasketCode,
  generateShipmentRef,
  generateParcelRef,
} = require('../../utils/reference');

const currentYear = new Date().getFullYear();

function mockDb(seq) {
  return { query: jest.fn().mockResolvedValue({ rows: [{ seq }] }) };
}

describe('generateOrderRef', () => {
  it('retourne KOM-<année>-<seq paddée à 6> à partir de order_ref_seq', async () => {
    const db = mockDb(42);
    const ref = await generateOrderRef(db);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('order_ref_seq'));
    expect(ref).toBe(`KOM-${currentYear}-000042`);
  });

  it('gère une séquence déjà large (pas de troncature)', async () => {
    const db = mockDb(1234567);
    const ref = await generateOrderRef(db);

    expect(ref).toBe(`KOM-${currentYear}-1234567`);
  });
});

describe('generateShipmentRef', () => {
  it('retourne EXP-<année>-<seq paddée à 4> à partir de shipment_ref_seq', async () => {
    const db = mockDb(7);
    const ref = await generateShipmentRef(db);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('shipment_ref_seq'));
    expect(ref).toBe(`EXP-${currentYear}-0007`);
  });
});

describe('generateParcelRef', () => {
  it('retourne KOM-P-<année>-<seq paddée à 6> à partir de parcel_ref_seq', async () => {
    const db = mockDb(123);
    const ref = await generateParcelRef(db);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('parcel_ref_seq'));
    expect(ref).toBe(`KOM-P-${currentYear}-000123`);
  });
});

describe('generateCashCode', () => {
  it('génère un code à 6 chiffres', () => {
    const code = generateCashCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('reste dans la plage [100000, 999999] sur plusieurs tirages', () => {
    for (let i = 0; i < 50; i++) {
      const n = Number(generateCashCode());
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });
});

describe('generateBasketCode', () => {
  it('génère un code au format K-XXXX (4 caractères après le tiret)', () => {
    const code = generateBasketCode();
    expect(code).toMatch(/^K-[A-Z0-9]{4}$/);
  });

  it("n'utilise jamais de caractères ambigus (0, 1, O, I exclus de l'alphabet)", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateBasketCode();
      const suffix = code.slice(2);
      expect(suffix).not.toMatch(/[01OI]/);
    }
  });
});
