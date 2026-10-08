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
  test('la santé canonique expose GREEN / ORANGE / RED / UNKNOWN et une fenêtre de fraîcheur explicite', () => {
    expect(projection.HEALTH).toEqual({
      GREEN: 'GREEN',
      ORANGE: 'ORANGE',
      RED: 'RED',
      UNKNOWN: 'UNKNOWN',
    });
    expect(projection.CONTROL_CHAIN_STALE_AFTER_MINUTES).toBe(30);
  });

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
        severity: null,
      },
      exceptions: [{
        code: 'hub_quarantine',
        summary: 'Unité HUB en quarantaine',
        owner_role: 'hub',
        severity: null,
      }],
      envelope: { type: 'HUB_UNIT', refs: ['HU-001'] },
      split: false,
      lineage: {
        purchase_orders: ['po-1'],
        hub_units: ['HU-001'],
        parcels: [],
      },
    });
  });

  test('expose au plus trois causes et conserve la cause gouvernante en premier', () => {
    const row = projection.projectRow({
      order_reference: 'K-MULTI-1',
      current_stage: 'PURCHASING',
      health: 'RED',
      exception_code: 'supplier_order_ambiguous',
      exception_summary: 'Commande fournisseur ambiguë',
      exception_owner_role: 'purchasing',
      exception_severity: 'critical',
      exception_causes: [
        { signal_type: 'supplier_payment_blocked', severity: 'high', summary: 'Paiement bloqué', owner_role: 'finance' },
        { signal_type: 'supplier_order_ambiguous', severity: 'critical', summary: 'Commande fournisseur ambiguë', owner_role: 'purchasing' },
        { signal_type: 'customer_payment_attention', severity: 'warning', summary: 'Paiement client à vérifier', owner_role: 'finance' },
        { signal_type: 'fourth_should_not_surface', severity: 'warning', summary: '4e', owner_role: 'support' },
      ],
      purchase_order_refs: ['po-1'],
      hub_unit_refs: [],
      parcel_refs: [],
      parcels_count: 0,
    });

    expect(row.exception).toMatchObject({
      code: 'supplier_order_ambiguous',
      owner_role: 'purchasing',
    });
    expect(row.exceptions.map(cause => cause.code)).toEqual([
      'supplier_order_ambiguous',
      'supplier_payment_blocked',
      'customer_payment_attention',
    ]);
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

  test('la projection reste conservative entre Purchasing, Supplier et Hub', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await projection.getControlChain({
      market: { id: '11111111-1111-4111-8111-111111111111', code: 'CM' },
    });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('o.reference AS order_reference');
    expect(sql).toContain("po.status::text IN ('confirmed','shipped','hub_received')");
    expect(sql).toContain("WHEN so.order_status = 'ordered' AND COALESCE(pf.supplier_acknowledged, FALSE) THEN 'SUPPLIER'");
    expect(sql).toContain("WHEN so.order_status = 'ordered' THEN 'PURCHASING'");
    expect(sql).toContain("WHEN so.order_status = 'preparation' AND COALESCE(hf.has_dispatched, FALSE) THEN 'FORWARDER'");
    expect(sql).not.toContain("OR so.payment_status = 'paid' THEN 'PURCHASING'");
  });

  test('GREEN exige un fait récent ; une observation vieillissante devient ORANGE et l absence de fait reste UNKNOWN', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await projection.getControlChain({
      market: { id: '11111111-1111-4111-8111-111111111111', code: 'CM' },
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("THEN 'ORANGE'");
    expect(sql).toContain("$5::int * INTERVAL '1 minute'");
    expect(sql).toContain("IS NOT NULL THEN 'GREEN'");
    expect(sql).toContain("ELSE 'UNKNOWN'");
    expect(params[4]).toBe(30);
  });

  test('une observation stale porte une cause et un owner actionnables', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await projection.getControlChain({
      market: { id: '11111111-1111-4111-8111-111111111111', code: 'CM' },
    });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("THEN 'observation_stale'");
    expect(sql).toContain("THEN 'Observation métier trop ancienne'");
    expect(sql).toContain("WHEN 'PURCHASING' THEN 'purchasing'");
    expect(sql).toContain("WHEN 'CUSTOMS' THEN 'customs'");
    expect(sql).toContain("WHEN 'RELAY' THEN 'relais'");
  });

  test('les incidents ouverts alimentent orange/rouge sans créer un statut dashboard', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await projection.getControlChain({
      market: { id: '11111111-1111-4111-8111-111111111111', code: 'CM' },
    });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('FROM incidents i');
    expect(sql).toContain('JSONB_AGG');
    expect(sql).toContain('WHERE rn <= 3');
    expect(sql).toContain('LEFT JOIN signal_summary ss ON ss.order_id = so.id');
    expect(sql).not.toContain('LEFT JOIN ranked_signals rs ON rs.order_id = so.id AND rs.rn = 1');
    expect(sql).toContain("i.status IN ('open','investigating')");
    expect(sql).toContain("WHEN 'high' THEN 'high'");
    expect(sql).toContain("ELSE 'warning'");
  });

  test('le snapshot Order 360 réutilise le même projecteur avec un order id résolu serveur', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        order_reference: 'K-CM-77',
        current_stage: 'HUB_CONTROL',
        health: 'RED',
        exception_code: 'hub_quarantine',
        exception_summary: 'Unité HUB en quarantaine',
        exception_owner_role: 'hub',
        purchase_order_refs: ['po-internal-id'],
        hub_unit_refs: ['KOM-RCV-77'],
        parcel_refs: [],
        parcels_count: 0,
      }],
    });

    const result = await projection.getOrderControlSnapshot({
      id: '11111111-1111-4111-8111-777777777777',
      market_id: '22222222-2222-4222-8222-222222222222',
      reference: 'K-CM-77',
    });

    expect(result).toEqual(expect.objectContaining({
      order_reference: 'K-CM-77',
      stage: 'HUB_CONTROL',
      health: 'RED',
      envelope: { type: 'HUB_UNIT', refs: ['KOM-RCV-77'] },
    }));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('AND ($4::uuid IS NULL OR o.id = $4::uuid)');
    expect(params[0]).toBe('22222222-2222-4222-8222-222222222222');
    expect(params[3]).toBe('11111111-1111-4111-8111-777777777777');
  });

  test('projette un échec de création de PO ouvert vers la commande sans nouveau lifecycle', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await projection.getControlChain({
      market: { id: '11111111-1111-4111-8111-111111111111', code: 'CM' },
    });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('FROM alerts a');
    expect(sql).toContain("a.type = 'purchasing_po_creation_failed'");
    expect(sql).toContain("a.entity_type = 'order'");
    expect(sql).toContain('a.entity_id = so.id');
    expect(sql).toContain('a.resolved_at IS NULL');
    expect(sql).toContain("'purchasing' AS owner_role");
  });

  test('projette un signal paiement fournisseur global vers les commandes par filiation exacte', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await projection.getControlChain({
      market: { id: '11111111-1111-4111-8111-111111111111', code: 'CM' },
    });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('JOIN supplier_execution_payments sep');
    expect(sql).toContain("s.entity_type = 'supplier_payment'");
    expect(sql).toContain('spl.purchase_order_id = sep.purchase_order_id');
    expect(sql).toContain('JOIN order_items soi ON soi.id = spl.order_item_id');
    expect(sql).toContain('JOIN scoped_orders so ON so.id = soi.order_id');
    expect(sql).not.toContain("s.market_id = so.market_id");
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

test('SQL : le CASE simple de propriétaire n’a pas de WHEN parasite avant son opérande (régression syntaxe PG)', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'services', 'logistics-control-chain-projection.js'), 'utf8');
  expect(source).toContain('THEN CASE (\n');
  expect(source).not.toMatch(/THEN CASE\s+WHEN \(\s+CASE/);
});
