'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const request = require('supertest');
const express = require('express');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));
const authState = { user: { id: 'u1', role: 'client' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!authState.user) return res.status(401).json({ error: 'Non authentifié' });
    req.user = authState.user;
    next();
  },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'Accès refusé' }),
}));
const mockInvoiceService = {
  getOrCreateInvoice: jest.fn(), generateHTML: jest.fn(),
  listInvoices: jest.fn(), issueInvoice: jest.fn(),
};
jest.mock('../../services/invoice-service', () => mockInvoiceService);
jest.mock('../../utils/logger', () => ({ child: () => ({ error: jest.fn() }) }));

const router = require('../../routes/invoices');
const VALID_ORDER_ID = '3f1a9b2c-1234-4abc-89ab-1234567890ab';
function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/invoices', router);
  instance.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return instance;
}

beforeEach(() => { jest.clearAllMocks(); authState.user = { id: 'u1', role: 'client' }; });

test('aucune facture publique nest servie, même avec un ancien token', async () => {
  const res = await request(app()).get('/api/invoices/public/ancien-token');
  expect(res.status).toBe(404);
  expect(mockInvoiceService.getOrCreateInvoice).not.toHaveBeenCalled();
});

test('le propriétaire authentifié télécharge un vrai PDF privé', async () => {
  mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] });
  mockInvoiceService.issueInvoice.mockResolvedValueOnce({
    pdf_filename: 'KOM-INV-2026-000001.pdf', pdf_content: Buffer.from('%PDF-1.3\nprivate'),
  });
  const res = await request(app()).get(`/api/invoices/${VALID_ORDER_ID}/download`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('application/pdf');
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(mockInvoiceService.issueInvoice).toHaveBeenCalledWith(VALID_ORDER_ID);
});

test('un autre client ne peut pas télécharger la facture (IDOR)', async () => {
  mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: 'other-user' }] });
  const res = await request(app()).get(`/api/invoices/${VALID_ORDER_ID}/download`);
  expect(res.status).toBe(403);
  expect(mockInvoiceService.issueInvoice).not.toHaveBeenCalled();
});

test('la liste globale des factures est réservée aux admins', async () => {
  expect((await request(app()).get('/api/invoices')).status).toBe(403);
  authState.user = { id: 'admin-1', role: 'admin' };
  mockInvoiceService.listInvoices.mockResolvedValueOnce([{ id: 'inv-1' }]);
  const allowed = await request(app()).get('/api/invoices');
  expect(allowed.status).toBe(200);
  expect(allowed.body.count).toBe(1);
});
