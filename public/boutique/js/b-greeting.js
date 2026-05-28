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
 *   - Ne s'affiche qu'une fois par session (sessionStorage guard).
 *   - Aucune erreur réseau ne remonte à l'utilisateur.
 *
 * Intégration : importé dans main.js, appelé dans setupBoutiqueRuntime().
 */

const GREETING_KEY = 'kmrc_greeted';
const STYLE_ID     = 'k-greeting-styles';
const CHIP_ID      = 'k-greeting-chip';
const DURATION     = 4000; // ms avant disparition

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
#k-greeting-chip {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 10px);
  right: 14px;
  z-index: 1800;
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--white, #fff);
  border: 1.5px solid rgba(31,122,84,.18);
  border-radius: 999px;
  padding: 6px 12px 6px 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,.10);
  font-size: 13px;
  font-weight: 700;
  color: var(--text, #1a1a1a);
  pointer-events: none;
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity .22s ease, transform .22s ease;
}
#k-greeting-chip.k-greeting-chip--visible {
  opacity: 1;
  transform: translateY(0);
}
#k-greeting-chip.k-greeting-chip--out {
  opacity: 0;
  transform: translateY(-6px);
}
`;
  document.head.appendChild(s);
}

function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || '';
}

function buildLabel(user) {
  const prenom = firstName(user.full_name);
  const badge  = user.loyalty_badge ? ` ${user.loyalty_badge}` : '';
  return prenom
    ? `Kwezi ${prenom}${badge} 😊`
    : `Kwezi${badge} 😊`;
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
    // réseau indisponible ou cookie expiré → silencieux
  }
}
