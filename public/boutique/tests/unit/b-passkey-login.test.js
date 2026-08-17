'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  isPasskeyLoginSupported,
  parseRequestOptions,
  serializeAuthenticationCredential,
  openPasskeyLogin,
} = require('../../js/b-passkey-login.js');

function response(ok, body, status = ok ? 200 : 400) {
  return { ok, status, json: jest.fn().mockResolvedValue(body) };
}

async function flush() {
  // fetch() -> response.json() -> fetchJson() -> caller .then()/await :
  // vider toute la chaîne de microtasks sans dépendre d'un timer réel.
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function installWebAuthn({ parse = null, get = null } = {}) {
  const PublicKeyCredential = function PublicKeyCredential() {};
  if (parse) PublicKeyCredential.parseRequestOptionsFromJSON = parse;
  Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: PublicKeyCredential });
  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    value: { get: get || jest.fn() },
  });
}

function removeWebAuthn() {
  delete window.PublicKeyCredential;
  Object.defineProperty(window.navigator, 'credentials', { configurable: true, value: undefined });
}

beforeEach(() => {
  document.body.innerHTML = '';
  global.fetch = jest.fn();
  removeWebAuthn();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('AUTH-4 — WebAuthn request helpers', () => {
  it('utilise parseRequestOptionsFromJSON quand disponible', () => {
    const parsed = { challenge: new Uint8Array([1]) };
    const parse = jest.fn().mockReturnValue(parsed);
    installWebAuthn({ parse });
    const input = { challenge: 'AQ', allowCredentials: [] };
    expect(parseRequestOptions(input)).toBe(parsed);
    expect(parse).toHaveBeenCalledWith(input);
  });

  it('convertit challenge et allowCredentials en fallback', () => {
    installWebAuthn();
    const result = parseRequestOptions({
      challenge: 'AQID',
      rpId: 'komerce.co',
      allowCredentials: [{ id: 'BAUG', type: 'public-key' }],
    });
    expect(Array.from(result.challenge)).toEqual([1, 2, 3]);
    expect(Array.from(result.allowCredentials[0].id)).toEqual([4, 5, 6]);
  });

  it('préfère credential.toJSON()', () => {
    const json = { id: 'cred-login', response: { signature: 'sig' } };
    const credential = { toJSON: jest.fn().mockReturnValue(json) };
    expect(serializeAuthenticationCredential(credential)).toBe(json);
  });
});

describe('AUTH-4 — login Passkey nominal', () => {
  it('retombe immédiatement sur WhatsApp si WebAuthn est indisponible', async () => {
    expect(isPasskeyLoginSupported()).toBe(false);
    await expect(openPasskeyLogin()).resolves.toEqual({ outcome: 'fallback' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('demande des options discoverable sans numéro et attend un geste utilisateur', async () => {
    const get = jest.fn();
    installWebAuthn({ get });
    global.fetch.mockResolvedValueOnce(response(true, {
      challenge: 'AQID', rpId: 'komerce.co', allowCredentials: [], userVerification: 'required',
    }));

    const promise = openPasskeyLogin({ reason: 'commande' });
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/auth/passkey/login/options');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({});
    expect(get).not.toHaveBeenCalled();
    expect(document.getElementById('k-passkey-login-cta').disabled).toBe(false);

    document.getElementById('k-passkey-login-whatsapp').click();
    jest.advanceTimersByTime(160);
    await expect(promise).resolves.toEqual({ outcome: 'fallback' });
  });

  it('fait options -> authenticator -> verify -> identité hydratée', async () => {
    const parsed = { challenge: new Uint8Array([1]), rpId: 'komerce.co' };
    const parse = jest.fn().mockReturnValue(parsed);
    const credentialJson = {
      id: 'cred-login', rawId: 'Y3JlZA', type: 'public-key',
      response: { clientDataJSON: 'Yw', authenticatorData: 'YQ', signature: 'cw' },
    };
    const get = jest.fn().mockResolvedValue({ toJSON: () => credentialJson });
    installWebAuthn({ parse, get });

    const user = { id: 42, full_name: 'Sam Test', phone: '+33612345678', role: 'client', relais_id: 3 };
    global.fetch
      .mockResolvedValueOnce(response(true, {
        challenge: 'AQID', rpId: 'komerce.co', allowCredentials: [], userVerification: 'required',
      }))
      .mockResolvedValueOnce(response(true, { verified: true, user }));

    const promise = openPasskeyLogin();
    await flush();
    document.getElementById('k-passkey-login-cta').click();
    await flush();
    jest.advanceTimersByTime(160);

    expect(parse).toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith({ publicKey: parsed });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toBe('/api/auth/passkey/login/verify');
    expect(global.fetch.mock.calls[1][1].credentials).toBe('include');
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).id).toBe('cred-login');
    await expect(promise).resolves.toEqual({ outcome: 'authenticated', user });
  });

  it('une annulation authenticator garde le fallback WhatsApp disponible', async () => {
    const err = Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
    const get = jest.fn().mockRejectedValue(err);
    installWebAuthn({ get });
    global.fetch.mockResolvedValueOnce(response(true, {
      challenge: 'AQID', rpId: 'komerce.co', allowCredentials: [], userVerification: 'required',
    }));

    const promise = openPasskeyLogin();
    await flush();
    document.getElementById('k-passkey-login-cta').click();
    await flush();

    expect(document.getElementById('k-passkey-login-error').textContent).toContain('annulée');
    expect(document.getElementById('k-passkey-login-cta').textContent).toBe('Réessayer');
    expect(document.getElementById('k-passkey-login-whatsapp')).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    document.getElementById('k-passkey-login-whatsapp').click();
    jest.advanceTimersByTime(160);
    await expect(promise).resolves.toEqual({ outcome: 'fallback' });
  });

  it('une credential révoquée/refusée dirige vers recovery WhatsApp sans créer de session JS', async () => {
    const get = jest.fn().mockResolvedValue({
      toJSON: () => ({ id: 'revoked', type: 'public-key', response: {} }),
    });
    installWebAuthn({ get });
    global.fetch
      .mockResolvedValueOnce(response(true, { challenge: 'AQID', rpId: 'komerce.co', allowCredentials: [] }))
      .mockResolvedValueOnce(response(false, { error: 'Authentification refusée', reason: 'credential_revoked' }, 401));

    const promise = openPasskeyLogin();
    await flush();
    document.getElementById('k-passkey-login-cta').click();
    await flush();

    expect(document.getElementById('k-passkey-login-error').textContent).toContain('récupérer votre compte');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    document.getElementById('k-passkey-login-whatsapp').click();
    jest.advanceTimersByTime(160);
    await expect(promise).resolves.toEqual({ outcome: 'fallback' });
  });
});
