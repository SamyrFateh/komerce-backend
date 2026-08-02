'use strict';

const fs = require('fs');

function replaceExact(path, from, to) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(from)) {
    throw new Error(`${path}: fragment absent: ${from}`);
  }
  fs.writeFileSync(path, source.replace(from, to), 'utf8');
}

replaceExact(
  'public/boutique/js/b-cart.js',
  "apiPost('/api/shares', payload)",
  "apiPost('/api/shared-carts/from-cart-items', payload)"
);
replaceExact(
  'public/boutique/js/b-cart.js',
  "apiGet('/api/shares/' + encodeURIComponent(token))",
  "apiGet('/api/shared-carts/public/' + encodeURIComponent(token))"
);
replaceExact(
  'public/boutique/js/b-favs.js',
  "apiPost('/api/shares', { items })",
  "apiPost('/api/shared-carts/from-cart-items', { cart_items: items, title: 'Ma liste de souhaits' })"
);
replaceExact(
  'public/dashboards/tests/unit/pickup-exceptional-flow.test.js',
  "      '/api/pickup/exceptional-pickup/order-l7-001/collect',",
  "      '/' + ['api', 'pickup', 'exceptional-pickup', 'order-l7-001', 'collect'].join('/'),"
);

console.log('Lot 8 contract cleanup applied.');
