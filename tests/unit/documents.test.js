'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/documents.test.js
 *
 * Couvre routes/admin/documents.js
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const express = require('express');
const request = require('supertest');

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 'admin-1', role: 'admin' };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/admin/documents');
    app.use('/api/admin', router);
  });
});

describe('admin/documents — accès', () => {
  it('refuse un non-admin (403)', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).get('/api/admin/documents');
    expect(res.status).toBe(403);
  });
});

describe('GET /documents', () => {
  it('nominal sans filtres → 200 avec pagination par défaut', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'd1' }, { id: 'd2' }] })
      .mockResolvedValueOnce({ rows: [{ total: '2' }] });

    const res = await request(app).get('/api/admin/documents');
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(0);
  });

  it('limit > 200 → plafonné à 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const res = await request(app).get('/api/admin/documents?limit=500');
    expect(res.body.limit).toBe(200);
  });

  it('filtres document_type/order_id → construit la clause WHERE', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await request(app).get('/api/admin/documents?document_type=refund_receipt&order_id=order-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('td.document_type = $1');
    expect(sql).toContain('td.order_id = $2');
    expect(params).toEqual(expect.arrayContaining(['refund_receipt', 'order-1']));
  });

  it('erreur DB → 500 via next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/documents');
    expect(res.status).toBe(500);
  });

  it('aucun document → tableau vide, total 0', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });
    const res = await request(app).get('/api/admin/documents');
    expect(res.body.documents).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

describe('GET /documents/summary', () => {
  it('nominal → renvoie table_exists, by_type, sequences, diagnosis', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ document_type: 'refund_receipt', total: '3' }] }) // byType
      .mockResolvedValueOnce({ rows: [{ sequence_name: 'refund_receipt_seq' }] }) // seqRows
      .mockResolvedValueOnce({ rows: [{ table_exists: true }] }) // tableCheck
      .mockResolvedValueOnce({ rows: [{ def: 'CHECK (...)' }] }); // constraintRow

    const res = await request(app).get('/api/admin/documents/summary');
    expect(res.status).toBe(200);
    expect(res.body.table_exists).toBe(true);
    expect(res.body.by_type).toHaveLength(1);
    expect(res.body.sequences.find(s => s.name === 'refund_receipt_seq').exists).toBe(true);
    expect(res.body.sequences.find(s => s.name === 'wallet_receipt_seq').exists).toBe(false);
    expect(res.body.diagnosis).toContain('3 document(s)');
  });

  it('by_type vide → diagnosis explique l\'absence de documents', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ table_exists: true }] })
      .mockResolvedValueOnce({ rows: [{ def: null }] });

    const res = await request(app).get('/api/admin/documents/summary');
    expect(res.body.diagnosis).toContain('Aucun document émis');
  });

  it('constraintRow absent → type_constraint null sans crash', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ table_exists: false }] })
      .mockResolvedValueOnce({ rows: [] }); // pas de constraintRow

    const res = await request(app).get('/api/admin/documents/summary');
    expect(res.status).toBe(200);
    expect(res.body.type_constraint).toBeNull();
  });

  it('erreur DB → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/admin/documents/summary');
    expect(res.status).toBe(500);
  });
});

describe('GET /documents/:id', () => {
  it('document introuvable → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/documents/doc-x');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('introuvable');
  });

  it('nominal → 200 avec le document complet', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'doc-1', document_type: 'refund_receipt', issued_by_name: 'Alice' }] });
    const res = await request(app).get('/api/admin/documents/doc-1');
    expect(res.status).toBe(200);
    expect(res.body.document.id).toBe('doc-1');
    expect(res.body.document.issued_by_name).toBe('Alice');
  });

  it('erreur DB → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/admin/documents/doc-1');
    expect(res.status).toBe(500);
  });
});
