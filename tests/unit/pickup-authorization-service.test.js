'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/pickup-authorization-service.js (Lot 5)
 *
 * Couvre :
 *   getMyAuthorization              — NONE / ACTIVE
 *   setMyAuthorization              — validation, création, remplacement,
 *                                     incrément de version, audit
 *   deleteMyAuthorization           — désactivation, idempotence, audit
 *   getActiveAuthorizationForUpdate — dbClient requis, verrouillage, absence
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockCreateAlert = jest.fn(() => Promise.resolve());
jest.mock('../../utils/alerts', () => ({
  createAlert: (...args) => mockCreateAlert(...args),
}));

const {
  getMyAuthorization,
  setMyAuthorization,
  deleteMyAuthorization,
  getActiveAuthorizationForUpdate,
  hasActiveAuthorization,
} = require('../../services/pickup-authorization-service');

beforeEach(() => {
  jest.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════
// getMyAuthorization
// ══════════════════════════════════════════════════════════════════════════

describe('getMyAuthorization', () => {
  it('aucune ligne → NONE', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getMyAuthorization('u1');
    expect(result.body).toEqual({ status: 'NONE' });
  });

  it('ligne existante mais is_active=false → NONE', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ is_active: false }] });
    const result = await getMyAuthorization('u1');
    expect(result.body).toEqual({ status: 'NONE' });
  });

  it('ligne active → ACTIVE avec les champs attendus', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        is_active: true,
        authorized_given_names: 'Fatima',
        authorized_family_name: 'Said',
        version: 3,
        updated_at: '2026-07-01T00:00:00Z',
      }],
    });
    const result = await getMyAuthorization('u1');
    expect(result.body).toEqual({
      status: 'ACTIVE',
      given_names: 'Fatima',
      family_name: 'Said',
      version: 3,
      updated_at: '2026-07-01T00:00:00Z',
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// setMyAuthorization
// ══════════════════════════════════════════════════════════════════════════

describe('setMyAuthorization', () => {
  it('rejette les champs vides', async () => {
    const result = await setMyAuthorization({ userId: 'u1', givenNames: '', familyName: 'Said' });
    expect(result.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejette les champs uniquement composés d\'espaces', async () => {
    const result = await setMyAuthorization({ userId: 'u1', givenNames: '   ', familyName: 'Said' });
    expect(result.status).toBe(400);
  });

  it('rejette les valeurs trop longues', async () => {
    const result = await setMyAuthorization({
      userId: 'u1', givenNames: 'a'.repeat(101), familyName: 'Said',
    });
    expect(result.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('création (version=1) → audit PICKUP_AUTHORIZATION_CREATED', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ version: 1, updated_at: 't1' }] });
    const result = await setMyAuthorization({ userId: 'u1', givenNames: 'Fatima', familyName: 'Said' });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: 'ACTIVE', given_names: 'Fatima', family_name: 'Said', version: 1, updated_at: 't1',
    });
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'PICKUP_AUTHORIZATION_CREATED',
      entityId: 'u1',
    }));
    // Jamais le nom en clair dans l'audit.
    const alertArg = mockCreateAlert.mock.calls[0][1];
    expect(alertArg.description).not.toMatch(/Fatima|Said/);
  });

  it('remplacement (version>1) → audit PICKUP_AUTHORIZATION_UPDATED', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ version: 2, updated_at: 't2' }] });
    await setMyAuthorization({ userId: 'u1', givenNames: 'Nouveau', familyName: 'Nom' });

    expect(mockCreateAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'PICKUP_AUTHORIZATION_UPDATED',
    }));
  });

  it('normalise avant stockage (query reçoit les champs normalisés en 4e/5e position)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ version: 1, updated_at: 't1' }] });
    await setMyAuthorization({ userId: 'u1', givenNames: '  ÉLÉONORE  ', familyName: 'Bacar' });

    const params = mockQuery.mock.calls[0][1];
    expect(params[1]).toBe('ÉLÉONORE'); // valeur saisie conservée telle quelle
    expect(params[3]).toBe('eleonore'); // normalisée
  });

  it('poursuit même si createAlert échoue (best-effort, non bloquant)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ version: 1, updated_at: 't1' }] });
    mockCreateAlert.mockRejectedValueOnce(new Error('db down'));
    const result = await setMyAuthorization({ userId: 'u1', givenNames: 'Fatima', familyName: 'Said' });
    expect(result.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// deleteMyAuthorization
// ══════════════════════════════════════════════════════════════════════════

describe('deleteMyAuthorization', () => {
  it('désactive et audite quand une ligne active existait', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ version: 4 }] });
    const result = await deleteMyAuthorization('u1');

    expect(result.body).toEqual({ status: 'NONE' });
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'PICKUP_AUTHORIZATION_REVOKED',
      entityId: 'u1',
    }));
  });

  it('idempotent : aucune ligne active → NONE sans erreur ni audit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await deleteMyAuthorization('u1');
    expect(result.body).toEqual({ status: 'NONE' });
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// getActiveAuthorizationForUpdate
// ══════════════════════════════════════════════════════════════════════════

describe('hasActiveAuthorization', () => {
  it('false si userId absent, sans requête DB', async () => {
    const result = await hasActiveAuthorization(null);
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('false si aucune ligne active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await hasActiveAuthorization('u1')).toBe(false);
  });

  it('true si une ligne active existe (ne révèle jamais le nom)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    expect(await hasActiveAuthorization('u1')).toBe(true);
    // La requête ne doit jamais sélectionner les colonnes nominatives.
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/authorized_given_names|authorized_family_name/);
  });
});

describe('getActiveAuthorizationForUpdate', () => {
  it('lève une erreur si dbClient absent (jamais de lecture non verrouillée)', async () => {
    await expect(getActiveAuthorizationForUpdate(null, 'u1')).rejects.toThrow(/dbClient requis/);
  });

  it('retourne null si userId absent', async () => {
    const client = { query: jest.fn() };
    const result = await getActiveAuthorizationForUpdate(client, null);
    expect(result).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('retourne null si aucune autorisation active', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    const result = await getActiveAuthorizationForUpdate(client, 'u1');
    expect(result).toBeNull();
  });

  it('pose bien FOR UPDATE et retourne les champs normalisés', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [{ normalized_given_names: 'fatima', normalized_family_name: 'said', version: 2 }],
      }),
    };
    const result = await getActiveAuthorizationForUpdate(client, 'u1');
    expect(client.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    expect(result).toEqual({ normalizedGivenNames: 'fatima', normalizedFamilyName: 'said', version: 2 });
  });
});
