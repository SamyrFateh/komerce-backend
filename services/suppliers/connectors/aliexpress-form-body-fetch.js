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
