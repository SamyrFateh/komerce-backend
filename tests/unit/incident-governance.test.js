'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const {
  CANONICAL_MAPPING,
  RECONCILIATION_SUBTYPE_MAPPING,
  UNCLASSIFIED,
  SLA_DURATION_MS,
  resolveGovernance,
  validateGovernance,
  resolveGovernanceOrThrow,
  isHubRelevant,
  isIrreversibleTransitionBlocked,
  assertTerminalResolutionAllowed,
  computeDueAt,
  resolverDomainToOwnerRole,
} = require('../../services/incident-governance');

describe('incident-governance — F2/F3', () => {
  test('physical type maps to Logistics/PHYSICAL_PROOF', () => {
    expect(resolveGovernance('weight_mismatch')).toEqual({
      origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF',
    });
    expect(isHubRelevant('weight_mismatch')).toBe(true);
  });

  test('payment type maps to Payments/UPSTREAM_TRUTH', () => {
    expect(resolveGovernance('payment_issue')).toEqual({
      origin_domain: 'PAYMENTS', resolver_domain: 'PAYMENTS', resolution_class: 'UPSTREAM_TRUTH',
    });
    expect(isHubRelevant('payment_issue')).toBe(false);
  });

  test('reconciliation subtype determines authority', () => {
    expect(resolveGovernance('reconciliation_error', { subtype: 'over_allocation' })).toEqual({
      origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF',
    });
    expect(resolveGovernance('reconciliation_error', { subtype: 'order_status_drift' })).toEqual({
      origin_domain: 'ORDERS', resolver_domain: 'ORDERS', resolution_class: 'UPSTREAM_TRUTH',
    });
  });

  test('partial_allocation is not an incident governance subtype', () => {
    expect(RECONCILIATION_SUBTYPE_MAPPING.partial_allocation).toBeUndefined();
    expect(resolveGovernance('reconciliation_error', { subtype: 'partial_allocation' })).toBeNull();
  });

  test('unknown creation fails closed', () => {
    expect(() => resolveGovernanceOrThrow({ incident_type: 'future_logistics_incident' }))
      .toThrow(/UNKNOWN_INCIDENT_TYPE/);
    expect(() => resolveGovernanceOrThrow({ incident_type: 'reconciliation_error' }))
      .toThrow(/MISSING_RECONCILIATION_SUBTYPE/);
  });

  test('wrong resolver fails validation', () => {
    expect(validateGovernance({ incident_type: 'weight_mismatch', resolver_domain: 'PURCHASING' }))
      .toEqual({ ok: false, reason: 'RESOLVER_DOMAIN_MISMATCH', expected: 'LOGISTICS', received: 'PURCHASING' });
  });

  test('known Logistics blocking incident blocks shipped', () => {
    expect(isIrreversibleTransitionBlocked(
      [{ incident_type: 'weight_mismatch', origin_domain: 'LOGISTICS' }], 'shipped'
    )).toMatchObject({ blocked: true, reason: 'OPEN_HUB_RELEVANT_INCIDENT' });
  });

  test('known Logistics non-blocking delay may ship as remediation', () => {
    expect(isIrreversibleTransitionBlocked(
      [{ incident_type: 'delay', origin_domain: 'LOGISTICS' }], 'shipped'
    )).toEqual({ blocked: false });
  });

  test('unknown Logistics incident blocks irreversible transition fail-closed', () => {
    expect(isIrreversibleTransitionBlocked(
      [{ incident_type: 'future_type', origin_domain: 'LOGISTICS' }], 'shipped'
    )).toMatchObject({ blocked: true, reason: 'UNKNOWN_LOGISTICS_INCIDENT_TYPE' });
  });

  test('foreign-domain incident sharing keys does not acquire Hub authority', () => {
    expect(isIrreversibleTransitionBlocked(
      [{ incident_type: 'payment_issue', origin_domain: 'PAYMENTS' }], 'shipped'
    )).toEqual({ blocked: false });
  });

  test.each(['manual_fix', 'auto_resolved', 'reship', 'refund', 'dismissed'])(
    'UPSTREAM_TRUTH cannot close via %s', (resolutionType) => {
      expect(() => assertTerminalResolutionAllowed({ incident_type: 'payment_issue' }, resolutionType))
        .toThrow(/UPSTREAM_TRUTH/);
    }
  );

  test.each(['manual_fix', 'auto_resolved', 'reship', 'refund', 'dismissed'])(
    'PHYSICAL_PROOF cannot close generically via %s', (resolutionType) => {
      expect(() => assertTerminalResolutionAllowed({ incident_type: 'weight_mismatch' }, resolutionType))
        .toThrow(/PHYSICAL_PROOF/);
    }
  );

  test('persisted UNCLASSIFIED cannot close generically', () => {
    expect(() => assertTerminalResolutionAllowed({
      incident_type: 'reconciliation_error', subtype: 'legacy_unknown',
      resolution_class: 'UNCLASSIFIED', resolver_domain: 'UNCLASSIFIED',
    }, 'auto_resolved')).toThrow(/UNCLASSIFIED/);
  });

  test('F3 SLA is derived only from resolution_class', () => {
    const base = new Date('2026-09-15T10:00:00.000Z');
    expect(SLA_DURATION_MS.PHYSICAL_PROOF).toBe(24 * 60 * 60 * 1000);
    expect(SLA_DURATION_MS.UPSTREAM_TRUTH).toBe(72 * 60 * 60 * 1000);
    expect(computeDueAt('PHYSICAL_PROOF', base).toISOString()).toBe('2026-09-16T10:00:00.000Z');
    expect(computeDueAt('UPSTREAM_TRUTH', base).toISOString()).toBe('2026-09-18T10:00:00.000Z');
    expect(computeDueAt('UNCLASSIFIED', base)).toBeNull();
  });

  test('resolver authority maps to an existing operational Action Center role', () => {
    expect(resolverDomainToOwnerRole('LOGISTICS')).toBe('hub');
    expect(resolverDomainToOwnerRole('PURCHASING')).toBe('sourcing');
    expect(resolverDomainToOwnerRole('PAYMENTS')).toBe('admin');
    expect(resolverDomainToOwnerRole('ORDERS')).toBe('admin');
    expect(resolverDomainToOwnerRole('future-domain')).toBe('admin');
  });

  test('direct mapping excludes reconciliation_error and covers direct active types', () => {
    expect(CANONICAL_MAPPING.reconciliation_error).toBeUndefined();
    expect(Object.keys(CANONICAL_MAPPING)).toHaveLength(11);
    expect(UNCLASSIFIED).toEqual({
      origin_domain: 'UNCLASSIFIED', resolver_domain: 'UNCLASSIFIED', resolution_class: 'UNCLASSIFIED',
    });
  });
});
