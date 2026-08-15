/**
 * @komerce-arch
 * @role          komerce-nav-authenticated-identity
 * @domain        account
 * @layer         ui-component
 * @criticality   medium
 * @inputs        authenticated_user, komerce:identity-authenticated
 * @outputs       personalized_komerce_navigation_entry
 * @depends       b-identity.js
 * @used-by       main.js
 * @doctrine      authenticated_session_only, no_gender_inference
 * @impact-areas  account-navigation, mobile-bnav, desktop-header
 * @version       2026-08
 */
'use strict';

import { getCurrentIdentity, restoreIdentity } from './b-identity.js';

const AUTHENTICATED_EVENT = 'komerce:identity-authenticated';
const CLEARED_EVENT = 'komerce:identity-cleared';
const NAV_SELECTOR = '#k-bnav-komerce-btn, #k-header-komerce-btn';

let installed = false;

function firstName(user) {
  return String(user?.full_name || user?.name || '')
    .trim()
    .split(/\s+/)[0] || '';
}

export function renderKomerceNavIdentity(user) {
  const name = firstName(user);

  document.querySelectorAll(NAV_SELECTOR).forEach((button) => {
    const label = button.querySelector('.k-komerce-nav-label');
    const fallback = label?.dataset.defaultLabel || 'Mon Komerce';

    button.classList.toggle('is-authenticated', Boolean(name));
    button.setAttribute('aria-label', name ? `Mon Komerce — ${name}` : 'Mon Komerce');
    button.removeAttribute('title');

    if (label) {
      label.textContent = name || fallback;
      if (name) button.title = name;
    }
  });
}

async function refreshFromAuthenticatedEvent(event) {
  const detailUser = event?.detail?.user || event?.detail || null;
  const user = detailUser?.full_name || detailUser?.name
    ? detailUser
    : getCurrentIdentity() || await restoreIdentity();
  renderKomerceNavIdentity(user);
}

export function setupKomerceNavIdentity() {
  renderKomerceNavIdentity(getCurrentIdentity());
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener(AUTHENTICATED_EVENT, refreshFromAuthenticatedEvent);
  window.addEventListener(CLEARED_EVENT, () => renderKomerceNavIdentity(null));
}
