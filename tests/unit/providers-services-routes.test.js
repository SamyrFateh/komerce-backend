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
const mockCreateContextualInquiry = jest.fn();
const mockDbQuery = jest.fn();
let mockSessionUser;

jest.mock('../../services/providers-service', () => ({
  getService: (...a) => mockGetService(...a),
  isServiceExposable: (...a) => mockIsServiceExposable(...a),
  getPhysicalOffer: (...a) => mockGetPhysicalOffer(...a),
  isPhysicalOfferExposable: (...a) => mockIsPhysicalOfferExposable(...a),
}));
jest.mock('../../services/providers-inquiry-service', () => ({
  createContextualInquiry: (...a) => mockCreateContextualInquiry(...a),
}));
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../middleware/auth-guest', () => ({
  authenticateOrCreateGuest: (req, res, next) => {
    if (!mockSessionUser) return res.status(401).json({ error: 'Identité requise', code: 'identity_required' });
    req.user = mockSessionUser;
    return next();
  },
}));

const express = require('express');
const request = require('supertest');

const SERVICE_ID  = '33333333-3333-3333-3333-333333333333';
const OFFER_ID    = '44444444-4444-4444-4444-444444444444';
const MARKET_ID   = '22222222-2222-2222-2222-222222222222';
const PROVIDER_ID = '55555555-5555-5555-5555-555555555555';
const INQUIRY_ID  = '66666666-6666-6666-6666-666666666666';

let app;
beforeEach(() => {
  jest.clearAllMocks();
  mockSessionUser = { id: 'user-1', phone: '+2693334455' };
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    app.use('/api/providers-services', require('../../routes/providers-services'));
  });
});

function marketOk() {
  mockDbQuery.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
}

describe('GET public detail', () => {
  it('400 sans market et 404 si cible non exposable', async () => {
    let res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`);
    expect(res.status).toBe(400);

    marketOk();
    mockIsServiceExposable.mockResolvedValue(false);
    res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`).query({ market: 'KM' });
    expect(res.status).toBe(404);
  });

  it('service projette uniquement request/callback et jamais un contact provider', async () => {
    marketOk();
    mockIsServiceExposable.mockResolvedValue(true);
    mockGetService.mockResolvedValue({
      id: SERVICE_ID,
      provider_id: PROVIDER_ID,
      provider_name: 'Garage Nurdine',
      phone: '+2699999999',
      public_phone: '+2693210000',
      public_whatsapp: '+2693210001',
      title: 'Recherche et sourcing de pièces auto',
      description: 'Indiquez marque, modèle, année et pièce recherchée.',
      zone: 'Mutsamudu / Anjouan',
      market_id: MARKET_ID,
      image_ref: '/media/auto.webp',
      actions_enabled: ['quote', 'call', 'whatsapp'],
    });

    const res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`).query({ market: 'KM' });
    expect(res.status).toBe(200);
    expect(res.body.actions).toEqual(['request', 'callback']);
    expect(res.body.public_contact).toBeNull();
    expect(res.body.provider_id).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/2699999999|2693210000|2693210001/);
  });

  it('physical_offer legacy call-only devient callback contextualisable', async () => {
    marketOk();
    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockGetPhysicalOffer.mockResolvedValue({
      id: OFFER_ID,
      provider_id: PROVIDER_ID,
      provider_name: 'Bâtir Anjouan',
      title: 'Ciment 42,5R — sac 50 kg',
      description: 'Stock local indicatif',
      zone: 'Mutsamudu',
      market_id: MARKET_ID,
      actions_enabled: ['call'],
    });

    const res = await request(app).get(`/api/providers-services/physical-offers/${OFFER_ID}`).query({ market: 'KM' });
    expect(res.status).toBe(200);
    expect(res.body.actions).toEqual(['callback']);
    expect(res.body.public_contact).toBeNull();
  });
});

describe('POST /inquiries', () => {
  it('dérive le téléphone de session et persiste la cible, intent, timing et note', async () => {
    marketOk();
    mockIsServiceExposable.mockResolvedValue(true);
    mockCreateContextualInquiry.mockResolvedValue({ id: INQUIRY_ID, status: 'sent', intent: 'request' });

    const res = await request(app)
      .post('/api/providers-services/inquiries')
      .query({ market: 'KM' })
      .send({
        service_id: SERVICE_ID,
        intent: 'request',
        requested_window: 'Cette semaine',
        requester_note: 'Toyota Hilux 2012, phare avant droit',
        requester_phone: '+2690000000',
      });

    expect(res.status).toBe(201);
    expect(res.body.inquiry).toEqual({
      id: INQUIRY_ID, status: 'sent', intent: 'request', target_kind: 'service',
    });
    expect(mockCreateContextualInquiry).toHaveBeenCalledWith({
      serviceId: SERVICE_ID,
      physicalOfferId: null,
      requesterPhone: '+2693334455',
      requestedWindow: 'Cette semaine',
      intent: 'request',
      requesterNote: 'Toyota Hilux 2012, phare avant droit',
    });
  });

  it('callback sur offre physique conserve la cible comme propos connu', async () => {
    marketOk();
    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockCreateContextualInquiry.mockResolvedValue({ id: INQUIRY_ID, status: 'sent', intent: 'callback' });

    const res = await request(app)
      .post('/api/providers-services/inquiries')
      .query({ market: 'KM' })
      .send({ physical_offer_id: OFFER_ID, intent: 'callback', requester_note: 'Confirmer le stock pour 50 sacs' });

    expect(res.status).toBe(201);
    expect(mockCreateContextualInquiry).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: null,
      physicalOfferId: OFFER_ID,
      intent: 'callback',
      requesterNote: 'Confirmer le stock pour 50 sacs',
    }));
  });

  it('quote legacy converge vers request ; intents/contact directs sont refusés', async () => {
    marketOk();
    mockIsServiceExposable.mockResolvedValue(true);
    mockCreateContextualInquiry.mockResolvedValue({ id: INQUIRY_ID, status: 'sent', intent: 'request' });

    let res = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' })
      .send({ service_id: SERVICE_ID, intent: 'quote' });
    expect(res.status).toBe(201);
    expect(mockCreateContextualInquiry).toHaveBeenLastCalledWith(expect.objectContaining({ intent: 'request' }));

    res = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' })
      .send({ service_id: SERVICE_ID, intent: 'call' });
    expect(res.status).toBe(400);
  });

  it('refuse note > 600, double cible et session sans identité', async () => {
    marketOk();
    let res = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' })
      .send({ service_id: SERVICE_ID, requester_note: 'x'.repeat(601) });
    expect(res.status).toBe(400);

    res = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' })
      .send({ service_id: SERVICE_ID, physical_offer_id: OFFER_ID });
    expect(res.status).toBe(400);

    mockSessionUser = null;
    res = await request(app).post('/api/providers-services/inquiries').query({ market: 'KM' })
      .send({ service_id: SERVICE_ID });
    expect(res.status).toBe(401);
  });
});
