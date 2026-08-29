/**
 * @komerce-arch-lite
 * @role          boutique-main
 * @domain        boutique
 * @layer         ui-component
 * @owner         public/boutique/js/boutique.js
 * @purpose       supports public/boutique/js/boutique.js
 * @impact-areas  boutique
 * @version       2026-07
 */
'use strict';

import './b-utils.js';
import { bus } from './b-bus.js';
import './b-store.js';
import './boutique.js';
import { setupSharePhoneGuard } from './b-share-phone-guard.js';
import { setupDesktopUpgrade } from './b-desktop-upgrade.js';
import { setupModalDesktopEnhancers } from './b-modal-desktop-enhancers.js';
import { isDesktop } from './b-scroll-owner.js';
import { setupProductOpenContract } from './b-product-open-contract.js';
import { setupCartProductOpenStyle } from './b-cart-product-open-style.js';
// D-P1 (T-016 pt.2) : Approche-C hybride désactivée sur PDP — plus importée
// ici. Module conservé (dormant) pour un usage hors PDP éventuel.
import { setupPdpCurationSuggestions } from './b-pdp-curation-suggestions.js';
import { setupHomePremiumV1 } from './b-home-premium-v1.js';
import { setupProductDetailModal } from './b-modal-product-detail-bootstrap.js';
import { setupLocalStockBadgeMount } from './local-stock-badge-mount.js';
// FIX GREETING — b-greeting importé mais jamais appelé dans setupBoutiqueRuntime
import { greetIfKnown } from './b-greeting.js';
import { setupClientNotifications } from './b-notifications.js';
import { setupKomerceNavIdentity } from './b-komerce-nav-identity.js';
import { setupPasskeyEnrollment } from './b-passkey-enrollment.js';

function setupBoutiqueRuntime() {
  setupSharePhoneGuard();
  // MDP-3 : abonnement resize installé indépendamment du viewport initial —
  // voir b-modal-desktop-enhancers.js (setupModalDesktopEnhancers est
  // idempotent ; ré-appelé sans effet par setupDesktopUpgrade() ci-dessous).
  setupModalDesktopEnhancers();
  setupDesktopUpgrade();
  setupPdpCurationSuggestions();
  setupHomePremiumV1();
  setupProductDetailModal();
  // Vague 2 D6 — écoute le même cycle de vie que setupProductDetailModal(),
  // jamais un nouveau signal. Badge invisible tant que commercial_exposure
  // reste DISABLED (capability != exposure).
  setupLocalStockBadgeMount();
  setupProductOpenContract();
  setupCartProductOpenStyle();
  setupKomerceNavIdentity();
  setupPasskeyEnrollment();
  // FIX GREETING — appelé après le boot, best-effort (silencieux si non connecté)
  greetIfKnown();
  setupClientNotifications();
}

if (typeof window !== 'undefined') {
  window._kbus = bus;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupBoutiqueRuntime);
  } else {
    setupBoutiqueRuntime();
  }

  let _desktopUpgradeDone = isDesktop();
  let _resizeTimer = null;
  window.addEventListener('resize', function() {
    if (_desktopUpgradeDone) return;
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function() {
      if (isDesktop() && !_desktopUpgradeDone) {
        _desktopUpgradeDone = true;
        setupDesktopUpgrade();
        setupPdpCurationSuggestions();
        setupHomePremiumV1();
      }
    }, 150);
  }, { passive: true });
}
