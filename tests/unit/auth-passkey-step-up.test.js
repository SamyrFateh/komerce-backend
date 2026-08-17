'use strict';

const mockGenerateAuthenticationOptions = jest.fn();
const mockVerifyAuthenticationResponse = jest.fn();
const mockQuery = jest.fn();

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: (...args) => mockGenerateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args) => mockVerifyAuthenticationResponse(...args),
}));
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const webauthn = require('../../services/webauthn-service');

function clientData(challenge) {
  return Buffer.from(JSON.stringify({ challenge, origin: 'http://localhost:3000', type: 'webauthn.get' }))
    .toString('base64url');
}

function response(id, challenge) {
  return {
    id,
    type: 'public-key',
    response: {
      clientDataJSON: clientData(challenge),
      authenticatorData: 'YQ',
      signature: 'cw',
    },
  };
}

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.WEBAUTHN_ORIGINS = 'http://localhost:3000';
});

describe('AUTH-7 WebAuthn step-up', () => {
  it('génère un challenge step_up lié au compte courant et restreint ses credentials', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ credential_id: 'cred-A', transports: ['internal'] }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGenerateAuthenticationOptions.mockResolvedValue({
      challenge: 'step-challenge',
      rpId: 'localhost',
      allowCredentials: [{ id: 'cred-A', transports: ['internal'] }],
      userVerification: 'required',
    });

    const options = await webauthn.getStepUpOptions({ userId: USER_A });
    expect(options.available).toBe(true);
    expect(mockGenerateAuthenticationOptions).toHaveBeenCalledWith(expect.objectContaining({
      userVerification: 'required',
      allowCredentials: [{ id: 'cred-A', transports: ['internal'] }],
    }));
    const insert = mockQuery.mock.calls[1];
    expect(insert[0]).toMatch(/webauthn_challenges/i);
    expect(insert[1][0]).toBe(USER_A);
    expect(insert[1][2]).toBe('step_up');
  });

  it('déclare step-up indisponible si le compte ne possède aucune passkey active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(webauthn.getStepUpOptions({ userId: USER_A }))
      .resolves.toEqual({ available: false, reason: 'no_active_credential' });
    expect(mockGenerateAuthenticationOptions).not.toHaveBeenCalled();
  });

  it('refuse qu’une passkey d’un autre compte valide le challenge step_up', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'challenge-id', user_id: USER_A, ceremony_type: 'step_up' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'mgmt-B', user_id: USER_B, credential_id: 'cred-B', public_key: 'AA', sign_count: 0,
        transports: [], backup_eligible: false, backup_state: false, revoked_at: null,
      }] });

    const result = await webauthn.verifyStepUp({
      userId: USER_A,
      response: response('cred-B', 'step-challenge'),
    });
    expect(result).toEqual({ verified: false, error: 'user_mismatch' });
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('refuse une credential révoquée pendant le step-up', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'challenge-id', user_id: USER_A, ceremony_type: 'step_up' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'mgmt-A', user_id: USER_A, credential_id: 'cred-A', public_key: 'AA', sign_count: 0,
        transports: [], backup_eligible: false, backup_state: false, revoked_at: new Date(),
      }] });

    await expect(webauthn.verifyStepUp({ userId: USER_A, response: response('cred-A', 'step-challenge') }))
      .resolves.toEqual({ verified: false, error: 'credential_revoked' });
  });

  it('une preuve step_up valide vérifie UV/origin/RPID, met à jour le compteur et reste sur le même user', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'challenge-id', user_id: USER_A, ceremony_type: 'step_up' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'mgmt-A', user_id: USER_A, credential_id: 'cred-A', public_key: 'AA', sign_count: 0,
        transports: ['internal'], backup_eligible: false, backup_state: false, revoked_at: null,
      }] })
      .mockResolvedValueOnce({ rows: [] });
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const result = await webauthn.verifyStepUp({ userId: USER_A, response: response('cred-A', 'step-challenge') });
    expect(result).toEqual({ verified: true, userId: USER_A });
    expect(mockVerifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      requireUserVerification: true,
      expectedRPID: 'localhost',
      expectedOrigin: ['http://localhost:3000'],
    }));
    expect(mockQuery.mock.calls[2][0]).toMatch(/last_used_at/i);
  });
});
