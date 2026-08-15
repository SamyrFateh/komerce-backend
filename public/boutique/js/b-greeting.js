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
 * @brief Salutation furtive — affiche un chip de bienvenue si l'utilisateur
 *        est reconnu (session active via cookie httpOnly).
 *
 * Comportement :
 *   - Appelle GET /api/auth/me (best-effort, sans bloquer le boot).
 *   - Si l'utilisateur est identifié, affiche un petit chip "Kwezi Fatima 😊"
 *     en haut à droite, fond clair, pendant 4 s puis disparaît.
 *   - Ne bloque rien, n'utilise pas le toast général.
 *   - Le chip ne s'affiche qu'une fois par session (sessionStorage guard),
 *     mais la session est toujours relue afin de personnaliser la navigation.
 *   - Aucune erreur réseau ne remonte à l'utilisateur.
 *
 * Intégration : importé dans main.js, appelé dans setupBoutiqueRuntime().
 */

const GREETING_KEY = 'kmrc_greeted';
const STYLE_ID     = 'k-greeting-styles';
const CHIP_ID      = 'k-greeting-chip';
const DURATION     = 4000; // ms avant disparition

// FIX BUG-L3 : styles migrés vers css/interactions.css (bundle components).
// La fonction ensureStyles() est supprimée — plus d'injection CSS depuis le JS.
function ensureStyles() { /* no-op — styles dans interactions.css */ }

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

  // Nettoyer un éventuel chip résiduel
  document.getElementById(CHIP_ID)?.remove();

  const chip = document.createElement('div');
  chip.id = CHIP_ID;
  chip.setAttribute('aria-live', 'polite');
  chip.textContent = label;
  document.body.appendChild(chip);

  // Entrée
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
 * Tente de récupérer la session et affiche le chip de bienvenue.
 * Silencieux en cas d'échec (utilisateur non connecté ou réseau indisponible).
 */
export async function greetIfKnown() {
  const alreadyGreeted = Boolean(sessionStorage.getItem(GREETING_KEY));

  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
    });

    if (!res.ok) return null;

    const user = await res.json();
    if (!user || !user.id) return null;

    // Le même signal vérifié alimente désormais la tête neutre + le prénom
    // dans l'entrée Mon Komerce. Le détail évite un second GET /api/auth/me.
    window.dispatchEvent(new CustomEvent('komerce:identity-authenticated', {
      detail: { user },
    }));

    if (alreadyGreeted) return user;

    sessionStorage.setItem(GREETING_KEY, '1');
    showGreetingChip(buildLabel(user));
    return user;
  } catch (_) {
    // réseau indisponible ou cookie expiré → silencieux
    return null;
  }
}
