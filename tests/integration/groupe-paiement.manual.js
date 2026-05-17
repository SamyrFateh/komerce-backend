#!/usr/bin/env node
/**
 * Manual smoke script for the shared cart group-payment flow.
 *
 * Run from repository root:
 *   node tests/integration/groupe-paiement.manual.js
 *
 * Optional:
 *   BASE_URL=http://localhost:3000 node tests/integration/groupe-paiement.manual.js
 *
 * This file is intentionally manual and is not part of Jest.
 */

'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_PRODUCTS = [];

async function request(method, path, body, cookie) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable. Use Node.js 18 or newer.');
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = response.headers.get('set-cookie');
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, setCookie };
}

function assertStep(label, condition, detail) {
  if (condition) {
    console.log(`OK  ${label}`);
    return;
  }

  console.error(`FAIL ${label}`, detail || '');
  process.exitCode = 1;
}

async function loadProducts() {
  const { status, data } = await request('GET', '/api/products?limit=2');
  assertStep('products endpoint responds', status === 200, `status=${status}`);

  if (Array.isArray(data.products) && data.products.length > 0) {
    data.products.slice(0, 2).forEach((product) => {
      TEST_PRODUCTS.push({ product_id: product.id, quantity: 1 });
    });
  } else {
    TEST_PRODUCTS.push({ product_id: 1, quantity: 1 });
  }
}

async function createSharedCart() {
  const { status, data, setCookie } = await request('POST', '/api/shared-carts/from-cart-items', {
    cart_items: TEST_PRODUCTS,
    title: 'Manual shared cart smoke test',
    tracking_phone: '+2693211234',
    recipient_phone: '+2693211234',
  });

  assertStep('create shared cart returns 200/201', [200, 201].includes(status), `status=${status}`);
  assertStep('shared cart token exists', Boolean(data.token), data.error);
  assertStep('shared cart id exists', Boolean(data.shared_cart_id), data.error);

  return { token: data.token, id: data.shared_cart_id, cookie: setCookie };
}

async function readPublicCart(token) {
  const { status, data } = await request('GET', `/api/shared-carts/public/${token}`);
  assertStep('public shared cart returns 200', status === 200, `status=${status}`);
  assertStep('public shared cart payload exists', Boolean(data.cart), data.error);
}

async function checkContributionValidation(token) {
  const { status } = await request('POST', `/api/shared-carts/public/${token}/contributions`, {
    amount_kmf: 100,
    contributor_name: 'Manual Test',
  });

  assertStep('invalid contribution is rejected', status === 400, `status=${status}`);
}

async function tryFinalize(id, cookie) {
  const { status } = await request('POST', `/api/shared-carts/${id}/finalize`, {}, cookie);
  assertStep('finalize is guarded', [400, 401, 403].includes(status), `status=${status}`);
}

(async () => {
  console.log(`BASE_URL=${BASE_URL}`);

  try {
    await loadProducts();
    const { token, id, cookie } = await createSharedCart();
    await readPublicCart(token);
    await checkContributionValidation(token);
    await tryFinalize(id, cookie);
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exitCode = 1;
  }

  if (process.exitCode) {
    console.error('Manual smoke script failed');
  } else {
    console.log('Manual smoke script passed');
  }
})();
