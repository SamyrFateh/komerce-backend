'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  NETWORK_MAX_ATTEMPTS,
  retryableNetworkResult,
  verifyMediaUrlWithRetry,
} = require('../../scripts/showcase-media-audit');

describe('showcase-media-audit network propagation', () => {
  test('retry les états compatibles avec une propagation CDN mais pas les 4xx permanents', () => {
    expect(NETWORK_MAX_ATTEMPTS).toBe(5);
    expect(retryableNetworkResult({ ok: false, status: 404 })).toBe(true);
    expect(retryableNetworkResult({ ok: false, status: 429 })).toBe(true);
    expect(retryableNetworkResult({ ok: false, status: 503 })).toBe(true);
    expect(retryableNetworkResult({ ok: false, reason: 'timeout' })).toBe(true);
    expect(retryableNetworkResult({ ok: false, status: 400 })).toBe(false);
    expect(retryableNetworkResult({ ok: false, status: 403 })).toBe(false);
    expect(retryableNetworkResult({ ok: true, status: 200 })).toBe(false);
  });

  test('un 404 ImageKit qui se propage devient vert sans relâcher le gate', async () => {
    const verifier = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, type: 'text/plain' })
      .mockResolvedValueOnce({ ok: false, status: 404, type: 'text/plain' })
      .mockResolvedValueOnce({ ok: true, status: 200, type: 'image/jpeg', bytes: 1024 });
    const sleepImpl = jest.fn(async () => {});

    const result = await verifyMediaUrlWithRetry('https://ik.imagekit.io/demo/hero.jpg', {
      verifier,
      sleepImpl,
      maxAttempts: 5,
      delays: [1, 2, 3, 4],
    });

    expect(result).toMatchObject({ ok: true, status: 200, attempts: 3 });
    expect(verifier).toHaveBeenCalledTimes(3);
    expect(sleepImpl.mock.calls).toEqual([[1], [2]]);
  });

  test('un 404 persistant reste rouge après la fenêtre de propagation', async () => {
    const verifier = jest.fn().mockResolvedValue({ ok: false, status: 404, type: 'text/plain' });
    const sleepImpl = jest.fn(async () => {});

    const result = await verifyMediaUrlWithRetry('https://ik.imagekit.io/demo/missing.jpg', {
      verifier,
      sleepImpl,
      maxAttempts: 3,
      delays: [1, 2],
    });

    expect(result).toMatchObject({ ok: false, status: 404, attempts: 3 });
    expect(verifier).toHaveBeenCalledTimes(3);
    expect(sleepImpl.mock.calls).toEqual([[1], [2]]);
  });

  test('une erreur permanente 403 échoue immédiatement', async () => {
    const verifier = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    const sleepImpl = jest.fn(async () => {});

    const result = await verifyMediaUrlWithRetry('https://ik.imagekit.io/demo/private.jpg', {
      verifier,
      sleepImpl,
      maxAttempts: 5,
    });

    expect(result).toMatchObject({ ok: false, status: 403, attempts: 1 });
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});
