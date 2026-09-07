'use strict';

const policy = require('../../services/pricing-market-decision-policy');

describe('pricing market decision policy', () => {
  const actorId = '11111111-1111-4111-8111-111111111111';
  const now = new Date('2026-09-07T09:00:00.000Z');

  function valid(overrides = {}) {
    return {
      version: 'CM-2026-09-v1',
      window_days: 30,
      maturity_threshold: 0.8,
      coverage_threshold: 1.05,
      max_disposition_ratio: 0.1,
      disposed_contribution_treatment: 'EXCLUDE_FROM_NUMERATOR',
      effective_from: '2026-09-07T09:00:00.000Z',
      source: 'economic_governance',
      evidence_ref: 'pricing-market-policy/cm/2026-09-v1',
      rationale: 'Politique explicite de décision économique du marché Cameroun.',
      ...overrides,
    };
  }

  test('normalizes an explicit, versioned and market-decision-ready policy', () => {
    const result = policy.normalizePolicyInput(valid(), actorId, { now });
    expect(result).toMatchObject({
      version: 'CM-2026-09-v1',
      window_days: 30,
      maturity_threshold: 0.8,
      coverage_threshold: 1.05,
      max_disposition_ratio: 0.1,
      disposed_contribution_treatment: 'EXCLUDE_FROM_NUMERATOR',
      effective_from: '2026-09-07T09:00:00.000Z',
    });
  });

  test('refuses backdating and invalid thresholds', () => {
    expect(() => policy.normalizePolicyInput(
      valid({ effective_from: '2026-09-07T08:59:59.000Z' }), actorId, { now }
    )).toThrow(/cannot be backdated/i);

    expect(() => policy.normalizePolicyInput(
      valid({ maturity_threshold: 1.1 }), actorId, { now }
    )).toThrow(/maturity_threshold/i);

    expect(() => policy.normalizePolicyInput(
      valid({ coverage_threshold: 0 }), actorId, { now }
    )).toThrow(/coverage_threshold/i);

    expect(() => policy.normalizePolicyInput(
      valid({ max_disposition_ratio: -0.1 }), actorId, { now }
    )).toThrow(/max_disposition_ratio/i);
  });

  test('derives the canonical server window, never a browser-supplied period', () => {
    const normalized = policy.normalizePolicyInput(valid(), actorId, { now });
    expect(policy.canonicalPeriod(normalized, now)).toEqual({
      from: '2026-08-08T09:00:00.000Z',
      to: '2026-09-07T09:00:00.000Z',
      bounds: '[from,to)',
      width_days: 30,
      source: 'server_policy_window',
    });
  });

  test('projects only the fields owned by the coverage and disposition gates', () => {
    const normalized = policy.normalizePolicyInput(valid(), actorId, { now });
    expect(policy.coveragePolicyFrom(normalized)).toEqual({
      version: 'CM-2026-09-v1',
      source: 'economic_governance',
      evidence_ref: 'pricing-market-policy/cm/2026-09-v1',
      maturity_threshold: 0.8,
      coverage_threshold: 1.05,
      disposed_contribution_treatment: 'EXCLUDE_FROM_NUMERATOR',
      effective_from: '2026-09-07T09:00:00.000Z',
      effective_to: null,
    });
    expect(policy.dispositionPolicyFrom(normalized)).toEqual({
      version: 'CM-2026-09-v1',
      source: 'economic_governance',
      max_ratio: 0.1,
    });
  });
});
