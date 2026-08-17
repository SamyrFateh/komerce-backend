'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  MAX_SESSION_TTL_SECONDS,
  resolveSessionTtlSeconds,
  resolveSessionTtlMs,
} = require('../../utils/auth-session-policy');

describe('AUTH-8d bounded session TTL', () => {
  it('utilise 7 jours par défaut', () => {
    expect(resolveSessionTtlSeconds(undefined)).toBe(7 * 24 * 60 * 60);
    expect(resolveSessionTtlMs(undefined)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it.each([
    ['15m', 15 * 60],
    ['12h', 12 * 60 * 60],
    ['3d', 3 * 24 * 60 * 60],
    ['90s', 90],
  ])('accepte une durée plus courte %s', (value, expected) => {
    expect(resolveSessionTtlSeconds(value)).toBe(expected);
  });

  it.each(['8d', '30d', '100d'])('plafonne %s à 7 jours', value => {
    expect(resolveSessionTtlSeconds(value)).toBe(MAX_SESSION_TTL_SECONDS);
  });

  it('plafonne aussi un override numérique', () => {
    expect(resolveSessionTtlSeconds(30 * 24 * 60 * 60)).toBe(MAX_SESSION_TTL_SECONDS);
  });

  it.each(['', 'abc', '0d', '-1d', '7days'])('une valeur invalide revient au plafond sûr', value => {
    expect(resolveSessionTtlSeconds(value)).toBe(MAX_SESSION_TTL_SECONDS);
  });
});
