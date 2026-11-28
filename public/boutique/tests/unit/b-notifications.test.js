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

test('une réponse On Demand ouvre le dossier et non le suivi de commande', async () => {
  mockApiGet.mockResolvedValue({ notifications: [{ id: 'n1', title: 'Réponse', message: 'Conseiller', action_target: 'client_requests', order_reference: 'REQ-1' }] });
  setupClientNotifications();
  window.dispatchEvent(new CustomEvent('komerce:identity-authenticated'));
  await Promise.resolve(); await Promise.resolve();
  const view = document.querySelector('.k-client-notification__view');
  expect(view.textContent).toBe('Voir ma demande');
  view.click();
  expect(mockBus.emit).toHaveBeenCalledWith('on-demand:open', { reference: 'REQ-1' });
  expect(mockBus.emit).not.toHaveBeenCalledWith('nav:goto-track', expect.anything());
  window.dispatchEvent(new Event('komerce:identity-cleared'));
});
