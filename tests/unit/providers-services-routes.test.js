'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockGetService = jest.fn();
const mockIsServiceExposable = jest.fn();
const mockGetPhysicalOffer = jest.fn();
const mockIsPhysicalOfferExposable = jest.fn();
const mockCreateInquiry = jest.fn();
const mockDbQuery = jest.fn();
let mockSessionUser;

jest.mock('../../services/providers-service', () => ({
  createInquiry: (...a) => mockCreateInquiry(...a),
  getService: (...a) => mockGetService(...a),
  isServiceExposable: (...a) => mockIsServiceExposable(...a),
  getPhysicalOffer: (...a) => mockGetPhysicalOffer(...a),
  isPhysicalOfferExposable: (...a) => mockIsPhysicalOfferExposable(...a),
}));
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../middleware/auth-guest', () => ({
  authenticateOrCreateGuest: (req, res, next) => {
    if (!mockSessionUser) {
      return res.status(401).json({ error: 'Identité requise', code: 'identity_required' });
    }
    req.user = mockSessionUser;
    return next();
  },
}));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionUser = { id: 'user-1', phone: '+2693334455', full_name: 'Client Test' };
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/providers-services');
    app.use('/api/providers-services', router);
  });
});

const SERVICE_ID  = '33333333-3333-3333-3333-333333333333';
const OFFER_ID    = '44444444-4444-4444-4444-444444444444';
const MARKET_ID   = '22222222-2222-2222-2222-222222222222';
const PROVIDER_ID = '55555555-5555-5555-5555-555555555555';
const INQUIRY_ID  = '66666666-6666-6666-6666-666666666666';

describe('GET /api/providers-services/services/:id', () => {
  it('400 si market manquant', async () => {
    const res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`);
    expect(res.status).toBe(400);
    expect(mockIsServiceExposable).not.toHaveBeenCalled();
  });

  it('400 si le code marché est inconnu ou inactif', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`).query({ market: 'ZZ' });
    expect(res.status).toBe(400);
    expect(mockIsServiceExposable).not.toHaveBeenCalled();
  });

  it('404 si non exposable — jamais le pourquoi', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockIsServiceExposable.mockResolvedValue(false);
    const res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`).query({ market: 'KM' });
    expect(res.status).toBe(404);
    expect(mockGetService).not.toHaveBeenCalled();
  });

  it('nominal : champs publics + image_ref, jamais provider_id ni téléphone', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockIsServiceExposable.mockResolvedValue(true);
    mockGetService.mockResolvedValue({
      id: SERVICE_ID,
      provider_id: PROVIDER_ID,
      title: 'Installation climatiseur',
      description: 'Pose et raccordement',
      zone: 'Moroni',
      market_id: MARKET_ID,
      image_ref: '/media/installateur.webp',
      status: 'active',
      commercial_exposure: 'ENABLED',
    });

    const res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`).query({ market: 'KM' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: SERVICE_ID,
      title: 'Installation climatiseur',
      description: 'Pose et raccordement',
      zone: 'Moroni',
      market_id: MARKET_ID,
      image_ref: '/media/installateur.webp',
    });
    expect(res.body.provider_id).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/phone|téléphone/i);
  });

  it('image_ref absent devient null dans le contrat public', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockIsServiceExposable.mockResolvedValue(true);
    mockGetService.mockResolvedValue({ id: SERVICE_ID, title: 'X', description: null, zone: null, market_id: MARKET_ID });
    const res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`).query({ market: 'KM' });
    expect(res.body.image_ref).toBeNull();
  });

  it('résout le code en UUID réel avant isServiceExposable', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockIsServiceExposable.mockResolvedValue(true);
    mockGetService.mockResolvedValue({ id: SERVICE_ID, title: 'X', description: null, zone: null, market_id: MARKET_ID });
    await request(app).get(`/api/providers-services/services/${SERVICE_ID}`).query({ market: 'KM' });
    expect(mockIsServiceExposable).toHaveBeenCalledWith(SERVICE_ID, MARKET_ID);
  });
});

describe('GET /api/providers-services/physical-offers/:id', () => {
  it('400 si market manquant', async () => {
    const res = await request(app).get(`/api/providers-services/physical-offers/${OFFER_ID}`);
    expect(res.status).toBe(400);
  });

  it('400 si le code marché est inconnu ou inactif', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get(`/api/providers-services/physical-offers/${OFFER_ID}`).query({ market: 'ZZ' });
    expect(res.status).toBe(400);
  });

  it('404 si non exposable', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockIsPhysicalOfferExposable.mockResolvedValue(false);
    const res = await request(app).get(`/api/providers-services/physical-offers/${OFFER_ID}`).query({ market: 'KM' });
    expect(res.status).toBe(404);
    expect(mockGetPhysicalOffer).not.toHaveBeenCalled();
  });

  it('nominal : Samboussas exposé avec image_ref, champs publics uniquement', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockGetPhysicalOffer.mockResolvedValue({
      id: OFFER_ID,
      provider_id: PROVIDER_ID,
      title: 'Samboussas mariage',
      description: 'Plateau de 50, préparation sur commande',
      zone: 'Moroni',
      market_id: MARKET_ID,
      image_ref: '/media/samboussas.webp',
      status: 'active',
      commercial_exposure: 'ENABLED',
    });

    const res = await request(app).get(`/api/providers-services/physical-offers/${OFFER_ID}`).query({ market: 'KM' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: OFFER_ID,
      title: 'Samboussas mariage',
      description: 'Plateau de 50, préparation sur commande',
      zone: 'Moroni',
      market_id: MARKET_ID,
      image_ref: '/media/samboussas.webp',
    });
    expect(res.body.provider_id).toBeUndefined();
  });

  it('résout le code en UUID réel avant isPhysicalOfferExposable', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockGetPhysicalOffer.mockResolvedValue({ id: OFFER_ID, title: 'X', description: null, zone: null, market_id: MARKET_ID });
    await request(app).get(`/api/providers-services/physical-offers/${OFFER_ID}`).query({ market: 'KM' });
    expect(mockIsPhysicalOfferExposable).toHaveBeenCalledWith(OFFER_ID, MARKET_ID);
  });
});

describe('POST /api/providers-services/inquiries', () => {
  beforeEach(() => {
    mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    mockIsServiceExposable.mockResolvedValue(true);
    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockCreateInquiry.mockResolvedValue({ id: INQUIRY_ID, status: 'sent' });
  });

  it('401 sans identité Komerce', async () => {
    mockSessionUser = null;
    const res = await request(app)
      .post('/api/providers-services/inquiries')
      .query({ market: 'KM' })
      .send({ service_id: SERVICE_ID });
    expect(res.status).toBe(401);
    expect(mockCreateInquiry).not.toHaveBeenCalled();
  });

  it('400 si aucune cible ou les deux cibles sont fournies', async () => {
    const none = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' }).send({});
    expect(none.status).toBe(400);
    const both = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' })
      .send({ service_id: SERVICE_ID, physical_offer_id: OFFER_ID });
    expect(both.status).toBe(400);
    expect(mockCreateInquiry).not.toHaveBeenCalled();
  });

  it('404 si la cible n’est plus exposable', async () => {
    mockIsServiceExposable.mockResolvedValue(false);
    const res = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' })
      .send({ service_id: SERVICE_ID });
    expect(res.status).toBe(404);
    expect(mockCreateInquiry).not.toHaveBeenCalled();
  });

  it('crée une demande service avec le téléphone de session', async () => {
    const res = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' })
      .send({ service_id: SERVICE_ID, requester_phone: '+33123456789', requested_window: 'Demain matin' });
    expect(res.status).toBe(201);
    expect(mockCreateInquiry).toHaveBeenCalledWith({
      serviceId: SERVICE_ID,
      physicalOfferId: null,
      requesterPhone: '+2693334455',
      requestedWindow: 'Demain matin',
    });
    expect(JSON.stringify(res.body)).not.toContain('+2693334455');
    expect(JSON.stringify(res.body)).not.toContain('+33123456789');
  });

  it('crée une demande physical_offer avec le même contrat XOR', async () => {
    const res = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' })
      .send({ physical_offer_id: OFFER_ID });
    expect(res.status).toBe(201);
    expect(mockCreateInquiry).toHaveBeenCalledWith({
      serviceId: null,
      physicalOfferId: OFFER_ID,
      requesterPhone: '+2693334455',
      requestedWindow: null,
    });
  });

  it('400 si requested_window dépasse le contrat texte libre borné', async () => {
    const res = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' })
      .send({ service_id: SERVICE_ID, requested_window: 'x'.repeat(161) });
    expect(res.status).toBe(400);
    expect(mockCreateInquiry).not.toHaveBeenCalled();
  });
});
