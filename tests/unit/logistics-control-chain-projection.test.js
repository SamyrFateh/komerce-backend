'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const projection = require('../../services/logistics-control-chain-projection');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('logistics-control-chain-projection', () => {
  test('le vocabulaire d’étapes reste aligné sur la doctrine canonique', () => {
    expect(projection.STAGES.map(stage => stage.key)).toEqual([
      'ORDER',
      'PURCHASING',
      'SUPPLIER',
      'HUB_RECEIVING',
      'HUB_CONTROL',
      'FORWARDER',
      'TRANSPORT',
      'CUSTOMS',
      'RELAY',
    ]);
  });

  test('garde une commande comme identité de pilotage tout en exposant son enveloppe actuelle', () => {
    const row = projection.projectRow({
      order_reference: 'K-104829',
      current_stage: 'HUB_CONTROL',
      health: 'RED',
      exception_code: 'hub_quarantine',
      exception_summary: 'Unité HUB en quarantaine',
      exception_owner_role: 'hub',
      purchase_order_refs: ['po-1'],
      hub_unit_refs: ['HU-001'],
      parcel_refs: [],
      parcels_count: 0,
    });

    expect(row).toEqual({
      order_reference: 'K-104829',
      stage: 'HUB_CONTROL',
      health: 'RED',
      exception: {
        code: 'hub_quarantine',
        summary: 'Unité HUB en quarantaine',
        owner_role: 'hub',
      },
      envelope: { type: 'HUB_UNIT', refs: ['HU-001'] },
      split: false,
      lineage: {
        purchase_orders: ['po-1'],
        hub_units: ['HU-001'],
        parcels: [],
      },
    });
  });

  test('un split reste une seule ligne de commande et conserve tous les colis de filiation', () => {
    const row = projection.projectRow({
      order_reference: 'K-200',
      current_stage: 'TRANSPORT',
      health: 'ORANGE',
      exception_code: 'parcel_blocked',
      exception_summary: 'Retard transitaire',
      exception_owner_role: 'hub',
      purchase_order_refs: ['po-2'],
      hub_unit_refs: ['HU-002'],
      parcel_refs: ['KOM-P-1', 'KOM-P-2'],
      parcels_count: 2,
    });

    expect(row.order_reference).toBe('K-200');
    expect(row.split).toBe(true);
    expect(row.envelope).toEqual({ type: 'PARCEL', refs: ['KOM-P-1', 'KOM-P-2'] });
    expect(row.lineage.parcels).toEqual(['KOM-P-1', 'KOM-P-2']);
  });

  test('la lecture market-scoped injecte uniquement le market id résolu côté serveur', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        order_reference: 'K-CM-1',
        current_stage: 'PURCHASING',
        health: 'GREEN',
        exception_code: null,
        exception_summary: null,
        exception_owner_role: null,
        purchase_order_refs: ['po-cm'],
        hub_unit_refs: [],
        parcel_refs: [],
        parcels_count: 0,
      }],
    });

    const result = await projection.getControlChain({
      market: { id: '11111111-1111-4111-8111-111111111111', code: 'CM' },
      limit: 50,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe('11111111-1111-4111-8111-111111111111');
    expect(params[2]).toBe(50);
    expect(result.by_stage.PURCHASING).toHaveLength(1);
    expect(result.by_stage.PURCHASING[0].order_reference).toBe('K-CM-1');
    expect(result.by_stage.RELAY).toEqual([]);
  });

  test('agrège une cause structurelle seulement à partir de trois commandes partageant étape et cause', () => {
    const impacted = ['K-301', 'K-302', 'K-303'].map((reference, index) => ({
      order_reference: reference,
      stage: 'PURCHASING',
      health: index === 2 ? 'RED' : 'ORANGE',
      exception: {
        code: 'supplier_payment_blocked',
        summary: 'Paiement fournisseur bloqué',
        owner_role: 'finance',
      },
    }));

    expect(projection.buildStructuralAlerts(impacted)).toEqual([{
      stage: 'PURCHASING',
      health: 'RED',
      reason_code: 'supplier_payment_blocked',
      summary: 'Paiement fournisseur bloqué',
      owner_role: 'finance',
      order_count: 3,
      order_references: ['K-301', 'K-302', 'K-303'],
    }]);

    expect(projection.buildStructuralAlerts(impacted.slice(0, 2))).toEqual([]);
  });

  test('la lecture globale utilise NULL et ne fabrique aucun filtre market navigateur', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await projection.getControlChain({ limit: 9999 });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBeNull();
    expect(params[2]).toBe(500);
  });

  test('le service reste strictement read-only', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../../services/logistics-control-chain-projection'), 'utf8');
    expect(src).toMatch(/@db-write\s+none/);
    expect(src).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|[a-z_])/i);
  });
});
