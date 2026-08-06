/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * POST-O8 — Contract test: invoice-ready → AuthKey transport routing.
 *
 * Evidence level: MOCK_INTEGRATION (fetch mocked; DB access to invoice
 * generation stubbed). No real WhatsApp / network is ever sent.
 *
 * Reproduces the O7.2 (Cycle A) behavioural regression flagged in
 * docs/POST_O8_BUSINESS_SEMANTIC_AUDIT.md §INVOICE_AUTHKEY_WID.
 *
 * Business chain under test:
 *   invoice-service.sendInvoiceReadyNotification(orderId)
 *     ↓ builds signed public invoice URL (orders owns the representation)
 *     ↓ hands a READY payload to the notifications transport
 *     ↓ notifications chooses transport: WID template if configured, else free-text
 *     ↓ authkey-client → fetch(AUTHKEY_URL)
 *
 * We inspect the EXACT body sent to fetch.
 *
 * Cases (from the mission spec §5.1):
 *   A — AUTHKEY_WID_INVOICE_READY configured → payload MUST use the template
 *       (wid = AUTHKEY_WID_INVOICE_READY, bodyValues carries the public URL),
 *       NOT a free-text payload.
 *   B — WID absent → free-text fallback explicitly proven.
 *   C — NODE_ENV=staging + phone not whitelisted → no network call at all.
 *   D — the URL is a signed public token, never a raw orderId.
 */

'use strict';

const VALID_ORDER_ID = '11111111-1111-4111-8111-111111111111';

// A fixture invoice row as returned by getOrCreateInvoice(), so the test is
// decoupled from full order seeding — the invoice generation path is covered
// separately by tests/unit/invoice-service.test.js.
function fixtureInvoice(overrides = {}) {
  return {
    id: 'inv-1',
    invoice_number: 'KOM-INV-2026-000123',
    order_id: VALID_ORDER_ID,
    client_phone: '+2693301234',
    client_name: 'ITest Client',
    payment_mode: 'stripe_eur',
    ...overrides,
  };
}

function loadFreshModules() {
  jest.resetModules();
  // Cases A/B/C/D flip NODE_ENV to 'production'/'staging' to exercise the
  // WID/whitelist branching in authkey-client. db.js schedules a real
  // setInterval pool-monitor whenever NODE_ENV !== 'test' — harmless in prod,
  // but a genuine Jest open handle here since we only care about the
  // notification-transport routing, never about DB access (getOrCreateInvoice
  // is stubbed below). Mock db.js so the fresh require of invoice-service
  // never constructs the real pg Pool / interval under the simulated env.
  jest.doMock('../../db', () => ({
    query: jest.fn(),
    getClient: jest.fn(),
  }));
  // invoice-service is a singleton instance; authkey-client computes WID /
  // IS_PRODUCTION / _allowedPhones at load — must be required fresh per env.
  const invoiceService = require('../../services/invoice-service');
  return { invoiceService };
}

function bodySentToFetch() {
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [, init] = global.fetch.mock.calls[0];
  return JSON.parse(init.body);
}

describe('POST-O8 — invoice-ready AuthKey transport contract', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ Status: 'Success', LogID: 'log-xyz' }),
    });
    process.env.AUTHKEY_API_KEY = 'test-key';
    process.env.INVOICE_PUBLIC_LINK_SECRET = 'audit-invoice-secret';
    process.env.APP_URL = 'https://app.komerce.km';
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
    jest.restoreAllMocks();
  });

  // ── Case A — WID configured MUST route through the template ───────────────
  it('A — AUTHKEY_WID_INVOICE_READY configured → uses the WID template, not free-text', async () => {
    process.env.NODE_ENV = 'production'; // no staging whitelist filter
    process.env.AUTHKEY_WID_INVOICE_READY = '33001';

    const { invoiceService } = loadFreshModules();
    jest.spyOn(invoiceService, 'getOrCreateInvoice').mockResolvedValue(fixtureInvoice());

    await invoiceService.sendInvoiceReadyNotification(VALID_ORDER_ID, 'REF-A');

    const body = bodySentToFetch();

    // The template transport is discriminated by presence of `wid` + `bodyValues`
    // and the ABSENCE of a bare free-text `message`.
    expect(body.wid).toBe('33001');
    expect(body.message).toBeUndefined();
    expect(body.bodyValues).toBeDefined();

    // bodyValues must carry the public invoice URL for the template to render.
    const values = Object.values(body.bodyValues).join(' ');
    expect(values).toMatch(/\/api\/invoices\/public\//);
  });

  // ── Case B — no WID → free-text fallback ─────────────────────────────────
  it('B — WID absent → explicit free-text fallback', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTHKEY_WID_INVOICE_READY;
    delete process.env.AUTHKEY_INVOICE_READY_WID;
    delete process.env.WID_INVOICE_READY;

    const { invoiceService } = loadFreshModules();
    jest.spyOn(invoiceService, 'getOrCreateInvoice').mockResolvedValue(fixtureInvoice());

    await invoiceService.sendInvoiceReadyNotification(VALID_ORDER_ID, 'REF-B');

    const body = bodySentToFetch();
    // Free-text transport: has `message`, no `wid`.
    expect(typeof body.message).toBe('string');
    expect(body.message).toMatch(/\/api\/invoices\/public\//);
    expect(body.wid).toBeUndefined();
  });

  // ── Case C — staging + non-whitelisted phone → zero network ──────────────
  it('C — staging, phone not whitelisted → no network call', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.AUTHKEY_ALLOWED_PHONES = '+2699999999'; // does NOT match fixture
    process.env.AUTHKEY_WID_INVOICE_READY = '33001';

    const { invoiceService } = loadFreshModules();
    jest.spyOn(invoiceService, 'getOrCreateInvoice').mockResolvedValue(fixtureInvoice());

    await invoiceService.sendInvoiceReadyNotification(VALID_ORDER_ID, 'REF-C');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── Case D — URL is a signed public token, never a raw orderId ───────────
  it('D — invoice URL is a signed public token, not a raw orderId', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTHKEY_WID_INVOICE_READY; // free-text carries the URL literally

    const { invoiceService } = loadFreshModules();
    jest.spyOn(invoiceService, 'getOrCreateInvoice').mockResolvedValue(fixtureInvoice());

    await invoiceService.sendInvoiceReadyNotification(VALID_ORDER_ID, 'REF-D');

    const body = bodySentToFetch();
    const carrier = body.message || Object.values(body.bodyValues || {}).join(' ');

    const m = carrier.match(/\/api\/invoices\/public\/([^\s]+)/);
    expect(m).not.toBeNull();
    const token = m[1];

    // The raw orderId must NOT appear as the path token.
    expect(token).not.toBe(VALID_ORDER_ID);
    expect(carrier).not.toContain(`/public/${VALID_ORDER_ID}`);

    // The token must be verifiable back to the order via the signed HMAC.
    const { verifyInvoicePublicToken } = require('../../services/invoice-public-token');
    expect(verifyInvoicePublicToken(token)).toBe(VALID_ORDER_ID);
  });
});
