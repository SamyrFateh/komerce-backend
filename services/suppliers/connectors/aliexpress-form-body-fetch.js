/**
 * @komerce-arch
 * @role          aliexpress-form-body-transport
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        signed AliExpress TOP URL + fetch implementation
 * @outputs       application/x-www-form-urlencoded POST request
 * @depends       none
 * @used-by       services/suppliers/aliexpress-fulfillment-adapter.js, scripts/aliexpress-prepayment-proof.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

function formBodyFetch(fetchImpl = fetch) {
  return async (rawUrl, init = {}) => {
    const url = new URL(rawUrl);
    const body = url.searchParams.toString();
    url.search = '';
    return fetchImpl(url.toString(), {
      ...init,
      headers: {
        ...(init.headers || {}),
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
    });
  };
}

module.exports = { formBodyFetch };
