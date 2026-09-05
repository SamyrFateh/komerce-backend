'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  CODE_ALPHABET,
  CODE_LENGTH,
  generatePickupCode,
  hashCode,
  normalizeCode,
  maskLast4,
} = require('../../services/pickup-code-helpers');

describe('pickup-code-helpers', () => {
  test('génère un secret de 8 caractères sans alphabet ambigu', () => {
    const code = generatePickupCode();
    expect(CODE_LENGTH).toBe(8);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{2}$/);
    expect(CODE_ALPHABET).not.toMatch(/[0OI1l]/);
  });

  test('normalisation et hash ignorent présentation et casse', () => {
    expect(normalizeCode(' a7k-3m9-p2 ')).toBe('A7K3M9P2');
    expect(hashCode('a7k-3m9-p2', 'salt')).toBe(hashCode('A7K3M9P2', 'salt'));
  });

  test('masque uniquement le last4 et gère l’absence de secret', () => {
    expect(maskLast4('ABCD')).toBe('•••-•AB-CD');
    expect(maskLast4(null)).toBeNull();
  });
});
