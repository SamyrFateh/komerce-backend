'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const onboarding = require('../../services/external-provider-onboarding-contracts');

describe('external provider onboarding contracts', () => {
  test('CJ : contrat provider documenté, clé API exacte, aucun token à demander', () => {
    const auth = {
      mode: 'api_key',
      scope: 'source',
      fields: [{ key: 'api_key', label: 'Clé API CJdropshipping', secret: true }],
    };
    const result = onboarding.checkReady('cj', auth);
    expect(result.ready).toBe(true);
    expect(result.contract).toMatchObject({
      provider_id: 'cj',
      status: 'defined',
      authority: 'provider_documentation',
      credential_owner: 'partner_account',
      operator_must_obtain: [{ key: 'api_key', label: 'Clé API CJdropshipping' }],
    });
    expect(result.contract.evidence_url).toMatch(/^https:\/\/developers\.cjdropshipping\.com\//);
    expect(result.contract.operator_must_not_request.join(' ')).toMatch(/mot de passe/i);
    expect(result.contract.operator_must_not_request.join(' ')).toMatch(/Access Token/i);
  });

  test('un écart entre étude API et champs auth bloque le connecteur', () => {
    const result = onboarding.checkReady('cj', {
      mode: 'api_key',
      scope: 'source',
      fields: [{ key: 'access_token', label: 'Access Token', secret: true }],
    });
    expect(result).toMatchObject({
      ready: false,
      reason: 'provider_onboarding_auth_fields_mismatch',
    });
  });

  test('Allegro : la documentation officielle bloque l ancien modèle de credentials par source', () => {
    const result = onboarding.checkReady('allegro', {
      mode: 'client_credentials',
      scope: 'source',
      fields: [
        { key: 'client_id', label: 'Client ID Allegro', secret: false },
        { key: 'client_secret', label: 'Client Secret Allegro', secret: true },
      ],
    });
    expect(result).toMatchObject({
      ready: false,
      reason: 'provider_onboarding_blocked',
      contract: {
        status: 'blocked',
        authority: 'provider_documentation',
        credential_owner: 'komerce_platform_application',
        operator_must_obtain: [],
      },
    });
    expect(result.contract.blocker).toMatch(/OAuth vendeur/i);
    expect(result.contract.operator_must_not_request.join(' ')).toMatch(/Client ID/i);
  });

  test('AliExpress : OAuth = autorisation humaine, aucun credential source à copier', () => {
    const result = onboarding.checkReady('aliexpress', {
      mode: 'oauth',
      scope: 'platform',
      fields: [],
    });
    expect(result.ready).toBe(true);
    expect(result.contract.credential_owner).toBe('komerce_platform_application');
    expect(result.contract.operator_must_obtain).toEqual([]);
    expect(result.contract.setup_steps.join(' ')).toMatch(/autorise/i);
  });

  test('un provider sans onboarding défini reste fail-closed', () => {
    const result = onboarding.checkReady('noon', { mode: 'none', scope: null, fields: [] });
    expect(result).toMatchObject({
      ready: false,
      reason: 'provider_onboarding_not_defined',
      contract: { provider_id: 'noon', status: 'missing' },
    });
  });

  test('le contrat public ne contient aucune valeur de credential ni nom de variable env', () => {
    const json = JSON.stringify(onboarding.publicContract('allegro'));
    expect(json).not.toMatch(/ALLEGRO_SANDBOX_|process\.env|credential_ref|ciphertext|refresh[_-]?token/i);
  });
});
