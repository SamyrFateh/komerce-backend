'use strict';

jest.mock('../../services/sourcing-canonical-unit-product-sku-resolution', () => ({
  STATUS: { RESOLVED: 'RESOLVED' },
  resolveCanonicalUnitForProductSku: jest.fn(),
}));

const resolver = require('../../services/sourcing-canonical-unit-product-sku-resolution');
const { normalizeCurrency, resolveCanonicalSupplierMoney } = require('../../services/purchasing-canonical-money');

const IDENTITY = {
  provider: 'allegro',
  version: 1,
  payload: { environment: 'sandbox', offer_id: '7782182471' },
};

function client() {
  return { query: jest.fn() };
}

describe('purchasing canonical supplier money', () => {
  beforeEach(() => jest.clearAllMocks());

  test('normalise une devise ISO en majuscules', () => {
    expect(normalizeCurrency(' pln ')).toBe('PLN');
    expect(normalizeCurrency('PL')).toBeNull();
  });

  test('résout prix + devise depuis la Canonical Unit et conserve la SOI exacte', async () => {
    resolver.resolveCanonicalUnitForProductSku.mockResolvedValue({
      status: 'RESOLVED',
      canonical_unit_id: 'unit-1',
      supplier_unit_ref: '7782182471',
      supplier_order_identity: IDENTITY,
      canonical_unit: {
        current_state: {
          purchase_price: 29.9,
          currency: 'PLN',
          supplier_order_identity: IDENTITY,
        },
      },
    });
    const c = client();
    const out = await resolveCanonicalSupplierMoney(c, {
      id: 'sku-1', supplier_unit_ref: '7782182471', supplier_order_identity: IDENTITY,
    });

    expect(out).toEqual({
      unit_price: 29.9,
      currency: 'PLN',
      canonical_unit_id: 'unit-1',
      supplier_unit_ref: '7782182471',
      supplier_order_identity: IDENTITY,
    });
  });

  test('échoue fermé si prix ou devise manquent', async () => {
    resolver.resolveCanonicalUnitForProductSku.mockResolvedValue({
      status: 'RESOLVED',
      canonical_unit_id: 'unit-1',
      supplier_unit_ref: '7782182471',
      supplier_order_identity: IDENTITY,
      canonical_unit: { current_state: { purchase_price: null, currency: 'PLN' } },
    });
    await expect(resolveCanonicalSupplierMoney(client(), {
      id: 'sku-1', supplier_unit_ref: '7782182471', supplier_order_identity: IDENTITY,
    })).rejects.toThrow(/prix fournisseur canonique/);
  });
});
