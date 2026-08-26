'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/relais.test.js
 *
 * Tests du router routes/relais.js (endpoints publics points relais)
 *
 * Couverture :
 *   ✓ GET / : accessible sans authentification, renvoie les colonnes attendues uniquement
 *   ✓ GET /public : accessible sans authentification, format { relais: [...] }
 *   ✓ GET /:id : renvoie le relais trouvé
 *   ✓ GET /:id : 404 si introuvable (ou inactif, car filtré par is_active=TRUE en SQL)
 *   ✓ GPS + photo publics sont projetés par les trois lectures relais
 *   ✓ Les requêtes SQL filtrent toujours is_active = TRUE (pas de fuite de relais désactivés)
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/relais');
    app.use('/api/relais', router);
  });
});

describe('relais — GET / (liste publique, sans auth)', () => {
  it('renvoie la liste des relais actifs sans nécessiter de token', async () => {
    const rows = [{
      id: 'r1', name: 'Relais Moroni', agent_name: 'Ali', phone: '+269111',
      address: 'Centre', zone: 'A', hours: '8h-18h', island: 'grande_comore',
      latitude: '-11.7172000', longitude: '43.2473000', photo_url: 'https://cdn.test/relais.jpg',
    }];
    mockQuery.mockResolvedValueOnce({ rows });

    const res = await request(app).get('/api/relais');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE is_active = TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/latitude, longitude, photo_url/);
  });
});

describe('relais — GET /public', () => {
  it('renvoie { relais: [...] } sans authentification', async () => {
    const rows = [{
      id: 'r1', name: 'Relais Moroni', zone: 'A', island: 'grande_comore',
      address: 'Centre', phone: '+269111', latitude: '-11.7172000',
      longitude: '43.2473000', photo_url: 'https://cdn.test/relais.jpg',
    }];
    mockQuery.mockResolvedValueOnce({ rows });

    const res = await request(app).get('/api/relais/public');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ relais: rows });
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE is_active = TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/latitude, longitude, photo_url/);
  });
});

describe('relais — GET /:id', () => {
  it('renvoie le détail du relais trouvé', async () => {
    const relais = {
      id: 'r1', name: 'Relais Moroni', agent_name: 'Ali', phone: '+269111',
      address: 'Centre', zone: 'A', hours: '8h-18h', island: 'grande_comore',
      latitude: '-11.7172000', longitude: '43.2473000', photo_url: 'https://cdn.test/relais.jpg',
    };
    mockQuery.mockResolvedValueOnce({ rows: [relais] });

    const res = await request(app).get('/api/relais/r1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(relais);
    expect(mockQuery.mock.calls[0][1]).toEqual(['r1']);
    expect(mockQuery.mock.calls[0][0]).toMatch(/AND is_active = TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/latitude, longitude, photo_url/);
  });

  it('404 si le relais est introuvable ou inactif', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/relais/r-inconnu');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Relais introuvable' });
  });
});
