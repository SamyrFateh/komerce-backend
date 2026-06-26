/**
 * @komerce-arch-lite
 * @role          unsold-stats-api-patch
 * @domain        admin-dashboard
 * @layer         api-client
 * @owner         dashboards/admin/js/api-client.js
 * @purpose       patches KmcApi post-load avec getUnsoldStats() → GET /api/unsold/stats/summary
 * @impact-areas  control-tower, admin-dashboard
 * @version       2026-06
 */
(function (global) {
  'use strict';

  if (!global.KmcApi) {
    throw new Error('KmcApi doit être chargé avant api-client-unsold.js');
  }

  global.KmcApi.getUnsoldStats = async function getUnsoldStats() {
    const res = await fetch('/api/unsold/stats/summary', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const ApiError = global.KmcApi.ApiError || Error;
      throw new ApiError(`${res.status} ${res.statusText}`, res.status, body);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : {};
  };
})(window);
