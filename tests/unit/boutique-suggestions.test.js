'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/boutique-suggestions.test.js
 * Couvre routes/boutique-suggestions.js
 *
 * Route fine sans auth (suggestions découverte non intrusives, lecture seule).
 * Aucun calcul ici : parse les query params (UUID, troncature) puis délègue
 * au moteur computeSuggestions(), mocké.
 */

const express = require('express');
const request = require('supertest');

const mockComputeSuggestions = jest.fn();
jest.mock('../../services/boutique-ranking-engine', () => ({
  computeSuggestions: (...args) => mockComputeSuggestions(...args),
}));

const suggestionsRouter = require('../../routes/boutique-suggestions');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/boutique/suggestions', suggestionsRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

const VALID_UUID = '11111111-1111-1111-1111-111111111111';
const VALID_UUID_2 = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  mockComputeSuggestions.mockResolvedValue({ sections: [] });
});

describe('GET /api/boutique/suggestions — accès public', () => {
  it('sans aucun param → 200, signals tous neutres, limit par défaut = 6', async () => {
    const res = await request(buildApp()).get('/api/boutique/suggestions');
    expect(res.status).toBe(200);
    expect(mockComputeSuggestions).toHaveBeenCalledWith({
      viewed_product_id: null,
      category: null,
      subcategory: null,
      recently_viewed: [],
      cart_product_ids: [],
      search_query: null,
      limit: 6,
    });
  });

  it('renvoie tel quel le résultat du moteur', async () => {
    mockComputeSuggestions.mockResolvedValue({ sections: [{ id: 's1' }] });
    const res = await request(buildApp()).get('/api/boutique/suggestions');
    expect(res.body).toEqual({ sections: [{ id: 's1' }] });
  });

  it('erreur moteur → 500 via next', async () => {
    mockComputeSuggestions.mockRejectedValue(new Error('moteur down'));
    const res = await request(buildApp()).get('/api/boutique/suggestions');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/boutique/suggestions — viewed_product_id', () => {
  it('UUID valide → transmis tel quel', async () => {
    await request(buildApp()).get(`/api/boutique/suggestions?viewed_product_id=${VALID_UUID}`);
    expect(mockComputeSuggestions).toHaveBeenCalledWith(expect.objectContaining({ viewed_product_id: VALID_UUID }));
  });

  it('UUID invalide → null (pas d\'injection de valeur arbitraire)', async () => {
    await request(buildApp()).get('/api/boutique/suggestions?viewed_product_id=not-a-uuid');
    expect(mockComputeSuggestions).toHaveBeenCalledWith(expect.objectContaining({ viewed_product_id: null }));
  });
});

describe('GET /api/boutique/suggestions — category / subcategory', () => {
  it('fournis → transmis, tronqués à 80 caractères', async () => {
    const longCat = 'x'.repeat(100);
    await request(buildApp()).get(`/api/boutique/suggestions?category=${longCat}&subcategory=phones`);
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.category).toHaveLength(80);
    expect(call.subcategory).toBe('phones');
  });

  it('absents → null', async () => {
    await request(buildApp()).get('/api/boutique/suggestions');
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.category).toBeNull();
    expect(call.subcategory).toBeNull();
  });
});

describe('GET /api/boutique/suggestions — recently_viewed / cart_product_ids (parseUUIDs)', () => {
  it('liste de UUIDs valides séparés par virgule → tableau filtré', async () => {
    await request(buildApp()).get(`/api/boutique/suggestions?recently_viewed=${VALID_UUID},${VALID_UUID_2}`);
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.recently_viewed).toEqual([VALID_UUID, VALID_UUID_2]);
  });

  it('mélange UUID valide + invalide → seuls les valides sont gardés', async () => {
    await request(buildApp()).get(`/api/boutique/suggestions?cart_product_ids=${VALID_UUID},not-a-uuid,${VALID_UUID_2}`);
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.cart_product_ids).toEqual([VALID_UUID, VALID_UUID_2]);
  });

  it('espaces autour des UUIDs → trim avant validation', async () => {
    await request(buildApp()).get(`/api/boutique/suggestions?recently_viewed=${encodeURIComponent(' ' + VALID_UUID + ' , ' + VALID_UUID_2)}`);
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.recently_viewed).toEqual([VALID_UUID, VALID_UUID_2]);
  });

  it('paramètre absent → tableau vide', async () => {
    await request(buildApp()).get('/api/boutique/suggestions');
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.recently_viewed).toEqual([]);
    expect(call.cart_product_ids).toEqual([]);
  });

  it('chaîne vide → tableau vide', async () => {
    await request(buildApp()).get('/api/boutique/suggestions?recently_viewed=');
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.recently_viewed).toEqual([]);
  });
});

describe('GET /api/boutique/suggestions — search_query', () => {
  it('fourni → transmis, tronqué à 200 caractères', async () => {
    const longQuery = 'y'.repeat(250);
    await request(buildApp()).get(`/api/boutique/suggestions?search_query=${longQuery}`);
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.search_query).toHaveLength(200);
  });

  it('absent → null', async () => {
    await request(buildApp()).get('/api/boutique/suggestions');
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.search_query).toBeNull();
  });
});

describe('GET /api/boutique/suggestions — limit', () => {
  it('fourni → parseInt appliqué', async () => {
    await request(buildApp()).get('/api/boutique/suggestions?limit=3');
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.limit).toBe(3);
  });

  it('absent → défaut 6', async () => {
    await request(buildApp()).get('/api/boutique/suggestions');
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(call.limit).toBe(6);
  });

  it('valeur non numérique → NaN transmis tel quel (pas de clamp dans la route)', async () => {
    await request(buildApp()).get('/api/boutique/suggestions?limit=abc');
    const call = mockComputeSuggestions.mock.calls[0][0];
    expect(Number.isNaN(call.limit)).toBe(true);
  });
});
