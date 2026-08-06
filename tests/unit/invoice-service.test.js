/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch
 * @role          invoice-service-test
 * @domain        orders
 * @layer         test
 * @criticality   medium
 * @depends       services/invoice-service.js
 * @used-by       CI unit job
 * @version       2026-06
 */

/**
 * KOMERCE — Tests Unitaires : invoice-service (AUD-08)
 *
 * Couvre :
 *   FACT-01 : calcul correct unit_price * quantity (régression principale)
 *   - item.total = price_kmf * quantity (pas price_kmf seul)
 *   - subtotal = somme des totaux ligne
 *   - total facture = order.total_kmf (livraison incluse dans le prix)
 *   - generateHTML : rendu correct des lignes article, totaux, escapeHtml
 *   - generateHTML : mode thermal produit bien la classe CSS correcte
 *   - getOrCreateInvoice : retourne facture existante sans INSERT (idempotence)
 *   - getOrCreateInvoice : lève une erreur si commande non trouvée
 *   - getOrCreateInvoice : lève une erreur si commande non payée
 *
 * Run : npx jest tests/unit/invoice-service.test.js
 */

'use strict';

// ── Mock db avant tout require ─────────────────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));


// Charger le service APRÈS les mocks
const invoiceService = require('../../services/invoice-service');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Construit un objet invoice minimal pour generateHTML */
function makeInvoice(overrides = {}) {
  return {
    id: 'inv-uuid-1',
    invoice_number: 'KOM-INV-2026-000001',
    order_id: 'order-uuid-1',
    parcel_id: null,
    client_name: 'Fatima Ahmed',
    client_phone: '+2690000001',
    relay_name: 'Relais Moroni Centre',
    items_snapshot: JSON.stringify([
      { name: 'Téléphone Samsung', qty: 1, unit_price: 50000, total: 50000 },
      { name: 'Coque de protection', qty: 2, unit_price: 3000, total: 6000 },
    ]),
    subtotal_kmf: 56000,
    shipping_kmf: 0,
    total_kmf: 58000,
    payment_mode: 'cash_relais',
    payment_status: 'paid',
    created_at: '2026-06-23T10:00:00.000Z',
    order_reference: 'KREF001',
    parcel_reference: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── generateHTML — calcul des lignes ──────────────────────────────────────

describe('generateHTML — calcul lignes et totaux', () => {
  test('FACT-01 : total ligne = unit_price * qty (pas unit_price seul)', () => {
    const invoice = makeInvoice();
    const html = invoiceService.generateHTML(invoice, {
      orderRef: 'KREF001',
      parcelRef: 'PKG-001',
    });

    // Ligne 1 : qty=1, unit_price=50000, total=50000
    expect(html).toContain('>1<'); // qty
    expect(html).toContain('50\u202f000'); // unit_price formatted (fr-FR uses non-breaking thin space)

    // Ligne 2 : qty=2, unit_price=3000, total=6000
    expect(html).toContain('>2<'); // qty
    expect(html).toContain('6\u202f000'); // total 3000*2
  });

  test('FACT-01 : total facture = order.total_kmf, pas la somme des lignes', () => {
    // subtotal=56000 mais total_kmf=58000 (ex. frais déjà inclus)
    const invoice = makeInvoice({ subtotal_kmf: 56000, total_kmf: 58000 });
    const html = invoiceService.generateHTML(invoice);
    // Le grand total affiché doit être 58000, pas 56000
    expect(html).toContain('58\u202f000');
  });

  test('items_snapshot accepte un objet déjà parsé (pas seulement une string)', () => {
    const invoice = makeInvoice({
      items_snapshot: [
        { name: 'Article A', qty: 3, unit_price: 2000, total: 6000 },
      ],
    });
    const html = invoiceService.generateHTML(invoice);
    expect(html).toContain('Article A');
    expect(html).toContain('>3<');
  });

  test('escapeHtml appliqué sur les noms de produit (XSS)', () => {
    const invoice = makeInvoice({
      items_snapshot: JSON.stringify([
        { name: '<script>alert(1)</script>', qty: 1, unit_price: 1000, total: 1000 },
      ]),
    });
    const html = invoiceService.generateHTML(invoice);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('escapeHtml appliqué sur client_name, relay_name, invoice_number', () => {
    const invoice = makeInvoice({
      client_name: '<b>Ali & Said</b>',
      relay_name: '"Relais Nord"',
      invoice_number: 'KOM-INV-<test>',
    });
    const html = invoiceService.generateHTML(invoice);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('Ali &amp; Said');
    expect(html).toContain('&quot;Relais Nord&quot;');
  });
});

// ── generateHTML — mode thermal ────────────────────────────────────────────

describe('generateHTML — mode thermal', () => {
  test('mode a5 par défaut — pas de classe thermal', () => {
    const html = invoiceService.generateHTML(makeInvoice());
    expect(html).toContain('class="invoice"');
    expect(html).not.toContain('class="invoice thermal"');
  });

  test('mode thermal — classe invoice thermal présente', () => {
    const html = invoiceService.generateHTML(makeInvoice(), { mode: 'thermal' });
    expect(html).toContain('class="invoice thermal"');
  });
});

// ── getOrCreateInvoice — idempotence ──────────────────────────────────────

describe('getOrCreateInvoice — idempotence', () => {
  test('retourne la facture existante sans INSERT si déjà créée', async () => {
    const existingInvoice = { id: 'inv-existing', invoice_number: 'KOM-INV-2026-000042', order_id: 'order-1' };
    mockQuery.mockResolvedValueOnce({ rows: [existingInvoice] }); // SELECT invoices

    const result = await invoiceService.getOrCreateInvoice('order-1');

    expect(result).toEqual(existingInvoice);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/SELECT.*FROM invoices/i);
    // Pas d'INSERT
    expect(mockQuery.mock.calls.find(c => /INSERT/i.test(c[0]))).toBeUndefined();
  });
});

// ── getOrCreateInvoice — erreurs ──────────────────────────────────────────

describe('getOrCreateInvoice — cas d\'erreur', () => {
  test('lève une erreur si la commande est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT invoices — vide
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT orders — vide

    await expect(invoiceService.getOrCreateInvoice('order-inexistant'))
      .rejects.toThrow(/introuvable/i);
  });

  test('lève une erreur si la commande n\'est pas payée', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT invoices — vide
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'order-2',
        reference: 'KREF002',
        total_kmf: 10000,
        payment_mode: 'cash_relais',
        payment_status: 'pending', // pas payée
        relais_id: 'rel-1',
        recipient_id: 'rec-1',
        client_name: 'Test',
        client_phone: '+2690000002',
        relay_name: 'Relais Test',
      }],
    }); // SELECT orders

    await expect(invoiceService.getOrCreateInvoice('order-2'))
      .rejects.toThrow(/non payée/i);
  });
});

// ── getOrCreateInvoice — calcul items (FACT-01) ────────────────────────────

describe('getOrCreateInvoice — calcul items FACT-01', () => {
  test('item.total = price_kmf * quantity pour chaque ligne avant INSERT', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT invoices
      .mockResolvedValueOnce({
        rows: [{
          id: 'order-3',
          reference: 'KREF003',
          total_kmf: 64000,
          payment_mode: 'stripe_eur',
          payment_status: 'paid',
          relais_id: 'rel-1',
          recipient_id: 'rec-1',
          client_name: 'Omar Ali',
          client_phone: '+2690000003',
          relay_name: 'Relais Sud',
        }],
      }) // SELECT orders
      .mockResolvedValueOnce({
        rows: [
          { quantity: 2, price_kmf: 15000, product_name: 'Chaussures' },
          { quantity: 1, price_kmf: 34000, product_name: 'Sac' },
        ],
      }) // SELECT order_items
      .mockResolvedValueOnce({ rows: [] }) // SELECT parcels
      .mockResolvedValueOnce({ rows: [{ seq: 99 }] }) // nextval invoice_seq
      .mockResolvedValueOnce({
        rows: [{
          id: 'inv-new',
          invoice_number: 'KOM-INV-2026-000099',
          order_id: 'order-3',
        }],
      }); // INSERT invoices

    await invoiceService.getOrCreateInvoice('order-3');

    // Trouver l'appel INSERT
    const insertCall = mockQuery.mock.calls.find(c => /INSERT INTO invoices/i.test(c[0]));
    expect(insertCall).toBeDefined();
    const params = insertCall[1];

    // params[6] = items_snapshot (JSON)
    const items = JSON.parse(params[6]);
    expect(items).toHaveLength(2);

    // Chaussures : qty=2, price=15000 → total=30000
    expect(items[0].qty).toBe(2);
    expect(items[0].unit_price).toBe(15000);
    expect(items[0].total).toBe(30000); // FACT-01

    // Sac : qty=1, price=34000 → total=34000
    expect(items[1].qty).toBe(1);
    expect(items[1].unit_price).toBe(34000);
    expect(items[1].total).toBe(34000); // FACT-01

    // params[7] = subtotal_kmf = 30000 + 34000 = 64000
    expect(params[7]).toBe(64000);
    // params[8] = shipping_kmf = 0
    expect(params[8]).toBe(0);
    // params[9] = total_kmf = order.total_kmf = 64000
    expect(params[9]).toBe(64000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// O7.2 (Cycle A) — sendInvoiceReadyNotification
//
// Déplacé depuis services/notifications/order.js pour casser le cycle
// runtime notifications<->orders (voir docs/O7_2_CYCLE_ANALYSIS.md). Cette
// méthode construit désormais le lien de facture publique ET l'envoie —
// `notifications` ne fait plus que transporter un message déjà prêt.
// ═══════════════════════════════════════════════════════════════════════
describe('sendInvoiceReadyNotification', () => {
  const mockCreateToken = jest.fn();
  // POST-O8 (INVOICE_AUTHKEY_WID) : le transport passe désormais par
  // notifyInvoiceReady (template WID si configuré, sinon repli texte libre).
  // `orders` construit toujours l'URL publique signée et la passe dans un
  // payload prêt ; `notifications` choisit le transport.
  const mockNotifyInvoiceReady = jest.fn();

  jest.mock('../../services/invoice-public-token', () => ({
    createInvoicePublicToken: (...a) => mockCreateToken(...a),
  }));
  jest.mock('../../services/notification-service', () => ({
    notifyInvoiceReady: (...a) => mockNotifyInvoiceReady(...a),
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateToken.mockReturnValue('signed-token-abc');
  });

  function mockExistingInvoice(overrides = {}) {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        invoice_number: 'KOM-INV-2026-000042',
        client_phone: '+269111',
        payment_mode: 'stripe_eur',
        ...overrides,
      }],
    });
  }

  it('construit un lien public signé et le passe à notifyInvoiceReady (stripe_eur → "facture disponible")', async () => {
    mockExistingInvoice();
    mockNotifyInvoiceReady.mockResolvedValueOnce({ ok: true, messageId: 'm1' });

    const result = await invoiceService.sendInvoiceReadyNotification('11111111-1111-1111-1111-111111111111', 'CMD-1');

    expect(mockCreateToken).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    expect(mockNotifyInvoiceReady).toHaveBeenCalledWith(
      '+269111',
      expect.objectContaining({
        publicUrl: expect.stringContaining('/api/invoices/public/signed-token-abc'),
        message: expect.stringContaining('facture'),
        invoiceNumber: 'KOM-INV-2026-000042',
      }),
      '11111111-1111-1111-1111-111111111111',
    );
    expect(result).toEqual({ ok: true, messageId: 'm1' });
  });

  it('utilise le message "paiement enregistré" pour cash_relais', async () => {
    mockExistingInvoice({ payment_mode: 'cash_relais' });
    mockNotifyInvoiceReady.mockResolvedValueOnce({ ok: true });

    await invoiceService.sendInvoiceReadyNotification('11111111-1111-1111-1111-111111111111', 'CMD-1');

    expect(mockNotifyInvoiceReady).toHaveBeenCalledWith(
      '+269111',
      expect.objectContaining({ message: expect.stringContaining('enregistre') }),
      '11111111-1111-1111-1111-111111111111',
    );
  });

  it('skip proprement si aucun téléphone sur la facture', async () => {
    mockExistingInvoice({ client_phone: null });

    const result = await invoiceService.sendInvoiceReadyNotification('11111111-1111-1111-1111-111111111111', 'CMD-1');

    expect(result).toEqual({ ok: false, reason: 'no_phone' });
    expect(mockNotifyInvoiceReady).not.toHaveBeenCalled();
  });

  it('non-bloquant si getOrCreateInvoice rejette (ex. paiement pas encore confirmé)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Commande CMD-1 non payée (status: pending)'));

    const result = await invoiceService.sendInvoiceReadyNotification('11111111-1111-1111-1111-111111111111', 'CMD-1');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('non payée');
    expect(mockNotifyInvoiceReady).not.toHaveBeenCalled();
  });

  it('propage un résultat ok:false sans lever si notifyInvoiceReady échoue', async () => {
    mockExistingInvoice();
    mockNotifyInvoiceReady.mockResolvedValueOnce({ ok: false, reason: 'no_phone_or_payload' });

    const result = await invoiceService.sendInvoiceReadyNotification('11111111-1111-1111-1111-111111111111', 'CMD-1');

    expect(result).toEqual({ ok: false, reason: 'no_phone_or_payload' });
  });
});
