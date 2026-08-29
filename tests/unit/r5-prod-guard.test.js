'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * R5 ? fail-closed sur l'environnement d?clar?.
 *
 * BASE_URL et le domaine ne d?terminent jamais l'environnement.
 * Les mutations sont autoris?es uniquement sur test ou staging.
 */

const {
  assertDeclaredMutantTargetSafe,
} = require('../../public/boutique/tests/e2e/helpers/environment.helpers');

describe('[R5] fail-closed ? environnement mutant explicite', () => {
  test('refuse KOMERCE_ENV absent', () => {
    expect(() =>
      assertDeclaredMutantTargetSafe({})
    ).toThrow(/FAIL-CLOSED.*KOMERCE_ENV absent/);
  });

  test('refuse production', () => {
    expect(() =>
      assertDeclaredMutantTargetSafe({ KOMERCE_ENV: 'production' })
    ).toThrow(/FAIL-CLOSED.*production/);
  });

  test('refuse development', () => {
    expect(() =>
      assertDeclaredMutantTargetSafe({ KOMERCE_ENV: 'development' })
    ).toThrow(/FAIL-CLOSED.*development/);
  });

  test('refuse une valeur inconnue', () => {
    expect(() =>
      assertDeclaredMutantTargetSafe({ KOMERCE_ENV: 'banana' })
    ).toThrow(/FAIL-CLOSED.*inconnu/);
  });

  test('autorise test', () => {
    expect(
      assertDeclaredMutantTargetSafe({ KOMERCE_ENV: 'test' })
    ).toBe('test');
  });

  test('autorise staging', () => {
    expect(
      assertDeclaredMutantTargetSafe({ KOMERCE_ENV: 'staging' })
    ).toBe('staging');
  });
});
