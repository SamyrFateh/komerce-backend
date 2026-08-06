'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/documents/document-service', () => ({
  findExistingDocument: jest.fn(),
  persistDocument: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const pool = require('../../db');
const documentService = require('../../services/documents/document-service');
const { issue, issueForShipment } = require('../../services/documents/customs-invoice');

describe('customs-invoice', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse parcelId ou shipmentId manquant', async () => {
    await expect(issue(null, 'ship-001')).rejects.toThrow('parcelId et shipmentId requis');
    await expect(issue('parcel-001')).rejects.toThrow('parcelId et shipmentId requis');
  });

  it('retourne le document existant si deja emis', async () => {
    const existing = { id: 'doc-001', reference: 'DOC-2026-000001' };
    documentService.findExistingDocument.mockResolvedValueOnce(existing);

    await expect(issue('parcel-001', 'ship-001')).resolves.toBe(existing);
    expect(pool.query).not.toHaveBeenCalled();
    expect(documentService.persistDocument).not.toHaveBeenCalled();
  });

  it('throw si colis ou expedition introuvable', async () => {
    documentService.findExistingDocument.mockResolvedValueOnce(null);
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(issue('parcel-missing', 'ship-001')).rejects.toThrow('Colis parcel-missing introuvable');

    documentService.findExistingDocument.mockResolvedValueOnce(null);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-001' }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(issue('parcel-001', 'ship-missing')).rejects.toThrow('Expédition ship-missing introuvable');
  });

  it('construit les lignes classifiees et persiste le snapshot douane', async () => {
    const doc = { id: 'doc-001', reference: 'DOC-2026-000042' };
    documentService.findExistingDocument.mockResolvedValueOnce(null);
    documentService.persistDocument.mockResolvedValueOnce(doc);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-001', reference: 'P-001', order_id: 'order-001', order_reference: 'CMD-001', relais_name: 'Relais A', relais_island: 'Anjouan' }] })
      .mockResolvedValueOnce({ rows: [{ reference: 'SHIP-001', shipment_date: '2026-06-01', transitaire_name: 'Transit A', transport_mode: 'air', customs_paid_kmf: 10000, declared_at: '2026-06-02' }] })
      .mockResolvedValueOnce({ rows: [
        { quantity: 2, product_name: 'Riz snapshot', product_name_live: 'Riz live', unit_price_kmf: 1000, line_total_kmf: 2000, customs_category_key: 'food', sh_code: '1901', douane_pct: 5, tva_pct: 10, taxe_add_pct: 0, classification_defaulted: false },
        { quantity: 1, product_name: null, product_name_live: 'Produit live', unit_price_kmf: 3000, line_total_kmf: 3000, customs_category_key: 'default', sh_code: null, douane_pct: 0, tva_pct: 0, taxe_add_pct: 0, classification_defaulted: true },
      ] })
      .mockResolvedValueOnce({ rows: [{ parcel_cif_kmf: 5000, customs_share_kmf: 750, allocation_basis: 'by_cif_value' }] })
      .mockResolvedValueOnce({ rows: [{ seq: 42 }] });

    await expect(issue('parcel-001', 'ship-001', { issuedBy: 'admin-001' })).resolves.toBe(doc);
    expect(documentService.persistDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentType: 'customs_invoice',
      subjectType: 'parcel',
      subjectId: 'parcel-001',
      orderId: 'order-001',
      reference: expect.stringMatching(/^DOC-\d{4}-000042$/),
      issuedBy: 'admin-001',
      metadata: expect.objectContaining({
        parcel_id: 'parcel-001', parcel_reference: 'P-001', shipment_id: 'ship-001', shipment_reference: 'SHIP-001',
        order_id: 'order-001', order_reference: 'CMD-001', relais_name: 'Relais A', relais_island: 'Anjouan',
        cif_kmf: 5000, customs_share_kmf: 750, allocation_basis: 'by_cif_value', has_defaulted_lines: true,
        lines: [
          expect.objectContaining({ product_name: 'Riz snapshot', quantity: 2, sh_code: '1901', classification_defaulted: false }),
          expect.objectContaining({ product_name: 'Produit live', quantity: 1, customs_category_key: 'default', classification_defaulted: true }),
        ],
      }),
      dbClient: pool,
    }));
  });

  it('issueForShipment continue meme si un colis echoue', async () => {
    documentService.findExistingDocument
      .mockResolvedValueOnce({ reference: 'DOC-OK' })
      .mockResolvedValueOnce(null);
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(issueForShipment(['parcel-ok', 'parcel-bad'], 'ship-001', 'admin')).resolves.toEqual([
      { parcel_id: 'parcel-ok', reference: 'DOC-OK', ok: true },
      { parcel_id: 'parcel-bad', ok: false, error: '[customs-invoice] Colis parcel-bad introuvable' },
    ]);
  });
});
