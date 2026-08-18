'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../js/b-identity.js', () => ({
  getCurrentIdentity: jest.fn(),
  openIdentityModal: jest.fn(),
}));

const { getCurrentIdentity, openIdentityModal } = require('../../js/b-identity.js');
const {
  isStepUpRequiredError,
  performPasskeyStepUp,
  withStepUpRetry,
} = require('../../js/b-passkey-step-up.js');

function response(ok, body, status = ok ? 200 : 400) {
  return { ok, status, json: jest.fn().mockResolvedValue(body) };
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
  jest.clearAllMocks();
  getCurrentIdentity.mockReturnValue({ id: 42, phone: '+33612345678' });
  openIdentityModal.mockResolvedValue({ id: 42, phone: '+33612345678' });
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

  it('rejoue une mutation sensible une seule fois après un step-up Passkey réussi', async () => {
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
    expect(openIdentityModal).not.toHaveBeenCalled();
  });

  it('utilise OTP si aucune Passkey step-up n’est disponible, accomplit l’opération puis signale l’offre facultative', async () => {
    installWebAuthn(jest.fn());
    global.fetch.mockResolvedValueOnce(response(false, { code: 'passkey_step_up_unavailable' }, 409));
    const err = Object.assign(new Error('recent auth'), { status: 428, code: 'step_up_required' });
    const operation = jest.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ ok: true });
    const completed = jest.fn();
    window.addEventListener('komerce:sensitive-operation-confirmed', completed, { once: true });

    await expect(withStepUpRetry(operation, {
      reason: 'voir le code secret de retrait',
      title: 'Confirmer avec WhatsApp',
    })).resolves.toEqual({ ok: true });

    expect(openIdentityModal).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+33612345678',
      purpose: 'sensitive-step-up',
    }));
    expect(operation).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0][0].detail).toEqual(expect.objectContaining({
      method: 'otp',
      sensitive: true,
      completed: true,
      reason: 'voir le code secret de retrait',
    }));
  });

  it('ne propose jamais la Passkey avant que l’opération sensible ait réellement réussi', async () => {
    installWebAuthn(jest.fn());
    global.fetch.mockResolvedValueOnce(response(false, { code: 'passkey_step_up_unavailable' }, 409));
    const stepUpRequired = Object.assign(new Error('recent auth'), { status: 428, code: 'step_up_required' });
    const finalFailure = Object.assign(new Error('business failure'), { status: 409, code: 'business_failure' });
    const operation = jest.fn()
      .mockRejectedValueOnce(stepUpRequired)
      .mockRejectedValueOnce(finalFailure);
    const completed = jest.fn();
    window.addEventListener('komerce:sensitive-operation-confirmed', completed, { once: true });

    await expect(withStepUpRetry(operation)).rejects.toBe(finalFailure);
    expect(openIdentityModal).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(completed).not.toHaveBeenCalled();
  });

  it('une révocation peut interdire explicitement toute reproposition Passkey après OTP', async () => {
    installWebAuthn(jest.fn());
    global.fetch.mockResolvedValueOnce(response(false, { code: 'passkey_step_up_unavailable' }, 409));
    const err = Object.assign(new Error('recent auth'), { status: 428, code: 'step_up_required' });
    const operation = jest.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ ok: true });
    const completed = jest.fn();
    window.addEventListener('komerce:sensitive-operation-confirmed', completed, { once: true });

    await expect(withStepUpRetry(operation, { offerEnrollmentAfterOtp: false })).resolves.toEqual({ ok: true });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(completed).not.toHaveBeenCalled();
  });

  it('une annulation OTP annule l’opération sans retry', async () => {
    installWebAuthn(jest.fn());
    global.fetch.mockResolvedValueOnce(response(false, { code: 'passkey_step_up_unavailable' }, 409));
    openIdentityModal.mockResolvedValueOnce(null);
    const err = Object.assign(new Error('recent auth'), { status: 428, code: 'step_up_required' });
    const operation = jest.fn().mockRejectedValue(err);

    await expect(withStepUpRetry(operation)).rejects.toEqual(expect.objectContaining({
      code: 'step_up_cancelled',
    }));
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
