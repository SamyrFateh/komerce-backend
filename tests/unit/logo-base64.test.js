'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/logo-base64.test.js
 * Couvre utils/documents/logo-base64.js
 */
const { LOGO_KOMERCE_BASE64, LOGO_KOMERCE_DATA_URI } = require('../../utils/documents/logo-base64');

describe('LOGO_KOMERCE_BASE64', () => {
  it('est une chaine non-vide', () => {
    expect(typeof LOGO_KOMERCE_BASE64).toBe('string');
    expect(LOGO_KOMERCE_BASE64.length).toBeGreaterThan(0);
  });

  it('ne contient que des caracteres base64 valides', () => {
    expect(LOGO_KOMERCE_BASE64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('est decodable sans erreur et produit un buffer non-vide', () => {
    const buf = Buffer.from(LOGO_KOMERCE_BASE64, 'base64');
    expect(buf.length).toBeGreaterThan(0);
  });

  it('commence par la signature PNG une fois decodee', () => {
    const buf = Buffer.from(LOGO_KOMERCE_BASE64, 'base64');
    // Signature PNG : 89 50 4E 47 0D 0A 1A 0A
    expect(buf.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});

describe('LOGO_KOMERCE_DATA_URI', () => {
  it('commence par "data:image/"', () => {
    expect(LOGO_KOMERCE_DATA_URI.startsWith('data:image/')).toBe(true);
  });

  it('est au format data:image/png;base64,<...>', () => {
    expect(LOGO_KOMERCE_DATA_URI).toMatch(/^data:image\/png;base64,/);
  });

  it('contient bien LOGO_KOMERCE_BASE64 comme payload', () => {
    expect(LOGO_KOMERCE_DATA_URI).toBe(`data:image/png;base64,${LOGO_KOMERCE_BASE64}`);
  });

  it('est une chaine non-vide', () => {
    expect(typeof LOGO_KOMERCE_DATA_URI).toBe('string');
    expect(LOGO_KOMERCE_DATA_URI.length).toBeGreaterThan('data:image/png;base64,'.length);
  });
});
