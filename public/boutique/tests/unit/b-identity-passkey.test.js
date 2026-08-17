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
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '';
  state.user = null;
  state.customer = null;
  state.client = null;
  state.profile = null;
  delete window.K;
  jest.clearAllMocks();
});

describe('AUTH-4 — requireIdentity passkey-first', () => {
  it('ne sollicite pas Passkey si une session/identité est déjà restaurée', async () => {
    state.user = { id: 1, full_name: 'Déjà connecté', phone: '+33612345678' };
    const user = await requireIdentity({ reason: 'commande' });
    expect(user.full_name).toBe('Déjà connecté');
    expect(openPasskeyLogin).not.toHaveBeenCalled();
  });

  it('accepte la Passkey comme chemin nominal sans ouvrir la modale OTP', async () => {
    const passkeyUser = {
      id: 42,
      full_name: 'Sam Passkey',
      phone: '+33612345678',
      role: 'client',
      relais_id: 7,
    };
    openPasskeyLogin.mockResolvedValue({ outcome: 'authenticated', user: passkeyUser });
    const eventSpy = jest.fn();
    window.addEventListener('komerce:identity-authenticated', eventSpy, { once: true });

    const user = await requireIdentity({ reason: 'commande' });

    expect(openPasskeyLogin).toHaveBeenCalledWith(expect.objectContaining({ reason: 'commande' }));
    expect(user.phone).toBe('+33612345678');
    expect(state.user.full_name).toBe('Sam Passkey');
    expect(document.querySelector('.k-id-overlay')).toBeNull();
    expect(eventSpy).toHaveBeenCalledTimes(1);
    const event = eventSpy.mock.calls[0][0];
    expect(event.detail.method).toBe('passkey');
    expect(event.detail.user.id).toBe(42);
  });

  it('ouvre OTP uniquement après choix explicite du fallback WhatsApp', async () => {
    openPasskeyLogin.mockResolvedValue({ outcome: 'fallback' });
    const promise = requireIdentity({ reason: 'commande' });
    await flush();

    expect(openPasskeyLogin).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.k-id-overlay')).not.toBeNull();
    document.querySelector('.k-id-close').click();
    await expect(promise).resolves.toBeNull();
  });

  it('une fermeture du gate Passkey annule la demande sans déclencher OTP', async () => {
    openPasskeyLogin.mockResolvedValue({ outcome: 'cancelled' });
    await expect(requireIdentity({ reason: 'commande' })).resolves.toBeNull();
    expect(document.querySelector('.k-id-overlay')).toBeNull();
  });
});
