'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  DEFAULT_MAX_AGE_SECONDS,
  recentAuthStatus,
  requireRecentAuth,
} = require('../../middleware/require-recent-auth');

function runMiddleware(auth) {
  const req = { auth };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = jest.fn();
  requireRecentAuth(req, res, next);
  return { res, next };
}

describe('AUTH-7 requireRecentAuth', () => {
  const now = 2_000_000_000;

  it.each(['otp', 'passkey'])('accepte une preuve %s récente', method => {
    expect(recentAuthStatus({ authTime: now - 60, amr: [method] }, now).ok).toBe(true);
  });

  it('refuse une vieille session sans auth_time', () => {
    const { res, next } = runMiddleware({ authTime: null, amr: [] });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(428);
    expect(res.body).toEqual(expect.objectContaining({
      code: 'step_up_required',
      reason: 'auth_time_missing',
      methods: ['passkey', 'otp'],
    }));
  });

  it.each(['password', 'magic_link', 'internal'])('refuse une preuve %s même récente', method => {
    const status = recentAuthStatus({ authTime: now - 10, amr: [method] }, now);
    expect(status).toEqual(expect.objectContaining({ ok: false, reason: 'strong_method_missing' }));
  });

  it('refuse une preuve OTP/Passkey trop ancienne', () => {
    const status = recentAuthStatus({
      authTime: now - DEFAULT_MAX_AGE_SECONDS - 1,
      amr: ['passkey'],
    }, now);
    expect(status).toEqual(expect.objectContaining({ ok: false, reason: 'auth_too_old' }));
  });

  it('refuse un auth_time anormalement dans le futur', () => {
    const status = recentAuthStatus({ authTime: now + 120, amr: ['otp'] }, now);
    expect(status).toEqual(expect.objectContaining({ ok: false, reason: 'auth_time_in_future' }));
  });

  it('appelle next uniquement pour une preuve forte et fraîche', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const { res, next } = runMiddleware({ authTime: nowSeconds, amr: ['passkey'] });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
