'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/logistics.test.js
 *
 * Tests du router routes/logistics.js (M12 colisage & PDF)
 *
 * pdfkit et qrcode sont mockés (pas de vrai rendu PDF) — on vérifie le
 * contrat HTTP (status, headers, délégation) et les invariants métier :
 *
 *   ✓ POST /shipments : génère la référence puis insère
 *   ✓ GET /shipments : liste avec nb_commandes agrégé
 *   ✓ PATCH /shipments/:id : 404 si introuvable ; COALESCE update ;
 *     déclenche safeSyncScanToParcels + logParcelEvent + notifyText
 *     UNIQUEMENT si arrived_at ET customs_cleared_at sont fournis ensemble
 *   ✓ GET /labels/:shipment_id : 404 si aucun colis ; sinon PDF (Content-Type, Content-Disposition)
 *   ✓ GET /manifest/:shipment_id : PDF avec Content-Disposition basé sur la référence shipment
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'u-admin', role: 'admin' }; next(); },
  requireRole: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../validators', () => ({ logistics: { createShipment: {}, updateShipment: {} } }));

const mockGenerateShipmentRef = jest.fn().mockResolvedValue('EXP-2026-0001');
jest.mock('../../utils/reference', () => ({
  generateShipmentRef: (...args) => mockGenerateShipmentRef(...args),
}));

const mockSafeSyncScanToParcels = jest.fn().mockResolvedValue({});
jest.mock('../../utils/parcelSync', () => ({
  safeSyncScanToParcels: (...args) => mockSafeSyncScanToParcels(...args),
}));

const mockNotifyText = jest.fn().mockResolvedValue({});
jest.mock('../../services/notification-service', () => ({
  notifyText: (...args) => mockNotifyText(...args),
  appendRelayLocation: (...args) => (
    jest.requireActual('../../services/notifications/relay-location').appendRelayLocation(...args)
  ),
}));

const mockLogParcelEvent = jest.fn().mockResolvedValue({});
jest.mock('../../services/parcel-security', () => ({
  logParcelEvent: (...args) => mockLogParcelEvent(...args),
}));

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,AAAA'),
}));

jest.mock('pdfkit', () => jest.fn().mockImplementation(() => {
  const doc = {
    _stream: null,
    pipe(stream) { doc._stream = stream; return doc; },
    fontSize() { return doc; },
    font() { return doc; },
    text() { return doc; },
    moveDown() { return doc; },
    image() { return doc; },
    moveTo() { return doc; },
    lineTo() { return doc; },
    dash() { return doc; },
    undash() { return doc; },
    stroke() { return doc; },
    fillColor() { return doc; },
    addPage() { return doc; },
    y: 100,
    end() { if (doc._stream && doc._stream.end) doc._stream.end(); },
  };
  return doc;
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerateShipmentRef.mockResolvedValue('EXP-2026-0001');
  mockSafeSyncScanToParcels.mockResolvedValue({});
  mockNotifyText.mockResolvedValue({});
  mockLogParcelEvent.mockResolvedValue({});

  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/logistics');
    app.use('/api/logistics', router);
  });
});

describe('POST /api/logistics/shipments', () => {
  test('génère la référence puis insère le shipment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'S1', reference: 'EXP-2026-0001', carrier: 'DHL' }] });

    const res = await request(app).post('/api/logistics/shipments').send({ carrier: 'DHL', container_ref: 'C1' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'S1', reference: 'EXP-2026-0001', carrier: 'DHL' });
    expect(mockGenerateShipmentRef).toHaveBeenCalled();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO shipments');
    expect(params[0]).toBe('EXP-2026-0001');
  });
});

describe('GET /api/logistics/shipments', () => {
  test('liste les expéditions avec nb_commandes agrégé', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'S1', nb_commandes: 3 }] });
    const res = await request(app).get('/api/logistics/shipments');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'S1', nb_commandes: 3 }]);
  });
});

describe('PATCH /api/logistics/shipments/:id', () => {
  test('404 si expédition introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/api/logistics/shipments/S1').send({ carrier: 'FedEx' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Expédition introuvable' });
  });

  test('update simple sans arrived_at+customs_cleared_at : pas de parcelSync ni notifications', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'S1', container_ref: 'C1' }] });
    const res = await request(app).patch('/api/logistics/shipments/S1').send({ carrier: 'FedEx' });

    expect(res.status).toBe(200);
    expect(mockSafeSyncScanToParcels).not.toHaveBeenCalled();
    expect(mockLogParcelEvent).not.toHaveBeenCalled();
    expect(mockNotifyText).not.toHaveBeenCalled();
  });

  test('arrived_at seul (sans customs_cleared_at) : pas de déclenchement', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'S1', container_ref: 'C1' }] });
    const res = await request(app).patch('/api/logistics/shipments/S1').send({ arrived_at: '2026-06-29' });
    expect(res.status).toBe(200);
    expect(mockSafeSyncScanToParcels).not.toHaveBeenCalled();
  });

  test('arrived_at + customs_cleared_at ensemble : déclenche parcelSync + logParcelEvent + SMS par colis avec téléphone', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'S1', container_ref: 'C1' }] }) // UPDATE shipments
      .mockResolvedValueOnce({
        rows: [
          { parcel_id: 'P1', order_id: 'O1', parcel_ref: 'REF1', order_ref: 'ORD1', phone: '321000', full_name: 'Ali', relais_name: 'Relais Moroni', relais_addr: 'Adresse' },
          { parcel_id: 'P2', order_id: 'O2', parcel_ref: 'REF2', order_ref: 'ORD2', phone: null, full_name: 'Fatima', relais_name: 'Relais Anjouan', relais_addr: 'Adresse2' },
        ],
      });

    const res = await request(app)
      .patch('/api/logistics/shipments/S1')
      .send({ arrived_at: '2026-06-29', customs_cleared_at: '2026-06-29' });

    expect(res.status).toBe(200);
    expect(mockSafeSyncScanToParcels).toHaveBeenCalledTimes(2);
    expect(mockSafeSyncScanToParcels).toHaveBeenCalledWith(expect.objectContaining({ order_id: 'O1', step: 'relais_received' }));
    expect(mockLogParcelEvent).toHaveBeenCalledTimes(2);
    expect(mockLogParcelEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ parcel_id: 'P1', event_type: 'location_changed' }));

    // attendre le fire-and-forget Promise.all des SMS
    await new Promise(r => setImmediate(r));
    expect(mockNotifyText).toHaveBeenCalledTimes(1); // seul P1 a un téléphone
    expect(mockNotifyText).toHaveBeenCalledWith('321000', expect.stringContaining('REF1'), 'available', null);
    expect(mockNotifyText.mock.calls[0][1]).toContain('https://www.google.com/maps/search/?api=1&query=');
  });
});

describe('GET /api/logistics/labels/:shipment_id', () => {
  test('404 si aucun colis pour cette expédition', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/logistics/labels/S1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Aucun colis pour cette expédition' });
  });

  test('200 + headers PDF si des colis existent', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ external_code: 'KP-001', parcel_ref: 'REF1', parcel_type: 'standard', weight_kg: 2, destination_island: 'Anjouan', relais_name: 'Relais A' }],
    });

    const res = await request(app).get('/api/logistics/labels/S1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('etiquettes-S1.pdf');
  });
});

describe('GET /api/logistics/manifest/:shipment_id', () => {
  test('404 si expédition introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/logistics/manifest/S1');
    expect(res.status).toBe(404);
  });

  test('200 + headers PDF nommés via la référence shipment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'S1', reference: 'EXP-2026-0001', container_ref: 'C1', carrier: 'DHL' }] })
      .mockResolvedValueOnce({ rows: [{ reference: 'ORD1', total_kmf: 1000, full_name: 'Ali', nb_articles: 2 }] });

    const res = await request(app).get('/api/logistics/manifest/S1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('manifeste-EXP-2026-0001.pdf');
  });
});

describe('erreurs', () => {
  test('erreur DB sur POST /shipments -> 500 via next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/logistics/shipments').send({ carrier: 'DHL' });
    expect(res.status).toBe(500);
  });
});
