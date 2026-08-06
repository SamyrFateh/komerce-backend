'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const VALID_ORDER_ID = '3f1a9b2c-1234-4abc-89ab-1234567890ab';
const OTHER_ORDER_ID = '7e2b8c3d-5678-4def-9abc-abcdef012345';

describe('invoice-public-token', () => {
  const previousSecret = process.env.INVOICE_PUBLIC_LINK_SECRET;
  const previousJwt = process.env.JWT_SECRET;
  const previousSession = process.env.SESSION_SECRET;

  beforeEach(() => {
    jest.resetModules();
    process.env.INVOICE_PUBLIC_LINK_SECRET = 'test-secret-please-rotate';
    delete process.env.JWT_SECRET;
    delete process.env.SESSION_SECRET;
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.INVOICE_PUBLIC_LINK_SECRET;
    else process.env.INVOICE_PUBLIC_LINK_SECRET = previousSecret;
    if (previousJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwt;
    if (previousSession === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSession;
  });

  function load() {
    return require('../../services/invoice-public-token');
  }

  describe('createInvoicePublicToken / verifyInvoicePublicToken', () => {
    it('cree un token verifiable qui restitue le bon order_id', () => {
      const { createInvoicePublicToken, verifyInvoicePublicToken } = load();
      const token = createInvoicePublicToken(VALID_ORDER_ID);
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(verifyInvoicePublicToken(token)).toBe(VALID_ORDER_ID);
    });

    it('rejette un order_id invalide a la creation', () => {
      const { createInvoicePublicToken } = load();
      expect(() => createInvoicePublicToken('not-a-uuid')).toThrow('invalid_order_id');
    });

    it("leve une erreur si aucun secret n'est configure", () => {
      delete process.env.INVOICE_PUBLIC_LINK_SECRET;
      const { createInvoicePublicToken } = load();
      expect(() => createInvoicePublicToken(VALID_ORDER_ID)).toThrow('missing_invoice_public_link_secret');
    });

    it('rejette un token altere (signature invalide)', () => {
      const { createInvoicePublicToken, verifyInvoicePublicToken } = load();
      const token = createInvoicePublicToken(VALID_ORDER_ID);
      const [payload] = token.split('.');
      const tampered = `${payload}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;
      expect(verifyInvoicePublicToken(tampered)).toBeNull();
    });

    it('rejette un token signe avec un autre order_id que celui encode (anti-confusion)', () => {
      const { createInvoicePublicToken, verifyInvoicePublicToken } = load();
      const tokenA = createInvoicePublicToken(VALID_ORDER_ID);
      const tokenB = createInvoicePublicToken(OTHER_ORDER_ID);
      const [, sigA] = tokenA.split('.');
      const [payloadB] = tokenB.split('.');
      const mixed = `${payloadB}.${sigA}`;
      expect(verifyInvoicePublicToken(mixed)).toBeNull();
    });

    it('rejette un token malforme (pas de point, vide, null)', () => {
      const { verifyInvoicePublicToken } = load();
      expect(verifyInvoicePublicToken('')).toBeNull();
      expect(verifyInvoicePublicToken(null)).toBeNull();
      expect(verifyInvoicePublicToken('no-dot-here')).toBeNull();
    });

    it('rejette un token verifie si le secret a change (rotation)', () => {
      const { createInvoicePublicToken } = load();
      const token = createInvoicePublicToken(VALID_ORDER_ID);

      jest.resetModules();
      process.env.INVOICE_PUBLIC_LINK_SECRET = 'a-different-secret';
      const { verifyInvoicePublicToken } = require('../../services/invoice-public-token');

      expect(verifyInvoicePublicToken(token)).toBeNull();
    });
  });

  describe('publicInvoiceUrlFromOrderUrl', () => {
    it('transforme une URL de facture privee en URL publique signee', () => {
      const { publicInvoiceUrlFromOrderUrl, verifyInvoicePublicToken } = load();
      const url = `https://komerce.example/api/invoices/${VALID_ORDER_ID}`;
      const result = publicInvoiceUrlFromOrderUrl(url);

      expect(result).toMatch(`/api/invoices/public/`);
      const token = result.split('/api/invoices/public/')[1];
      expect(verifyInvoicePublicToken(token)).toBe(VALID_ORDER_ID);
    });

    it('gere le suffixe /download', () => {
      const { publicInvoiceUrlFromOrderUrl } = load();
      const url = `https://komerce.example/api/invoices/${VALID_ORDER_ID}/download`;
      const result = publicInvoiceUrlFromOrderUrl(url);
      expect(result).toContain('/api/invoices/public/');
    });

    it('retourne l\'URL inchangee si le pattern ne correspond pas', () => {
      const { publicInvoiceUrlFromOrderUrl } = load();
      const url = 'https://komerce.example/api/something-else';
      expect(publicInvoiceUrlFromOrderUrl(url)).toBe(url);
    });
  });
});
