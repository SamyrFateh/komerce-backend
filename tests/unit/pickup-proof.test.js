'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/pickup-proof.test.js
 * Couvre services/documents/pickup-proof.js
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/documents/document-service', () => ({
  findExistingDocument: jest.fn(),
  persistDocument: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
  forModule: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const db = require('../../db');
const documentService = require('../../services/documents/document-service');
const { issue, buildDisplayData } = require('../../services/documents/pickup-proof');

describe('issue', () => {
  beforeEach(() => jest.clearAllMocks());

  it('orderId manquant → rejette', async () => {
    await expect(issue()).rejects.toThrow('orderId requis');
  });

  it('commande introuvable → rejette', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(issue('order-x')).rejects.toThrow('introuvable');
  });

  it('commande pas en statut collected → rejette', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'shipped' }] });
    await expect(issue('order-1')).rejects.toThrow('non collectée');
  });

  it('document deja existant (idempotence) → retourne l\'existant sans generer de reference', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'collected', reference: 'ORD-1' }] });
    documentService.findExistingDocument.mockResolvedValue({ id: 'doc-1', reference: 'RET-2026-000001' });

    const result = await issue('order-1');
    expect(result).toEqual({ id: 'doc-1', reference: 'RET-2026-000001' });
    expect(documentService.persistDocument).not.toHaveBeenCalled();
  });

  it('nominal → genere une reference et persiste le document avec le snapshot', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        id: 'order-1', status: 'collected', reference: 'ORD-1', collected_at: '2026-01-01T10:00:00Z',
        relais_name: 'Relais Moroni', relais_id: 'r1', recipient_name: 'Jean', recipient_phone: '0612',
        user_name: 'Jean Client', payment_mode: 'cash_relais', total_kmf: 5000,
      }] })
      .mockResolvedValueOnce({ rows: [{ seq: 42 }] }); // nextval pickup_proof_seq
    documentService.findExistingDocument.mockResolvedValue(null);
    documentService.persistDocument.mockResolvedValue({ id: 'doc-1', reference: 'RET-2026-000042' });

    const result = await issue('order-1', { issuedBy: 'agent-1' });
    expect(result).toEqual({ id: 'doc-1', reference: 'RET-2026-000042' });
    expect(documentService.persistDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentType: 'pickup_proof',
      subjectType: 'order',
      subjectId: 'order-1',
      orderId: 'order-1',
      reference: expect.stringMatching(/^RET-\d{4}-000042$/),
      issuedBy: 'agent-1',
      metadata: expect.objectContaining({
        order_id: 'order-1',
        order_reference: 'ORD-1',
        relais_name: 'Relais Moroni',
        recipient_name: 'Jean',
        total_kmf: 5000,
      }),
    }));
  });

  it('champs optionnels absents → metadata avec fallback null', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'collected', reference: 'ORD-1' }] })
      .mockResolvedValueOnce({ rows: [{ seq: 1 }] });
    documentService.findExistingDocument.mockResolvedValue(null);
    documentService.persistDocument.mockResolvedValue({ id: 'doc-1' });

    await issue('order-1');
    const callArg = documentService.persistDocument.mock.calls[0][0];
    expect(callArg.metadata.relais_name).toBeNull();
    expect(callArg.metadata.recipient_name).toBeNull();
    expect(callArg.issuedBy).toBeNull();
  });

  it('utilise dbClient fourni au lieu du pool par defaut', async () => {
    const customClient = { query: jest.fn() };
    customClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'collected', reference: 'ORD-1' }] })
      .mockResolvedValueOnce({ rows: [{ seq: 1 }] });
    documentService.findExistingDocument.mockResolvedValue(null);
    documentService.persistDocument.mockResolvedValue({ id: 'doc-1' });

    await issue('order-1', { dbClient: customClient });
    expect(customClient.query).toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('buildDisplayData', () => {
  it('metadata en objet → extrait les champs avec fallback "—"', () => {
    const doc = {
      reference: 'RET-2026-000001',
      issued_at: '2026-01-02T10:00:00Z',
      metadata: { order_reference: 'ORD-1', relais_name: 'Relais A', collected_at: '2026-01-01T09:00:00Z' },
    };
    const result = buildDisplayData(doc);
    expect(result.reference).toBe('RET-2026-000001');
    expect(result.document_type).toBe('Preuve de retrait');
    expect(result.order_reference).toBe('ORD-1');
    expect(result.relais_name).toBe('Relais A');
    expect(result.recipient_name).toBe('—');
    expect(result.collected_at).not.toBe('—');
  });

  it('metadata en string JSON → parse correctement', () => {
    const doc = {
      reference: 'RET-2026-000002',
      issued_at: '2026-01-02T10:00:00Z',
      metadata: JSON.stringify({ order_reference: 'ORD-2' }),
    };
    const result = buildDisplayData(doc);
    expect(result.order_reference).toBe('ORD-2');
  });

  it('metadata absente → tous les champs en fallback, pas de crash', () => {
    const doc = { reference: 'RET-2026-000003', issued_at: null };
    const result = buildDisplayData(doc);
    expect(result.order_reference).toBe('—');
    expect(result.relais_name).toBe('—');
    expect(result.recipient_name).toBe('—');
    expect(result.recipient_phone).toBeNull();
    expect(result.collected_at).toBe('—');
    expect(result.issued_at).toBe('—');
  });
});
