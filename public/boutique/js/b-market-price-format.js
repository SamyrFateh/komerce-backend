/**
 * @komerce-arch-lite
 * @role          market-local-price-format
 * @domain        checkout
 * @layer         ui-helper
 * @owner         public/boutique/js/b-utils.js
 * @purpose       Display exact LOCAL_ACTIVE market prices without converting through rounded KMF
 * @impact-areas  boutique, catalog, cart, checkout, market
 * @version       2026-11
 */
'use strict';

import { fmt } from './b-utils.js';

/**
 * Amount already denominated in the server-authorized market currency.
 * Do NOT pass it through _projectKmf(): LOCAL_ACTIVE XAF -> rounded KMF
 * -> XAF is lossy (6654 XAF becomes 6655 XAF).
 */
export function fmtMarketAmount(amount, currency, minorUnit = null) {
  const value = Number(amount);
  const code = String(currency || '').toUpperCase();
  if (!Number.isFinite(value) || !/^[A-Z]{3}$/.test(code)) return 'Prix à confirmer';
  const digits = minorUnit == null
    ? (code === 'EUR' || code === 'USD' ? 2 : 0)
    : Number(minorUnit);
  if (!Number.isInteger(digits) || digits < 0 || digits > 3) return 'Prix à confirmer';
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value) + ' ' + (code === 'EUR' ? '€' : code);
}

/** Product-level LOCAL_ACTIVE decision: market amount is authority for display. */
export function fmtLocalProductPrice(product, qty = 1) {
  if (product?.market_price_source === 'LOCAL_ACTIVE' &&
      product.market_price_effective_amount != null &&
      Number.isFinite(Number(product.market_price_effective_amount)) &&
      product.market_price_currency) {
    return fmtMarketAmount(
      Number(product.market_price_effective_amount) * Number(qty || 1),
      product.market_price_currency
    );
  }
  return fmt((Number(product?.price_kmf ?? product?.price ?? 0) || 0) * Number(qty || 1), 'KMF');
}

/** Entire personal cart: display exact local totals only when all items agree. */
export function fmtLocalLinesTotal(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const currency = list[0]?.product?.market_price_currency;
  const allLocal = list.length > 0 && currency && list.every(line =>
    line?.product?.market_price_source === 'LOCAL_ACTIVE' &&
    line.product.market_price_effective_amount != null &&
    Number.isFinite(Number(line.product.market_price_effective_amount)) &&
    line.product.market_price_currency === currency
  );
  if (allLocal) {
    const total = list.reduce((sum, line) =>
      sum + Number(line.product.market_price_effective_amount) *
        Number(line.qty ?? line.quantity ?? 1), 0);
    return fmtMarketAmount(total, currency);
  }
  return fmt(list.reduce((sum, line) =>
    sum + Number(line?.price ?? line?.product?.price_kmf ?? line?.product?.price ?? 0) *
      Number(line?.qty ?? line?.quantity ?? 1), 0), 'KMF');
}

