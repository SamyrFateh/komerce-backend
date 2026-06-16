/**
 * @komerce-arch-lite
 * @role          boutique-b-cart-groups-tab
 * @domain        boutique
 * @layer         ui-component
 * @owner         public/boutique/js/b-cart.js
 * @purpose       supports public/boutique/js/b-cart.js
 * @impact-areas  boutique
 * @version       2026-06
 */

/**
 * @module b-cart-groups-tab
 * @brief Compatibilité locale paniers partagés.
 *
 * Le panier principal ne doit plus contenir d'onglet "Partagés".
 * Les paniers partagés vivent dans Suivi, pas dans le drawer panier.
 */

import { cartTotal, showToast } from './b-cart-core.js';

const STORAGE_KEY = 'kmrc_group_carts_v1';
let installed = false;

function loadGroups() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function saveGroups(groups) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(groups.slice(0, 20))); } catch (_) {}
}

function todayLabel(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function addGroupFromShare(detail) {
  const groups = loadGroups().filter(g => !String(g.id).startsWith('demo-'));
  const title = detail?.label || detail?.event_name || 'Panier partagé';
  const url = detail?.url || detail?.publicUrl || window.location.href;
  const publicToken = detail?.publicToken || null;
  const creatorToken = detail?.creatorToken || null;

  const group = {
    id: publicToken ? 'grp-' + publicToken : 'grp-' + Date.now(),
    title,
    status: 'open',
    dateLabel: 'Clôture le ' + todayLabel(3),
    total: Number(detail?.total) || cartTotal() || 0,
    url,
    publicToken,
    creatorToken,
    participants: [
      { name: 'Moi', status: 'pending', amount: Number(detail?.total) || cartTotal() || null }
    ]
  };

  saveGroups([group].concat(groups));
  showToast('Panier partagé ajouté au suivi', 'success');
}

// ARCH-1 : flag de guard migré de window.__kmrcGroupWorkspacePatch vers
// une variable de module — évite la pollution du scope global.
let _fetchPatched = false;

function patchFetchForWorkspaceCreation() {
  if (_fetchPatched) return;
  _fetchPatched = true;

  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;

  window.fetch = async function(input, init) {
    const res = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/api/collective-workspaces')) {
        const clone = res.clone();
        clone.json().then(data => {
          if (!data?.public_token) return;
          window.dispatchEvent(new CustomEvent('kmrc:group-cart-created', {
            detail: {
              label: data.event_name || 'Panier partagé',
              url: window.location.origin + '/event/w/' + encodeURIComponent(data.public_token),
              publicToken: data.public_token,
              creatorToken: data.creator_token,
              total: cartTotal()
            }
          }));
        }).catch(() => {});
      }
    } catch (_) {}
    return res;
  };
}

export function setupCartGroupsTab() {
  if (installed) return;
  installed = true;

  // Legacy désactivé.
  // Le flux Groupe officiel vit dans b-group-view.js + group/group-api.js.
  // Ne plus patcher window.fetch ni écrire kmrc_group_carts_v1 :
  // cela recycle des paniers locaux obsolètes et peut provoquer des appels API invalides.
}
