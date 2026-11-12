/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

jest.mock('../../js/b-store.js', () => ({ state: { cart: [], cartSurface: 'personal' } }));
jest.mock('../../js/b-bus.js', () => ({ bus: { on: jest.fn(), off: jest.fn() } }));
jest.mock('../../js/b-utils.js', () => ({
  apiPost: jest.fn(),
  fmt: jest.fn(amount => Number(amount).toLocaleString('fr-FR') + ' KMF'),
}));
const { cartQuotePayload, renderQuotePreview, quoteVariantLabel } = require('../../js/b-cart-quote.js');

describe('Fais-moi un devis — sans relais ni identité', () => {
  const cart = [
    { product: { id: 'p-1' }, qty: 2, variant_combo: { cj_size: 'S' }, requested_transport_rail: 'SEA_STANDARD' },
    { product: { id: 'p-1' }, qty: 1, variant_combo: { cj_size: 'M' } },
  ];
  test('conserve deux tailles distinctes et le marché sans prix client ni relais', () => {
    expect(cartQuotePayload(cart, 'KM')).toEqual({
      market_code: 'KM',
      items: [
        { product_id: 'p-1', quantity: 2, variant_combo: { cj_size: 'S' }, requested_transport_rail: 'SEA_STANDARD' },
        { product_id: 'p-1', quantity: 1, variant_combo: { cj_size: 'M' }, requested_transport_rail: null },
      ],
    });
  });
  test('refuse un panier vide, quantité invalide, ou marché absent', () => {
    expect(cartQuotePayload(cart, null)).toBeNull();
    expect(cartQuotePayload([], 'KM')).toBeNull();
    expect(cartQuotePayload([{ product: { id: 'p-1' }, qty: 0 }], 'KM')).toBeNull();
  });
  test('affiche le montant officiel, la livraison incluse et des variantes lisibles', () => {
    const root = document.createElement('div');
    renderQuotePreview(root, {
      total_kmf: 7990, items_total_kmf: 7990, transport_price_kmf: 0,
      items: [{ product_name: '<script>bad()</script>', quantity: 1,
        variant_combo: { cj_color: 'Rouge', cj_size: 'S' },
        unit_price_kmf: 7990, line_total_kmf: 7990 }],
    });
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<script>bad()</script>');
    expect(root.textContent).toContain('Couleur : Rouge');
    expect(root.textContent).toContain('Taille : S');
    expect(root.textContent).toContain('7');
    expect(root.textContent).toContain('Livraison maritime incluse');
    expect(root.textContent).not.toContain('Point relais');
    expect(root.textContent).not.toContain('26 KMF');
    expect(quoteVariantLabel({ cj_size: 'XL' })).toBe('Taille : XL');
  });
  test('refuse un supplément maritime non nul en provenance du serveur', () => {
    expect(() => renderQuotePreview(document.createElement('div'), {
      items: [{}], total_kmf: 8016, transport_price_kmf: 26,
    })).toThrow(/incomplet/);
  });

  test('ferme le devis après téléchargement et partage réussi, reste ouvert si partage annulé', async () => {
    const { setupCartQuote } = require('../../js/b-cart-quote.js');
    const { state } = require('../../js/b-store.js');
    const origin = document.createElement('button');
    origin.id = 'k-cart-quote';
    document.body.appendChild(origin);
    document.body.dataset.marketCode = 'KM';
    state.cart = cart;
    state.cartSurface = 'personal';

    const preview = {
      total_kmf: 23970, items_total_kmf: 23970, transport_price_kmf: 0,
      items: [
        { product_name: 'Chemise', quantity: 2, unit_price_kmf: 7990,
          line_total_kmf: 15980, variant_combo: { cj_size: 'S' } },
        { product_name: 'Chemise', quantity: 1, unit_price_kmf: 7990,
          line_total_kmf: 7990, variant_combo: { cj_size: 'M' } },
      ],
    };
    const oldFetch = global.fetch;
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    const oldShare = Object.getOwnPropertyDescriptor(navigator, 'share');
    const oldCanShare = Object.getOwnPropertyDescriptor(navigator, 'canShare');
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    global.fetch = jest.fn().mockImplementation(async (_url, options) => {
      if (options.headers.Accept === 'application/json') {
        return { ok: true, json: async () => preview };
      }
      return { ok: true, blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }) };
    });
    URL.createObjectURL = jest.fn(() => 'blob:quote');
    URL.revokeObjectURL = jest.fn();
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    const openReady = async () => {
      origin.click();
      await flush();
      expect(document.querySelector('#k-quote-result').hidden).toBe(false);
    };

    try {
      setupCartQuote();
      await openReady();
      document.querySelector('[data-quote-action="save"]').click();
      await flush();
      expect(anchorClick).toHaveBeenCalledTimes(1);
      expect(document.querySelector('#k-quote-dialog')).toBeNull();
      expect(document.activeElement).toBe(origin);

      Object.defineProperty(navigator, 'share', { configurable: true,
        value: jest.fn().mockRejectedValue({ name: 'AbortError' }) });
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      await openReady();
      document.querySelector('[data-quote-action="share"]').click();
      await flush();
      expect(document.querySelector('#k-quote-dialog')).not.toBeNull();
      expect(anchorClick).toHaveBeenCalledTimes(1);

      navigator.share.mockResolvedValueOnce();
      await new Promise(resolve => setTimeout(resolve, 0));
      document.querySelector('[data-quote-action="share"]').click();
      await flush();
      expect(document.querySelector('#k-quote-dialog')).toBeNull();
      expect(anchorClick).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = oldFetch;
      URL.createObjectURL = oldCreate;
      URL.revokeObjectURL = oldRevoke;
      if (oldShare) Object.defineProperty(navigator, 'share', oldShare);
      else delete navigator.share;
      if (oldCanShare) Object.defineProperty(navigator, 'canShare', oldCanShare);
      else delete navigator.canShare;
      anchorClick.mockRestore();
      document.body.removeAttribute('data-market-code');
      document.querySelector('#k-quote-dialog')?.remove();
      origin.remove();
      state.cart = [];
    }
  });
});
