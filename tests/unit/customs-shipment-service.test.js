'use strict';

/**
 * Tests unitaires — services/customs-shipment-service.js (R8)
 *
 * Couvre :
 *   allocateCustoms — fonction pure, tous les modes de ventilation
 *   updateShipment  — guard 400 (aucun champ) avec mock db
 *   createShipment  — guard 400 (champs requis manquants) avec mock db
 *   deactivateShipment / deleteShipment — guard 404 avec mock db+pool
 */

const {
  allocateCustoms,
  updateShipment,
  createShipment,
  deactivateShipment,
  deleteShipment,
} = require('../../services/customs-shipment-service');

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

  it('lève err.status=400 si customs_paid_kmf manquant', async () => {
    await expect(createShipment(makePoolDb(), {
      reference: 'ENV-001',
      shipment_date: '2026-01-01',
      cif_value_kmf: 100,
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
});
