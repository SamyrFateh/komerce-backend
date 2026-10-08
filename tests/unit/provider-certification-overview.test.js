'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const { buildProviderCertificationOverview } = require('../../services/provider-certification-overview');

const routeSource = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'admin-providers-capabilities.js'), 'utf8');

const registry = {
  providers: {
    cj: [
      { capability: 'purchasing.contract', classification: 'CONFIRMED', availability: 'PROVEN', highest_proof: 'P4', environment: 'LIVE_STAGING', evidence: ['e'], limitations: ['l'] },
      { capability: 'purchasing.reconcile_payment', classification: 'GAP', availability: 'UNPROVEN', highest_proof: null, environment: 'LIVE_STAGING', evidence: [], limitations: [] },
    ],
    stripe: [
      { capability: 'payment.capture', classification: 'CONFIRMED', availability: 'PROVEN', highest_proof: 'P4', environment: 'LIVE', evidence: [], limitations: [] },
    ],
  },
};

const find = (overview, provider, capability) => overview.providers.find(p => p.provider === provider).records.find(r => r.capability === capability);

describe('provider certification overview', () => {
  test('la décision runtime est celle des gardes d’exécution, avec sa raison', () => {
    const o = buildProviderCertificationOverview({ registry, env: { KOMERCE_PROVIDER_EXECUTION_ENV: 'LIVE_STAGING' } });
    expect(o.runtime_environment).toBe('LIVE_STAGING');
    expect(find(o, 'cj', 'purchasing.contract').runtime_decision).toEqual({ allowed: true, reason: null });
    expect(find(o, 'cj', 'purchasing.reconcile_payment').runtime_decision).toEqual({ allowed: false, reason: 'CERTIFICATION_CAPABILITY_GAP' });
  });

  test('environnement non déclaré → refus explicite, jamais autorisé par défaut', () => {
    const o = buildProviderCertificationOverview({ registry, env: {} });
    expect(o.runtime_environment).toBeNull();
    expect(find(o, 'cj', 'purchasing.contract').runtime_decision).toEqual({ allowed: false, reason: 'CERTIFICATION_RUNTIME_ENVIRONMENT_REQUIRED' });
  });

  test('environnement incohérent → refus par la certification', () => {
    const o = buildProviderCertificationOverview({ registry, env: { KOMERCE_PROVIDER_EXECUTION_ENV: 'SANDBOX' } });
    expect(find(o, 'cj', 'purchasing.contract').runtime_decision.reason).toBe('CERTIFICATION_ENVIRONMENT_MISMATCH');
  });

  test('environnement invalide → signalé, aucune autorisation', () => {
    const o = buildProviderCertificationOverview({ registry, env: { KOMERCE_PROVIDER_EXECUTION_ENV: 'prod' } });
    expect(o.runtime_environment_error).toBe('PROVIDER_EXECUTION_ENV_INVALID');
    expect(find(o, 'cj', 'purchasing.contract').runtime_decision.allowed).toBe(false);
  });

  test('provider documenté mais hors garde d’exécution : preuve visible, décision = provider non supporté', () => {
    const o = buildProviderCertificationOverview({ registry, env: { KOMERCE_PROVIDER_EXECUTION_ENV: 'LIVE' } });
    const stripe = o.providers.find(p => p.provider === 'stripe');
    expect(stripe.runtime_guarded).toBe(false);
    expect(stripe.records[0].runtime_decision).toEqual({ allowed: false, reason: 'CERTIFICATION_PROVIDER_UNSUPPORTED' });
  });

  test('l’avis « activer ≠ autoriser » est porté par la projection, et aucun secret n’y figure', () => {
    const o = buildProviderCertificationOverview({ registry, env: {} });
    expect(o.activation_notice).toMatch(/n’autorise pas/);
    expect(JSON.stringify(o)).not.toMatch(/api_key|secret|token|password|credential/i);
  });

  test('le registre réel se projette sans erreur', () => {
    const o = buildProviderCertificationOverview({ env: { KOMERCE_PROVIDER_EXECUTION_ENV: 'SANDBOX' } });
    expect(o.providers.length).toBeGreaterThan(0);
    expect(o.providers.every(p => p.records.every(r => typeof r.runtime_decision.allowed === 'boolean'))).toBe(true);
  });
});

test('la route est admin-only et en lecture seule', () => {
  expect(routeSource).toContain("router.get('/capabilities'");
  expect(routeSource).toContain("requireRole(['admin'])");
  expect(routeSource).not.toMatch(/router\.(post|put|patch|delete)\(/);
});
