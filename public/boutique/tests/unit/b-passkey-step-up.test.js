'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  isStepUpRequiredError,
  performPasskeyStepUp,
  withStepUpRetry,
} = require('../../js/b-passkey-step-up.js');

function response(ok, body, status = ok ? 200 : 400) {
  return { ok, status, json: jest.fn().mockResolvedValue(body) };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function installWebAuthn(get) {
  const PublicKeyCredential = function PublicKeyCredential() {};
  PublicKeyCredential.parseRequestOptionsFromJSON = jest.fn(options => ({ ...options, parsed: true }));
  Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: PublicKeyCredential });
  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    value: { get },
  });
}

beforeEach(() => {
  global.fetch = jest.fn();
  delete window.PublicKeyCredential;
  Object.defineProperty(window.navigator, 'credentials', { configurable: true, value: undefined });
});

describe('AUTH-7 — Passkey step-up client', () => {
  it('reconnaît uniquement le contrat 428 step_up_required', () => {
    expect(isStepUpRequiredError({ status: 428, code: 'step_up_required' })).toBe(true);
    expect(isStepUpRequiredError({ status: 401, code: 'step_up_required' })).toBe(false);
    expect(isStepUpRequiredError({ status: 428, code: 'other' })).toBe(false);
  });

  it('retourne reauth_required si le navigateur n’a pas de WebAuthn', async () => {
    await expect(performPasskeyStepUp()).resolves.toEqual({ outcome: 'reauth_required', method: 'otp' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fait options -> authenticator -> verify et ne change jamais d’identité côté client', async () => {
    const credential = { toJSON: () => ({ id: 'cred-A', type: 'public-key', response: {} }) };
    const get = jest.fn().mockResolvedValue(credential);
    installWebAuthn(get);
    global.fetch
      .mockResolvedValueOnce(response(true, { challenge: 'AQID', rpId: 'komerce.co', allowCredentials: [] }))
      .mockResolvedValueOnce(response(true, { verified: true }));

    await expect(performPasskeyStepUp()).resolves.toEqual({ outcome: 'stepped_up', method: 'passkey' });
    expect(global.fetch.mock.calls[0][0]).toBe('/api/auth/passkey/step-up/options');
    expect(global.fetch.mock.calls[1][0]).toBe('/api/auth/passkey/step-up/verify');
    expect(global.fetch.mock.calls[0][1].credentials).toBe('include');
    expect(global.fetch.mock.calls[1][1].credentials).toBe('include');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('rejoue une mutation sensible une seule fois après un step-up réussi', async () => {
    const credential = { toJSON: () => ({ id: 'cred-A', type: 'public-key', response: {} }) };
    installWebAuthn(jest.fn().mockResolvedValue(credential));
    global.fetch
      .mockResolvedValueOnce(response(true, { challenge: 'AQID', rpId: 'komerce.co', allowCredentials: [] }))
      .mockResolvedValueOnce(response(true, { verified: true }));

    const err = Object.assign(new Error('recent auth'), { status: 428, code: 'step_up_required' });
    const operation = jest.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ ok: true });

    await expect(withStepUpRetry(operation)).resolves.toEqual({ ok: true });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('ne rejoue pas une mutation si aucune Passkey step-up n’est disponible', async () => {
    installWebAuthn(jest.fn());
    global.fetch.mockResolvedValueOnce(response(false, { code: 'passkey_step_up_unavailable' }, 409));
    const err = Object.assign(new Error('recent auth'), { status: 428, code: 'step_up_required' });
    const operation = jest.fn().mockRejectedValue(err);

    await expect(withStepUpRetry(operation)).rejects.toEqual(expect.objectContaining({
      code: 'step_up_reauth_required',
    }));
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
