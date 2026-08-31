/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockBus = { emit: jest.fn() };

jest.mock('../../js/b-utils.js', () => ({
  apiGet: (...args) => mockApiGet(...args),
  apiPost: (...args) => mockApiPost(...args),
}));
jest.mock('../../js/b-bus.js', () => ({ bus: mockBus }));

const { setupClientNotifications } = require('../../js/b-notifications.js');

describe('client notifications identity gate', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    mockApiGet.mockResolvedValue({ notifications: [] });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('anonymous boot/focus stay silent; authenticated signal starts the feed and identity clear stops it again', async () => {
    setupClientNotifications();
    expect(mockApiGet).not.toHaveBeenCalled();

    // Les événements de cycle de vie ne doivent jamais transformer un visiteur
    // anonyme en rafale de 401 sur le feed authentifié.
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mockApiGet).not.toHaveBeenCalled();

    window.dispatchEvent(new CustomEvent('komerce:identity-authenticated', {
      detail: { user: { id: 'u-1' } },
    }));

    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiGet).toHaveBeenCalledWith('/api/auth/me/notifications', { retries: 0 });
    await Promise.resolve();

    window.dispatchEvent(new Event('komerce:identity-cleared'));
    window.dispatchEvent(new Event('focus'));
    expect(mockApiGet).toHaveBeenCalledTimes(1);
  });
});
