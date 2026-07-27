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
 * Objectif : transformer l'entrée catalogue en vitrine curatée sans casser
 * l'architecture existante ni le mobile. Module additif : il enrichit le hero,
 * les catégories et insère des bandes éditoriales avant la grille produits.
 *
 * Note audit : la classe d'activation est posée sur <html>, pas sur <body>,
 * pour ne pas créer d'état body permanent que check:body-classes considère bloquant.
 */

import { bus } from './b-bus.js';
import { isDesktop } from './b-scroll-owner.js';

'use strict';

let _installed = false;
let _styleInjected = false;
let _blocksInjected = false;

function injectStyles() {
  // Lot 3 — Tout le CSS a été rapatrié dans les owners :
  //   catégories (.k-cats, .k-chip, .k-chip-label) → categories.css
  //   hero (.k-hero-*, #k-hero-fixed-wrap)          → hero.css
  //   header / search / catalog                      → layout.css
  //   side-cart + blocs éditoriaux                   → boutique-desktop.css
  // Le JS ne possède plus aucun style. _styleInjected conservé pour compatibilité appelants.
  _styleInjected = true;
  return;
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// Visibilité contextuelle de la bande promesse :
// elle n'a de sens que sur l'ACCUEIL (univers « Tout ») et la vue shop.
// Dès qu'un univers/filtre est actif, elle parasite la navigation produit → masquée.
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

  // Bande promesse (slogan « Achetez pour vous… » + chips réassurance)
  // DÉSACTIVÉE : elle retardait l'arrivée des produits, sur l'accueil comme en
  // navigation. On conserve la classe k-home-premium-v1 (elle pilote tout le
  // style desktop premium) mais on n'injecte plus la section.
  // → repasser SHOW_CURATION à true pour la rétablir (visibilité contextuelle
  //   gérée par applyHomeCurationVisibility / les listeners bus ci-dessous).
  const SHOW_CURATION = false;
  if (!SHOW_CURATION) return;

  // Bloc allégé : une ligne sobre (citation Brand Truth §Vérité de marque)
  // + chips de promesse en pilule, centrés. Aucun titre serif, aucun
  // bloc éditorial lourd — la doctrine BRAND_TRUTH §Règle de simplicité
  // linguistique impose visuel > texte, court > exhaustif.
  const section = makeEl('section', 'k-home-curation');
  section.setAttribute('aria-label', 'Promesse Komerce');

  const inner = makeEl('div', 'k-home-curation-inner');

  const baseline = makeEl('p', 'k-home-baseline', 'Achetez pour vous, pour eux, ou ensemble.');

  const chips = makeEl('div', 'k-home-promise-list');
  [
    'Retrait relais',
    'Paiement sécurisé',
    'Suivi en 9 étapes',
    'Panier partagé',
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
