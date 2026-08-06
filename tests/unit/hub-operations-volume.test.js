'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/hub-operations-volume.test.js
 * Tests de caractérisation — lots V-4 (densité de valeur) et Q-1 (non-conformité)
 *
 * Couvre :
 *   computeVolumeTasks — repack prescrit (gain ≥ seuil), measure (volume absent),
 *                        exempt ignoré, gain sous seuil, priorité repack > measure,
 *                        SANS CONTRAINTE : erreur DB avalée, jamais d'échec de scan
 *   recordVolume       — nominal (une mesure, deux mesures), produit introuvable,
 *                        payload vide refusé
 *   recordSealPhoto    — nominal (event seal_photo + compteur), colis introuvable
 *
 * Doctrines : DOCTRINE_DENSITE_VALEUR §5, DOCTRINE_NON_CONFORMITE §2.
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));
jest.mock('../../utils/parcelSync', () => ({
  safeSyncScanToParcels: jest.fn().mockResolvedValue({}),
}));

const db = require('../../db');
const {
  computeVolumeTasks,
  recordVolume,
  recordSealPhoto,
} = require('../../services/hub-operations');

beforeEach(() => jest.clearAllMocks());

// Petite aide : router les db.query par fragment de SQL
function routeQueries(routes) {
  db.query.mockImplementation(async (sql, params) => {
    for (const [fragment, handler] of routes) {
      if (sql.includes(fragment)) {
        return typeof handler === 'function' ? handler(sql, params) : handler;
      }
    }
    return { rows: [] };
  });
}

// ════════════════════════════════════════════════════════════════
// 1. computeVolumeTasks (V-4)
// ════════════════════════════════════════════════════════════════

describe('computeVolumeTasks', () => {
  const rule = { rows: [{ value: { value: 2000 } }] };

  it('prescrit repack quand le gain prouvé dépasse le seuil', async () => {
    routeQueries([
      ['business_rules', rule],
      ['parcel_items', { rows: [{
        product_id: 'p1', name: 'Ventilateur', quantity: 1,
        volume_cm3: 30000, repack_volume_cm3: 12000, repack_exempt: false,
      }] }],
    ]);

    const r = await computeVolumeTasks('parcel-1');

    expect(r.next_action).toBe('repack');
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]).toMatchObject({ task: 'repack', gain_cm3: 18000 });
  });

  it('prescrit measure quand le volume est inconnu', async () => {
    routeQueries([
      ['business_rules', rule],
      ['parcel_items', { rows: [{
        product_id: 'p2', name: 'Mystère', quantity: 2,
        volume_cm3: null, repack_volume_cm3: null, repack_exempt: false,
      }] }],
    ]);

    const r = await computeVolumeTasks('parcel-1');

    expect(r.next_action).toBe('measure_volume');
    expect(r.tasks[0].task).toBe('measure');
  });

  it('ignore les produits repack_exempt (fragile : la protection prime)', async () => {
    routeQueries([
      ['business_rules', rule],
      ['parcel_items', { rows: [{
        product_id: 'p3', name: 'Fragile', quantity: 1,
        volume_cm3: null, repack_volume_cm3: null, repack_exempt: true,
      }] }],
    ]);

    const r = await computeVolumeTasks('parcel-1');

    expect(r.next_action).toBeNull();
    expect(r.tasks).toHaveLength(0);
  });

  it('ne prescrit rien sous le seuil de gain', async () => {
    routeQueries([
      ['business_rules', rule],
      ['parcel_items', { rows: [{
        product_id: 'p4', name: 'Chaussures', quantity: 1,
        volume_cm3: 8000, repack_volume_cm3: 7500, repack_exempt: false,
      }] }],
    ]);

    const r = await computeVolumeTasks('parcel-1');

    expect(r.next_action).toBeNull();
  });

  it('priorise repack sur measure dans un colis mixte', async () => {
    routeQueries([
      ['business_rules', rule],
      ['parcel_items', { rows: [
        { product_id: 'p1', name: 'Ventilateur', quantity: 1,
          volume_cm3: 30000, repack_volume_cm3: 12000, repack_exempt: false },
        { product_id: 'p2', name: 'Mystère', quantity: 1,
          volume_cm3: null, repack_volume_cm3: null, repack_exempt: false },
      ] }],
    ]);

    const r = await computeVolumeTasks('parcel-1');

    expect(r.next_action).toBe('repack');
    expect(r.tasks).toHaveLength(2);
  });

  it('retombe sur le seuil fallback si business_rules est inaccessible', async () => {
    routeQueries([
      ['business_rules', () => { throw new Error('DB down'); }],
      ['parcel_items', { rows: [{
        product_id: 'p1', name: 'Ventilateur', quantity: 1,
        volume_cm3: 30000, repack_volume_cm3: 12000, repack_exempt: false,
      }] }],
    ]);

    const r = await computeVolumeTasks('parcel-1');

    // gain 18000 ≥ fallback 2000 → repack quand même
    expect(r.next_action).toBe('repack');
  });

  it('SANS CONTRAINTE : avale toute erreur — le scan ne casse jamais', async () => {
    db.query.mockRejectedValue(new Error('connexion perdue'));

    const r = await computeVolumeTasks('parcel-1');

    expect(r).toEqual({ next_action: null, tasks: [] });
  });
});

// ════════════════════════════════════════════════════════════════
// 2. recordVolume (V-4)
// ════════════════════════════════════════════════════════════════

describe('recordVolume', () => {
  it('refuse un payload sans aucune mesure', async () => {
    const r = await recordVolume('prod-1', 'agent-1', {});

    expect(r.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('enregistre volume_cm3 seul et calcule le gain si repack connu', async () => {
    db.query.mockResolvedValue({ rows: [{
      id: 'prod-1', name: 'Ventilateur',
      volume_cm3: 30000, repack_volume_cm3: 12000, repack_exempt: false,
    }] });

    const r = await recordVolume('prod-1', 'agent-1', { volume_cm3: 30000 });

    expect(r.status).toBe(200);
    expect(r.body.repack_gain_cm3).toBe(18000);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('volume_cm3 = $1');
    expect(params).toEqual([30000, 'prod-1']);
  });

  it('enregistre les deux mesures en un seul UPDATE', async () => {
    db.query.mockResolvedValue({ rows: [{
      id: 'prod-1', name: 'Ventilateur',
      volume_cm3: 30000, repack_volume_cm3: 12000, repack_exempt: false,
    }] });

    const r = await recordVolume('prod-1', 'agent-1',
      { volume_cm3: 30000, repack_volume_cm3: 12000 });

    expect(r.status).toBe(200);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('volume_cm3 = $1');
    expect(sql).toContain('repack_volume_cm3 = $2');
    expect(params).toEqual([30000, 12000, 'prod-1']);
  });

  it('retourne 404 si le produit est introuvable', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const r = await recordVolume('inconnu', 'agent-1', { volume_cm3: 100 });

    expect(r.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. recordSealPhoto (Q-1 — borne 1 de responsabilité)
// ════════════════════════════════════════════════════════════════

describe('recordSealPhoto', () => {
  it('insère un scan_event seal_photo et retourne le compteur', async () => {
    routeQueries([
      ['FROM parcels', { rows: [{ id: 'parcel-1', reference: 'KP-2026-0042' }] }],
      ['INSERT INTO scan_events', (sql, params) => {
        expect(sql).toContain("'seal_photo'");
        expect(sql).toContain("'hub_agent'");
        expect(params).toEqual(['parcel-1', 'agent-1', '/uploads/hub/abc.jpg', 'carton 2/5']);
        return { rows: [{ id: 'evt-1', created_at: '2026-07-03T12:00:00Z' }] };
      }],
      ['SUM(cardinality', { rows: [{ photo_count: '3' }] }],
    ]);

    const r = await recordSealPhoto('parcel-1', 'agent-1', '/uploads/hub/abc.jpg', 'carton 2/5');

    expect(r.status).toBe(201);
    expect(r.body.photo_count).toBe(3);
    expect(r.body.event_id).toBe('evt-1');
  });

  it('retourne 404 si le colis est introuvable — rien n\'est inséré', async () => {
    routeQueries([
      ['FROM parcels', { rows: [] }],
    ]);

    const r = await recordSealPhoto('inconnu', 'agent-1', '/uploads/hub/x.jpg');

    expect(r.status).toBe(404);
    const inserts = db.query.mock.calls.filter(([sql]) => sql.includes('INSERT'));
    expect(inserts).toHaveLength(0);
  });
});
