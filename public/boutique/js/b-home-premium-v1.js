/**
 * @module b-home-premium-v1
 * @brief Couche premium desktop pour la page d'accueil Komerce.
 *
 * Objectif : transformer l'entrée catalogue en vitrine curatée sans casser
 * l'architecture existante ni le mobile. Module additif : il enrichit le hero,
 * les catégories et insère des bandes éditoriales avant la grille produits.
 */

import { state } from './b-store.js';
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
  body.k-home-premium-v1 .k-header {
    backdrop-filter: blur(18px);
    background: color-mix(in srgb, var(--sand) 82%, var(--white));
    border-bottom: 1px solid var(--border-text-06);
  }

  body.k-home-premium-v1 .k-logo-text {
    font-weight: 900;
    letter-spacing: -.025em;
  }

  body.k-home-premium-v1 .k-search {
    min-height: 54px;
    border-radius: 999px;
    box-shadow: 0 14px 36px var(--border-text-06);
  }

  body.k-home-premium-v1 .k-search input::placeholder {
    color: color-mix(in srgb, var(--text-muted) 78%, transparent);
  }

  body.k-home-premium-v1 #k-hero-fixed-wrap {
    background:
      radial-gradient(circle at 10% 0%, color-mix(in srgb, var(--ocean-bg-08) 66%, transparent), transparent 24%),
      linear-gradient(180deg, var(--sand) 0%, color-mix(in srgb, var(--sand-warm) 55%, var(--white)) 100%);
  }

  body.k-home-premium-v1 .k-hero-inner {
    max-width: none;
    padding-inline: clamp(26px, 3.6vw, 60px);
  }

  body.k-home-premium-v1 .k-hero-media {
    border-radius: 0 0 28px 28px;
    overflow: hidden;
    box-shadow: 0 18px 50px var(--border-text-06);
  }

  body.k-home-premium-v1 .k-hero-mini-slogan--premium {
    max-width: 510px;
  }

  body.k-home-premium-v1 .k-hero-badge {
    letter-spacing: .06em;
  }

  body.k-home-premium-v1 .k-line-1::before {
    content: 'Achetez pour les Comores, simplement.';
    display: block;
    font-family: var(--font-display, var(--font));
    color: var(--text);
    font-size: clamp(34px, 3.4vw, 58px);
    line-height: .92;
    letter-spacing: -.045em;
    max-width: 560px;
  }

  body.k-home-premium-v1 .k-line-1,
  body.k-home-premium-v1 .k-line-2 {
    font-size: 0 !important;
  }

  body.k-home-premium-v1 .k-hero-sub {
    margin-top: 14px;
    max-width: 470px;
    font-size: 15px;
    line-height: 1.55;
  }

  body.k-home-premium-v1 .k-hero-sub::after {
    content: ' Dubai → Comores · Retrait en relais · Paiement carte ou à la livraison.';
  }

  body.k-home-premium-v1 .k-hero-cta-primary {
    min-height: 44px;
    border-radius: 14px;
    box-shadow: 0 16px 32px color-mix(in srgb, var(--coral) 22%, transparent);
  }

  body.k-home-premium-v1 .k-hero-cta-ghost {
    border-radius: 14px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
  }

  body.k-home-premium-v1 .k-hero-trust {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
    border: 1px solid var(--border-text-06);
  }

  body.k-home-premium-v1 .k-cats-shell {
    padding-top: 18px;
  }

  body.k-home-premium-v1 .k-cats::before {
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

  body.k-home-premium-v1 .k-cats {
    position: relative;
    gap: 14px;
  }

  body.k-home-premium-v1 .k-chip {
    border-radius: 24px;
    min-width: 164px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
    box-shadow: 0 14px 34px var(--border-text-06);
    transition: transform .18s var(--ease), box-shadow .18s var(--ease), border-color .18s var(--ease);
  }

  body.k-home-premium-v1 .k-chip:hover {
    transform: translateY(-3px);
    box-shadow: 0 20px 44px var(--border-text-08);
  }

  body.k-home-premium-v1 .k-chip-label {
    font-weight: 850;
  }

  body.k-home-premium-v1 .k-home-curation {
    display: block;
    padding: 28px clamp(26px, 3.4vw, 56px) 18px;
    background:
      radial-gradient(circle at 84% 4%, color-mix(in srgb, var(--coral) 10%, transparent), transparent 22%),
      var(--sand);
  }

  body.k-home-premium-v1 .k-home-curation-inner {
    max-width: 1500px;
    margin: 0 auto;
    display: grid;
    gap: 22px;
  }

  body.k-home-premium-v1 .k-home-section-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 16px;
  }

  body.k-home-premium-v1 .k-home-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--coral);
    text-transform: uppercase;
    letter-spacing: .08em;
    font-size: 11px;
    font-weight: 900;
  }

  body.k-home-premium-v1 .k-home-title {
    margin-top: 5px;
    font-family: var(--font-display, var(--font));
    font-size: clamp(28px, 2.6vw, 42px);
    line-height: .98;
    letter-spacing: -.035em;
    color: var(--text);
  }

  body.k-home-premium-v1 .k-home-subtitle {
    max-width: 620px;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.55;
  }

  body.k-home-premium-v1 .k-home-compose-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  body.k-home-premium-v1 .k-home-compose-card {
    min-height: 132px;
    padding: 18px;
    border-radius: 26px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
    border: 1px solid var(--border-text-06);
    box-shadow: 0 18px 46px var(--border-text-06);
    cursor: pointer;
    transition: transform .18s var(--ease), box-shadow .18s var(--ease), border-color .18s var(--ease);
  }

  body.k-home-premium-v1 .k-home-compose-card:hover {
    transform: translateY(-4px);
    border-color: var(--ocean-light);
    box-shadow: 0 22px 54px var(--border-text-08);
  }

  body.k-home-premium-v1 .k-home-compose-icon {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 15px;
    background: var(--ocean-bg-08);
    border: 1px solid var(--border-ocean-14);
    font-size: 22px;
  }

  body.k-home-premium-v1 .k-home-compose-card strong {
    display: block;
    margin-top: 14px;
    color: var(--text);
    font-size: 16px;
    letter-spacing: -.015em;
  }

  body.k-home-premium-v1 .k-home-compose-card span:last-child {
    display: block;
    margin-top: 5px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.4;
  }

  body.k-home-premium-v1 .k-home-how {
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 18px;
    align-items: stretch;
  }

  body.k-home-premium-v1 .k-home-how-card,
  body.k-home-premium-v1 .k-home-promise-card {
    border-radius: 28px;
    padding: 22px;
    background: color-mix(in srgb, var(--white) 76%, transparent);
    border: 1px solid var(--border-text-06);
  }

  body.k-home-premium-v1 .k-home-steps {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-top: 16px;
  }

  body.k-home-premium-v1 .k-home-step {
    padding: 12px;
    border-radius: 18px;
    background: var(--sand);
    border: 1px solid var(--border-text-06);
    font-size: 12px;
    color: var(--text-muted);
  }

  body.k-home-premium-v1 .k-home-step b {
    display: block;
    color: var(--text);
    font-size: 13px;
    margin-bottom: 4px;
  }

  body.k-home-premium-v1 .k-home-promise-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }

  body.k-home-premium-v1 .k-home-promise-chip {
    padding: 8px 10px;
    border-radius: 999px;
    background: var(--sand);
    border: 1px solid var(--border-text-06);
    color: var(--text);
    font-size: 12px;
    font-weight: 750;
  }

  body.k-home-premium-v1 #k-catalog-section {
    padding-top: 22px;
  }

  body.k-home-premium-v1 #k-catalog-section::before {
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

  body.k-home-premium-v1 #k-catalog-section::after {
    content: 'Des produits utiles, bien placés, faciles à commander et à retirer en relais.';
    display: block;
    max-width: 1500px;
    margin: -2px auto 18px;
    color: var(--text-muted);
    font-size: 14px;
  }

  body.k-home-premium-v1 .k-side-cart {
    box-shadow: -14px 0 44px var(--border-text-08);
    border-left: 1px solid var(--border-text-06);
  }

  body.k-home-premium-v1 .k-sc-btn-checkout {
    border-radius: 18px;
  }
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

function clickCategory(cat) {
  const chip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
  if (chip) chip.click();
}

function createComposeCard(icon, title, subtitle, cat) {
  const card = makeEl('button', 'k-home-compose-card');
  card.type = 'button';
  card.addEventListener('click', function() { clickCategory(cat); });

  const i = makeEl('span', 'k-home-compose-icon', icon);
  const strong = makeEl('strong', '', title);
  const sub = makeEl('span', '', subtitle);
  card.append(i, strong, sub);
  return card;
}

function injectHomeBlocks() {
  if (_blocksInjected || !isDesktop() || typeof document === 'undefined') return;

  const pageScroll = document.getElementById('k-page-scroll');
  const catalogWrap = document.getElementById('k-desktop-catalog-wrap');
  if (!pageScroll || !catalogWrap) return;

  _blocksInjected = true;
  document.body.classList.add('k-home-premium-v1');

  const section = makeEl('section', 'k-home-curation');
  section.setAttribute('aria-label', 'Sélections Komerce');

  const inner = makeEl('div', 'k-home-curation-inner');

  const head = makeEl('div', 'k-home-section-head');
  const hCopy = makeEl('div');
  const eyebrow = makeEl('div', 'k-home-eyebrow', '🧺 Composer un panier');
  const title = makeEl('div', 'k-home-title', 'Des sélections utiles pour le quotidien');
  const subtitle = makeEl('p', 'k-home-subtitle', 'Komerce vous aide à démarrer vite : famille, maison, tech ou cadeaux — choisissez un univers et composez un panier adapté aux Comores.');
  hCopy.append(eyebrow, title, subtitle);
  head.appendChild(hCopy);

  const grid = makeEl('div', 'k-home-compose-grid');
  grid.append(
    createComposeCard('👕', 'Look du moment', 'Mode, chaussures et accessoires faciles à associer.', 'Mode & Beauté'),
    createComposeCard('🏠', 'Maison pratique', 'Rangement, cuisine, entretien et objets utiles.', 'Maison'),
    createComposeCard('🎧', 'Tech utile', 'Audio, téléphone, câbles, supports et gadgets.', 'Tech'),
    createComposeCard('🎁', 'Idées cadeaux', 'Petites attentions à envoyer ou offrir en relais.', 'Créations personnelles')
  );

  const how = makeEl('div', 'k-home-how');

  const howCard = makeEl('div', 'k-home-how-card');
  const howEye = makeEl('div', 'k-home-eyebrow', '📦 Comment ça marche');
  const howTitle = makeEl('div', 'k-home-title', 'Acheter pour les Comores, sans complication');
  const steps = makeEl('div', 'k-home-steps');
  [
    ['1. Choisissez', 'Produits et quantités'],
    ['2. Payez', 'Carte ou livraison'],
    ['3. On expédie', 'Dubai → Comores'],
    ['4. Retirez', 'Code en relais'],
  ].forEach(function(step) {
    const s = makeEl('div', 'k-home-step');
    const b = makeEl('b', '', step[0]);
    const t = makeEl('span', '', step[1]);
    s.append(b, t);
    steps.appendChild(s);
  });
  howCard.append(howEye, howTitle, steps);

  const promise = makeEl('div', 'k-home-promise-card');
  const pEye = makeEl('div', 'k-home-eyebrow', '🌙 Promesse Komerce');
  const pTitle = makeEl('div', 'k-home-title', 'Une boutique pensée pour la diaspora et les familles');
  const chips = makeEl('div', 'k-home-promise-list');
  ['Retrait relais', 'Paiement sécurisé', 'Suivi commande', 'Panier partagé', 'Prix en KMF', 'Livraison incluse'].forEach(function(label) {
    chips.appendChild(makeEl('span', 'k-home-promise-chip', label));
  });
  promise.append(pEye, pTitle, chips);

  how.append(howCard, promise);
  inner.append(head, grid, how);
  section.appendChild(inner);

  pageScroll.insertBefore(section, catalogWrap);
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
}
