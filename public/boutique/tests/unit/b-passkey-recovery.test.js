'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { openPasskeyLogin } = require('../../js/b-passkey-login.js');
const { offerPasskeyEnrollment } = require('../../js/b-passkey-enrollment.js');

const PASSKEY_HINT_KEY = 'komerce_passkey_available_v1';

function response(ok, body, status = ok ? 200 : 400) {
  return { ok, status, json: jest.fn().mockResolvedValue(body) };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function installWebAuthn({ get = null, create = null } = {}) {
  const PublicKeyCredential = function PublicKeyCredential() {};
  Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: PublicKeyCredential });
  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    value: {
      get: get || jest.fn(),
      create: create || jest.fn(),
    },
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  window.localStorage.clear();
  global.fetch = jest.fn();
  delete window.PublicKeyCredential;
  Object.defineProperty(window.navigator, 'credentials', { configurable: true, value: undefined });
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('AUTH-5 — entrée recovery depuis une Passkey inutilisable', () => {
  it('transforme un refus 401 en action explicite Récupérer avec WhatsApp', async () => {
    const get = jest.fn().mockResolvedValue({
      toJSON: () => ({ id: 'revoked', type: 'public-key', response: {} }),
    });
    installWebAuthn({ get });
    // Ce scénario teste une Passkey qui était connue/utilisable sur ce
    // navigateur avant d'être refusée par le serveur. Sans cet indice UX,
    // le produit doit désormais aller directement vers WhatsApp et ne monte
    // volontairement aucune UI Passkey.
    window.localStorage.setItem(PASSKEY_HINT_KEY, '1');
    global.fetch
      .mockResolvedValueOnce(response(true, {
        challenge: 'AQID', rpId: 'komerce.co', allowCredentials: [], userVerification: 'required',
      }))
      .mockResolvedValueOnce(response(false, {
        error: 'Authentification refusée', reason: 'credential_revoked',
      }, 401));

    const resultPromise = openPasskeyLogin();
    await flush();
    document.getElementById('k-passkey-login-cta').click();
    await flush();

    expect(document.getElementById('k-passkey-login-error').textContent).toContain('récupérer votre compte');
    expect(document.getElementById('k-passkey-login-whatsapp').textContent).toBe('Récupérer avec WhatsApp');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    document.getElementById('k-passkey-login-whatsapp').click();
    jest.advanceTimersByTime(160);
    await expect(resultPromise).resolves.toEqual({ outcome: 'recovery', reason: 'passkey_unusable' });
  });

  it('le recovery peut reproposer une nouvelle Passkey même si l’offre normale a déjà été vue', async () => {
    installWebAuthn();
    window.sessionStorage.setItem('komerce_passkey_offer_seen', '1');
    global.fetch.mockResolvedValueOnce(response(true, {
      challenge: 'AQID',
      rp: { id: 'komerce.co', name: 'Komerce' },
      user: { id: 'BAUG', name: '42', displayName: 'Compte récupéré' },
      excludeCredentials: [],
    }));

    await expect(offerPasskeyEnrollment({ purpose: 'recovery' })).resolves.toBe(true);
    await flush();

    expect(document.getElementById('k-passkey-title').textContent).toContain('nouvelle passkey');
    expect(document.getElementById('k-passkey-sub').textContent).toContain('récupéré');
    expect(document.getElementById('k-passkey-enable').textContent).toContain('Activer');

    document.getElementById('k-passkey-later').click();
    jest.advanceTimersByTime(160);
    expect(document.querySelector('.k-passkey-enroll-overlay')).toBeNull();
  });
});
