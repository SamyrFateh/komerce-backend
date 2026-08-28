'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const mockAdmin = {
  reactivateExpiredSnoozes: jest.fn(),
  listSignals: jest.fn(),
  getStats: jest.fn(),
  familyForType: jest.fn(type => type === 'stock_rupture' ? 'sourcing' : 'ops'),
  acknowledgeByRef: jest.fn(),
  snoozeByRef: jest.fn(),
  resolveByRef: jest.fn(),
};
jest.mock('../../services/signal-admin-service', () => mockAdmin);

const mockGenerateSignals = jest.fn();
jest.mock('../../services/signal-service', () => ({ generateSignals: (...args) => mockGenerateSignals(...args) }));

const workspace = require('../../services/action-center-workspace');

beforeEach(() => {
  jest.clearAllMocks();
  mockAdmin.reactivateExpiredSnoozes.mockResolvedValue(0);
  mockAdmin.getStats.mockResolvedValue({
    total: 1,
    bySeverity: [{ severity: 'warning', count: '1' }],
    byFamily: [{ family: 'sourcing', count: '1' }],
    byType: [],
  });
});

test('projection exposes signal_ref and server-resolved Product 360, never internal UUID', async () => {
  mockAdmin.listSignals.mockResolvedValue({
    signals: [{
      id: '11111111-1111-1111-1111-111111111111',
      signal_ref: 'KSG-000001',
      signal_type: 'stock_rupture',
      severity: 'warning',
      title: 'Produit sans vente',
      summary: '0 vente',
      recommendation: 'Réviser',
      confidence: 'medium',
      owner_role: 'sourcing',
      status: 'open',
      entity_type: 'product',
      entity_id: '22222222-2222-2222-2222-222222222222',
      resolved_by: '33333333-3333-3333-3333-333333333333',
      target_filters: { product_id: '22222222-2222-2222-2222-222222222222' },
      created_at: '2026-08-27T08:00:00Z',
      updated_at: '2026-08-27T08:00:00Z',
    }],
    total: 1,
    limit: 100,
    offset: 0,
  });
  mockDbQuery.mockResolvedValueOnce({ rows: [{
    internal_id: '22222222-2222-2222-2222-222222222222',
    product_ref: 'KPR-000123',
    name: 'Produit test',
  }] });

  const result = await workspace.buildWorkspace();

  expect(result.scope.mode).toBe('global_decision_signals');
  expect(result.scope.market_dimension).toBe('unavailable');
  expect(result.signals[0]).toMatchObject({
    signal_ref: 'KSG-000001',
    family: 'sourcing',
    entity: {
      type: 'product',
      ref: 'KPR-000123',
      href: '/admin/products/KPR-000123',
    },
  });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain('11111111-1111-1111-1111-111111111111');
  expect(serialized).not.toContain('22222222-2222-2222-2222-222222222222');
  expect(serialized).not.toContain('33333333-3333-3333-3333-333333333333');
  expect(serialized).not.toContain('target_filters');
});

test('Order signal drill-down is resolved by business order reference', async () => {
  mockAdmin.familyForType.mockReturnValue('ops');
  mockAdmin.listSignals.mockResolvedValue({
    signals: [{ signal_ref: 'KSG-000002', signal_type: 'margin_drift', severity: 'warning', title: 'Marge', status: 'acknowledged', entity_type: 'order', entity_id: 'order-uuid' }],
    total: 1, limit: 100, offset: 0,
  });
  mockDbQuery.mockResolvedValueOnce({ rows: [{ internal_id: 'order-uuid', reference: 'KOM-2026-42' }] });

  const result = await workspace.buildWorkspace();

  expect(result.signals[0].entity.href).toBe('/admin/orders/KOM-2026-42');
  expect(result.signals[0].actions).toEqual(['snooze', 'resolve']);
});

test('Canonical lifecycle actions always delegate by signal_ref', async () => {
  mockAdmin.acknowledgeByRef.mockResolvedValue({ signal_ref: 'KSG-000003', status: 'acknowledged' });
  mockAdmin.snoozeByRef.mockResolvedValue({ signal_ref: 'KSG-000003', status: 'snoozed', snoozed_until: 'later' });
  mockAdmin.resolveByRef.mockResolvedValue({ signal_ref: 'KSG-000003', status: 'resolved', resolved_at: 'now' });

  await workspace.acknowledge('KSG-000003');
  await workspace.snooze('KSG-000003', 24);
  await workspace.resolve('KSG-000003', { id: 'admin-1' });

  expect(mockAdmin.acknowledgeByRef).toHaveBeenCalledWith('KSG-000003');
  expect(mockAdmin.snoozeByRef).toHaveBeenCalledWith('KSG-000003', 24);
  expect(mockAdmin.resolveByRef).toHaveBeenCalledWith('KSG-000003', 'admin-1');
});

test('invalid browser signal reference is rejected before DB mutation', async () => {
  await expect(workspace.acknowledge('uuid-raw')).rejects.toMatchObject({ status: 400, code: 'action_center_signal_ref_invalid' });
  expect(mockAdmin.acknowledgeByRef).not.toHaveBeenCalled();
});

test('generate delegates to the existing signal generator authority', async () => {
  mockGenerateSignals.mockResolvedValue({ expired: 0, generators: {} });
  await workspace.generateSignals(['parcel_blocked']);
  expect(mockGenerateSignals).toHaveBeenCalledWith(['parcel_blocked']);
});
