'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockApiGet = jest.fn();
const mockApiDelete = jest.fn();
jest.mock('../../js/b-utils.js', () => ({ apiGet: mockApiGet, apiDelete: mockApiDelete }));

const { loadPasskeySecurity } = require('../../js/b-passkey-security.js');

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="security"></div>';
  jest.clearAllMocks();
  window.confirm = jest.fn().mockReturnValue(true);
});

describe('AUTH-6 — moyens de connexion', () => {
  it('affiche label + dernière utilisation à partir de métadonnées sûres', async () => {
    mockApiGet.mockResolvedValue({ credentials: [{
      id: '11111111-1111-4111-8111-111111111111',
      device_label: 'Passkey iPhone',
      created_at: '2026-08-01T10:00:00Z',
      last_used_at: '2026-08-16T10:00:00Z',
      backup_eligible: true,
      backup_state: true,
    }] });
    const container = document.getElementById('security');
    await loadPasskeySecurity(container);

    expect(mockApiGet).toHaveBeenCalledWith('/api/auth/passkey/credentials');
    expect(container.textContent).toContain('Passkey iPhone');
    expect(container.textContent).toContain('Dernière utilisation');
    expect(container.textContent).toContain('Synchronisée');
    expect(container.textContent).not.toMatch(/public_key|credential_id|sign_count/i);
    expect(container.querySelector('[data-credential-id]')?.dataset.credentialId)
      .toBe('11111111-1111-4111-8111-111111111111');
  });

  it('révoque par ID de gestion opaque puis retire la ligne', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    mockApiGet.mockResolvedValue({ credentials: [{
      id, device_label: 'Chrome Windows', created_at: '2026-08-01T10:00:00Z',
      last_used_at: null, backup_eligible: false, backup_state: false,
    }] });
    mockApiDelete.mockResolvedValue({ revoked: true, id });
    const container = document.getElementById('security');
    await loadPasskeySecurity(container);

    container.querySelector('button').click();
    await flush();

    expect(window.confirm).toHaveBeenCalled();
    expect(mockApiDelete).toHaveBeenCalledWith(`/api/auth/passkey/credentials/${id}`);
    expect(container.querySelector('[data-credential-id]')).toBeNull();
    expect(container.textContent).toContain('Aucune passkey active');
  });

  it('n’envoie aucune révocation si l’utilisateur annule la confirmation', async () => {
    window.confirm.mockReturnValue(false);
    mockApiGet.mockResolvedValue({ credentials: [{
      id: '11111111-1111-4111-8111-111111111111',
      device_label: 'iPhone', created_at: '2026-08-01T10:00:00Z',
      last_used_at: null, backup_eligible: false, backup_state: false,
    }] });
    const container = document.getElementById('security');
    await loadPasskeySecurity(container);
    container.querySelector('button').click();
    await flush();
    expect(mockApiDelete).not.toHaveBeenCalled();
  });
});
