'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/customs-shipment-service.js (R8)
 *
 * Couvre :
 *   allocateCustoms — fonction pure, tous les modes de ventilation
 *   updateShipment  — guard 400 (aucun champ) avec mock db
 *   createShipment  — guard 400 (champs requis manquants) avec mock db
 *   deactivateShipment / deleteShipment — guard 404 avec mock db+pool
 */

jest.mock('../../services/cost-allocation', () => ({
  allocateShipmentRealCosts: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../services/documents/customs-invoice', () => ({
  issue: jest.fn(),
  issueForShipment: jest.fn().mockResolvedValue({}),
}));

const {
  allocateCustoms,
  propagateCostDouane,
  listShipments,
  getEffectiveRates,
  getShipment,
  updateShipment,
  createShipment,
  deactivateShipment,
  activateShipment,
  deleteShipment,
  declareCustomsPayment,
  isCustomsDeclaredForOrder,
} = require('../../services/customs-shipment-service');

const costAllocation = require('../../services/cost-allocation');
const customsInvoice  = require('../../services/documents/customs-invoice');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseShipment = {
  customs_paid_kmf: 10000,
  allocation_method: 'by_cif_value',
  allocation_config: {},
};

const parcel3 = [
  { parcel_id: 'p1', cif_kmf: 3000, weight_kg: 10 },
  { parcel_id: 'p2', cif_kmf: 5000, weight_kg: 20 },
  { parcel_id: 'p3', cif_kmf: 2000, weight_kg: 5  },
];

// ── allocateCustoms ───────────────────────────────────────────────────────────

describe('allocateCustoms', () => {

  // ── Cas limites ──────────────────────────────────────────────────────────────

  describe('cas limites', () => {
    it('retourne [] si parcels vide', () => {
      expect(allocateCustoms(baseShipment, [])).toEqual([]);
    });

    it('retourne [] si customs_paid_kmf = 0', () => {
      const r = allocateCustoms({ ...baseShipment, customs_paid_kmf: 0 }, parcel3);
      expect(r).toEqual([]);
    });

    it('retourne [] si customs_paid_kmf absent (undefined)', () => {
      const r = allocateCustoms({ allocation_method: 'by_cif_value' }, parcel3);
      expect(r).toEqual([]);
    });

    it('la somme des parts = customs_paid_kmf (à l\'arrondi près)', () => {
      const r = allocateCustoms(baseShipment, parcel3);
      const sum = r.reduce((s, a) => s + a.customs_share_kmf, 0);
      expect(Math.abs(sum - 10000)).toBeLessThanOrEqual(0.05);
    });
  });

  // ── by_cif_value (défaut) ─────────────────────────────────────────────────

  describe('by_cif_value', () => {
    let result;
    beforeEach(() => {
      result = allocateCustoms({ ...baseShipment, allocation_method: 'by_cif_value' }, parcel3);
    });

    it('renvoie un résultat par colis', () => {
      expect(result).toHaveLength(3);
    });

    it('allocation_basis = by_cif_value', () => {
      result.forEach(a => expect(a.allocation_basis).toBe('by_cif_value'));
    });

    it('répartit proportionnellement à la valeur CIF', () => {
      // total CIF = 10000 → parts : 3000, 5000, 2000
      expect(result.find(a => a.parcel_id === 'p1').customs_share_kmf).toBeCloseTo(3000, 1);
      expect(result.find(a => a.parcel_id === 'p2').customs_share_kmf).toBeCloseTo(5000, 1);
      expect(result.find(a => a.parcel_id === 'p3').customs_share_kmf).toBeCloseTo(2000, 1);
    });

    it('utilise by_cif_value si allocation_method absent', () => {
      const r = allocateCustoms({ customs_paid_kmf: 1000 }, [
        { parcel_id: 'a', cif_kmf: 1, weight_kg: 0 },
        { parcel_id: 'b', cif_kmf: 1, weight_kg: 0 },
      ]);
      expect(r[0].customs_share_kmf).toBeCloseTo(500, 0);
      expect(r[1].customs_share_kmf).toBeCloseTo(500, 0);
    });

    it('fallback équitable si toutes les valeurs CIF = 0', () => {
      const zeroCif = [
        { parcel_id: 'a', cif_kmf: 0, weight_kg: 5 },
        { parcel_id: 'b', cif_kmf: 0, weight_kg: 5 },
      ];
      const r = allocateCustoms({ customs_paid_kmf: 1000, allocation_method: 'by_cif_value' }, zeroCif);
      expect(r[0].customs_share_kmf).toBeCloseTo(500, 0);
      expect(r[1].customs_share_kmf).toBeCloseTo(500, 0);
    });
  });

  // ── by_weight ─────────────────────────────────────────────────────────────

  describe('by_weight', () => {
    let result;
    beforeEach(() => {
      // poids : 10, 20, 5 → total 35
      result = allocateCustoms({ ...baseShipment, allocation_method: 'by_weight' }, parcel3);
    });

    it('répartit proportionnellement au poids', () => {
      const p1 = result.find(a => a.parcel_id === 'p1').customs_share_kmf;
      const p2 = result.find(a => a.parcel_id === 'p2').customs_share_kmf;
      const p3 = result.find(a => a.parcel_id === 'p3').customs_share_kmf;
      expect(p1).toBeCloseTo(10000 * 10 / 35, 0);
      expect(p2).toBeCloseTo(10000 * 20 / 35, 0);
      expect(p3).toBeCloseTo(10000 *  5 / 35, 0);
    });

    it('allocation_basis = by_weight', () => {
      result.forEach(a => expect(a.allocation_basis).toBe('by_weight'));
    });

    it('fallback équitable si tous les poids = 0', () => {
      const zeroPoids = [
        { parcel_id: 'a', cif_kmf: 0, weight_kg: 0 },
        { parcel_id: 'b', cif_kmf: 0, weight_kg: 0 },
        { parcel_id: 'c', cif_kmf: 0, weight_kg: 0 },
      ];
      const r = allocateCustoms({ customs_paid_kmf: 900, allocation_method: 'by_weight' }, zeroPoids);
      r.forEach(a => expect(a.customs_share_kmf).toBeCloseTo(300, 0));
    });
  });

  // ── by_volume ─────────────────────────────────────────────────────────────

  describe('by_volume', () => {
    const parcelsVol = [
      { parcel_id: 'v1', cif_kmf: 100, weight_kg: 1, volume_m3: 0.2 },
      { parcel_id: 'v2', cif_kmf: 100, weight_kg: 1, volume_m3: 0.8 },
    ];

    it('répartit proportionnellement au volume', () => {
      const r = allocateCustoms({ customs_paid_kmf: 1000, allocation_method: 'by_volume' }, parcelsVol);
      expect(r.find(a => a.parcel_id === 'v1').customs_share_kmf).toBeCloseTo(200, 1);
      expect(r.find(a => a.parcel_id === 'v2').customs_share_kmf).toBeCloseTo(800, 1);
    });

    it('fallback équitable si volume_m3 absent (undefined → 0)', () => {
      const noVol = [
        { parcel_id: 'a', cif_kmf: 0, weight_kg: 0 },
        { parcel_id: 'b', cif_kmf: 0, weight_kg: 0 },
      ];
      const r = allocateCustoms({ customs_paid_kmf: 600, allocation_method: 'by_volume' }, noVol);
      r.forEach(a => expect(a.customs_share_kmf).toBeCloseTo(300, 0));
    });
  });

  // ── manual ────────────────────────────────────────────────────────────────

  describe('manual', () => {
    it('retourne customs_share_kmf = 0 pour chaque colis', () => {
      const r = allocateCustoms({ ...baseShipment, allocation_method: 'manual' }, parcel3);
      expect(r).toHaveLength(3);
      r.forEach(a => {
        expect(a.customs_share_kmf).toBe(0);
        expect(a.allocation_basis).toBe('manual');
      });
    });

    it('préserve les autres champs du colis', () => {
      const r = allocateCustoms({ ...baseShipment, allocation_method: 'manual' }, [
        { parcel_id: 'x', cif_kmf: 500, weight_kg: 3, extra_field: 'oui' },
      ]);
      expect(r[0].parcel_id).toBe('x');
      expect(r[0].extra_field).toBe('oui');
    });
  });

  // ── mixed ─────────────────────────────────────────────────────────────────

  describe('mixed', () => {
    const parcels2 = [
      { parcel_id: 'm1', cif_kmf: 1000, weight_kg: 10 },
      { parcel_id: 'm2', cif_kmf: 3000, weight_kg: 10 },
    ];

    it('combine CIF et poids selon les pondérations cfg', () => {
      // cif 50/50: m1=25%, m2=75% | poids 50/50: m1=50%, m2=50%
      // mixed 70/30: m1 = 0.7*25% + 0.3*50% = 32.5%, m2 = 67.5%
      const r = allocateCustoms({
        customs_paid_kmf: 10000,
        allocation_method: 'mixed',
        allocation_config: { cif: 0.7, weight: 0.3 },
      }, parcels2);

      const share1 = r.find(a => a.parcel_id === 'm1').customs_share_kmf;
      const share2 = r.find(a => a.parcel_id === 'm2').customs_share_kmf;
      expect(share1).toBeCloseTo(3250, 0);
      expect(share2).toBeCloseTo(6750, 0);
      expect(share1 + share2).toBeCloseTo(10000, 0);
    });

    it('fallback 50/50 si cfg absent', () => {
      const r = allocateCustoms({
        customs_paid_kmf: 1000,
        allocation_method: 'mixed',
        allocation_config: {},
      }, [
        { parcel_id: 'a', cif_kmf: 800, weight_kg: 10 },
        { parcel_id: 'b', cif_kmf: 200, weight_kg: 10 },
      ]);
      // poids égaux → weight part = 50/50; cif 80/20 → mixed 50/50 → 65/35
      const s1 = r.find(a => a.parcel_id === 'a').customs_share_kmf;
      const s2 = r.find(a => a.parcel_id === 'b').customs_share_kmf;
      expect(s1 + s2).toBeCloseTo(1000, 0);
    });

    it('allocation_basis = mixed', () => {
      const r = allocateCustoms({ customs_paid_kmf: 100, allocation_method: 'mixed' }, parcels2);
      r.forEach(a => expect(a.allocation_basis).toBe('mixed'));
    });
  });

  // ── Arrondi ───────────────────────────────────────────────────────────────

  describe('arrondi', () => {
    it('arrondit à 2 décimales', () => {
      const r = allocateCustoms({ customs_paid_kmf: 1 }, [
        { parcel_id: 'a', cif_kmf: 1 },
        { parcel_id: 'b', cif_kmf: 2 },
        { parcel_id: 'c', cif_kmf: 3 },
      ]);
      r.forEach(a => {
        const s = String(a.customs_share_kmf);
        const decimals = s.includes('.') ? s.split('.')[1].length : 0;
        expect(decimals).toBeLessThanOrEqual(2);
      });
    });
  });
});

// ── Guards DB (mocks légers) ──────────────────────────────────────────────────

describe('updateShipment — guard 400', () => {
  it('lève err.status=400 si body vide', async () => {
    const mockDb = { query: jest.fn() };
    await expect(updateShipment(mockDb, 'any-id', {})).rejects.toMatchObject({
      status: 400,
      message: 'Aucun champ à modifier',
    });
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('lève err.status=400 si body ne contient que des champs inconnus', async () => {
    const mockDb = { query: jest.fn() };
    await expect(updateShipment(mockDb, 'any-id', { foo: 'bar', baz: 123 })).rejects.toMatchObject({
      status: 400,
    });
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('appelle db.query si au moins un champ autorisé présent', async () => {
    const mockDb = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'x', reference: 'REF-001' }] }),
    };
    const result = await updateShipment(mockDb, 'x', { reference: 'REF-001' });
    expect(mockDb.query).toHaveBeenCalledTimes(1);
    expect(result.shipment.reference).toBe('REF-001');
  });

  it('lève err.status=404 si la query retourne rows vides', async () => {
    const mockDb = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(updateShipment(mockDb, 'ghost', { notes: 'x' })).rejects.toMatchObject({
      status: 404,
      message: 'Shipment not found',
    });
  });
});

describe('createShipment — guard 400', () => {
  const makePoolDb = () => ({
    pool: { connect: jest.fn() },
    query: jest.fn(),
  });

  it('lève err.status=400 si reference manquant', async () => {
    await expect(createShipment(makePoolDb(), {
      shipment_date: '2026-01-01',
      cif_value_kmf: 100,
      customs_paid_kmf: 20,
    }, 'user-1')).rejects.toMatchObject({ status: 400 });
  });

  it('lève err.status=400 si cif_value_kmf manquant', async () => {
    // customs_paid_kmf n'est plus requis à la création (workflow deux étapes —
    // déclaration via declareCustomsPayment). cif_value_kmf reste requis.
    await expect(createShipment(makePoolDb(), {
      reference: 'ENV-001',
      shipment_date: '2026-01-01',
    }, 'user-1')).rejects.toMatchObject({ status: 400 });
  });
});

describe('deactivateShipment — guard 404', () => {
  it('lève err.status=404 si shipment introuvable', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'ROLLBACK') return { rows: [] };
        // UPDATE retourne rows vides → shipment not found
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    await expect(deactivateShipment(mockDb, 'ghost-id', 'test')).rejects.toMatchObject({
      status: 404,
      message: 'Shipment not found',
    });
    expect(client.release).toHaveBeenCalled();
  });
});

describe('deleteShipment — guard 404', () => {
  it('lève err.status=404 si aucune ligne supprimée', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'ROLLBACK') return { rows: [] };
        if (s.startsWith('SELECT parcel_id')) return { rows: [] };   // linkedParcels vide
        // DELETE → rowCount 0
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    await expect(deleteShipment(mockDb, 'ghost-id')).rejects.toMatchObject({
      status: 404,
    });
    expect(client.release).toHaveBeenCalled();
  });

  it('supprime avec succès et propage le recalcul aux orders liées', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'COMMIT') return { rows: [] };
        if (s.startsWith('SELECT parcel_id')) return { rows: [{ parcel_id: 'p1' }, { parcel_id: 'p2' }] };
        if (s.startsWith('DELETE FROM customs_shipments')) return { rows: [], rowCount: 1 };
        if (s.startsWith('SELECT DISTINCT order_id')) return { rows: [{ order_id: 'order-1' }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    const result = await deleteShipment(mockDb, 'ship-1');

    expect(result).toEqual({ deleted: true, id: 'ship-1', parcels_recalculated: 2 });
    expect(client.release).toHaveBeenCalled();
  });
});

// ── propagateCostDouane ────────────────────────────────────────────────────

describe('propagateCostDouane', () => {
  it('ne fait rien si parcelIds vide/non tableau', async () => {
    const client = { query: jest.fn() };
    await propagateCostDouane(client, []);
    await propagateCostDouane(client, undefined);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('ne fait rien si aucune order liée trouvée', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    await propagateCostDouane(client, ['p1']);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('met à jour cost_douane_kmf puis margin_real_pct pour les orders trouvées', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ order_id: 'o1' }, { order_id: 'o2' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    await propagateCostDouane(client, ['p1', 'p2']);
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.query.mock.calls[1][0]).toMatch(/SET cost_douane_kmf/);
    expect(client.query.mock.calls[2][0]).toMatch(/SET margin_real_pct/);
  });
});

// ── listShipments ───────────────────────────────────────────────────────────

describe('listShipments', () => {
  it('sans filtre : conds = 1=1 seul', async () => {
    const mockDb = { query: jest.fn().mockResolvedValue({ rows: [{ id: 's1' }] }) };
    const result = await listShipments(mockDb);
    expect(result.shipments).toHaveLength(1);
    expect(mockDb.query.mock.calls[0][1]).toEqual([]);
  });

  it('avec filtres from/to/active=true', async () => {
    const mockDb = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listShipments(mockDb, { from: '2026-01-01', to: '2026-06-01', active: 'true' });
    const [sql, params] = mockDb.query.mock.calls[0];
    expect(sql).toMatch(/shipment_date >= \$1/);
    expect(sql).toMatch(/shipment_date <= \$2/);
    expect(sql).toMatch(/is_active = \$3/);
    expect(params).toEqual(['2026-01-01', '2026-06-01', true]);
  });

  it("active='1' est aussi interprété comme true", async () => {
    const mockDb = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listShipments(mockDb, { active: '1' });
    expect(mockDb.query.mock.calls[0][1]).toEqual([true]);
  });

  it("active='false' → false", async () => {
    const mockDb = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listShipments(mockDb, { active: 'false' });
    expect(mockDb.query.mock.calls[0][1]).toEqual([false]);
  });
});

// ── getEffectiveRates ────────────────────────────────────────────────────────

describe('getEffectiveRates', () => {
  it('indexe les taux par period et retourne fallback_rate_pct=15', async () => {
    const mockDb = {
      query: jest.fn().mockResolvedValue({
        rows: [{ period: '2026-Q1', rate_pct: 12 }, { period: '2026-Q2', rate_pct: 14 }],
      }),
    };
    const result = await getEffectiveRates(mockDb);
    expect(result.fallback_rate_pct).toBe(15);
    expect(result.rates['2026-Q1'].rate_pct).toBe(12);
    expect(result.rates['2026-Q2'].rate_pct).toBe(14);
  });
});

// ── getShipment ───────────────────────────────────────────────────────────────

describe('getShipment', () => {
  it('lève err.status=404 si shipment introuvable', async () => {
    const mockDb = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    await expect(getShipment(mockDb, 'ghost')).rejects.toMatchObject({
      status: 404, message: 'Shipment not found',
    });
  });

  it('retourne shipment + parcels liés', async () => {
    const mockDb = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 's1', reference: 'ENV-001' }] })
        .mockResolvedValueOnce({ rows: [{ parcel_id: 'p1', parcel_ref: 'COL-1' }] }),
    };
    const result = await getShipment(mockDb, 's1');
    expect(result.shipment.reference).toBe('ENV-001');
    expect(result.parcels).toHaveLength(1);
  });
});

// ── createShipment — happy paths ───────────────────────────────────────────

describe('createShipment — happy paths', () => {
  const makeClient = (overrides = {}) => ({
    query: jest.fn(async (sql) => {
      const s = sql.trim();
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.startsWith('INSERT INTO customs_shipments')) {
        return { rows: [overrides.shipment || { id: 'ship-1', reference: 'ENV-001' }] };
      }
      if (s.startsWith('SELECT p.id, p.reference')) {
        return { rows: overrides.parcelData || [{ id: 'p1', cif_kmf: 1000, weight_kg: 5 }] };
      }
      if (s.startsWith('INSERT INTO customs_shipment_parcels')) return { rows: [] };
      if (s.startsWith('UPDATE customs_shipments')) return { rows: [] };
      if (s.startsWith('SELECT DISTINCT order_id')) return { rows: [] };
      return { rows: [] };
    }),
    release: jest.fn(),
  });

  it('ventile immédiatement si customs_paid_kmf + parcel_ids fournis', async () => {
    const client = makeClient();
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    const result = await createShipment(mockDb, {
      reference: 'ENV-001', shipment_date: '2026-01-01', cif_value_kmf: 100000,
      customs_paid_kmf: 15000, parcel_ids: ['p1'],
    }, 'user-1');

    expect(result.shipment.id).toBe('ship-1');
    expect(result.allocations).toHaveLength(1);
    expect(client.query.mock.calls.some(c => c[0].trim().startsWith('UPDATE customs_shipments'))).toBe(true);
  });

  it('rattache les colis sans ventiler si customs_paid_kmf absent', async () => {
    const client = makeClient();
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    const result = await createShipment(mockDb, {
      reference: 'ENV-002', shipment_date: '2026-01-01', cif_value_kmf: 50000,
      parcel_ids: ['p1', 'p2'],
    }, 'user-1');

    expect(result.allocations).toEqual([]);
    const inserts = client.query.mock.calls.filter(c => c[0].trim().startsWith('INSERT INTO customs_shipment_parcels'));
    expect(inserts).toHaveLength(2);
  });

  it('ne rattache ni ne ventile si aucun parcel_ids fourni', async () => {
    const client = makeClient();
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    const result = await createShipment(mockDb, {
      reference: 'ENV-003', shipment_date: '2026-01-01', cif_value_kmf: 20000,
    }, 'user-1');

    expect(result.allocations).toEqual([]);
  });

  it('rollback + relance si une query échoue', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN') return { rows: [] };
        if (s.startsWith('INSERT INTO customs_shipments')) throw new Error('db down');
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    await expect(createShipment(mockDb, {
      reference: 'ENV-004', shipment_date: '2026-01-01', cif_value_kmf: 1000,
    }, 'user-1')).rejects.toThrow('db down');
    expect(client.release).toHaveBeenCalled();
  });
});

// ── deactivateShipment — happy path ─────────────────────────────────────────

describe('deactivateShipment — happy path', () => {
  it('désactive, retire la ventilation et propage', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'COMMIT') return { rows: [] };
        if (s.startsWith('UPDATE customs_shipments')) return { rows: [{ id: 'ship-1', is_active: false }] };
        if (s.startsWith('DELETE FROM customs_shipment_parcels')) return { rows: [{ parcel_id: 'p1' }, { parcel_id: 'p2' }] };
        if (s.startsWith('SELECT DISTINCT order_id')) return { rows: [] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    const result = await deactivateShipment(mockDb, 'ship-1', 'erreur saisie');

    expect(result.parcels_reset).toBe(2);
    expect(result.shipment.id).toBe('ship-1');
  });
});

// ── activateShipment ─────────────────────────────────────────────────────────

describe('activateShipment', () => {
  it('lève err.status=404 si shipment introuvable', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'ROLLBACK') return { rows: [] };
        return { rows: [] }; // UPDATE → not found
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    await expect(activateShipment(mockDb, 'ghost', [])).rejects.toMatchObject({ status: 404 });
    expect(client.release).toHaveBeenCalled();
  });

  it('réactive et re-ventile les colis fournis', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'COMMIT') return { rows: [] };
        if (s.startsWith('UPDATE customs_shipments')) return { rows: [{ id: 'ship-1', customs_paid_kmf: 10000, allocation_method: 'by_cif_value' }] };
        if (s.startsWith('SELECT p.id, p.reference')) return { rows: [{ id: 'p1', cif_kmf: 1000, weight_kg: 5 }] };
        if (s.startsWith('INSERT INTO customs_shipment_parcels')) return { rows: [] };
        if (s.startsWith('SELECT DISTINCT order_id')) return { rows: [] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    const result = await activateShipment(mockDb, 'ship-1', ['p1']);

    expect(result.allocations).toHaveLength(1);
    expect(result.message).toMatch(/réactivé/);
  });
});

// ── declareCustomsPayment ────────────────────────────────────────────────────

describe('declareCustomsPayment', () => {
  afterEach(() => jest.clearAllMocks());

  it('lève err.status=400 si customs_paid_kmf manquant ou <= 0', async () => {
    const mockDb = { pool: { connect: jest.fn() } };
    await expect(declareCustomsPayment(mockDb, 'ship-1', {}, 'user-1'))
      .rejects.toMatchObject({ status: 400 });
    await expect(declareCustomsPayment(mockDb, 'ship-1', { customs_paid_kmf: -5 }, 'user-1'))
      .rejects.toMatchObject({ status: 400 });
    expect(mockDb.pool.connect).not.toHaveBeenCalled();
  });

  it('lève err.status=404 si expédition introuvable', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'ROLLBACK') return { rows: [] };
        return { rows: [] }; // SELECT ... FOR UPDATE → not found
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    await expect(declareCustomsPayment(mockDb, 'ghost', { customs_paid_kmf: 1000 }, 'user-1'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('lève err.status=409 si expédition déjà confirmée', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'ROLLBACK') return { rows: [] };
        if (s.startsWith('SELECT * FROM customs_shipments')) return { rows: [{ id: 'ship-1', status: 'confirmed' }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    await expect(declareCustomsPayment(mockDb, 'ship-1', { customs_paid_kmf: 1000 }, 'user-1'))
      .rejects.toMatchObject({ status: 409 });
  });

  it('déclare, ventile, propage et pose customs_cleared_at sur les colis (happy path complet)', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'COMMIT') return { rows: [] };
        if (s.startsWith('SELECT * FROM customs_shipments')) return { rows: [{ id: 'ship-1', status: 'pending', allocation_method: 'by_cif_value' }] };
        if (s.startsWith('UPDATE customs_shipments SET')) return { rows: [] };
        if (s.startsWith('SELECT parcel_id FROM customs_shipment_parcels')) return { rows: [{ parcel_id: 'p1' }] };
        if (s.startsWith('SELECT p.id, p.reference')) return { rows: [{ id: 'p1', cif_kmf: 1000, weight_kg: 5 }] };
        if (s.startsWith('INSERT INTO customs_shipment_parcels')) return { rows: [] };
        if (s.startsWith('SELECT DISTINCT order_id')) return { rows: [] };
        if (s.startsWith('UPDATE parcels')) return { rows: [] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    const result = await declareCustomsPayment(mockDb, 'ship-1', {
      customs_paid_kmf: 12000, freight_kmf: 500, notes: 'transitaire X',
    }, 'user-1');

    expect(result).toEqual({
      shipment_id: 'ship-1', status: 'declared', customs_paid_kmf: 12000, parcels_updated: 1,
    });
    expect(costAllocation.allocateShipmentRealCosts).toHaveBeenCalledWith('ship-1');
    expect(customsInvoice.issueForShipment).toHaveBeenCalledWith(['p1'], 'ship-1', 'user-1');
  });

  it('happy path sans colis rattachés (pas de ventilation ni facture)', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'COMMIT') return { rows: [] };
        if (s.startsWith('SELECT * FROM customs_shipments')) return { rows: [{ id: 'ship-1', status: 'pending' }] };
        if (s.startsWith('UPDATE customs_shipments SET')) return { rows: [] };
        if (s.startsWith('SELECT parcel_id FROM customs_shipment_parcels')) return { rows: [] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    const result = await declareCustomsPayment(mockDb, 'ship-1', { customs_paid_kmf: 5000 }, 'user-1');

    expect(result.parcels_updated).toBe(0);
    expect(customsInvoice.issueForShipment).not.toHaveBeenCalled();
  });

  it('continue même si allocateShipmentRealCosts échoue (non bloquant)', async () => {
    costAllocation.allocateShipmentRealCosts.mockRejectedValueOnce(new Error('alloc partiel'));
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'COMMIT') return { rows: [] };
        if (s.startsWith('SELECT * FROM customs_shipments')) return { rows: [{ id: 'ship-1', status: 'pending' }] };
        if (s.startsWith('UPDATE customs_shipments SET')) return { rows: [] };
        if (s.startsWith('SELECT parcel_id FROM customs_shipment_parcels')) return { rows: [] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    await expect(declareCustomsPayment(mockDb, 'ship-1', { customs_paid_kmf: 5000 }, 'user-1'))
      .resolves.toMatchObject({ status: 'declared' });
  });

  it('continue même si customsInvoice.issueForShipment échoue (non bloquant)', async () => {
    customsInvoice.issueForShipment.mockRejectedValueOnce(new Error('facture partielle'));
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN' || s === 'COMMIT') return { rows: [] };
        if (s.startsWith('SELECT * FROM customs_shipments')) return { rows: [{ id: 'ship-1', status: 'pending' }] };
        if (s.startsWith('UPDATE customs_shipments SET')) return { rows: [] };
        if (s.startsWith('SELECT parcel_id FROM customs_shipment_parcels')) return { rows: [{ parcel_id: 'p1' }] };
        if (s.startsWith('SELECT p.id, p.reference')) return { rows: [{ id: 'p1', cif_kmf: 1000, weight_kg: 5 }] };
        if (s.startsWith('INSERT INTO customs_shipment_parcels')) return { rows: [] };
        if (s.startsWith('SELECT DISTINCT order_id')) return { rows: [] };
        if (s.startsWith('UPDATE parcels')) return { rows: [] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    await expect(declareCustomsPayment(mockDb, 'ship-1', { customs_paid_kmf: 5000 }, 'user-1'))
      .resolves.toMatchObject({ status: 'declared' });
  });

  it('rollback si une query échoue en cours de transaction', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const s = sql.trim();
        if (s === 'BEGIN') return { rows: [] };
        if (s.startsWith('SELECT * FROM customs_shipments')) throw new Error('db down');
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockDb = { pool: { connect: jest.fn().mockResolvedValue(client) } };

    await expect(declareCustomsPayment(mockDb, 'ship-1', { customs_paid_kmf: 5000 }, 'user-1'))
      .rejects.toThrow('db down');
    expect(client.release).toHaveBeenCalled();
  });
});

// ── isCustomsDeclaredForOrder ────────────────────────────────────────────────

describe('isCustomsDeclaredForOrder', () => {
  it('bloque si un colis dépend d\'une expédition non déclarée', async () => {
    const mockQ = { query: jest.fn().mockResolvedValue({ rows: [{ status: 'pending', reference: 'ENV-005' }] }) };

    const result = await isCustomsDeclaredForOrder(mockQ, 'order-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/ENV-005/);
  });

  it('autorise si aucun colis lié à une expédition non déclarée', async () => {
    const mockQ = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    const result = await isCustomsDeclaredForOrder(mockQ, 'order-1');

    expect(result).toEqual({ allowed: true });
  });
});
