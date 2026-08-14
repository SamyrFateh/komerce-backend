'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const request = require('supertest');
const express = require('express');
const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1', role: 'client' }; next(); },
}));
const mockEnsureInvoicePdf = jest.fn();
const mockEnsureDocumentPdf = jest.fn();
jest.mock('../../services/invoice-service', () => ({ ensurePdf: (...args) => mockEnsureInvoicePdf(...args) }));
jest.mock('../../services/documents/document-service', () => ({ ensurePdf: (...args) => mockEnsureDocumentPdf(...args) }));
const router = require('../../routes/documents');
const ID = '3f1a9b2c-1234-4abc-89ab-1234567890ab';
function app() {
  const instance = express();
  instance.use('/api/auth/me/documents', router);
  instance.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return instance;
}
beforeEach(() => jest.clearAllMocks());

test('liste uniquement les documents du compte et fournit une URL protégée', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: ID, document_type: 'invoice', reference: 'KOM-INV-1', amount_kmf: '12500', status: 'available' }] });
  const res = await request(app()).get('/api/auth/me/documents');
  expect(res.status).toBe(200);
  expect(mockQuery.mock.calls[0][1][0]).toBe('user-1');
  expect(mockQuery.mock.calls[0][0]).toContain("td.document_type = 'refund_receipt'");
  expect(res.body.documents[0]).toMatchObject({ amount_kmf: 12500, download_url: `/api/auth/me/documents/${ID}/download` });
  expect(res.headers['cache-control']).toBe('private, no-store');
});

test('filtre les documents par référence de commande authentifiée', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const res = await request(app()).get('/api/auth/me/documents?order_reference=K1AAAA');
  expect(res.status).toBe(200);
  expect(mockQuery.mock.calls[0][1]).toEqual(['user-1', 'K1AAAA', 50, 0]);
  expect(mockQuery.mock.calls[0][0]).toContain('o.reference = $2');
});

test('refuse une référence de commande invalide sans interroger la base', async () => {
  const res = await request(app()).get('/api/auth/me/documents?order_reference=../../secret');
  expect(res.status).toBe(400);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('ne fournit aucun lien tant que le PDF n\'est pas disponible', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: ID, document_type: 'invoice', status: 'pending' }] });
  const res = await request(app()).get('/api/auth/me/documents');
  expect(res.body.documents[0].download_url).toBeNull();
});

test('télécharge une facture appartenant au compte', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: ID, pdf_content: null }] });
  mockEnsureInvoicePdf.mockResolvedValueOnce({ pdf_filename: 'facture.pdf', pdf_content: Buffer.from('%PDF-private') });
  const res = await request(app()).get(`/api/auth/me/documents/${ID}/download`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('application/pdf');
  expect(mockEnsureInvoicePdf).toHaveBeenCalledTimes(1);
});

test('télécharge un reçu transactionnel appartenant au compte', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: ID, document_type: 'refund_receipt' }] });
  mockEnsureDocumentPdf.mockResolvedValueOnce({ pdf_filename: 'remboursement.pdf', pdf_content: Buffer.from('%PDF-private') });
  expect((await request(app()).get(`/api/auth/me/documents/${ID}/download`)).status).toBe(200);
  expect(mockEnsureDocumentPdf).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[1][0]).toContain("td.document_type = 'refund_receipt'");
});

test('répond 404 sans révéler un document appartenant à un autre compte', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  expect((await request(app()).get(`/api/auth/me/documents/${ID}/download`)).status).toBe(404);
  expect(mockEnsureInvoicePdf).not.toHaveBeenCalled();
  expect(mockEnsureDocumentPdf).not.toHaveBeenCalled();
});
