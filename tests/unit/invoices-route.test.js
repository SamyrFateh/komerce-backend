'use strict';

const request = require('supertest');
const express = require('express');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

const mockState = { user: { id: 'u1', role: 'client' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockState.user;
    next();
  },
}));

const mockVerifyToken = jest.fn();
jest.mock('../../services/invoice-public-token', () => ({
  verifyInvoicePublicToken: (...args) => mockVerifyToken(...args),
}));

const mockGetOrCreateInvoice = jest.fn();
const mockGenerateHTML = jest.fn();
const mockListInvoices = jest.fn();
const mockMarkDelivered = jest.fn();
jest.mock('../../services/invoice-service', () => ({
  getOrCreateInvoice: (...args) => mockGetOrCreateInvoice(...args),
  generateHTML: (...args) => mockGenerateHTML(...args),
  listInvoices: (...args) => mockListInvoices(...args),
  markDelivered: (...args) => mockMarkDelivered(...args),
}));

jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() })) }));

const router = require('../../routes/invoices');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/invoices', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const VALID_ORDER_ID = '3f1a9b2c-1234-4abc-89ab-1234567890ab';

describe('GET /api/invoices/public/:token', () => {
  beforeEach(() => jest.clearAllMocks());

  it('404 si le token est invalide ou expire', async () => {
    mockVerifyToken.mockReturnValue(null);
    const res = await request(buildApp()).get('/api/invoices/public/bad-token');
    expect(res.status).toBe(404);
  });

  it('genere et renvoie le HTML de facture pour un token valide, sans authentification', async () => {
    mockVerifyToken.mockReturnValue(VALID_ORDER_ID);
    mockGetOrCreateInvoice.mockResolvedValue({ id: 'inv1', invoice_number: 'F-001' });
    mockGenerateHTML.mockReturnValue('<html>facture</html>');

    const res = await request(buildApp()).get('/api/invoices/public/good-token');
    expect(res.status).toBe(200);
    expect(res.text).toBe('<html>facture</html>');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('404 si la facture est introuvable (message contenant "introuvable")', async () => {
    mockVerifyToken.mockReturnValue(VALID_ORDER_ID);
    mockGetOrCreateInvoice.mockRejectedValue(new Error('Commande introuvable'));

    const res = await request(buildApp()).get('/api/invoices/public/good-token');
    expect(res.status).toBe(404);
  });

  it("400 si la commande n'est pas encore payee", async () => {
    mockVerifyToken.mockReturnValue(VALID_ORDER_ID);
    mockGetOrCreateInvoice.mockRejectedValue(new Error('Commande non payée'));

    const res = await request(buildApp()).get('/api/invoices/public/good-token');
    expect(res.status).toBe(400);
  });
});

describe('requireInvoiceOrderAccess (guard IDOR)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 si non authentifie', async () => {
    mockState.user = null;
    const res = await request(buildApp()).get(`/api/invoices/${VALID_ORDER_ID}`);
    expect(res.status).toBe(401);
  });

  it('400 si orderId n\'est pas un UUID valide', async () => {
    mockState.user = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/invoices/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('UUID');
  });

  it('404 si la commande est introuvable (client)', async () => {
    mockState.user = { id: 'u1', role: 'client' };
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get(`/api/invoices/${VALID_ORDER_ID}`);
    expect(res.status).toBe(404);
  });

  it("403 si la commande appartient a un autre utilisateur (IDOR bloque)", async () => {
    mockState.user = { id: 'u1', role: 'client' };
    mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] });
    const res = await request(buildApp()).get(`/api/invoices/${VALID_ORDER_ID}`);
    expect(res.status).toBe(403);
  });

  it('200 si le client est proprietaire de la commande', async () => {
    mockState.user = { id: 'u1', role: 'client' };
    mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] });
    mockGetOrCreateInvoice.mockResolvedValue({ id: 'inv1', invoice_number: 'F-001' });
    mockGenerateHTML.mockReturnValue('<html>ok</html>');

    const res = await request(buildApp()).get(`/api/invoices/${VALID_ORDER_ID}`);
    expect(res.status).toBe(200);
  });

  it.each(['admin', 'agent_hub', 'agent_relais'])(
    '%s saute la verification de propriete (pas de requete DB de garde)',
    async (role) => {
      mockState.user = { id: 'staff1', role };
      mockGetOrCreateInvoice.mockResolvedValue({ id: 'inv1', invoice_number: 'F-001' });
      mockGenerateHTML.mockReturnValue('<html>ok</html>');

      const res = await request(buildApp()).get(`/api/invoices/${VALID_ORDER_ID}`);
      expect(res.status).toBe(200);
      expect(mockDbQuery).not.toHaveBeenCalled();
    }
  );
});

describe('GET /api/invoices (liste)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('liste avec limit/offset par defaut', async () => {
    mockState.user = { id: 'adm1', role: 'admin' };
    mockListInvoices.mockResolvedValue([{ id: 'inv1' }]);

    const res = await request(buildApp()).get('/api/invoices');
    expect(res.status).toBe(200);
    expect(mockListInvoices).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    expect(res.body.count).toBe(1);
  });

  it('clamp la limite a 200 maximum', async () => {
    mockState.user = { id: 'adm1', role: 'admin' };
    mockListInvoices.mockResolvedValue([]);

    await request(buildApp()).get('/api/invoices?limit=9999');
    expect(mockListInvoices).toHaveBeenCalledWith({ limit: 200, offset: 0 });
  });
});

describe('POST /api/invoices/:orderId/deliver', () => {
  beforeEach(() => jest.clearAllMocks());

  it("400 si 'via' est absent ou invalide", async () => {
    mockState.user = { id: 'adm1', role: 'admin' };
    const res = await request(buildApp()).post(`/api/invoices/${VALID_ORDER_ID}/deliver`).send({ via: 'fax' });
    expect(res.status).toBe(400);
  });

  it('marque la facture comme delivree pour un via valide', async () => {
    mockState.user = { id: 'adm1', role: 'admin' };
    mockGetOrCreateInvoice.mockResolvedValue({ id: 'inv1', invoice_number: 'F-002' });
    mockMarkDelivered.mockResolvedValue(undefined);

    const res = await request(buildApp()).post(`/api/invoices/${VALID_ORDER_ID}/deliver`).send({ via: 'whatsapp' });
    expect(res.status).toBe(200);
    expect(mockMarkDelivered).toHaveBeenCalledWith('inv1', 'whatsapp');
  });
});
