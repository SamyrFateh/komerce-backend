/**
 * @komerce-arch-lite
 * @role          boutique-main
 * @domain        boutique
 * @layer         ui-component
 * @owner         public/boutique/js/boutique.js
 * @purpose       supports public/boutique/js/boutique.js
 * @impact-areas  boutique
 * @version       2026-06
 */

import './b-utils.js';
import { bus } from './b-bus.js';
import './b-store.js';
import './boutique.js';
import { setupSharePhoneGuard } from './b-share-phone-guard.js';
import { setupDesktopUpgrade } from './b-desktop-upgrade.js';
import { isDesktop } from './b-scroll-owner.js';
import { setupProductOpenContract } from './b-product-open-contract.js';
import { setupCartProductOpenStyle } from './b-cart-product-open-style.js';
import { setupModalContractClasses } from './b-modal-desktop-enhancers.js';
import { setupApprocheCHybridPdp } from './b-modal-approche-c-hybrid.js';
import { setupPdpCurationSuggestions } from './b-pdp-curation-suggestions.js';
import { setupHomePremiumV1 } from './b-home-premium-v1.js';
// FIX GREETING — b-greeting importé mais jamais appelé dans setupBoutiqueRuntime
import { greetIfKnown } from './b-greeting.js';

function applyHeroMoonSlogan() {
  const headline = 'La lune,';
  const promise = 'vous pouvez l\u2019attraper.';

  const searchSlogan = document.querySelector('.k-search-slogan');
  if (searchSlogan) {
    searchSlogan.innerHTML = headline + ' <strong>' + promise + '</strong>';
  }

  const heroLine1 = document.querySelector('.k-hero-mini-slogan--premium .k-line-1');
  const heroLine2 = document.querySelector('.k-hero-mini-slogan--premium .k-line-2');
  if (heroLine1) heroLine1.textContent = headline;
  if (heroLine2) heroLine2.textContent = promise;

  const stickyTitleTop = document.querySelector('.k-hero-title-top');
  const stickyTitleBottom = document.querySelector('.k-hero-title-bottom');
  if (stickyTitleTop) stickyTitleTop.textContent = headline;
  if (stickyTitleBottom) stickyTitleBottom.textContent = promise;
}

function setupBoutiqueRuntime() {
  setupSharePhoneGuard();
  setupModalContractClasses();
  setupDesktopUpgrade();
  setupApprocheCHybridPdp();
  setupPdpCurationSuggestions();
  setupHomePremiumV1();
  setupProductOpenContract();
  setupCartProductOpenStyle();
  applyHeroMoonSlogan();
  // FIX GREETING — appelé après le boot, best-effort (silencieux si non connecté)
  greetIfKnown();
}

if (typeof window !== 'undefined') {
  window._kbus = bus;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupBoutiqueRuntime);
  } else {
    setupBoutiqueRuntime();
  }

  var _desktopUpgradeDone = isDesktop();
  var _resizeTimer = null;
  window.addEventListener('resize', function() {
    if (_desktopUpgradeDone) return;
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function() {
      if (isDesktop() && !_desktopUpgradeDone) {
        _desktopUpgradeDone = true;
        setupDesktopUpgrade();
        setupApprocheCHybridPdp();
        setupPdpCurationSuggestions();
        setupHomePremiumV1();
        applyHeroMoonSlogan();
      }
    }, 150);
  }, { passive: true });
}
