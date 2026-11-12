'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));
jest.mock('../../services/invoice-service', () => ({ issueInvoice: jest.fn() }));
jest.mock('../../services/documents/pickup-proof', () => ({ issueForHandoff: jest.fn() }));
jest.mock('../../services/documents/refund-receipt', () => ({ issue: jest.fn() }));

const invoiceService = require('../../services/invoice-service');
const pickupProof = require('../../services/documents/pickup-proof');
const refundReceipt = require('../../services/documents/refund-receipt');
const { reconcileDocuments } = require('../../services/documents/document-reconciliation');

function dbWith({ invoice = [], proof = [], refund = [] }) {
  return { query: jest.fn(async (sql) => {
    if (sql.includes('FROM invoices') || sql.includes('LEFT JOIN invoices')) return { rows: invoice };
    if (sql.includes("document_type = 'pickup_proof'")) return { rows: proof };
    if (sql.includes("document_type = 'refund_receipt'")) return { rows: refund };
    throw new Error('requête inattendue ' + sql);
  }) };
}

describe('document-reconciliation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('réémet les trois familles via les services d\'émission existants', async () => {
    const db = dbWith({
      invoice: [{ subject_id: 'o1', order_id: 'o1' }],
      proof: [{ subject_id: 'scan-2', order_id: 'o2' }],
      refund: [{ subject_id: 'r1', order_id: 'o3' }],
    });
    const report = await reconcileDocuments({ db, issuedBy: 'admin-1' });
    expect(invoiceService.issueInvoice).toHaveBeenCalledWith('o1');
    expect(pickupProof.issueForHandoff).toHaveBeenCalledWith('scan-2', { issuedBy: 'admin-1' });
    expect(refundReceipt.issue).toHaveBeenCalledWith('r1', { issuedBy: 'admin-1' });
    expect(report).toMatchObject({ issued: 3, failed: 0, dry_run: false });
  });

  it('dry_run : détecte sans émettre', async () => {
    const db = dbWith({ refund: [{ subject_id: 'r1', order_id: 'o3' }] });
    const report = await reconcileDocuments({ db, dryRun: true });
    expect(report.families.refund_receipt.missing).toBe(1);
    expect(refundReceipt.issue).not.toHaveBeenCalled();
    expect(report.issued).toBe(0);
  });

  it('un échec est rapporté sans bloquer les autres et sans compter comme émis', async () => {
    const db = dbWith({ refund: [{ subject_id: 'r1', order_id: 'o3' }, { subject_id: 'r2', order_id: 'o4' }] });
    refundReceipt.issue.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ id: 'd' });
    const report = await reconcileDocuments({ db });
    expect(report.failed).toBe(1);
    expect(report.issued).toBe(1);
    expect(report.families.refund_receipt.failed[0]).toMatchObject({ subject_id: 'r1', error: 'boom' });
  });

  it('bornes : limite plafonnée ; détecteurs limités aux événements confirmés', async () => {
    const db = dbWith({});
    await reconcileDocuments({ db, limit: 99999 });
    expect(db.query.mock.calls.every(([, p]) => p[0] === 200)).toBe(true);
    const sqls = db.query.mock.calls.map(c => c[0]).join('\n');
    expect(sqls).toMatch(/payment_status = 'paid'/);
    expect(sqls).toMatch(/s\.step = 'collected'/);
    expect(sqls).toMatch(/td\.subject_type = 'pickup_handoff'/);
    expect(sqls).toMatch(/td\.subject_id = s\.id/);
    expect(sqls).toMatch(/r\.status = 'completed'/);
  });
});
