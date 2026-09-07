/**
 * @komerce-arch
 * @role          cj-catalog-category-index
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        CJ access token
 * @outputs       CJ third-level category list
 * @depends       services/suppliers/connectors/cj-connector.js
 * @used-by       scripts/cj-full-catalog-sync.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, supplier-import
 * @version       2026-09-v1
 */
'use strict';

const cjConnector = require('./connectors/cj-connector');

const CATEGORY_PATH = '/product/getCategory';

function flattenCategories(data = []) {
  const out = [];
  for (const first of Array.isArray(data) ? data : []) {
    const level1 = String(first?.categoryFirstName || '').trim() || null;
    for (const second of Array.isArray(first?.categoryFirstList) ? first.categoryFirstList : []) {
      const level2 = String(second?.categorySecondName || '').trim() || null;
      for (const third of Array.isArray(second?.categorySecondList) ? second.categorySecondList : []) {
        const categoryId = String(third?.categoryId || '').trim();
        const level3 = String(third?.categoryName || '').trim() || null;
        if (!categoryId) continue;
        out.push({
          category_id: categoryId,
          level1,
          level2,
          level3,
          path: [level1, level2, level3].filter(Boolean).join(' > ') || categoryId,
        });
      }
    }
  }
  return out;
}

async function fetchCategories({ fetchImpl = fetch, env = process.env } = {}) {
  const token = await cjConnector.getAccessToken({ fetchImpl, env });
  const response = await fetchImpl(`${cjConnector.BASE_URL}${CATEGORY_PATH}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'CJ-Access-Token': token,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.result === false || body.success === false) {
    const requestId = body.requestId ? ` requestId=${body.requestId}` : '';
    throw new Error(`[CJdropshipping] catégories échouées (${response.status}): ${body.message || 'erreur inconnue'}${requestId}`);
  }
  const categories = flattenCategories(body.data);
  if (!categories.length) throw new Error('[CJdropshipping] aucune catégorie feuille retournée');
  return {
    categories,
    total: categories.length,
    request_id: body.requestId || null,
    points_info: body.pointsInfo || null,
  };
}

module.exports = {
  CATEGORY_PATH,
  flattenCategories,
  fetchCategories,
};
