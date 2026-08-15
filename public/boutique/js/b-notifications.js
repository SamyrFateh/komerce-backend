/**
 * @komerce-arch
 * @role          client-notification-banner
 * @domain        notification
 * @layer         ui-component
 * @criticality   high
 * @inputs        authenticated notification feed
 * @outputs       compact actionable banner, explicit acknowledgement
 * @depends       b-bus.js, b-utils.js
 * @used-by       main.js
 * @doctrine      DOCTRINE_NOTIFICATIONS_CLIENT_KOMERCE.md
 * @impact-areas  notifications, orders, boutique-shell
 * @version       2026-08
 */

'use strict';

import { bus } from './b-bus.js';
import { apiGet, apiPost } from './b-utils.js';

let installed = false;
let openNotifications = [];
let lastRefreshAt = 0;
const REFRESH_INTERVAL_MS = 60000;

function ensureBanner() {
  let banner = document.getElementById('k-client-notification');
  if (banner) return banner;
  banner = document.createElement('aside');
  banner.id = 'k-client-notification';
  banner.className = 'k-client-notification u-hidden';
  banner.setAttribute('aria-live', 'polite');
  banner.setAttribute('aria-atomic', 'true');
  const spacer = document.getElementById('k-header-spacer');
  if (spacer) spacer.insertAdjacentElement('afterend', banner);
  else document.body.prepend(banner);
  return banner;
}

function hideBanner() {
  const banner = document.getElementById('k-client-notification');
  if (!banner) return;
  banner.classList.add('u-hidden');
  banner.replaceChildren();
}

function renderCurrent() {
  const notification = openNotifications[0];
  if (!notification) {
    hideBanner();
    return;
  }

  const banner = ensureBanner();
  banner.replaceChildren();
  banner.className = `k-client-notification k-client-notification--${notification.severity || 'important'}`;

  const icon = document.createElement('span');
  icon.className = 'k-client-notification__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = notification.event_key?.startsWith('order.exception.')
    ? '⚠️'
    : notification.event_key === 'order.preparation'
      ? '⚙️'
      : notification.event_key === 'order.shipped' ? '🚚' : '📦';

  const copy = document.createElement('div');
  copy.className = 'k-client-notification__copy';
  const title = document.createElement('strong');
  title.textContent = notification.title;
  const message = document.createElement('span');
  message.textContent = notification.message;
  copy.append(title, message);

  const actions = document.createElement('div');
  actions.className = 'k-client-notification__actions';
  const view = document.createElement('button');
  view.type = 'button';
  view.className = 'k-client-notification__view';
  view.textContent = 'Voir la commande';
  view.addEventListener('click', () => {
    bus.emit('nav:goto-track', { orderReference: notification.order_reference });
  });

  const ack = document.createElement('button');
  ack.type = 'button';
  ack.className = 'k-client-notification__ack';
  ack.textContent = 'J’ai compris';
  ack.setAttribute('aria-label', `Acquitter : ${notification.title}`);
  ack.addEventListener('click', async () => {
    ack.disabled = true;
    try {
      await apiPost(`/api/auth/me/notifications/${encodeURIComponent(notification.id)}/ack`, null, { retries: 0 });
      openNotifications = openNotifications.filter(row => row.id !== notification.id);
      renderCurrent();
    } catch (_) {
      ack.disabled = false;
    }
  });
  actions.append(view, ack);
  banner.append(icon, copy, actions);
}

export async function refreshClientNotifications({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastRefreshAt < 30000) return;
  lastRefreshAt = now;
  try {
    const payload = await apiGet('/api/auth/me/notifications', { retries: 0 });
    openNotifications = Array.isArray(payload?.notifications) ? payload.notifications : [];
    renderCurrent();
  } catch (err) {
    // Une session absente/expirée n'ouvre jamais l'OTP : le bandeau reste
    // simplement masqué. Une panne réseau ne doit pas gêner la boutique.
    if (err?.status === 401 || err?.status === 403) hideBanner();
  }
}

function refreshWhenVisible() {
  if (document.visibilityState === 'visible') refreshClientNotifications();
}

export function setupClientNotifications() {
  if (installed) return;
  installed = true;
  ensureBanner();
  refreshClientNotifications({ force: true });
  window.addEventListener('komerce:identity-authenticated', () => refreshClientNotifications({ force: true }));
  window.addEventListener('focus', () => refreshClientNotifications());
  document.addEventListener('visibilitychange', refreshWhenVisible);
  // Polling léger uniquement quand l'application est visible : il remplace le
  // besoin d'un push externe sans produire de nouveau message ni doublon.
  window.setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
}
