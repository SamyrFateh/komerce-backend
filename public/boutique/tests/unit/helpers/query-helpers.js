'use strict';

/**
 * Helpers de requête « par rôle/texte/classe » — évitent de coupler les
 * tests à l'emplacement précis d'un bouton dans #k-cart-footer-btns ou
 * .k-sc-header (mandat Lot D). On cherche un bouton n'importe où dans le
 * document par sous-chaîne de texte visible, ou par une classe canonique
 * partagée (ex. .k-cart-item-remove, .k-qty-btn), jamais par un chemin
 * DOM figé.
 */

function allButtons(root = document) {
  return Array.from(root.querySelectorAll('button'));
}

/** Premier bouton dont le textContent contient `text` (insensible aux espaces). */
function findButtonByText(text, root = document) {
  return allButtons(root).find((b) => b.textContent.replace(/\s+/g, ' ').trim().includes(text)) || null;
}

/** Tous les boutons dont le textContent contient `text`. */
function findButtonsByText(text, root = document) {
  return allButtons(root).filter((b) => b.textContent.replace(/\s+/g, ' ').trim().includes(text));
}

/** Bouton par aria-label exact ou partiel. */
function findButtonByAriaLabel(label, root = document) {
  return allButtons(root).find((b) => (b.getAttribute('aria-label') || '').includes(label)) || null;
}

/** Clique le premier bouton trouvé par texte visible ; jette si absent (échec de test explicite). */
function clickByText(text, root = document) {
  const btn = findButtonByText(text, root);
  if (!btn) throw new Error(`Aucun bouton avec le texte "${text}" trouvé`);
  btn.click();
  return btn;
}

/** Éléments portant une classe canonique donnée (ex. 'k-cart-snapshot-item'). */
function byClass(className, root = document) {
  return Array.from(root.querySelectorAll('.' + className));
}

module.exports = {
  allButtons,
  findButtonByText,
  findButtonsByText,
  findButtonByAriaLabel,
  clickByText,
  byClass,
};
