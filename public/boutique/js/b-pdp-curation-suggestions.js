/**
 * @module b-pdp-curation-suggestions
 * @brief Curation éditoriale des suggestions sous PDP desktop.
 *
 * Objectif : transformer le bloc générique "Vous aimerez aussi" en séquence
 * premium : Compléter avec → Dans le même univers → Sélection Komerce.
 *
 * Module additif : il ne reconstruit pas les cartes produit et conserve donc
 * les handlers existants de b-modal.js. Il renomme et réordonne uniquement les
 * sections déjà rendues, puis déplace quelques cartes vers un bloc complémentaire.
 */

import { bus } from './b-bus.js';
import { state } from './b-store.js';
import { isDesktop } from './b-scroll-owner.js';

'use strict';

let _installed = false;
let _styleInjected = false;

const COMPLEMENT_LABELS = {
  mode: 'Compléter le look',
  enfant: 'Compléter avec',
  tech: 'Accessoires compatibles',
  ordinateurs: 'Accessoires compatibles',
  phones: 'Accessoires utiles',
  téléphones: 'Accessoires utiles',
  maison: 'À associer avec',
  beauté: 'Routine complète',
  cuisine: 'Compléter l’équipement',
};

function injectStyles() {
  if (_styleInjected || typeof document === 'undefined') return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'k-pdp-curation-style';
  style.textContent = `
@media (min-width: 900px) {
  #k-modal-suggestions.k-pdp-curation {
    background:
      radial-gradient(circle at 14% 0%, color-mix(in srgb, var(--ocean-bg-08) 60%, transparent), transparent 26%),
      linear-gradient(180deg, var(--sand) 0%, var(--sand-warm) 100%);
    border-top: 1px solid var(--border-text-06);
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-section {
    max-width: 1480px;
    margin-inline: auto;
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-section + .k-sug-section {
    margin-top: 34px;
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-title {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: 12px;
    margin-bottom: 14px;
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-title-icon {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: var(--white);
    box-shadow: 0 10px 24px var(--border-text-06);
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-title-text {
    font-family: var(--font-display, var(--font));
    font-size: clamp(24px, 2.2vw, 34px);
    letter-spacing: -.03em;
  }

  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-subtitle {
    grid-column: 2;
    margin-top: -7px;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-section--complements {
    padding: 22px;
    border-radius: 26px;
    background: color-mix(in srgb, var(--white) 72%, transparent);
    border: 1px solid var(--border-text-06);
    box-shadow: 0 18px 46px var(--border-text-06);
  }

  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-section--complements .k-sug-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(150px, 1fr));
    gap: 14px;
  }

  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-section--same .k-sug-grid,
  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-section--editorial .k-sug-grid {
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 18px;
  }

  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-badge {
    position: absolute;
    left: 10px;
    top: 10px;
    z-index: 2;
    height: 24px;
    padding: 0 9px;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ocean) 92%, var(--text));
    color: var(--white);
    font-size: 11px;
    font-weight: 850;
    box-shadow: 0 8px 18px var(--border-text-12);
  }

  /* Si la carte porte déjà un badge promo (.k-sug-promo-badge), masquer
     le badge curation Utile/Assorti — la promo a priorité commerciale.
     Les deux badges occupaient le même coin haut-gauche et le curation
     écrasait visuellement le -X% qui est un argument d'achat plus fort. */
  #k-modal-suggestions.k-pdp-curation .k-sug-card-img:has(.k-sug-promo-badge) .k-pdp-curation-badge {
    display: none;
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-card-img { position: relative; }
}
`;
  document.head.appendChild(style);
}

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

function addBadge(card, label) {
  if (!card || card.querySelector('.k-pdp-curation-badge')) return;
  const img = card.querySelector('.k-sug-card-img');
  if (!img) return;
  const badge = document.createElement('span');
  badge.className = 'k-pdp-curation-badge';
  badge.textContent = label;
  img.appendChild(badge);
}

function pickComplementTitle(product) {
  const raw = String(product && product.category ? product.category : '').trim().toLowerCase();
  return COMPLEMENT_LABELS[raw] || 'Compléter avec';
}

function moveComplementCards(otherSection, maxCount) {
  if (!otherSection) return null;
  const grid = otherSection.querySelector('.k-sug-grid--other');
  if (!grid) return null;

  const cards = Array.from(grid.querySelectorAll('.k-sug-card')).slice(0, maxCount);
  if (!cards.length) return null;

  const section = document.createElement('div');
  section.className = 'k-sug-section k-pdp-curation-section--complements';

  const title = document.createElement('div');
  title.className = 'k-sug-title';

  const icon = document.createElement('span');
  icon.className = 'k-sug-title-icon';
  icon.textContent = '🧩';

  const text = document.createElement('span');
  text.className = 'k-sug-title-text';
  text.textContent = pickComplementTitle(state.modalProduct);

  const subtitle = document.createElement('div');
  subtitle.className = 'k-pdp-curation-subtitle';
  subtitle.textContent = 'Des produits utiles pour composer un panier plus complet, sans quitter la fiche.';

  const newGrid = document.createElement('div');
  newGrid.className = 'k-sug-grid k-sug-grid--complements';

  title.append(icon, text, subtitle);
  section.append(title, newGrid);

  cards.forEach(function(card, index) {
    addBadge(card, index < 2 ? 'Assorti' : 'Utile');
    newGrid.appendChild(card);
  });

  return section;
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

  const complementSection = moveComplementCards(otherSection, 6);
  if (complementSection) {
    rail.insertBefore(complementSection, rail.firstChild);
  }

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
    const remaining = otherSection.querySelectorAll('.k-sug-card').length;
    if (remaining > 0) {
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

export function setupPdpCurationSuggestions() {
  if (_installed) return;
  _installed = true;
  injectStyles();

  bus.on('modal:opened', function() {
    if (!isDesktop()) return;
    requestAnimationFrame(function() {
      requestAnimationFrame(enhanceCuration);
    });
  });
}
