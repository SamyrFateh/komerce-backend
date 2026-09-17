'use strict';
const { createClient } = require('../services/suppliers/allegro-sandbox-client');

const fetchImpl = async (...args) => {
  const response = await fetch(...args);
  try {
    const url = String(args[0] || '');
    if (response.ok && url.includes('/sale/shipping-rates')) {
      const payload = await response.clone().json();
      const rows = (Array.isArray(payload?.shippingRates) ? payload.shippingRates : []).slice(0, 30);
      console.log(JSON.stringify({ shippingRates: rows }));
    }
  } catch {
    console.error('ALLEGRO_SHIPPING_RATES_DIAG_UNREADABLE');
  }
  return response;
};

createClient({ fetchImpl }).getSellerSettings()
  .then(settings => console.log(JSON.stringify({ status: 'OK', projected: settings.shipping_rates })))
  .catch(error => {
    console.error(String(error?.message || 'ALLEGRO_DIAG_FAILED'));
    process.exitCode = 1;
  });
