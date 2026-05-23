import './b-utils.js';
import { bus } from './b-bus.js';
import './b-store.js';
import './boutique.js';
import { setupDesktopUpgrade } from './b-desktop-upgrade.js';
import { isDesktop } from './b-scroll-owner.js';
import { setupProductOpenContract } from './b-product-open-contract.js';
import { setupCartProductOpenStyle } from './b-cart-product-open-style.js';
import { setupModalContractClasses } from './b-modal-desktop-enhancers.js';
import { setupApprocheCHybridPdp } from './b-modal-approche-c-hybrid.js';
import { setupPdpCurationSuggestions } from './b-pdp-curation-suggestions.js';
import { setupHomePremiumV1 } from './b-home-premium-v1.js';

function setupBoutiqueRuntime() {
  setupModalContractClasses();
  setupDesktopUpgrade();
  setupApprocheCHybridPdp();
  setupPdpCurationSuggestions();
  setupHomePremiumV1();
  setupProductOpenContract();
  setupCartProductOpenStyle();
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
      }
    }, 150);
  }, { passive: true });
}
