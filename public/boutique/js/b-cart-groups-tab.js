/**
 * @module b-cart-groups-tab
 * @brief Onglet "Mes groupes" dans le panier.
 *
 * V1 volontairement légère : lecture locale des paniers collectifs créés
 * depuis ce navigateur + UI visuelle rapide. Compatible sans backend dédié.
 */

import { state, dom } from './b-store.js';
import { cartQty, cartTotal, showToast } from './b-cart-core.js';
import { fmt } from './b-utils.js';

const STORAGE_KEY = 'kmrc_group_carts_v1';
let installed = false;
let activeTab = 'cart';

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

function initials(name) {
  const clean = String(name || '').trim();
  if (!clean) return '👤';
  return clean.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

function safeText(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function todayLabel(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function seedIfEmpty() {
  const existing = loadGroups();
  if (existing.length) return existing;

  const seed = [
    {
      id: 'demo-open',
      title: 'Commande famille',
      status: 'open',
      dateLabel: 'Clôture le ' + todayLabel(3),
      total: 7000,
      url: window.location.origin + '/boutique/',
      participants: [
        { name: 'Sitti', status: 'paid', amount: 4800 },
        { name: 'Mohamed', status: 'pending', amount: 2200 },
        { name: 'Fatima', status: 'pending', amount: null }
      ]
    },
    {
      id: 'demo-paid',
      title: 'Cadeau mariage',
      status: 'paid',
      dateLabel: 'Clôturé le ' + todayLabel(-3),
      total: 12000,
      url: window.location.origin + '/boutique/',
      participants: [
        { name: 'Ibrahim', status: 'paid', amount: 6000 },
        { name: 'Ayoub', status: 'paid', amount: 6000 }
      ]
    }
  ];

  saveGroups(seed);
  return seed;
}

function getGroups() {
  return seedIfEmpty();
}

function groupCount() {
  return getGroups().filter(g => g.status !== 'archived').length;
}

function ensureCss() {
  if (document.getElementById('kmrc-cart-groups-css')) return;
  const link = document.createElement('link');
  link.id = 'kmrc-cart-groups-css';
  link.rel = 'stylesheet';
  link.href = '/boutique/css/cart-groups.css?v=1';
  document.head.appendChild(link);
}

function ensureTabs() {
  if (!dom.cartDrawer || document.getElementById('k-cart-tabs')) return;

  const tabs = document.createElement('div');
  tabs.id = 'k-cart-tabs';
  tabs.className = 'k-cart-tabs';
  tabs.innerHTML = `
    <button type="button" class="k-cart-tab is-active" data-cart-tab="cart">🧺 Panier</button>
    <button type="button" class="k-cart-tab" data-cart-tab="groups">👥 Mes groupes <span class="k-cart-tab-badge" id="k-cart-groups-badge">0</span></button>
  `;

  dom.cartHeader.insertAdjacentElement('afterend', tabs);

  const body = document.createElement('div');
  body.id = 'k-group-cart-body';
  body.className = 'k-group-cart-body';
  dom.cartBody.insertAdjacentElement('afterend', body);

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cart-tab]');
    if (!btn) return;
    setActiveTab(btn.dataset.cartTab);
  });
}

function setActiveTab(tab) {
  activeTab = tab === 'groups' ? 'groups' : 'cart';

  document.querySelectorAll('.k-cart-tab').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.cartTab === activeTab);
  });

  const groupBody = document.getElementById('k-group-cart-body');
  if (groupBody) groupBody.classList.toggle('is-active', activeTab === 'groups');

  dom.cartBody?.classList.toggle('is-hidden-by-groups', activeTab === 'groups');
  dom.cartFooter?.classList.toggle('is-hidden-by-groups', activeTab === 'groups');

  if (activeTab === 'groups') renderGroups();
}

function statusPill(status) {
  return status === 'paid'
    ? '<span class="k-group-pill k-group-pill--paid">Payé</span>'
    : '<span class="k-group-pill k-group-pill--open">Ouvert</span>';
}

function participantHtml(person, idx) {
  const paid = person.status === 'paid';
  const amount = person.amount == null ? '—' : fmt(Number(person.amount) || 0, 'KMF');
  return `
    <div class="k-group-person">
      <div class="k-group-person-left">
        <div class="k-group-avatar k-group-avatar--${['a','b','c','d'][idx % 4]}">${safeText(initials(person.name))}</div>
        <div>
          <p class="k-group-name">${safeText(person.name || 'Participant')}</p>
          <p class="k-group-status ${paid ? 'k-group-status--paid' : 'k-group-status--pending'}">${paid ? '✓ Payé' : '⏳ En attente'}</p>
        </div>
      </div>
      <span class="k-group-amount">${safeText(amount)}</span>
    </div>`;
}

function cardHtml(group) {
  const open = group.status !== 'paid';
  const participants = (group.participants || []).slice(0, 4);
  return `
    <article class="k-group-card" data-group-id="${safeText(group.id)}">
      <div class="k-group-head">
        <div class="k-group-title">${safeText(group.title || 'Panier collectif')}</div>
        ${statusPill(group.status)}
      </div>
      <p class="k-group-date">📅 ${safeText(group.dateLabel || 'En cours')}</p>
      ${open ? '<p class="k-group-open-hint">Lien prêt à partager. Les proches paient leur part.</p>' : ''}
      <div class="k-group-participants">
        <p class="k-group-label">Participants</p>
        ${participants.map(participantHtml).join('')}
      </div>
      <div class="k-group-bottom">
        <div>
          <p class="k-group-total-label">Total collecté</p>
          <p class="k-group-total">${fmt(Number(group.total) || 0, 'KMF')}</p>
        </div>
        <div class="k-group-actions">
          ${open ? `
            <button type="button" class="k-group-action" data-group-copy title="Copier le lien">🔗</button>
            <button type="button" class="k-group-action k-group-action--danger" data-group-close title="Clôturer">🔒</button>
          ` : `
            <button type="button" class="k-group-action" data-group-detail title="Voir le détail">👁️</button>
          `}
        </div>
      </div>
    </article>`;
}

function renderGroups() {
  const body = document.getElementById('k-group-cart-body');
  if (!body) return;
  const groups = getGroups();
  updateBadge();

  if (!groups.length) {
    body.innerHTML = `
      <div class="k-group-empty">
        <div class="k-group-empty-icon">👥</div>
        <p class="k-group-empty-title">Aucun groupe</p>
        <p class="k-group-empty-sub">Ajoutez des produits au panier, puis lancez un paiement en groupe.</p>
        <button type="button" class="k-group-empty-btn" data-group-back-cart>Voir mon panier</button>
      </div>`;
    return;
  }

  body.innerHTML = groups.map(cardHtml).join('');
}

function updateBadge() {
  const badge = document.getElementById('k-cart-groups-badge');
  if (!badge) return;
  const n = groupCount();
  badge.textContent = String(n);
  badge.style.display = n > 0 ? 'inline-flex' : 'none';
}

function addGroupFromShare(detail) {
  const groups = loadGroups().filter(g => !String(g.id).startsWith('demo-'));
  const total = cartTotal();
  const title = detail?.label || 'Panier collectif';
  const url = detail?.url || window.location.href;

  const group = {
    id: 'grp-' + Date.now(),
    title,
    status: 'open',
    dateLabel: 'Clôture le ' + todayLabel(3),
    total: 0,
    url,
    participants: [
      { name: 'Moi', status: 'pending', amount: total || null }
    ]
  };

  saveGroups([group].concat(groups));
  updateBadge();
  setActiveTab('groups');
}

function bindActions() {
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-group-back-cart]')) {
      setActiveTab('cart');
      return;
    }

    const card = e.target.closest('.k-group-card');
    if (!card) return;
    const id = card.dataset.groupId;
    const groups = getGroups();
    const group = groups.find(g => String(g.id) === String(id));
    if (!group) return;

    if (e.target.closest('[data-group-copy]')) {
      try {
        await navigator.clipboard.writeText(group.url || window.location.href);
        showToast('Lien copié', 'success');
      } catch (_) {
        showToast('Copie impossible', 'error');
      }
      return;
    }

    if (e.target.closest('[data-group-close]')) {
      group.status = 'paid';
      group.dateLabel = 'Clôturé le ' + todayLabel(0);
      saveGroups(groups);
      renderGroups();
      showToast('Groupe clôturé', 'success');
      return;
    }

    if (e.target.closest('[data-group-detail]')) {
      showToast('Détail du groupe', 'success');
    }
  });

  window.addEventListener('kmrc:group-cart-created', (e) => addGroupFromShare(e.detail || {}));
}

function patchFetchForShareCreation() {
  if (window.__kmrcGroupSharePatch) return;
  window.__kmrcGroupSharePatch = true;

  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;

  window.fetch = async function(input, init) {
    const res = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/api/shares') && init?.body) {
        const payload = JSON.parse(init.body);
        if (payload?.type === 'event') {
          const clone = res.clone();
          clone.json().then(data => {
            window.dispatchEvent(new CustomEvent('kmrc:group-cart-created', {
              detail: { label: payload.event_label, url: data?.url || data?.share_url }
            }));
          }).catch(() => {});
        }
      }
    } catch (_) {}
    return res;
  };
}

export function setupCartGroupsTab() {
  if (installed) return;
  installed = true;
  ensureCss();
  ensureTabs();
  updateBadge();
  bindActions();
  patchFetchForShareCreation();

  // Si l'organisateur vient de créer un groupe, on l'envoie directement ici.
  window.addEventListener('kmrc:group-cart-created', () => {
    ensureTabs();
    setActiveTab('groups');
  });
}
