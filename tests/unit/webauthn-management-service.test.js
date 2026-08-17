'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Couverture structurelle dédiée de services/webauthn-management-service.js.
 * Vérifie les propriétés SQL de visibilité et d'idempotence qui complètent
 * les tests de route AUTH-6 existants.
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
const management = require('../../services/webauthn-management-service');

describe('webauthn-management-service — invariants SQL', () => {
  beforeEach(() => jest.clearAllMocks());

  it('liste seulement les credentials actifs, ordonnés par dernière utilisation puis création', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: '11111111-1111-4111-8111-111111111111',
      device_label: null,
      created_at: '2026-08-01T10:00:00Z',
      last_used_at: null,
      backup_eligible: 0,
      backup_state: 1,
    }] });

    const rows = await management.listCredentials('user-A');

    expect(mockQuery.mock.calls[0][0]).toMatch(/revoked_at IS NULL/i);
    expect(mockQuery.mock.calls[0][0]).toMatch(/ORDER BY COALESCE\(last_used_at, created_at\) DESC, created_at DESC/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-A']);
    expect(rows).toEqual([{
      id: '11111111-1111-4111-8111-111111111111',
      device_label: 'Passkey',
      created_at: '2026-08-01T10:00:00Z',
      last_used_at: null,
      backup_eligible: false,
      backup_state: true,
    }]);
  });

  it('révocation : reste idempotente et scellée à la paire credential/user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: '11111111-1111-4111-8111-111111111111',
      revoked_at: '2026-08-17T08:00:00Z',
    }] });

    const result = await management.revokeCredential({
      userId: 'user-A',
      credentialManagementId: '11111111-1111-4111-8111-111111111111',
    });

    expect(mockQuery.mock.calls[0][0]).toMatch(/SET revoked_at = COALESCE\(revoked_at, NOW\(\)\)/i);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE id = \$1\s+AND user_id = \$2/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['11111111-1111-4111-8111-111111111111', 'user-A']);
    expect(result).toEqual({
      revoked: true,
      id: '11111111-1111-4111-8111-111111111111',
      revoked_at: '2026-08-17T08:00:00Z',
    });
  });
});
