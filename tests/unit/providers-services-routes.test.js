'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/providers-services-routes.test.js
 *
 * Tests du router routes/providers-services.js (Vague 2 D4 — GET read-only shadow)
 *
 * Couverture :
 *   ✓ GET /services/:id : 400 si market_id manquant
 *   ✓ GET /services/:id : 404 si non exposable, jamais le pourquoi
 *   ✓ GET /services/:id : champs publics uniquement, JAMAIS le téléphone provider
 *   ✓ GET /physical-offers/:id : mêmes garanties (cas de vérité samboussas)
 */

const mockGetService = jest.fn();
const mockIsServiceExposable = jest.fn();
const mockGetPhysicalOffer = jest.fn();
const mockIsPhysicalOfferExposable = jest.fn();
jest.mock('../../services/providers-service', () => ({
  getService: (...a) => mockGetService(...a),
  isServiceExposable: (...a) => mockIsServiceExposable(...a),
  getPhysicalOffer: (...a) => mockGetPhysicalOffer(...a),
  isPhysicalOfferExposable: (...a) => mockIsPhysicalOfferExposable(...a),
}));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
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

describe('GET /api/providers-services/services/:id', () => {
  it('400 si market_id manquant', async () => {
    const res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`);
    expect(res.status).toBe(400);
    expect(mockIsServiceExposable).not.toHaveBeenCalled();
  });

  it('404 si non exposable — jamais le pourquoi (draft, exposure DISABLED, provider suspendu, mauvais marché)', async () => {
    mockIsServiceExposable.mockResolvedValue(false);
    const res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`).query({ market_id: MARKET_ID });
    expect(res.status).toBe(404);
    expect(mockGetService).not.toHaveBeenCalled(); // pas de lecture inutile si pas exposable
  });

  it('nominal : champs publics uniquement, jamais provider_id ni téléphone', async () => {
    mockIsServiceExposable.mockResolvedValue(true);
    mockGetService.mockResolvedValue({
      id: SERVICE_ID, provider_id: PROVIDER_ID, title: 'Installation climatiseur',
      description: 'Pose et raccordement', zone: 'Moroni', market_id: MARKET_ID,
      status: 'active', commercial_exposure: 'ENABLED',
      created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
    });

    const res = await request(app).get(`/api/providers-services/services/${SERVICE_ID}`).query({ market_id: MARKET_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: SERVICE_ID, title: 'Installation climatiseur',
      description: 'Pose et raccordement', zone: 'Moroni', market_id: MARKET_ID,
    });
    expect(res.body.provider_id).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/phone|téléphone/i);
  });

  it('vérifie le marché demandé, pas un marché arbitraire', async () => {
    mockIsServiceExposable.mockResolvedValue(true);
    mockGetService.mockResolvedValue({ id: SERVICE_ID, title: 'X', description: null, zone: null, market_id: MARKET_ID });
    await request(app).get(`/api/providers-services/services/${SERVICE_ID}`).query({ market_id: MARKET_ID });
    expect(mockIsServiceExposable).toHaveBeenCalledWith(SERVICE_ID, MARKET_ID);
  });
});

describe('GET /api/providers-services/physical-offers/:id — cas de vérité samboussas', () => {
  it('400 si market_id manquant', async () => {
    const res = await request(app).get(`/api/providers-services/physical-offers/${OFFER_ID}`);
    expect(res.status).toBe(400);
  });

  it('404 si non exposable', async () => {
    mockIsPhysicalOfferExposable.mockResolvedValue(false);
    const res = await request(app).get(`/api/providers-services/physical-offers/${OFFER_ID}`).query({ market_id: MARKET_ID });
    expect(res.status).toBe(404);
    expect(mockGetPhysicalOffer).not.toHaveBeenCalled();
  });

  it('nominal : Samboussas mariage exposé, champs publics uniquement', async () => {
    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockGetPhysicalOffer.mockResolvedValue({
      id: OFFER_ID, provider_id: PROVIDER_ID, title: 'Samboussas mariage',
      description: 'Plateau de 50, préparation sur commande', zone: 'Moroni', market_id: MARKET_ID,
      status: 'active', commercial_exposure: 'ENABLED',
    });

    const res = await request(app).get(`/api/providers-services/physical-offers/${OFFER_ID}`).query({ market_id: MARKET_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: OFFER_ID, title: 'Samboussas mariage',
      description: 'Plateau de 50, préparation sur commande', zone: 'Moroni', market_id: MARKET_ID,
    });
    expect(res.body.provider_id).toBeUndefined();
  });
});
