'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/hub-operations.js (REFACTO-R2)
 *
 * Couverture :
 *   receiveParcel — nominal, colis introuvable
 *   packParcel    — nominal, introuvable, mauvais statut
 *   sealParcel    — nominal, introuvable, mauvais statut
 *   batchScan     — nominal, vide, > 50, erreur partielle
 */

jest.mock('../../db');
jest.mock('../../utils/parcelSync');

const db               = require('../../db');
const { safeSyncScanToParcels } = require('../../utils/parcelSync');
const hubOps           = require('../../services/hub-operations');

// Helper : crée un mock client de transaction
function makeClient(queryResponses = []) {
  let callIdx = 0;
  return {
    query: jest.fn().mockImplementation(() => {
      const r = queryResponses[callIdx++];
      return Promise.resolve(r ?? { rows: [], rowCount: 0 });
    }),
    release: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  safeSyncScanToParcels.mockResolvedValue({ synced: true });
});

// ─── receiveParcel ────────────────────────────────────────────────────────────

describe('receiveParcel', () => {
  test('nominal — scanne un colis et retourne 200 + parcel mis à jour', async () => {
    const parcel = { id: 'p1', order_id: 'o1', status: 'draft', reference: 'REF-001' };
    const client = makeClient([
      {},                                    // BEGIN
      { rows: [parcel] },                    // SELECT FOR UPDATE
      {},                                    // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [{ ...parcel, status: 'preparation' }] }); // SELECT après commit

    const result = await hubOps.receiveParcel('REF-001', 'user1', 'notes test');

    expect(result.status).toBe(200);
    expect(result.body.message).toMatch('REF-001');
    expect(result.body.sync).toEqual({ synced: true });
    expect(safeSyncScanToParcels).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'hub_preparation', order_id: 'o1' }),
      client
    );
    expect(client.release).toHaveBeenCalled();
  });

  test('colis introuvable → 404 + ROLLBACK', async () => {
    const client = makeClient([
      {},            // BEGIN
      { rows: [] },  // SELECT → vide
      {},            // ROLLBACK
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await hubOps.receiveParcel('INCONNU', 'user1');

    expect(result.status).toBe(404);
    expect(result.body.error).toMatch('INCONNU');
    expect(safeSyncScanToParcels).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });
});

// ─── packParcel ───────────────────────────────────────────────────────────────

describe('packParcel', () => {
  test('nominal — marque emballé et retourne 200', async () => {
    const parcel = { id: 'p2', order_id: 'o2', status: 'preparation', reference: 'REF-002' };
    const client = makeClient([
      {},                   // BEGIN
      { rows: [parcel] },   // SELECT FOR UPDATE
      {},                   // UPDATE notes
      {},                   // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [parcel] }); // SELECT final

    const result = await hubOps.packParcel('p2', 'user1', 'BOX-A', 'fragile');

    expect(result.status).toBe(200);
    expect(result.body.message).toMatch('REF-002');
    expect(client.release).toHaveBeenCalled();
  });

  test('colis introuvable → 404', async () => {
    const client = makeClient([{}, { rows: [] }, {}]); // BEGIN, SELECT vide, ROLLBACK
    db.getClient.mockResolvedValue(client);

    const result = await hubOps.packParcel('inconnu', 'user1');
    expect(result.status).toBe(404);
  });

  test('colis pas en préparation → 400', async () => {
    const parcel = { id: 'p3', status: 'shipped', reference: 'REF-003' };
    const client = makeClient([{}, { rows: [parcel] }, {}]); // BEGIN, SELECT, ROLLBACK
    db.getClient.mockResolvedValue(client);

    const result = await hubOps.packParcel('p3', 'user1');
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('préparation');
  });
});

// ─── sealParcel ───────────────────────────────────────────────────────────────

describe('sealParcel', () => {
  test('nominal — scelle et retourne 200 + sync shipped', async () => {
    const parcel = { id: 'p4', order_id: 'o4', status: 'preparation', reference: 'REF-004' };
    const client = makeClient([
      {},                   // BEGIN
      { rows: [parcel] },   // SELECT FOR UPDATE
      {},                   // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [{ ...parcel, status: 'shipped' }] });

    const result = await hubOps.sealParcel('p4', 'user1');

    expect(result.status).toBe(200);
    expect(result.body.message).toMatch('expédier');
    expect(safeSyncScanToParcels).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'shipped' }),
      client
    );
  });

  test('colis pas en préparation → 400', async () => {
    const parcel = { id: 'p5', status: 'draft', reference: 'REF-005' };
    const client = makeClient([{}, { rows: [parcel] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await hubOps.sealParcel('p5', 'user1');
    expect(result.status).toBe(400);
  });
});

// ─── batchScan ────────────────────────────────────────────────────────────────

describe('batchScan', () => {
  test('tableau vide → 400', async () => {
    const result = await hubOps.batchScan([], 'user1');
    expect(result.status).toBe(400);
    expect(db.getClient).not.toHaveBeenCalled();
  });

  test('> 50 refs → 400', async () => {
    const refs = Array.from({ length: 51 }, (_, i) => `REF-${i}`);
    const result = await hubOps.batchScan(refs, 'user1');
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('50');
  });

  test('nominal 2 colis — 2 scannés, 0 erreur', async () => {
    const makeParcel = (ref, id) => ({ id, order_id: 'o1', status: 'draft', reference: ref });

    // getClient appelé 2 fois (une tx par colis)
    db.getClient
      .mockResolvedValueOnce(makeClient([{}, { rows: [makeParcel('R1', 'p1')] }, {}]))
      .mockResolvedValueOnce(makeClient([{}, { rows: [makeParcel('R2', 'p2')] }, {}]));

    const result = await hubOps.batchScan(['R1', 'R2'], 'user1');

    expect(result.status).toBe(200);
    expect(result.body.total_success).toBe(2);
    expect(result.body.total_errors).toBe(0);
  });

  test('erreur partielle — 1 succès, 1 introuvable', async () => {
    const parcel = { id: 'p1', order_id: 'o1', status: 'draft', reference: 'R1' };

    db.getClient
      .mockResolvedValueOnce(makeClient([{}, { rows: [parcel] }, {}]))
      .mockResolvedValueOnce(makeClient([{}, { rows: [] }, {}])); // introuvable

    const result = await hubOps.batchScan(['R1', 'INCONNU'], 'user1');

    expect(result.status).toBe(200);
    expect(result.body.total_success).toBe(1);
    expect(result.body.total_errors).toBe(1);
    expect(result.body.errors[0].ref).toBe('INCONNU');
  });
});
