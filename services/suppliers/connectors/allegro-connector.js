/**
 * @komerce-arch
 * @role          allegro-sandbox-source-connector
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        sandbox seller offer IDs or bounded page
 * @outputs       NormalizedSupplierProduct V2, native PLN facts
 * @depends       services/suppliers/allegro-sandbox-client.js, services/suppliers/normalized-product.js
 * @used-by       services/sourcing-import-dispatch.js, services/suppliers/allegro-fulfillment-adapter.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing
 */
'use strict';
const client = require('../allegro-sandbox-client');
const { partitionValid } = require('../normalized-product');

function offerId(value) {
  if (typeof value !== 'string' || !/^[0-9]{1,30}$/.test(value)) throw new Error('ALLEGRO_OFFER_ID_REQUIRED');
  return value;
}

function normalizeOffer(offer, expectedId) {
  const id = offerId(offer?.id);
  if (id !== expectedId) throw new Error('ALLEGRO_OFFER_ID_MISMATCH');
  if (!Array.isArray(offer.productSet) || offer.productSet.length !== 1
    || offer.productSet[0].quantity?.value !== 1) throw new Error('ALLEGRO_BUNDLE_UNSUPPORTED');
  const money = offer.sellingMode?.price;
  if (offer.sellingMode?.format !== 'BUY_NOW' || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(money?.amount)
    || !(Number(money.amount) > 0) || money.currency !== 'PLN') throw new Error('ALLEGRO_PRICE_UNSUPPORTED');
  const stock = offer.stock?.available;
  if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('ALLEGRO_STOCK_UNKNOWN');
  if (!['ACTIVE', 'INACTIVE', 'ACTIVATING', 'ENDED'].includes(offer.publication?.status)) throw new Error('ALLEGRO_PUBLICATION_UNKNOWN');
  const media = (offer.images || []).map((url, i) => ({
    supplier_media_id: `allegro-sandbox:${id}:${i}`, url, role: 'PRODUCT', display_order: i,
  }));
  return {
    schema_version: '2', supplier_name: 'Allegro Sandbox', supplier_product_id: id,
    product_name: offer.name, supplier_category: offer.category?.id || null,
    purchase_price: Number(money.amount), currency: 'PLN', stock_available: stock,
    product_url: `https://allegro.pl.allegrosandbox.pl/oferta/${id}`,
    source_locale: 'pl-PL', media, option_axes: [],
    sellable_units: [{ supplier_sku: `allegro-sandbox:${id}`, supplier_unit_ref: id,
      supplier_order_identity: { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: id } },
      option_values: {}, purchase_price: Number(money.amount), currency: 'PLN', stock_available: stock,
      is_active: offer.publication.status === 'ACTIVE', media_refs: media.map(m => m.supplier_media_id),
    }],
    raw_payload: { allegro: { environment: 'sandbox', offer } },
  };
}

async function fetchProducts(options = {}) {
  const api = options.client || client;
  let ids;
  if (options.productIds !== undefined) {
    if (!Array.isArray(options.productIds) || !options.productIds.length || options.productIds.length > 100) throw new Error('ALLEGRO_EXPECTS_1_TO_100_OFFER_IDS');
    ids = [...new Set(options.productIds.map(offerId))];
  } else {
    const size = Number(options.size ?? 30);
    const page = Number(options.page ?? 1);
    if (!Number.isSafeInteger(size) || size < 1 || size > 100 || !Number.isSafeInteger(page) || page < 1
      || (page - 1) * size > 99900) throw new Error('ALLEGRO_INVALID_PAGE');
    const params = { limit: size, offset: (page - 1) * size, 'publication.status': 'ACTIVE' };
    if (options.keyword) params.name = String(options.keyword);
    const listed = await api.get('/sale/offers', params);
    if (!Array.isArray(listed?.offers) || listed.offers.length > size) throw new Error('ALLEGRO_INVALID_OFFER_LIST');
    ids = [...new Set(listed.offers.map(o => offerId(o.id)))];
  }
  const products = [];
  const invalid = [];
  for (const id of ids) {
    // Network/auth failures abort the batch. Never turn a failed refresh into an empty snapshot.
    const offer = await api.get(`/sale/product-offers/${id}`);
    try { products.push(normalizeOffer(offer, id)); }
    catch (error) { invalid.push({ supplier_product_id: id, errors: [error.message] }); }
  }
  const checked = partitionValid(products);
  return { products: checked.valid, invalid: [...invalid, ...checked.invalid], total: ids.length };
}

function inactiveReason() {
  try { client.configuration(process.env); return null; } catch (error) { return error.message; }
}
module.exports = { fetchProducts, normalizeOffer, offerId,
  get IS_ACTIVE() { return inactiveReason() === null; },
  get INACTIVE_REASON() { return inactiveReason(); },
};
