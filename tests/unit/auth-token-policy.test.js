'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  SESSION_TOKEN_USE,
  sessionClaimsVerdict,
  isCanonicalSessionClaims,
} = require('../../utils/auth-token-policy');

function canonical(overrides = {}) {
  return {
    id: 'user-1',
    jti: 'jti-1',
    auth_time: 1700000000,
    amr: ['passkey'],
    exp: 1800000000,
    token_use: SESSION_TOKEN_USE,
    ...overrides,
  };
}

describe('AUTH-8e canonical session token boundary', () => {
  it('accepte une session canonique', () => {
    expect(isCanonicalSessionClaims(canonical())).toBe(true);
  });

  it('tolère temporairement token_use absent pour une session AUTH-7/8 déjà émise', () => {
    const claims = canonical();
    delete claims.token_use;
    expect(sessionClaimsVerdict(claims)).toEqual({ ok: true, legacyTokenUse: true });
  });

  it('refuse catégoriquement un token scoped même signé', () => {
    expect(sessionClaimsVerdict(canonical({ scope: 'orders_read' }))).toEqual({
      ok: false,
      reason: 'scoped_token_not_session',
    });
  });

  it('refuse un token_use non-session', () => {
    expect(sessionClaimsVerdict(canonical({ token_use: 'api' }))).toEqual({
      ok: false,
      reason: 'token_use_not_session',
    });
  });

  it.each([
    ['jti', null, 'jti_missing'],
    ['auth_time', null, 'auth_time_missing'],
    ['amr', [], 'amr_missing'],
    ['exp', null, 'exp_missing'],
  ])('refuse une pseudo-session sans claim canonique %s', (field, value, reason) => {
    expect(sessionClaimsVerdict(canonical({ [field]: value }))).toEqual({ ok: false, reason });
  });
});
