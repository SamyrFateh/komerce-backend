'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { formBodyFetch } = require('../../services/suppliers/connectors/aliexpress-form-body-fetch');

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('AliExpress form-body transport', () => {
  test('déplace les paramètres existants de la query vers un body form-urlencoded sans les modifier', async () => {
    const fetchImpl = jest.fn(async () => response({ ok: true }));
    const wrapped = formBodyFetch(fetchImpl);
    const raw = 'https://api-sg.aliexpress.com/sync?method=freight&sign=ABC123&payload=%7B%22country_code%22%3A%22KM%22%7D';

    await wrapped(raw, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetchImpl.mock.calls[0];
    const url = new URL(rawUrl);
    expect(url.origin + url.pathname).toBe('https://api-sg.aliexpress.com/sync');
    expect(url.search).toBe('');
    expect(init.method).toBe('POST');
    expect(init.headers.Accept).toBe('application/json');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=UTF-8');

    const body = new URLSearchParams(init.body);
    expect(body.get('method')).toBe('freight');
    expect(body.get('sign')).toBe('ABC123');
    expect(body.get('payload')).toBe('{"country_code":"KM"}');
  });
});
