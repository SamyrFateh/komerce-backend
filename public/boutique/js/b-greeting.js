/**
 * @komerce-arch-lite
 * @role          boutique-b-greeting
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       supports public/boutique/js/b-catalog.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module b-greeting
 * @brief Salutation furtive â€” affiche un chip de bienvenue si l'utilisateur
 *        est reconnu (session active via cookie httpOnly).
 *
 * Comportement :
 *   - Appelle GET /api/auth/me (best-effort, sans bloquer le boot).
 *   - Si l'utilisateur est identifiÃ©, affiche un petit chip "Kwezi Fatima ðŸ˜Š"
 *     en haut Ã  droite, fond clair, pendant 4 s puis disparaÃ®t.
 *   - Ne bloque rien, n'utilise pas le toast gÃ©nÃ©ral.
 *   - Ne s'affiche qu'une fois par session (sessionStorage guard).
 *   - Aucune erreur rÃ©seau ne remonte Ã  l'utilisateur.
 *
 * IntÃ©gration : importÃ© dans main.js, appelÃ© dans setupBoutiqueRuntime().
 */

const GREETING_KEY = 'kmrc_greeted';
const STYLE_ID     = 'k-greeting-styles';
const CHIP_ID      = 'k-greeting-chip';
const DURATION     = 4000; // ms avant disparition

// FIX BUG-L3 : styles migrÃ©s vers css/interactions.css (bundle components).
// La fonction ensureStyles() est supprimÃ©e â€” plus d'injection CSS depuis le JS.
function ensureStyles() { /* no-op â€” styles dans interactions.css */ }

function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || '';
}

function buildLabel(user) {
  const prenom = firstName(user.full_name);
  const badge  = user.loyalty_badge ? ` ${user.loyalty_badge}` : '';
  return prenom
    ? `Karibu ${prenom}${badge} 😊`
    : `Karibu${badge} 😊`;
}

function showGreetingChip(label) {
  ensureStyles();

  // Nettoyer un Ã©ventuel chip rÃ©siduel
  document.getElementById(CHIP_ID)?.remove();

  const chip = document.createElement('div');
  chip.id = CHIP_ID;
  chip.setAttribute('aria-live', 'polite');
  chip.textContent = label;
  document.body.appendChild(chip);

  // EntrÃ©e
  requestAnimationFrame(() => {
    requestAnimationFrame(() => chip.classList.add('k-greeting-chip--visible'));
  });

  // Sortie
  setTimeout(() => {
    chip.classList.add('k-greeting-chip--out');
    chip.classList.remove('k-greeting-chip--visible');
    setTimeout(() => chip.remove(), 280);
  }, DURATION);
}

/**
 * Tente de rÃ©cupÃ©rer la session et affiche le chip de bienvenue.
 * Silencieux en cas d'Ã©chec (utilisateur non connectÃ© ou rÃ©seau indisponible).
 */
export async function greetIfKnown() {
  if (sessionStorage.getItem(GREETING_KEY)) return;

  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
    });

    if (!res.ok) return;

    const user = await res.json();
    if (!user || !user.id) return;

    sessionStorage.setItem(GREETING_KEY, '1');
    showGreetingChip(buildLabel(user));
  } catch (_) {
    // rÃ©seau indisponible ou cookie expirÃ© â†’ silencieux
  }
}
