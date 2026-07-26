/**
 * @komerce-arch-lite
 * @role          boutique-b-home-premium-v1
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       supports public/boutique/js/b-catalog.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module b-home-premium-v1
 * @brief Couche premium desktop pour la page d'accueil Komerce.
 *
 * Objectif : transformer l'entrÃ©e catalogue en vitrine curatÃ©e sans casser
 * l'architecture existante ni le mobile. Module additif : il enrichit le hero,
 * les catÃ©gories et insÃ¨re des bandes Ã©ditoriales avant la grille produits.
 *
 * Note audit : la classe d'activation est posÃ©e sur <html>, pas sur <body>,
 * pour ne pas crÃ©er d'Ã©tat body permanent que check:body-classes considÃ¨re bloquant.
 */

import { bus } from './b-bus.js';
import { isDesktop } from './b-scroll-owner.js';

'use strict';

let _installed = false;
let _styleInjected = false;
let _blocksInjected = false;

function injectStyles() {
  // Lot 3 â€” Tout le CSS a Ã©tÃ© rapatriÃ© dans les owners :
  //   catÃ©gories (.k-cats, .k-chip, .k-chip-label) â†’ categories.css
  //   hero (.k-hero-*, #k-hero-fixed-wrap)          â†’ hero.css
  //   header / search / catalog                      â†’ layout.css
  //   side-cart + blocs Ã©ditoriaux                   â†’ boutique-desktop.css
  // Le JS ne possÃ¨de plus aucun style. _styleInjected conservÃ© pour compatibilitÃ© appelants.
  _styleInjected = true;
  return;
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// VisibilitÃ© contextuelle de la bande promesse :
// elle n'a de sens que sur l'ACCUEIL (univers Â« Tout Â») et la vue shop.
// DÃ¨s qu'un univers/filtre est actif, elle parasite la navigation produit â†’ masquÃ©e.
let _currentTab = 'shop';
let _currentCat = 'all';

function applyHomeCurationVisibility() {
  const section = document.querySelector('.k-home-curation');
  if (!section) return;
  const onHome = !_currentCat || _currentCat === 'all';
  const visible = _currentTab === 'shop' && onHome;
  section.classList.toggle('u-hidden', !visible);
}

function injectHomeBlocks() {
  if (_blocksInjected || !isDesktop() || typeof document === 'undefined') return;

  const pageScroll = document.getElementById('k-page-scroll');
  const catalogWrap = document.getElementById('k-desktop-catalog-wrap');
  if (!pageScroll || !catalogWrap) return;

  _blocksInjected = true;
  document.documentElement.classList.add('k-home-premium-v1');

  // Bande promesse (slogan Â« Achetez pour vousâ€¦ Â» + chips rÃ©assurance)
  // DÃ‰SACTIVÃ‰E : elle retardait l'arrivÃ©e des produits, sur l'accueil comme en
  // navigation. On conserve la classe k-home-premium-v1 (elle pilote tout le
  // style desktop premium) mais on n'injecte plus la section.
  // â†’ repasser SHOW_CURATION Ã  true pour la rÃ©tablir (visibilitÃ© contextuelle
  //   gÃ©rÃ©e par applyHomeCurationVisibility / les listeners bus ci-dessous).
  const SHOW_CURATION = false;
  if (!SHOW_CURATION) return;

  // Bloc allÃ©gÃ© : une ligne sobre (citation Brand Truth Â§VÃ©ritÃ© de marque)
  // + chips de promesse en pilule, centrÃ©s. Aucun titre serif, aucun
  // bloc Ã©ditorial lourd â€” la doctrine BRAND_TRUTH Â§RÃ¨gle de simplicitÃ©
  // linguistique impose visuel > texte, court > exhaustif.
  const section = makeEl('section', 'k-home-curation');
  section.setAttribute('aria-label', 'Promesse Komerce');

  const inner = makeEl('div', 'k-home-curation-inner');

  const baseline = makeEl('p', 'k-home-baseline', 'Achetez pour vous, pour eux, ou ensemble.');

  const chips = makeEl('div', 'k-home-promise-list');
  [
    'Retrait relais',
    'Paiement sÃ©curisÃ©',
    'Suivi en 9 Ã©tapes',
    'Panier partagÃ©',
    'Prix en KMF',
    'Livraison incluse aux Comores',
  ].forEach(function(label) {
    chips.appendChild(makeEl('span', 'k-home-promise-chip', label));
  });

  inner.append(baseline, chips);
  section.appendChild(inner);

  pageScroll.insertBefore(section, catalogWrap);
  _currentTab = document.body.classList.contains('k-view-shop') ? 'shop' : 'other';
  applyHomeCurationVisibility();
}

export function setupHomePremiumV1() {
  if (_installed) return;
  _installed = true;
  injectStyles();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectHomeBlocks, { once: true });
  } else {
    injectHomeBlocks();
  }

  bus.on('view:changed', function(tab) { _currentTab = tab; applyHomeCurationVisibility(); });
  bus.on('catalog:cat-changed', function(cat) { _currentCat = cat; applyHomeCurationVisibility(); });
}
