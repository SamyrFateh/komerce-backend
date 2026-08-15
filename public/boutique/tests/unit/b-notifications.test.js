'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const mockEmit = jest.fn();
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
jest.mock('../../js/b-bus.js', () => ({ bus: { emit: mockEmit } }));
jest.mock('../../js/b-utils.js', () => ({ apiGet: mockApiGet, apiPost: mockApiPost }));
const { setupClientNotifications, refreshClientNotifications } = require('../../js/b-notifications.js');
const { flush } = require('./helpers/boutiqueTestKit');

beforeEach(() => {
  document.body.innerHTML = '<header id="k-header"></header><div id="k-header-spacer"></div>';
  jest.clearAllMocks();
});

test('affiche uniquement l\'information utile et ouvre Commandes', async () => {
  mockApiGet.mockResolvedValueOnce({ notifications: [{
    id: 'notif-1', severity: 'urgent', title: 'Votre colis est disponible',
    message: 'Commande K7A78R6 à retirer au relais Moroni.', order_reference: 'K7A78R6',
  }] });
  setupClientNotifications();
  await flush();
  const banner = document.getElementById('k-client-notification');
  expect(banner.textContent).toContain('Votre colis est disponible');
  expect(banner.textContent).not.toMatch(/facture|wallet|whatsapp/i);
  banner.querySelector('.k-client-notification__view').click();
  expect(mockEmit).toHaveBeenCalledWith('nav:goto-track', { orderReference: 'K7A78R6' });
});

test('acquitte explicitement puis masque le bandeau', async () => {
  // Le module est idempotent entre tests ; le refresh post-auth force le flux.
  mockApiGet.mockResolvedValueOnce({ notifications: [{
    id: 'notif-2', severity: 'urgent', title: 'Colis disponible', message: 'Retrait au relais.',
  }] });
  window.dispatchEvent(new CustomEvent('komerce:identity-authenticated'));
  await flush();
  mockApiPost.mockResolvedValueOnce({ notification: { id: 'notif-2', status: 'acknowledged' } });
  document.querySelector('.k-client-notification__ack').click();
  await flush();
  expect(mockApiPost).toHaveBeenCalledWith('/api/auth/me/notifications/notif-2/ack', null, { retries: 0 });
  expect(document.getElementById('k-client-notification').classList).toContain('u-hidden');
});

test('reste silencieux sans session et ne relance pas pendant le throttle', async () => {
  mockApiGet.mockRejectedValueOnce({ status: 401 });
  await refreshClientNotifications({ force: true });
  expect(document.getElementById('k-client-notification')).toBeNull();
  mockApiGet.mockClear();
  await refreshClientNotifications();
  expect(mockApiGet).not.toHaveBeenCalled();
});

test('réagit au retour de visibilité sans forcer un nouveau message', () => {
  setupClientNotifications();
  window.dispatchEvent(new Event('focus'));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});

test('conserve le message si l acquittement échoue', async () => {
  mockApiGet.mockResolvedValueOnce({ notifications: [{
    id: 'notif-3', title: 'Colis disponible', message: 'Retrait au relais.',
  }] });
  await refreshClientNotifications({ force: true });
  mockApiPost.mockRejectedValueOnce(new Error('network'));
  const ack = document.querySelector('.k-client-notification__ack');
  ack.click();
  await flush();
  expect(ack.disabled).toBe(false);
  expect(document.getElementById('k-client-notification').classList).not.toContain('u-hidden');
});

test('peut monter le bandeau sans spacer de header', async () => {
  document.body.innerHTML = '';
  mockApiGet.mockResolvedValueOnce({ notifications: [{
    id: 'notif-4', title: 'Colis disponible', message: 'Retrait au relais.',
  }] });
  await refreshClientNotifications({ force: true });
  expect(document.body.firstElementChild.id).toBe('k-client-notification');
});
