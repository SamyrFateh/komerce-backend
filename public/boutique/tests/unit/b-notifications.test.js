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

  test('anonymous boot performs no notification request; authenticated signal starts the feed', async () => {
    setupClientNotifications();
    expect(mockApiGet).not.toHaveBeenCalled();

    window.dispatchEvent(new CustomEvent('komerce:identity-authenticated', {
      detail: { user: { id: 'u-1' } },
    }));

    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiGet).toHaveBeenCalledWith('/api/auth/me/notifications', { retries: 0 });
    await Promise.resolve();
  });
});
