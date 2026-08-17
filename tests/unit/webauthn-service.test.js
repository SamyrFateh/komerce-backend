'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Couverture structurelle dédiée de services/webauthn-service.js.
 * Complète auth-passkey.test.js avec les chemins de génération d'options
 * et de persistance des challenges, sans re-tester la crypto de la librairie.
 */

const mockGenerateRegistrationOptions = jest.fn();
const mockVerifyRegistrationResponse = jest.fn();
const mockGenerateAuthenticationOptions = jest.fn();
const mockVerifyAuthenticationResponse = jest.fn();

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (...args) => mockGenerateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args) => mockVerifyRegistrationResponse(...args),
  generateAuthenticationOptions: (...args) => mockGenerateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args) => mockVerifyAuthenticationResponse(...args),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

process.env.WEBAUTHN_RP_ID = 'komerce.shop';
process.env.WEBAUTHN_RP_NAME = 'Komerce';
process.env.WEBAUTHN_ORIGINS = 'https://komerce.shop';

const webauthn = require('../../services/webauthn-service');
const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('webauthn-service — options et challenges', () => {
  beforeEach(() => jest.clearAllMocks());

  it('enregistrement : exclut les credentials actifs et persiste un challenge register lié au user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ credential_id: 'cred-existing', transports: ['internal'] }] });
    mockGenerateRegistrationOptions.mockResolvedValue({ challenge: 'reg-challenge' });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const options = await webauthn.getRegistrationOptions({ id: USER_ID, phone: '+2693000000', full_name: 'Client Komerce' });

    expect(options).toEqual({ challenge: 'reg-challenge' });
    expect(mockGenerateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpID: 'komerce.shop',
      rpName: 'Komerce',
      userName: '+2693000000',
      attestationType: 'none',
      authenticatorSelection: expect.objectContaining({ userVerification: 'required' }),
      excludeCredentials: [{ id: 'cred-existing', transports: ['internal'] }],
    }));
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO webauthn_challenges/i);
    expect(mockQuery.mock.calls[1][1][0]).toBe(USER_ID);
    expect(mockQuery.mock.calls[1][1][1]).toBe('reg-challenge');
    expect(mockQuery.mock.calls[1][1][2]).toBe('register');
    expect(mockQuery.mock.calls[1][1][3]).toBeInstanceOf(Date);
  });

  it('login username-first inconnu : ne révèle pas le compte et stocke un challenge orphelin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockGenerateAuthenticationOptions.mockResolvedValue({ challenge: 'login-challenge' });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const options = await webauthn.getLoginOptions({ phone: '+2693999999' });

    expect(options).toEqual({ challenge: 'login-challenge' });
    expect(mockGenerateAuthenticationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpID: 'komerce.shop',
      userVerification: 'required',
      allowCredentials: [],
    }));
    expect(mockQuery.mock.calls[1][1][0]).toBeNull();
    expect(mockQuery.mock.calls[1][1][1]).toBe('login-challenge');
    expect(mockQuery.mock.calls[1][1][2]).toBe('login');
  });

  it('step-up : aucune passkey active => indisponible sans générer de challenge', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(webauthn.getStepUpOptions({ userId: USER_ID })).resolves.toEqual({
      available: false,
      reason: 'no_active_credential',
    });
    expect(mockGenerateAuthenticationOptions).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
