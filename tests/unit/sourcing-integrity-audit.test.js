'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  buildIntegrityAudit,
  collectIntegrityAudit,
} = require('../../scripts/sourcing-integrity-audit');
const {
  buildFinalAuthoritySnapshot,
  buildHealthDashboardFromAudit,
  buildHealthDashboard,
} = require('../../services/sourcing-integrity-service');

const resolved = (id = 'sku1', provider = 'cj') => ({
  status: 'RESOLVED',
  product_sku_id: id,
  canonical_unit_id: `unit-${id}`,
  supplier_unit_ref: `ref-${id}`,
  supplier_order_identity: { provider, version: 1, payload: { exact: id } },
  canonical_unit: { provenance: [{ source_id: `api:${provider}`, adapter_type: provider }] },
});

function healthySnapshot(overrides = {}) {
  return {
    golden_report: { status: 'PASS', hard_failures: [], catalog: { status: 'PASS' } },
    source_states: [{ source_id: 'api:cj', adapter_type: 'cj', status: 'active', failed_captures: 0, partial_captures: 0, running_captures: 0 }],
    observations: [
      { observation_id: 'o1', capture_id: 'c1', source_id: 'api:cj', grain: 'unit', source_ref: 'R1', capture_started_at: '2026-09-01T10:00:00Z', observed_at: '2026-09-01T10:00:00Z', canonical_entity_id: 'u1', active_binding_count: 1 },
      { observation_id: 'o2', capture_id: 'c2', source_id: 'api:cj', grain: 'unit', source_ref: 'R1', capture_started_at: '2026-09-02T10:00:00Z', observed_at: '2026-08-31T10:00:00Z', canonical_entity_id: 'u1', active_binding_count: 1 },
    ],
    ref_collisions: [],
    entities: [{ canonical_entity_id: 'u1', grain: 'unit', status: 'active', parent_status: 'active', active_bindings: 2 }],
    latest_review_required: 0,
    sku_resolutions: [resolved()],
    ...overrides,
  };
}

test('HEALTHY tolère une observation hors ordre si le replay conserve la même identité', () => {
  const report = buildIntegrityAudit(healthySnapshot());
  expect(report.status).toBe('HEALTHY');
  expect(report.idempotency).toMatchObject({
    status: 'HEALTHY',
    repeated_source_identities: 1,
    replay_splits: 0,
    out_of_order_observations: 1,
    out_of_order_preserved_without_identity_rewrite: true,
  });
  expect(report.hard_failures).toEqual([]);
});

test('même ref textuelle dans deux namespaces différents ne crée pas un faux replay split', () => {
  const observations = [
    { observation_id: 'cj1', capture_id: 'c1', source_id: 'api:cj', grain: 'unit', source_ref: 'SAME', capture_started_at: '2026-09-01', observed_at: '2026-09-01', canonical_entity_id: 'u-cj', active_binding_count: 1 },
    { observation_id: 'ali1', capture_id: 'a1', source_id: 'api:aliexpress', grain: 'unit', source_ref: 'SAME', capture_started_at: '2026-09-01', observed_at: '2026-09-01', canonical_entity_id: 'u-ali', active_binding_count: 1 },
  ];
  const report = buildIntegrityAudit(healthySnapshot({ observations }));
  expect(report.status).toBe('HEALTHY');
  expect(report.idempotency.replay_splits).toBe(0);
});

test('ATTENTION signale les incidents récupérables sans les appeler corruption', () => {
  const report = buildIntegrityAudit(healthySnapshot({
    source_states: [{ source_id: 'api:cj', adapter_type: 'cj', status: 'active', failed_captures: 1, partial_captures: 1, running_captures: 0 }],
    observations: [{ observation_id: 'o1', capture_id: 'c1', source_id: 'api:cj', grain: 'unit', source_ref: 'R1', active_binding_count: 0 }],
    latest_review_required: 2,
    sku_resolutions: [{ status: 'AMBIGUOUS_UNIT', product_sku_id: 'sku1' }],
  }));
  expect(report.status).toBe('ATTENTION');
  expect(report.hard_failures).toEqual([]);
  expect(report.integrity.warnings).toEqual(expect.arrayContaining(['failed_captures_present', 'partial_captures_present']));
  expect(report.resolution.warnings).toEqual(expect.arrayContaining(['unbound_observations_present', 'review_required_present']));
  expect(report.unit_identity.warnings).toContain('ambiguous_identity_blocked');
  expect(report.purchasing_readiness.warnings).toContain('supplier_identities_blocked');
});

test('BROKEN est réservé aux violations d’intégrité', () => {
  const report = buildIntegrityAudit(healthySnapshot({
    observations: [
      { observation_id: 'o1', capture_id: 'c1', source_id: 'api:cj', grain: 'unit', source_ref: 'R1', canonical_entity_id: 'u1', active_binding_count: 2 },
      { observation_id: 'o2', capture_id: 'c2', source_id: 'api:cj', grain: 'unit', source_ref: 'R1', canonical_entity_id: 'u2', active_binding_count: 1 },
    ],
    ref_collisions: [{ source_id: 'api:cj', ref_kind: 'unit.source_ref', ref_value: 'R1', canonical_count: 2 }],
    sku_resolutions: [{ status: 'RESOLVED', product_sku_id: 'sku1', canonical_unit_id: 'u1', supplier_unit_ref: null, supplier_order_identity: null }],
  }));
  expect(report.status).toBe('BROKEN');
  expect(report.hard_failures).toEqual(expect.arrayContaining([
    'multiple_active_bindings_for_observation',
    'namespaced_ref_points_to_multiple_canonical_entities',
    'replay_split_across_canonical_entities',
    'resolved_unit_missing_exact_identity',
  ]));
});

test('SOI RESOLVED dont le provider contredit la provenance est BROKEN', () => {
  const bad = resolved('sku1', 'cj');
  bad.canonical_unit.provenance = [{ source_id: 'api:aliexpress', adapter_type: 'aliexpress' }];
  const report = buildIntegrityAudit(healthySnapshot({ sku_resolutions: [bad] }));
  expect(report.status).toBe('BROKEN');
  expect(report.unit_identity.hard_failures).toContain('resolved_soi_provider_namespace_mismatch');
});

test('collectIntegrityAudit reste read-only et résout chaque SKU actif', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [{ source_id: 'api:cj', adapter_type: 'cj', status: 'active', failed_captures: 0, partial_captures: 0, running_captures: 0 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ review_required: 0 }] })
    .mockResolvedValueOnce({ rows: [{ id: 'sku1' }, { id: 'sku2' }] });
  const resolveFn = jest.fn(async id => resolved(id));
  const goldenFn = jest.fn(async () => ({ status: 'PASS', hard_failures: [], catalog: { status: 'PASS' } }));
  const report = await collectIntegrityAudit(query, resolveFn, goldenFn);
  expect(report.status).toBe('HEALTHY');
  expect(resolveFn).toHaveBeenCalledTimes(2);
  expect(goldenFn).toHaveBeenCalledTimes(1);
  for (const [sql] of query.mock.calls) expect(String(sql).toLowerCase()).not.toContain('insert ');
});

test('autorité finale sépare Sourcing, Selection et Hub', () => {
  const authority = buildFinalAuthoritySnapshot();
  expect(authority).toMatchObject({
    status: 'FINAL_TECHNICAL_AUTHORITY',
    product_authority: 'CANONICAL_PRODUCT',
    offer_authority: 'CANONICAL_OFFER',
    unit_authority: 'CANONICAL_UNIT',
    selection_authority: 'NOT_AUTHORIZED_IN_SOURCING',
    supplier_order_side_effect: 'HARD_STOP',
    hub_routing_authority: 'OUT_OF_SCOPE_NEXT_DOMAIN',
  });
  expect(authority.retirement_matrix.REMOVE_NOW).toEqual([]);
});

test('dashboard santé respecte ETAT → agrégats → exceptions → drill-down → raw', () => {
  const audit = buildIntegrityAudit(healthySnapshot());
  const dashboard = buildHealthDashboardFromAudit(audit);
  expect(dashboard).toMatchObject({
    schema_version: 'sourcing-health-dashboard-v1',
    scope: { mode: 'global_sourcing' },
    state: { global: 'HEALTHY', integrity: 'HEALTHY', performance: 'HEALTHY', blockers: 0, attention: 0 },
    aggregates: { replay_splits: 0, ambiguous_blocked: 0 },
    exceptions: [],
    authority: { status: 'FINAL_TECHNICAL_AUTHORITY' },
    raw: { report_version: 'sourcing-operational-integrity-v1', status: 'HEALTHY' },
  });
  expect(dashboard.state.trend.status).toBe('UNKNOWN');
});

test('dashboard santé n invente pas un vert quand l audit est BROKEN', async () => {
  const brokenAudit = buildIntegrityAudit(healthySnapshot({
    observations: [{ observation_id: 'o1', capture_id: 'c1', source_id: 'api:cj', grain: 'unit', source_ref: 'R1', active_binding_count: 2 }],
  }));
  const dashboard = await buildHealthDashboard({ auditFn: jest.fn(async () => brokenAudit) });
  expect(dashboard.state.global).toBe('BROKEN');
  expect(dashboard.state.integrity).toBe('BROKEN');
  expect(dashboard.state.performance).toBe('BROKEN');
  expect(dashboard.state.blockers).toBeGreaterThan(0);
  expect(dashboard.exceptions[0].severity).toBe('BROKEN');
});
