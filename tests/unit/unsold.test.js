'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/unsold.test.js
 * Couvre routes/unsold.js
 */

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant — connectez-vous' });
    req.user = mockUser;
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé admin' });
    }
    next();
  },
}));

const unsoldRouter = require('../../routes/unsold');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/unsold', unsoldRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
});

describe('GET /api/unsold — liste', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/unsold');
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/unsold');
    expect(res.status).toBe(403);
  });

  it('admin → 200 + tableau depuis v_unsold_pipeline', async () => {
    const rows = [{ id: 'u1', product_name: 'Chaise' }];
    mockDbQuery.mockResolvedValueOnce({ rows });
    const res = await request(buildApp()).get('/api/unsold');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(mockDbQuery).toHaveBeenCalledWith('SELECT * FROM v_unsold_pipeline');
  });

  it('erreur DB → 500 via next', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/unsold');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/unsold/scan', () => {
  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/unsold/scan');
    expect(res.status).toBe(403);
  });

  it('aucun nouvel invendu → scanned + items_created:0, pas d\'INSERT', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // auto_unsold()
      .mockResolvedValueOnce({ rows: [] }); // pas de nouvelle ligne

    const res = await request(buildApp()).post('/api/unsold/scan');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 3, items_created: 0 });
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  it('nominal → cree un unsold_item par commande fraichement basculee', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // auto_unsold()
      .mockResolvedValueOnce({ rows: [{ order_id: 'o1', total_kmf: 4000, unsold_price_kmf: null, product_id: 'p1', product_name: 'Lampe', price_kmf: 4000 }] })
      .mockResolvedValueOnce({ rows: [] }); // INSERT unsold_items

    const res = await request(buildApp()).post('/api/unsold/scan');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 1, items_created: 1 });
    expect(mockDbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO unsold_items'),
      ['o1', 'p1', 'Lampe', 4000, 3000]
    );
  });

  it('product_name et price_kmf absents → fallback "Article" et total_kmf utilises', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ order_id: 'o2', total_kmf: 2000, unsold_price_kmf: null, product_id: null, product_name: null, price_kmf: null }] })
      .mockResolvedValueOnce({ rows: [] });

    await request(buildApp()).post('/api/unsold/scan');
    expect(mockDbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO unsold_items'),
      ['o2', null, 'Article', 2000, 1500]
    );
  });

  it('erreur DB pendant le scan → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('connexion perdue'));
    const res = await request(buildApp()).post('/api/unsold/scan');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/unsold/stats/summary', () => {
  it('admin → 200 + objet de stats', async () => {
    const stats = { total_actifs: 5, valeur_liquidation_kmf: 15000 };
    mockDbQuery.mockResolvedValueOnce({ rows: [stats] });
    const res = await request(buildApp()).get('/api/unsold/stats/summary');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(stats);
  });

  it("n'est pas intercepte par la route GET /:id", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ total_actifs: 0 }] });
    await request(buildApp()).get('/api/unsold/stats/summary');
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('FROM v_unsold_pipeline'));
    expect(mockDbQuery).not.toHaveBeenCalledWith(expect.stringContaining('WHERE id'), expect.anything());
  });
});

describe('GET /api/unsold/:id', () => {
  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/unsold/inexistant');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Invendu introuvable' });
  });

  it('trouve → 200 + objet', async () => {
    const item = { id: 'u1', product_name: 'Chaise' };
    mockDbQuery.mockResolvedValueOnce({ rows: [item] });
    const res = await request(buildApp()).get('/api/unsold/u1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(item);
    expect(mockDbQuery).toHaveBeenCalledWith('SELECT * FROM v_unsold_pipeline WHERE id = $1', ['u1']);
  });

  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/unsold/u1');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/unsold/:id', () => {
  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).patch('/api/unsold/u1').send({ unsold_price_kmf: 2000 });
    expect(res.status).toBe(404);
  });

  it('nominal → met a jour et renvoie la ligne, valeurs absentes -> COALESCE conserve', async () => {
    const updated = { id: 'u1', unsold_price_kmf: 2500, channel: 'whatsapp', notes: null };
    mockDbQuery.mockResolvedValueOnce({ rows: [updated] });
    const res = await request(buildApp()).patch('/api/unsold/u1').send({ unsold_price_kmf: 2500, channel: 'whatsapp' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE unsold_items'),
      [2500, 'whatsapp', undefined, 'u1']
    );
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).patch('/api/unsold/u1').send({});
    expect(res.status).toBe(403);
  });
});

describe('POST /api/unsold/:id/resolve', () => {
  it('statut invalide → 400, pas de requete DB', async () => {
    const res = await request(buildApp()).post('/api/unsold/u1/resolve').send({ status: 'parti_en_vacances' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Statut invalide' });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it.each(['sold_whatsapp', 'sold_reseller', 'donated', 'destroyed'])(
    'statut "%s" valide → accepte',
    async (status) => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', status }] });
      const res = await request(buildApp()).post('/api/unsold/u1/resolve').send({ status });
      expect(res.status).toBe(200);
    }
  );

  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).post('/api/unsold/u1/resolve').send({ status: 'donated' });
    expect(res.status).toBe(404);
  });

  it('nominal vente revendeur → renvoie la ligne resolue avec prix et reseller_id', async () => {
    const resolved = { id: 'u1', status: 'sold_reseller', resolved_price_kmf: 1500, reseller_id: 'r1' };
    mockDbQuery.mockResolvedValueOnce({ rows: [resolved] });
    const res = await request(buildApp())
      .post('/api/unsold/u1/resolve')
      .send({ status: 'sold_reseller', resolved_price_kmf: 1500, reseller_id: 'r1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(resolved);
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE unsold_items'),
      ['sold_reseller', 1500, 'r1', undefined, 'u1']
    );
  });
});

describe('GET /api/unsold/:id/whatsapp', () => {
  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/unsold/u1/whatsapp');
    expect(res.status).toBe(404);
  });

  it('nominal → genere un message avec le pourcentage de remise et les prix formates', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', product_name: 'Lampe', original_price_kmf: 4000, unsold_price_kmf: 3000 }],
    });
    const res = await request(buildApp()).get('/api/unsold/u1/whatsapp');
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Lampe');
    expect(res.body.message).toContain('-25%');
    expect(res.body.message).toMatch(/Prix normal : 4.000 KMF/);
    expect(res.body.message).toMatch(/Prix soldé : 3.000 KMF/);
    expect(res.body.item.id).toBe('u1');
  });
});
