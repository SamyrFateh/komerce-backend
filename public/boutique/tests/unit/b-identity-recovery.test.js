'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../js/b-passkey-login.js', () => ({
  openPasskeyLogin: jest.fn(),
}));

jest.mock('../../js/b-utils.js', () => ({
  ...jest.requireActual('../../js/b-utils.js'),
  showToast: jest.fn(),
}));

const { state } = require('../../js/b-store.js');
const { openPasskeyLogin } = require('../../js/b-passkey-login.js');
const { requireIdentity } = require('../../js/b-identity.js');

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function response(ok, body, status = ok ? 200 : 400) {
  return Promise.resolve({ ok, status, json: jest.fn().mockResolvedValue(body) });
}

function fillOtp(code) {
  const boxes = document.querySelectorAll('.k-id-otp-box');
  [...code].forEach((digit, index) => {
    boxes[index].value = digit;
    boxes[index].dispatchEvent(new Event('input'));
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  state.user = null;
  state.customer = null;
  state.client = null;
  state.profile = null;
  delete window.K;
  global.fetch = jest.fn();
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('AUTH-5 — recovery = téléphone -> OTP -> nouvelle Passkey', () => {
  it('un état recovery ouvre explicitement le parcours OTP, jamais une session locale directe', async () => {
    openPasskeyLogin.mockResolvedValue({ outcome: 'recovery', reason: 'passkey_unusable' });

    const promise = requireIdentity({ reason: 'commande' });
    await flush();

    expect(document.getElementById('k-id-title').textContent).toBe('Récupérer votre compte');
    expect(document.getElementById('k-id-step-phone').hidden).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(state.user).toBeNull();

    document.querySelector('.k-id-close').click();
    await expect(promise).resolves.toBeNull();
  });

  it('après OTP recovery réussi, l’événement porte purpose=recovery pour déclencher le ré-enrôlement', async () => {
    openPasskeyLogin.mockResolvedValue({ outcome: 'recovery', reason: 'passkey_unusable' });
    global.fetch
      .mockImplementationOnce(() => response(true, { success: true }))
      .mockImplementationOnce(() => response(true, {
        success: true,
        user: { id: 42, full_name: 'Compte récupéré', phone: '+33612345678', role: 'client' },
      }));

    const authEvent = jest.fn();
    window.addEventListener('komerce:identity-authenticated', authEvent, { once: true });

    const identityPromise = requireIdentity({ reason: 'commande' });
    await flush();

    document.getElementById('k-id-name').value = 'Compte';
    document.getElementById('k-id-name').dispatchEvent(new Event('input'));
    document.getElementById('k-id-lastname').value = 'Récupéré';
    document.getElementById('k-id-lastname').dispatchEvent(new Event('input'));
    document.getElementById('k-id-phone').value = '612345678';
    document.getElementById('k-id-phone').dispatchEvent(new Event('input'));
    document.getElementById('k-id-phone-cta').click();
    await flush();

    expect(global.fetch.mock.calls[0][0]).toBe('/api/auth/otp/request');
    expect(document.getElementById('k-id-step-otp').hidden).toBe(false);

    fillOtp('123456');
    document.getElementById('k-id-otp-cta').click();
    const user = await identityPromise;
    await flush();

    expect(global.fetch.mock.calls[1][0]).toBe('/api/auth/otp/verify');
    expect(user.id).toBe(42);
    expect(state.user.id).toBe(42);
    expect(authEvent).toHaveBeenCalledTimes(1);
    expect(authEvent.mock.calls[0][0].detail).toEqual(expect.objectContaining({
      method: 'otp',
      purpose: 'recovery',
      user: expect.objectContaining({ id: 42 }),
    }));
  });
});
