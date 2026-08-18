'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  base64urlToBytes,
  bytesToBase64url,
  parseCreationOptions,
  serializeRegistrationCredential,
  isPasskeySupported,
  offerPasskeyEnrollment,
  setupPasskeyEnrollment,
} = require('../../js/b-passkey-enrollment.js');

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function response(ok, body, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

function installWebAuthn({ parse = null, create = null } = {}) {
  const PublicKeyCredential = function PublicKeyCredential() {};
  if (parse) PublicKeyCredential.parseCreationOptionsFromJSON = parse;
  Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: PublicKeyCredential });
  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    value: { create: create || jest.fn() },
  });
}

function removeWebAuthn() {
  delete window.PublicKeyCredential;
  Object.defineProperty(window.navigator, 'credentials', { configurable: true, value: undefined });
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  window.localStorage.clear();
  global.fetch = jest.fn();
  removeWebAuthn();
  jest.useRealTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('encodage WebAuthn navigateur', () => {
  it('convertit base64url <-> bytes sans padding persistant', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
    const encoded = bytesToBase64url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Array.from(base64urlToBytes(encoded))).toEqual(Array.from(bytes));
  });

  it('utilise parseCreationOptionsFromJSON quand le navigateur le fournit', () => {
    const parsed = { challenge: new Uint8Array([1]) };
    const parse = jest.fn().mockReturnValue(parsed);
    installWebAuthn({ parse });
    const input = { challenge: 'AQ', user: { id: 'Ag' } };
    expect(parseCreationOptions(input)).toBe(parsed);
    expect(parse).toHaveBeenCalledWith(input);
  });

  it('convertit challenge, user.id et excludeCredentials en fallback', () => {
    installWebAuthn();
    const result = parseCreationOptions({
      challenge: 'AQID',
      rp: { id: 'komerce.co', name: 'Komerce' },
      user: { id: 'BAUG', name: 'u', displayName: 'U' },
      excludeCredentials: [{ id: 'BwgJ', type: 'public-key' }],
    });
    expect(Array.from(result.challenge)).toEqual([1, 2, 3]);
    expect(Array.from(result.user.id)).toEqual([4, 5, 6]);
    expect(Array.from(result.excludeCredentials[0].id)).toEqual([7, 8, 9]);
  });

  it('préfère credential.toJSON() et ne réimplémente pas la crypto', () => {
    const json = { id: 'cred-1', type: 'public-key', response: { clientDataJSON: 'a', attestationObject: 'b' } };
    const credential = { toJSON: jest.fn().mockReturnValue(json) };
    expect(serializeRegistrationCredential(credential)).toBe(json);
    expect(credential.toJSON).toHaveBeenCalledTimes(1);
  });
});

describe('enrôlement Passkey contextuel', () => {
  it('est totalement inerte sur un navigateur sans WebAuthn', async () => {
    expect(isPasskeySupported()).toBe(false);
    await expect(offerPasskeyEnrollment()).resolves.toBe(false);
    expect(document.querySelector('.k-passkey-enroll-overlay')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('affiche un opt-in explicite et Plus tard sans lancer WebAuthn automatiquement', async () => {
    const create = jest.fn();
    installWebAuthn({ create });
    global.fetch.mockResolvedValueOnce(response(true, {
      challenge: 'AQID',
      rp: { id: 'komerce.co', name: 'Komerce' },
      user: { id: 'BAUG', name: '1', displayName: 'Client' },
      excludeCredentials: [],
    }));

    await expect(offerPasskeyEnrollment()).resolves.toBe(true);
    await flush();

    expect(document.getElementById('k-passkey-title').textContent).toContain('prochaine fois');
    expect(document.getElementById('k-passkey-sub').textContent).toContain('opérations sensibles');
    expect(document.getElementById('k-passkey-enable')).not.toBeNull();
    expect(document.getElementById('k-passkey-later')).not.toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/auth/passkey/register/options');
    expect(global.fetch.mock.calls[0][1].credentials).toBe('include');

    // Le seul stockage client introduit est un flag UX non secret de session.
    expect(window.sessionStorage.getItem('komerce_passkey_offer_seen')).toBe('1');
    expect(window.localStorage.length).toBe(0);
  });

  it('enrôle via options serveur -> WebAuthn -> verify serveur', async () => {
    const parsed = { challenge: new Uint8Array([1]), rp: { id: 'komerce.co' } };
    const parse = jest.fn().mockReturnValue(parsed);
    const credentialJson = {
      id: 'cred-1',
      rawId: 'Y3JlZC0x',
      type: 'public-key',
      response: { clientDataJSON: 'Y2xpZW50', attestationObject: 'YXR0ZXN0' },
    };
    const credential = { toJSON: jest.fn().mockReturnValue(credentialJson) };
    const create = jest.fn().mockResolvedValue(credential);
    installWebAuthn({ parse, create });

    global.fetch
      .mockResolvedValueOnce(response(true, {
        challenge: 'AQID',
        rp: { id: 'komerce.co', name: 'Komerce' },
        user: { id: 'BAUG', name: '1', displayName: 'Client' },
        excludeCredentials: [],
      }))
      .mockResolvedValueOnce(response(true, { verified: true }));

    const enrolled = jest.fn();
    window.addEventListener('komerce:passkey-enrolled', enrolled, { once: true });

    await offerPasskeyEnrollment();
    await flush();
    const enable = document.getElementById('k-passkey-enable');
    expect(enable.disabled).toBe(false);
    expect(enable.textContent).toContain('Activer');

    enable.click();
    await flush();
    await flush();

    expect(parse).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ publicKey: parsed });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toBe('/api/auth/passkey/register/verify');
    const verifyRequest = global.fetch.mock.calls[1][1];
    expect(verifyRequest.credentials).toBe('include');
    const body = JSON.parse(verifyRequest.body);
    expect(body.id).toBe('cred-1');
    expect(body.deviceLabel).toMatch(/^Passkey /);
    expect(enrolled).toHaveBeenCalledTimes(1);
    expect(enable.textContent).toContain('activée');
  });

  it('une annulation du dialogue système ne touche pas à la session et permet de réessayer', async () => {
    const cancel = Object.assign(new Error('The operation was not allowed'), { name: 'NotAllowedError' });
    const create = jest.fn().mockRejectedValue(cancel);
    installWebAuthn({ create });
    global.fetch.mockResolvedValueOnce(response(true, {
      challenge: 'AQID',
      rp: { id: 'komerce.co', name: 'Komerce' },
      user: { id: 'BAUG', name: '1', displayName: 'Client' },
      excludeCredentials: [],
    }));

    await offerPasskeyEnrollment();
    await flush();
    document.getElementById('k-passkey-enable').click();
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(1); // aucun verify après annulation
    expect(document.getElementById('k-passkey-error').textContent).toContain('annulée');
    expect(document.getElementById('k-passkey-enable').disabled).toBe(false);
    expect(document.getElementById('k-passkey-enable').textContent).toBe('Réessayer');
  });

  it('Plus tard ferme seulement la proposition, sans appel WebAuthn', async () => {
    jest.useFakeTimers();
    const create = jest.fn();
    installWebAuthn({ create });
    global.fetch.mockResolvedValueOnce(response(true, {
      challenge: 'AQID',
      rp: { id: 'komerce.co', name: 'Komerce' },
      user: { id: 'BAUG', name: '1', displayName: 'Client' },
      excludeCredentials: [],
    }));

    await offerPasskeyEnrollment();
    await Promise.resolve();
    document.getElementById('k-passkey-later').click();
    jest.advanceTimersByTime(160);
    expect(document.querySelector('.k-passkey-enroll-overlay')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('setup ignore tout OTP d’identité simple et n’écoute que le succès post-OTP d’une opération sensible', async () => {
    jest.useFakeTimers();
    installWebAuthn();
    global.fetch.mockResolvedValue(response(true, {
      challenge: 'AQID',
      rp: { id: 'komerce.co', name: 'Komerce' },
      user: { id: 'BAUG', name: '1', displayName: 'Client' },
      excludeCredentials: [],
    }));

    setupPasskeyEnrollment();

    // Un OTP de partage/identification ne doit plus rien déclencher.
    window.dispatchEvent(new CustomEvent('komerce:identity-authenticated', {
      detail: { method: 'otp', purpose: 'authentication' },
    }));
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    expect(document.querySelector('.k-passkey-enroll-overlay')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();

    // Même un signal sensible incomplet ou validé par Passkey est ignoré.
    window.dispatchEvent(new CustomEvent('komerce:sensitive-operation-confirmed', {
      detail: { method: 'passkey', sensitive: true, completed: true },
    }));
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    expect(document.querySelector('.k-passkey-enroll-overlay')).toBeNull();

    const blocker = document.createElement('div');
    blocker.setAttribute('aria-modal', 'true');
    document.body.appendChild(blocker);

    window.dispatchEvent(new CustomEvent('komerce:sensitive-operation-confirmed', {
      detail: { method: 'otp', sensitive: true, completed: true },
    }));
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    expect(document.querySelector('.k-passkey-enroll-overlay')).toBeNull();

    blocker.remove();
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    expect(document.querySelector('.k-passkey-enroll-overlay')).not.toBeNull();
  });
});
