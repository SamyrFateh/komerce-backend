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
  if (_styleInjected || typeof document === 'undefined') return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'k-home-premium-v1-style';
  style.textContent = `
@media (min-width: 900px) {
  html.k-home-premium-v1 .k-header {
    backdrop-filter: blur(18px);
    background: color-mix(in srgb, var(--sand) 82%, var(--white));
    border-bottom: 1px solid var(--border-text-06);
  }

  html.k-home-premium-v1 .k-logo-text {
    font-weight: 900;
    letter-spacing: -.025em;
  }

  html.k-home-premium-v1 .k-search {
    min-height: 54px;
    border-radius: 999px;
    box-shadow: 0 14px 36px var(--border-text-06);
  }

  html.k-home-premium-v1 .k-search input::placeholder {
    color: color-mix(in srgb, var(--text-muted) 78%, transparent);
  }

  html.k-home-premium-v1 #k-hero-fixed-wrap {
    background:
      radial-gradient(circle at 10% 0%, color-mix(in srgb, var(--ocean-bg-08) 66%, transparent), transparent 24%),
      linear-gradient(180deg, var(--sand) 0%, color-mix(in srgb, var(--sand-warm) 55%, var(--white)) 100%);
  }

  html.k-home-premium-v1 .k-hero-inner {
    max-width: none;
    padding-inline: clamp(26px, 3.6vw, 60px);
  }

  html.k-home-premium-v1 .k-hero-media {
    border-radius: 0 0 28px 28px;
    overflow: hidden;
    box-shadow: 0 18px 50px var(--border-text-06);
  }

  html.k-home-premium-v1 .k-hero-mini-slogan--premium {
    max-width: 510px;
  }

  html.k-home-premium-v1 .k-hero-badge {
    letter-spacing: .06em;
  }

  html.k-home-premium-v1 .k-line-1::before {
    content: 'Achetez pour les Comores, simplement.';
    display: block;
    font-family: var(--font-display, var(--font));
    color: var(--text);
    font-size: clamp(34px, 3.4vw, 58px);
    line-height: .92;
    letter-spacing: -.045em;
    max-width: 560px;
  }

  html.k-home-premium-v1 .k-line-1,
  html.k-home-premium-v1 .k-line-2 {
    font-size: 0 !important;
  }

  html.k-home-premium-v1 .k-hero-sub {
    margin-top: 14px;
    max-width: 470px;
    font-size: 15px;
    line-height: 1.55;
  }

  html.k-home-premium-v1 .k-hero-cta-primary {
    min-height: 44px;
    border-radius: 14px;
    box-shadow: 0 16px 32px color-mix(in srgb, var(--coral) 22%, transparent);
  }

  html.k-home-premium-v1 .k-hero-cta-ghost {
    border-radius: 14px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
  }

  html.k-home-premium-v1 .k-hero-trust {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
    border: 1px solid var(--border-text-06);
  }

  html.k-home-premium-v1 .k-cats-shell { padding-top: 18px; }

  html.k-home-premium-v1 .k-cats::before {
    content: 'Explorer par univers';
    position: absolute;
    left: clamp(24px, 3vw, 46px);
    top: -34px;
    font-family: var(--font-display, var(--font));
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -.025em;
    color: var(--text);
  }

  html.k-home-premium-v1 .k-cats {
    position: relative;
    gap: 14px;
  }

  html.k-home-premium-v1 .k-chip {
    border-radius: 24px;
    min-width: 164px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
    box-shadow: 0 14px 34px var(--border-text-06);
    transition: transform .18s var(--ease), box-shadow .18s var(--ease), border-color .18s var(--ease);
  }

  html.k-home-premium-v1 .k-chip:hover {
    transform: translateY(-3px);
    box-shadow: 0 20px 44px var(--border-text-08);
  }

  html.k-home-premium-v1 .k-chip-label { font-weight: 850; }

  html.k-home-premium-v1 .k-home-curation {
    display: block;
    padding: 22px clamp(26px, 3.4vw, 56px) 14px;
    background:
      radial-gradient(circle at 84% 4%, color-mix(in srgb, var(--coral) 10%, transparent), transparent 22%),
      var(--sand);
  }

  body:not(.k-view-shop) .k-home-curation {
    display: none !important;
  }

  html.k-home-premium-v1 .k-home-curation-inner {
    max-width: 1500px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    text-align: center;
  }

  html.k-home-premium-v1 .k-home-baseline {
    margin: 0;
    font-family: var(--font-display, var(--font));
    font-size: clamp(20px, 1.6vw, 26px);
    line-height: 1.1;
    letter-spacing: -.02em;
    color: var(--text);
  }

  html.k-home-premium-v1 .k-home-promise-list {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  html.k-home-premium-v1 .k-home-promise-chip {
    padding: 8px 14px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
    border: 1px solid var(--border-text-06);
    color: var(--text);
    font-size: 12px;
    font-weight: 700;
  }

  html.k-home-premium-v1 #k-catalog-section { padding-top: 22px; }

  html.k-home-premium-v1 #k-catalog-section::before {
    content: 'Bons plans du moment';
    display: block;
    max-width: 1500px;
    margin: 0 auto 6px;
    font-family: var(--font-display, var(--font));
    font-size: clamp(26px, 2.2vw, 36px);
    line-height: 1;
    letter-spacing: -.03em;
    color: var(--text);
  }

  html.k-home-premium-v1 #k-catalog-section::after {
    content: 'Des produits utiles, bien placés, faciles à commander et à retirer en relais.';
    display: block;
    max-width: 1500px;
    margin: -2px auto 18px;
    color: var(--text-muted);
    font-size: 14px;
  }

  body:not(.k-view-shop) #k-catalog-section::before,
  body:not(.k-view-shop) #k-catalog-section::after {
    content: none !important;
    display: none !important;
  }

  html.k-home-premium-v1 .k-side-cart {
    box-shadow: -14px 0 44px var(--border-text-08);
    border-left: 1px solid var(--border-text-06);
  }

  html.k-home-premium-v1 .k-sc-btn-checkout { border-radius: 18px; }
}
`;

  document.head.appendChild(style);
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function syncHomeScope(tab) {
  const section = document.querySelector('.k-home-curation');
  if (!section) return;
  section.classList.toggle('u-hidden', tab !== 'shop');
}

function injectHomeBlocks() {
  if (_blocksInjected || !isDesktop() || typeof document === 'undefined') return;

  const pageScroll = document.getElementById('k-page-scroll');
  const catalogWrap = document.getElementById('k-desktop-catalog-wrap');
  if (!pageScroll || !catalogWrap) return;

  _blocksInjected = true;
  document.documentElement.classList.add('k-home-premium-v1');

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
  syncHomeScope(document.body.classList.contains('k-view-shop') ? 'shop' : 'other');
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

  bus.on('view:changed', syncHomeScope);
}
