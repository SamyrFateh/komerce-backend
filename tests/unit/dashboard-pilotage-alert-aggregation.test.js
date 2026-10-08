'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  structuralAlertsFromChain,
  mergePilotageAlerts,
  summarizeControlChain,
} = require('../../services/dashboard-pilotage-alert-aggregation');

describe('pilotage structural alert aggregation', () => {
  const chain = {
    stages: [
      { key: 'PURCHASING', label: 'Achats' },
      { key: 'HUB_CONTROL', label: 'Contrôle HUB' },
    ],
    by_stage: {
      PURCHASING: [
        { health: 'RED' },
        { health: 'ORANGE' },
        { health: 'GREEN' },
      ],
      HUB_CONTROL: [{ health: 'UNKNOWN' }],
    },
    structural_alerts: [{
      stage: 'PURCHASING',
      health: 'RED',
      reason_code: 'supplier_payment_blocked',
      summary: 'Paiement fournisseur bloqué',
      owner_role: 'finance',
      order_count: 3,
      order_references: ['K-1', 'K-2', 'K-3'],
    }],
  };


  test('summarizes stage health without client recompute', () => {
    expect(summarizeControlChain(chain)).toEqual(expect.objectContaining({
      stages: [
        expect.objectContaining({
          key: 'PURCHASING',
          label: 'Achats',
          health: 'RED',
          order_count: 3,
          health_counts: { GREEN: 1, ORANGE: 1, RED: 1, UNKNOWN: 0 },
        }),
        expect.objectContaining({
          key: 'HUB_CONTROL',
          health: 'UNKNOWN',
          order_count: 1,
          health_counts: { GREEN: 0, ORANGE: 0, RED: 0, UNKNOWN: 1 },
        }),
      ],
      structural_alerts: [
        expect.objectContaining({
          reason_code: 'supplier_payment_blocked',
          order_count: 3,
          href: '/admin/operations#operations-control-chain',
        }),
      ],
    }));
  });

  test('projects one structural cause for many impacted orders', () => {
    expect(structuralAlertsFromChain(chain)).toEqual([
      expect.objectContaining({
        level: 'critical',
        title: 'Paiement fournisseur bloqué',
        message: '3 commande(s) impactée(s) · PURCHASING',
        action_url: '/admin/operations#operations-control-chain',
        structural: true,
        order_count: 3,
      }),
    ]);
  });

  test('replaces covered order symptoms without hiding unrelated alerts', () => {
    const merged = mergePilotageAlerts([
      { id: 's1', level: 'critical', source: 'purchasing', message: '1', signal_type: 'supplier_payment_blocked', order_reference: 'K-1' },
      { id: 's2', level: 'critical', source: 'purchasing', message: '2', signal_type: 'supplier_payment_blocked', order_reference: 'K-2' },
      { id: 's3', level: 'critical', source: 'purchasing', message: '3', signal_type: 'supplier_payment_blocked', order_reference: 'K-3' },
      { id: 's4', level: 'critical', source: 'hub', message: 'Quarantaine', signal_type: 'hub_non_compliant', order_reference: 'K-4' },
    ], chain, 10);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(expect.objectContaining({ structural: true, order_count: 3 }));
    expect(merged[1]).toEqual(expect.objectContaining({ id: 's4', message: 'Quarantaine' }));
    expect(JSON.stringify(merged)).not.toContain('"signal_type"');
    expect(JSON.stringify(merged)).not.toContain('"order_reference"');
  });

  test('keeps a same-type alert when its order is outside the structural group', () => {
    const merged = mergePilotageAlerts([
      { id: 'other', level: 'critical', source: 'purchasing', message: 'Autre commande', signal_type: 'supplier_payment_blocked', order_reference: 'K-99' },
    ], chain, 10);

    expect(merged).toHaveLength(2);
    expect(merged.some(row => row.id === 'other')).toBe(true);
  });

  test('honors the display limit after structural prioritization', () => {
    const merged = mergePilotageAlerts([
      { id: 'warning', level: 'warning', source: 'ops', message: 'warning' },
      { id: 'info', level: 'info', source: 'ops', message: 'info' },
    ], chain, 2);
    expect(merged).toHaveLength(2);
    expect(merged[0].structural).toBe(true);
    expect(merged[1].id).toBe('warning');
  });
});
