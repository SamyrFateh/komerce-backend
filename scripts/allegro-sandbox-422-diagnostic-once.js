'use strict';
const { createClient } = require('../services/suppliers/allegro-sandbox-client');

function bounded(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500)
    : null;
}

const fetchImpl = async (...args) => {
  const response = await fetch(...args);
  if (response.status === 422) {
    try {
      const payload = await response.clone().json();
      const errors = (Array.isArray(payload?.errors) ? payload.errors : []).slice(0, 20).map(error => ({
        code: bounded(error?.code),
        path: bounded(error?.path),
        message: bounded(error?.message),
        userMessage: bounded(error?.userMessage),
        metadata: error?.metadata && typeof error.metadata === 'object' ? error.metadata : null,
      }));
      console.error(JSON.stringify({ allegro_422: errors }));
    } catch {
      console.error(JSON.stringify({ allegro_422: 'UNREADABLE' }));
    }
  }
  return response;
};

createClient({ fetchImpl }).activateOffer('7782182471')
  .then(result => console.log(JSON.stringify({ status: 'OK', offer_id: result.offer_id })))
  .catch(error => {
    console.error(String(error?.message || 'ALLEGRO_DIAG_FAILED'));
    process.exitCode = 1;
  });
