/**
 * @komerce-arch
 * @role          aliexpress-source-discovery
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        AliExpress DS feed names, categories, feed probes
 * @outputs       bounded acquisition plan + discovery evidence
 * @depends       none
 * @used-by       services/suppliers/connectors/aliexpress-connected-connector.js, scripts/aliexpress-feed-surface-proof.js, scripts/aliexpress-feed-topup-runtime.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      discovery_precedes_import, provider_plan_is_evidence_not_capability_flag
 * @impact-areas  sourcing, supplier-import
 * @version       2026-09-v1
 */
'use strict';

const DEFAULT_COUNTRY_CODE = 'AE';
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PROBES = 24;

class AliExpressDiscoveryError extends Error {
  constructor(message, code = 'ALIEXPRESS_DISCOVERY_FAILED', details = null) {
    super(message);
    this.name = 'AliExpressDiscoveryError';
    this.code = code;
    this.details = details;
  }
}

const asArray = (value) => Array.isArray(value) ? value : (value == null ? [] : [value]);

function unwrap(payload = {}) {
  return payload?.resp_result?.result
    || payload?.result?.result
    || payload?.result
    || payload?.resp_result
    || payload
    || {};
}

function feedNames(payload) {
  const result = unwrap(payload);
  return asArray(result?.promos?.promo || result?.promos || result?.promo)
    .map((item) => String(item?.promo_name || item?.feed_name || '').trim())
    .filter(Boolean);
}

function categories(payload) {
  const result = unwrap(payload);
  return asArray(result?.categories?.category || result?.categories || result?.category)
    .map((item) => ({
      id: String(item?.category_id || '').trim(),
      name: String(item?.category_name || '').trim(),
    }))
    .filter((item) => /^\d+$/.test(item.id));
}

function productIds(payload) {
  const out = new Set();
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 10) return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    const id = String(value.product_id || value.itemId || '').trim();
    if (/^\d{5,20}$/.test(id)) out.add(id);
    Object.values(value).forEach((item) => walk(item, depth + 1));
  }
  walk(payload);
  return [...out];
}

function planSlots(feeds, categoryRows) {
  const fs = asArray(feeds).filter(Boolean).slice(0, 80);
  const cs = asArray(categoryRows).slice(0, 48);
  const out = [];
  for (let page = 1; page <= 2; page++) {
    for (const feed of fs) out.push({ feed, page, categoryId: null, categoryName: null });
  }
  for (const category of cs) {
    for (const feed of fs.slice(0, 3)) {
      out.push({
        feed,
        page: 1,
        categoryId: category.id,
        categoryName: category.name || null,
      });
    }
  }
  return out;
}

function isEmptyResultError(error) {
  return /\bresult\s+is\s+empty\b|\bempty\s+result\b/i.test(String(error?.message || error || ''));
}

async function discoverAcquisitionPlan({
  invokeTop,
  countryCode = DEFAULT_COUNTRY_CODE,
  pageSize = DEFAULT_PAGE_SIZE,
  maxProbes = DEFAULT_MAX_PROBES,
} = {}) {
  if (typeof invokeTop !== 'function') {
    throw new AliExpressDiscoveryError('AliExpress Discovery sans invokeTop', 'ALIEXPRESS_DISCOVERY_ADAPTER_MISSING');
  }

  const country = String(countryCode || DEFAULT_COUNTRY_CODE).trim().toUpperCase();
  const size = Math.max(1, Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, 50));
  const probesLimit = Math.max(1, Math.min(Number(maxProbes) || DEFAULT_MAX_PROBES, 100));

  const feedPayload = await invokeTop('aliexpress.ds.feedname.get', {});
  const categoryPayload = await invokeTop('aliexpress.ds.category.get', {});
  const feeds = feedNames(feedPayload);
  const categoryRows = categories(categoryPayload);
  const slots = planSlots(feeds, categoryRows);

  if (!slots.length) {
    throw new AliExpressDiscoveryError(
      'Discovery AliExpress: aucune surface feed/catégorie disponible',
      'ALIEXPRESS_DISCOVERY_NO_SURFACE',
      { feeds: feeds.length, categories: categoryRows.length }
    );
  }

  const firstPageFeeds = slots.filter((slot) => !slot.categoryId && slot.page === 1);
  const categorySlots = slots.filter((slot) => Boolean(slot.categoryId));
  const laterFeedPages = slots.filter((slot) => !slot.categoryId && slot.page > 1);
  const primaryBudget = Math.max(1, Math.ceil(probesLimit / 2));
  const probeSlots = [
    ...firstPageFeeds.slice(0, primaryBudget),
    ...categorySlots.slice(0, Math.max(0, probesLimit - primaryBudget)),
    ...laterFeedPages,
  ].slice(0, probesLimit);

  let probes = 0;
  for (const slot of probeSlots) {
    let payload;
    try {
      // eslint-disable-next-line no-await-in-loop
      payload = await invokeTop('aliexpress.ds.recommend.feed.get', {
        country,
        target_currency: 'USD',
        target_language: 'EN',
        page_size: size,
        page_no: slot.page,
        category_id: slot.categoryId,
        sort: 'volumeDesc',
        feed_name: slot.feed,
      });
    } catch (error) {
      if (isEmptyResultError(error)) {
        probes += 1;
        continue;
      }
      throw error;
    }
    probes += 1;
    const ids = productIds(payload);
    if (!ids.length) continue;

    return {
      status: 'READY',
      provider: 'aliexpress',
      strategy: 'feed-category',
      version: 'aliexpress-ds-discovery-v1',
      pull_options: {
        product_ids: ids.slice(0, size),
        page: slot.page,
        size,
        country_code: country,
        sort: 'volumeDesc',
        feed_name: slot.feed,
        ...(slot.categoryId ? { category_id: slot.categoryId } : {}),
      },
      evidence: {
        feeds_discovered: feeds.length,
        categories_discovered: categoryRows.length,
        probes,
        selected_feed: slot.feed,
        selected_category_id: slot.categoryId || null,
        selected_category_name: slot.categoryName || null,
        probe_product_count: ids.length,
        sample_product_ids: ids.slice(0, 5),
      },
    };
  }

  throw new AliExpressDiscoveryError(
    'Discovery AliExpress: aucune surface testée ne retourne de produit',
    'ALIEXPRESS_DISCOVERY_EMPTY',
    {
      feeds: feeds.length,
      categories: categoryRows.length,
      probes,
    }
  );
}

module.exports = {
  DEFAULT_COUNTRY_CODE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_PROBES,
  AliExpressDiscoveryError,
  unwrap,
  feedNames,
  categories,
  productIds,
  planSlots,
  isEmptyResultError,
  discoverAcquisitionPlan,
};
