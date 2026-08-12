/**
 * @komerce-arch-lite
 * @role          recommendations-b-pdp-curation-suggestions
 * @domain        recommendations
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-suggestions.js
 * @purpose       supports public/boutique/js/b-modal-suggestions.js
 * @impact-areas  recommendations
 * @version       2026-06
 */
'use strict';

/**
 * @module b-pdp-curation-suggestions
 * @brief Curation éditoriale des suggestions sous PDP desktop.
 *
 * Objectif : transformer le bloc générique "Vous aimerez aussi" en deux
 * niveaux honnêtes : Dans le même univers → Sélection Komerce.
 *
 * Module additif : il ne reconstruit pas les cartes produit et conserve donc
 * les handlers existants de b-modal.js. Il renomme et réordonne uniquement les
 * sections déjà rendues. Une suggestion inter-catégorie reste une découverte :
 * elle n'est jamais rebaptisée "assortie", "utile" ou "compatible" sans
 * relation explicite fournie par le moteur de recommandation.
 */

import { bus } from './b-bus.js';
import { state } from './b-store.js';
import { isDesktop } from './b-scroll-owner.js';

'use strict';

let _installed = false;
let _styleInjected = false;

// function injectStyles() supprimée (L3-S9) — CSS géré par modal-product.css
function injectStyles() {}

function setSectionTitle(section, iconText, titleText, subtitleText) {
  if (!section) return;
  const title = section.querySelector('.k-sug-title');
  if (!title) return;

  const icon = title.querySelector('.k-sug-title-icon');
  if (icon) icon.textContent = iconText;

  const text = title.querySelector('.k-sug-title-text');
  if (text) text.textContent = titleText;

  let subtitle = title.querySelector('.k-pdp-curation-subtitle');
  if (!subtitle) {
    subtitle = document.createElement('div');
    subtitle.className = 'k-pdp-curation-subtitle';
    title.appendChild(subtitle);
  }
  subtitle.textContent = subtitleText;
}

function enhanceCuration() {
  if (!isDesktop()) return;

  const suggestions = document.getElementById('k-modal-suggestions');
  const rail = document.getElementById('k-sug-rail');
  if (!suggestions || !rail || suggestions.classList.contains('u-hidden')) return;

  const sections = Array.from(rail.querySelectorAll(':scope > .k-sug-section'));
  if (!sections.length) return;

  const alreadyEnhancedFor = suggestions.dataset.curationProductId;
  const productId = state.modalProduct ? String(state.modalProduct.id) : '';
  if (alreadyEnhancedFor === productId) return;
  suggestions.dataset.curationProductId = productId;

  suggestions.classList.add('k-pdp-curation');

  const sameSection = sections.find(function(section) {
    return Boolean(section.querySelector('.k-sug-grid--same'));
  });
  const otherSection = sections.find(function(section) {
    return Boolean(section.querySelector('.k-sug-grid--other'));
  });

  if (sameSection) {
    sameSection.classList.add('k-pdp-curation-section--same');
    const cat = state.modalProduct && state.modalProduct.category ? state.modalProduct.category : 'ce produit';
    setSectionTitle(
      sameSection,
      '🌊',
      'Dans le même univers',
      'Des alternatives proches dans ' + cat + ', pour comparer sans perdre le fil.'
    );
  }

  if (otherSection) {
    otherSection.classList.add('k-pdp-curation-section--editorial');
    const discoveries = otherSection.querySelectorAll('.k-sug-card').length;
    if (discoveries > 0) {
      setSectionTitle(
        otherSection,
        '✨',
        'Sélection Komerce',
        'Quelques découvertes populaires pour continuer l’exploration.'
      );
    } else {
      otherSection.classList.add('u-hidden');
    }
  }
}

function scheduleEnhanceCuration() {
  if (!isDesktop()) return;
  requestAnimationFrame(function() {
    requestAnimationFrame(enhanceCuration);
  });
}

export function setupPdpCurationSuggestions() {
  if (_installed) return;
  _installed = true;
  injectStyles();

  bus.on('modal:opened', scheduleEnhanceCuration);
  bus.on('modal:suggestions-rendered', scheduleEnhanceCuration);
}
