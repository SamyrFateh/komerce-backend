/**
 * @module b-greeting
 * @brief Salutation furtive — affiche un toast de bienvenue si l'utilisateur
 *        est reconnu (session active via cookie httpOnly).
 *
 * Comportement :
 *   - Appelle GET /api/auth/me (best-effort, sans bloquer le boot).
 *   - Si l'utilisateur est identifié, affiche un toast "Bonjour [Prénom] 👋"
 *     pendant 2 800 ms puis il disparaît automatiquement.
 *   - Affiche le badge fidélité si présent (ex: "⭐ Gold").
 *   - Ne s'affiche qu'une fois par session (sessionStorage guard).
 *   - Aucune erreur réseau ne remonte à l'utilisateur.
 *
 * Intégration : importé dans main.js, appelé dans setupBoutiqueRuntime().
 */

import { showToast } from './b-cart-core.js';

const GREETING_KEY = 'kmrc_greeted';

/**
 * Extrait le prénom depuis full_name ("Fatima Ben Ali" → "Fatima").
 * @param {string} fullName
 * @returns {string}
 */
function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || '';
}

/**
 * Construit le message de salutation.
 * @param {{ full_name: string, loyalty_badge?: string }} user
 * @returns {string}
 */
function buildMessage(user) {
  const prenom = firstName(user.full_name);
  const badge  = user.loyalty_badge ? ` ${user.loyalty_badge}` : '';
  return prenom
    ? `Kwezi ${prenom}${badge} — Habari ! 😊`
    : `Kwezi${badge} — Habari ! 😊`;
}

/**
 * Tente de récupérer la session et affiche le toast de bienvenue.
 * Silencieux en cas d'échec (utilisateur non connecté ou réseau indisponible).
 */
export async function greetIfKnown() {
  // Guard : une seule fois par session de navigation
  if (sessionStorage.getItem(GREETING_KEY)) return;

  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
    });

    if (!res.ok) return; // non connecté → pas de toast

    const user = await res.json();
    if (!user || !user.id) return;

    sessionStorage.setItem(GREETING_KEY, '1');
    showToast(buildMessage(user), '', 10000);
  } catch (_) {
    // réseau indisponible ou cookie expiré → silencieux
  }
}
