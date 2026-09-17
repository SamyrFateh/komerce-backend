'use strict';

jest.mock('../../services/sourcing-canonical-unit-product-sku-resolution', () => ({
  STATUS: { RESOLVED: 'RESOLVED' },
  resolveCanonicalUnitForProductSku: jest.fn(),
}));

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => next(),
  requireRole: () => (req, res, next) => next(),
}));

jest.mock('../../services/purchasing-trigger-service', () => ({
  triggerPurchasing: jest.fn(),
}));

jest.mock('../../services/purchasing-receive-service', () => ({
  processReceive: jest.fn(),
}));

jest.mock('../../services/purchasing-admin-service', () => ({
  deleteSupplier: jest.fn(),
  confirmPurchaseOrder: jest.fn(),
  cancelPurchaseOrder: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const resolver = require('../../services/sourcing-canonical-unit-product-sku-resolution');
const {
  normalizeCurrency,
  resolveCanonicalSupplierMoney,
  resolveCanonicalMappingMoney,
} = require('../../services/purchasing-canonical-money');
const purchasingRouter = require('../../routes/purchasing');

const IDENTITY = {
  provider: 'allegro',
  version: 1,
  payload: { environment: 'sandbox', offer_id: '7782182471' },
};

function client() {
  return { query: jest.fn() };
}

function resolvedCanonicalUnit() {
  return {
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
  };
}

describe('purchasing canonical supplier money', () => {
  beforeEach(() => jest.clearAllMocks());

  test('normalise une devise ISO en majuscules', () => {
    expect(normalizeCurrency(' pln ')).toBe('PLN');
    expect(normalizeCurrency('PL')).toBeNull();
  });

  test('résout prix + devise depuis la Canonical Unit et conserve la SOI exacte', async () => {
    resolver.resolveCanonicalUnitForProductSku.mockResolvedValue(resolvedCanonicalUnit());
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

  test('résout le prix canonique d’un mapping product_id + supplier_sku sans dépendre de supplier_price_aed', async () => {
    resolver.resolveCanonicalUnitForProductSku.mockResolvedValue(resolvedCanonicalUnit());
    const c = client();
    c.query.mockResolvedValueOnce({
      rows: [{
        id: 'sku-1',
        product_id: 'product-1',
        supplier_sku: 'ALLEGRO-SKU-1',
        supplier_unit_ref: '7782182471',
        supplier_order_identity: IDENTITY,
      }],
    });

    const out = await resolveCanonicalMappingMoney(c, 'product-1', 'ALLEGRO-SKU-1');

    expect(c.query).toHaveBeenCalledWith(expect.stringContaining('FROM product_skus'), ['product-1', 'ALLEGRO-SKU-1']);
    expect(out).toMatchObject({ unit_price: 29.9, currency: 'PLN', canonical_unit_id: 'unit-1' });
  });

  test('un mapping sans product_sku canonique reste legacy', async () => {
    const c = client();
    c.query.mockResolvedValueOnce({ rows: [] });

    await expect(resolveCanonicalMappingMoney(c, 'product-1', 'LEGACY-SKU')).resolves.toBeNull();
    expect(resolver.resolveCanonicalUnitForProductSku).not.toHaveBeenCalled();
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

describe('POST /api/purchasing/suppliers/:id/map — canonical supplier money', () => {
  beforeEach(() => jest.clearAllMocks());

  function app() {
    const instance = express();
    instance.use(express.json());
    instance.use('/api/purchasing', purchasingRouter);
    return instance;
  }

  test('201 sans supplier_price_aed quand le SKU/SOI canonique résout son prix natif', async () => {
    resolver.resolveCanonicalUnitForProductSku.mockResolvedValue(resolvedCanonicalUnit());
    db.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'sku-1',
          product_id: 'product-1',
          supplier_sku: 'ALLEGRO-SKU-1',
          supplier_unit_ref: '7782182471',
          supplier_order_identity: IDENTITY,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'map-1', supplier_price_aed: null }] });

    const res = await request(app())
      .post('/api/purchasing/suppliers/supplier-1/map')
      .send({ product_id: 'product-1', supplier_sku: 'ALLEGRO-SKU-1' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'map-1', supplier_price_aed: null });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][1][4]).toBeNull();
    expect(resolver.resolveCanonicalUnitForProductSku).toHaveBeenCalledWith('sku-1', expect.any(Function));
  });

  test('400 sans supplier_price_aed quand aucun SKU canonique ne porte le prix', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app())
      .post('/api/purchasing/suppliers/supplier-1/map')
      .send({ product_id: 'product-1', supplier_sku: 'LEGACY-SKU' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mapping legacy/);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});