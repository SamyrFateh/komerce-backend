/**
 * KOMERCE — API Client JS v2.0
 * Spec v7.1 · Mars 2026
 *
 * Modules :
 *   1. Produits (catalogue dynamique depuis API)
 *   2. Suivi commande (7 statuts v7.1)
 *   3. Panier (ajout, quantité, suppression, total, couture)
 *   4. Panier partagé (K-XXXX · 7 jours)
 *   5. Checkout (diaspora 4 champs / local 3 champs)
 *   6. Commande (création API par article)
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════

const KOMERCE_API = 'https://komerce-backend-production.up.railway.app';

// Taux de change MVP (révision mensuelle)
const TAUX = { AED: 138, EUR: 492 };

// Catégories avec service couture disponible
const COUTURE_CATS = ['vetements', 'ceremonie', 'vêtements', 'tenues', 'wax'];

// Images de fallback par catégorie (utilisées quand image_url est null en DB)
const CATEGORY_IMAGES = {
  electronique:  'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400&q=75',
  telephones:    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400&q=75',
  mariage:       'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=400&q=75',
  ceremonie:     'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=400&q=75',
  vetements:     'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=400&q=75',
  maison:        'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=75',
  cuisine:       'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=75',
  wax:           'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=400&q=75',
  default:       'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=400&q=75',
};

function getProductImage(p) {
  if (p.image_url) return p.image_url;
  const cat = (p.category || '').toLowerCase();
  for (const key of Object.keys(CATEGORY_IMAGES)) {
    if (key !== 'default' && cat.includes(key)) return CATEGORY_IMAGES[key];
  }
  return CATEGORY_IMAGES.default;
}

// ═══════════════════════════════════════════════════════════════════════
//  ÉTAT GLOBAL
// ═══════════════════════════════════════════════════════════════════════

let _token      = null;
let _relaisList = [];
let _cart       = [];          // [{ product, qty, couture }]
let _profil     = 'local';     // 'local' | 'diaspora'

// ═══════════════════════════════════════════════════════════════════════
//  UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);

function kmf(n) {
  return Number(n).toLocaleString('fr-FR') + ' KMF';
}

function eur(n) {
  return (n / TAUX.EUR).toFixed(0) + ' €';
}

async function apiGet(path) {
  try {
    const res = await fetch(KOMERCE_API + path, {
      headers: _token ? { Authorization: 'Bearer ' + _token } : {}
    });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

async function apiPost(path, body) {
  try {
    const res = await fetch(KOMERCE_API + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(_token ? { Authorization: 'Bearer ' + _token } : {})
      },
      body: JSON.stringify(body)
    });
    return res.json();
  } catch (e) { return { error: e.message }; }
}

function toast(msg, type = 'info') {
  // Supprimer toast précédent
  document.querySelectorAll('.kmrc-toast').forEach(el => el.remove());
  const el = document.createElement('div');
  el.className = 'kmrc-toast';
  el.style.cssText = `
    position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(0);
    background:${type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1a3a5c'};
    color:#fff;padding:12px 24px;border-radius:100px;font-size:.88rem;
    font-weight:700;z-index:10001;box-shadow:0 4px 20px rgba(0,0,0,.25);
    white-space:nowrap;transition:opacity .3s;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2800);
}

// ═══════════════════════════════════════════════════════════════════════
//  1. PRODUITS
// ═══════════════════════════════════════════════════════════════════════

async function loadProducts() {
  // Web → .promo-grid  |  PWA → .promo-row
  const grid  = document.querySelector('.promo-grid');
  const row   = document.querySelector('.promo-row');
  const container = grid || row;
  if (!container) return;

  const isPWA = !!row && !grid;

  // Afficher un loader pendant le chargement
  container.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:2rem;color:#94a3b8;">
      <div style="font-size:1.5rem;margin-bottom:.5rem;opacity:.5;">⏳</div>
      <div style="font-size:.85rem;">Chargement des produits…</div>
    </div>`;

  const data = await apiGet('/api/products?limit=8');
  if (!data || data.error || !data.products?.length) {
    // Remettre les cartes statiques en état fonctionnel
    container.innerHTML = container.innerHTML; // ne rien écraser — les onclick data-product sont déjà là
    wireStaticButtons();
    return;
  }

  const products = data.products;

  container.innerHTML = products.map(p => {
    const promo    = p.promo_pct ? Math.round(p.promo_pct) : null;
    const stock    = p.stock ?? 99;
    const pData    = JSON.stringify(p).replace(/"/g, '&quot;');
    const needSize = COUTURE_CATS.some(c => (p.category || '').toLowerCase().includes(c));

    if (isPWA) {
      // ── Carte PWA (.promo-card-m) ──
      return `
        <div class="promo-card-m" data-product-id="${p.id}"
          onclick="event.stopPropagation();openProduct(JSON.parse(this.dataset.pp))" data-pp="${pData}"
          style="cursor:pointer;">
          <div class="promo-card-m-img">
            <img src="${getProductImage(p)}" alt="${p.name}"
              style="width:100%;height:100%;object-fit:cover;display:block;"
              onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span style=\\'display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:2.8rem;\\'>${p.emoji || '📦'}</span>')"
            ${promo ? `<span class="pct-badge">−${promo}%</span>` : ''}
            ${needSize ? `<span style="position:absolute;bottom:.3rem;left:.3rem;
              background:#1a3a5c;color:#fff;font-size:.6rem;font-weight:700;
              padding:1px 6px;border-radius:10px;">✂️ Tailles dispo</span>` : ''}
          </div>
          <div class="promo-card-m-body">
            <div class="pm-name">${p.name}</div>
            <div class="pm-kmf">${kmf(p.price_kmf)}
              <span style="font-size:.7rem;color:#94a3b8;"> ≈ ${eur(p.price_kmf)}</span>
            </div>
            ${stock < 5 ? `<div style="color:#dc2626;font-size:.7rem;font-weight:700;">
              ⚠️ Plus que ${stock}</div>` : ''}
            <div style="display:flex;gap:.4rem;margin-top:.4rem;">
              <button class="pm-btn"
                onclick="event.stopPropagation();addToCart(JSON.parse(this.dataset.p))"
                data-p="${pData}"
                style="flex:1;">
                🛒 Ajouter
              </button>
              <button
                onclick="event.stopPropagation();quickOrder(JSON.parse(this.dataset.p))"
                data-p="${pData}"
                title="Commander maintenant"
                style="padding:.45rem .6rem;background:none;border:1.5px solid #1a3a5c;
                       border-radius:8px;cursor:pointer;font-size:.85rem;">
                ⚡
              </button>
            </div>
          </div>
        </div>`;
    } else {
      // ── Carte Web (.promo-card) ──
      return `
        <div class="promo-card" data-product-id="${p.id}"
          onclick="event.stopPropagation();openProduct(JSON.parse(this.dataset.pp))" data-pp="${pData}"
          style="cursor:pointer;">
          <div class="promo-card-img">
            <img src="${getProductImage(p)}" alt="${p.name}"
              style="width:100%;height:100%;object-fit:cover;display:block;position:absolute;inset:0;"
              onerror="this.style.display='none'">
            <span style="display:none;align-items:center;justify-content:center;
                   width:100%;height:100%;font-size:3rem;">${p.emoji || '📦'}</span>
            ${promo ? `<div class="promo-badge">−${promo}%</div>` : ''}
            ${needSize ? `<div style="position:absolute;top:.5rem;left:.5rem;background:#1a3a5c;
              color:#fff;font-size:.65rem;font-weight:700;padding:2px 8px;border-radius:20px;">
              ✂️ Tailles dispo</div>` : ''}
          </div>
          <div class="promo-card-body">
            <div class="promo-card-name">${p.name}</div>
            <div class="promo-card-cat">${p.category || ''}</div>
            <div class="promo-prices" style="margin:.4rem 0;">
              <span class="promo-price-now">${kmf(p.price_kmf)}</span>
              <span style="font-size:.75rem;color:#64748b;margin-left:.4rem;">${eur(p.price_kmf)}</span>
            </div>
            ${stock < 5 ? `<div style="color:#dc2626;font-size:.75rem;font-weight:700;
              margin-bottom:.4rem;">⚠️ Plus que ${stock} en stock</div>` : ''}
            <div style="display:flex;gap:.5rem;margin-top:.6rem;">
              <button
                onclick="event.stopPropagation();addToCart(JSON.parse(this.dataset.p))"
                data-p="${pData}"
                class="btn-order"
                style="flex:1;display:flex;align-items:center;justify-content:center;gap:.4rem;">
                🛒 Ajouter
              </button>
              <button
                onclick="event.stopPropagation();quickOrder(JSON.parse(this.dataset.p))"
                data-p="${pData}"
                title="Commander maintenant"
                style="padding:.55rem .75rem;background:none;border:2px solid #1a3a5c;
                       border-radius:8px;cursor:pointer;font-size:.9rem;">
                ⚡
              </button>
            </div>
          </div>
        </div>`;
    }
  }).join('');
}

// Câble les boutons des cartes statiques (HTML codé en dur) si l'API est indisponible.
// Lit le data-product du parent .promo-card ou .promo-card-m.
function wireStaticButtons() {
  document.querySelectorAll('.btn-order, .pm-btn').forEach(btn => {
    if (btn.onclick) return;
    const card = btn.closest('[data-product]');
    if (!card) return;
    try {
      const p = JSON.parse(card.dataset.product);
      btn.onclick = (e) => { e.stopPropagation(); addToCart(p); };
    } catch (e) { /* ignorer */ }
  });

  // Wirer clic carte -> openProduct (cartes statiques HTML)
  document.querySelectorAll('[data-product]').forEach(card => {
    if (card.dataset.productWired) return;
    card.dataset.productWired = '1';
    try {
      const p = JSON.parse(card.dataset.product);
      card.style.cursor = 'pointer';
      card.onclick = () => openProduct(p);
    } catch (e) { /* ignorer */ }
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  1b. FICHE PRODUIT — MODALE
// ═══════════════════════════════════════════════════════════════════════

function openProduct(product) {
  const p = product;
  document.getElementById('kmrc-product-modal')?.remove();

  const needSize  = COUTURE_CATS.some(c => (p.category || '').toLowerCase().includes(c));
  const promo     = p.promo_pct ? Math.round(p.promo_pct) : null;
  const stock     = p.stock ?? 99;
  const img       = getProductImage(p);
  const catColors = { vetements:'#7c3aed', ceremonie:'#be185d', maison:'#0891b2',
                      electronique:'#0369a1', beaute:'#db2777', parfum:'#7c3aed',
                      cuisine:'#d97706', wax:'#b45309' };
  const cat       = (p.category || '').toLowerCase();
  const pillKey   = Object.keys(catColors).find(k => cat.includes(k));
  const pillColor = pillKey ? catColors[pillKey] : '#4a5568';
  const pillBg    = pillKey ? pillColor + '15' : '#f0f4f8';
  const pData     = JSON.stringify(p).replace(/"/g, '&quot;');

  const PSIZES = ['XS','S','M','L','XL','XXL','XXXL'];

  const modal = document.createElement('div');
  modal.id = 'kmrc-product-modal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(4px);
    z-index:10200;display:flex;align-items:center;justify-content:center;
    padding:1rem;animation:kmrcFadeIn .2s ease;
  `;

  modal.innerHTML = `
    <div style="
      background:#fff;border-radius:20px;width:100%;max-width:680px;
      max-height:90vh;overflow-y:auto;
      animation:kmrcSlideUp .25s ease;
    ">
      <button onclick="document.getElementById('kmrc-product-modal').remove()"
        style="float:right;margin:.8rem .8rem 0 0;
               background:rgba(0,0,0,.07);border:none;border-radius:50%;
               width:34px;height:34px;cursor:pointer;font-size:1rem;
               display:flex;align-items:center;justify-content:center;
               color:#4a5568;">✕</button>

      <div style="display:flex;flex-wrap:wrap;gap:1.4rem;padding:1.4rem 1.6rem 1.2rem;clear:both;">

        <div style="flex:0 0 auto;width:min(220px,100%);position:relative;">
          <div style="border-radius:14px;overflow:hidden;background:#f0f4f8;
                      aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;">
            <img src="${img}" alt="${p.name}"
              style="width:100%;height:100%;object-fit:cover;display:block;"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <span style="display:none;align-items:center;justify-content:center;
                         width:100%;height:100%;font-size:4rem;">${p.emoji || '📦'}</span>
          </div>
          ${promo ? `<div style="position:absolute;top:.7rem;left:.7rem;
            background:#dc2626;color:#fff;font-size:.75rem;font-weight:800;
            padding:.25rem .7rem;border-radius:20px;">−${promo}%</div>` : ''}
          ${stock < 5 ? `<div style="position:absolute;bottom:.7rem;left:.7rem;
            background:#dc2626;color:#fff;font-size:.7rem;font-weight:700;
            padding:.2rem .6rem;border-radius:12px;">⚠️ ${stock} restants</div>` : ''}
        </div>

        <div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:.75rem;">
          <div>
            <span style="font-size:.72rem;font-weight:700;padding:.25rem .75rem;border-radius:20px;
              background:${pillBg};color:${pillColor};border:1px solid ${pillColor}30;">
              ${p.category || 'Produit'}
            </span>
          </div>
          <h2 style="font-size:1.15rem;font-weight:800;color:#1a3a5c;margin:0;line-height:1.3;">
            ${p.name}
          </h2>
          <div style="display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap;">
            <span style="font-size:1.3rem;font-weight:900;color:#e8a020;">${kmf(p.price_kmf)}</span>
            <span style="font-size:.88rem;color:#94a3b8;">≈ ${eur(p.price_kmf)}</span>
          </div>
          <p style="font-size:.87rem;color:#4a5568;line-height:1.65;margin:0;">
            ${p.description || ((p.emoji || '📦') + ' ' + (p.category ? 'Catégorie : ' + p.category : 'Produit Komerce'))}
          </p>

          ${needSize ? `
          <div id="kmrc-prod-size-wrap">
            <div style="font-size:.72rem;font-weight:700;color:#64748b;
                        text-transform:uppercase;letter-spacing:.06em;margin-bottom:.5rem;">
              Taille <span id="kmrc-prod-size-warn" style="color:#dc2626;">*</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:.35rem;">
              ${PSIZES.map(s => `
                <button onclick="event.stopPropagation();_selectProductSize('${s}')"
                  id="kmrc-psize-${s}"
                  style="padding:.3rem .65rem;border-radius:7px;cursor:pointer;
                         font-size:.8rem;font-weight:700;border:1.5px solid #e2e8f0;
                         background:#fff;color:#64748b;transition:all .12s;">${s}</button>`).join('')}
            </div>
          </div>` : ''}

          <div style="display:flex;gap:.7rem;margin-top:.25rem;flex-wrap:wrap;">
            <button onclick="event.stopPropagation();_addFromProductModal(${pData})"
              style="flex:1;min-width:130px;padding:.75rem 1rem;
                     background:linear-gradient(135deg,#14532d,#16a34a);
                     color:#fff;border:none;border-radius:12px;
                     font-size:.88rem;font-weight:800;cursor:pointer;">
              🛒 Ajouter au panier
            </button>
            <button onclick="event.stopPropagation();_quickFromProductModal(${pData})"
              style="padding:.75rem 1.1rem;background:linear-gradient(135deg,#1a3a5c,#2563eb);
                     color:#fff;border:none;border-radius:12px;
                     font-size:.88rem;font-weight:800;cursor:pointer;">
              ⚡ Commander
            </button>
          </div>
        </div>
      </div>

      <div style="border-top:1px solid #f0f4f8;padding:1.2rem 1.6rem 1.6rem;">
        <div style="font-size:.78rem;font-weight:800;color:#1a3a5c;
                    text-transform:uppercase;letter-spacing:.06em;margin-bottom:.9rem;">
          Produits similaires
        </div>
        <div id="kmrc-similar">
          <span style="color:#94a3b8;font-size:.82rem;">Chargement…</span>
        </div>
      </div>
    </div>
  `;

  window._kmrcProductSize = null;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  _loadSimilar(p, 'kmrc-similar');
}

function _selectProductSize(size) {
  window._kmrcProductSize = window._kmrcProductSize === size ? null : size;
  ['XS','S','M','L','XL','XXL','XXXL'].forEach(s => {
    const btn = document.getElementById('kmrc-psize-' + s);
    if (!btn) return;
    const active = s === window._kmrcProductSize;
    btn.style.borderColor = active ? '#1a3a5c' : '#e2e8f0';
    btn.style.background  = active ? '#1a3a5c' : '#fff';
    btn.style.color       = active ? '#fff'    : '#64748b';
  });
  const warn = document.getElementById('kmrc-prod-size-warn');
  if (warn) warn.style.display = window._kmrcProductSize ? 'none' : 'inline';
}

function _addFromProductModal(product) {
  const needSize = COUTURE_CATS.some(c => (product.category || '').toLowerCase().includes(c));
  if (needSize && !window._kmrcProductSize) {
    toast('⚠️ Choisissez une taille', 'error');
    const warn = document.getElementById('kmrc-prod-size-warn');
    if (warn) { warn.style.display = 'inline'; warn.style.color = '#dc2626'; }
    return;
  }
  const enriched = Object.assign({}, product);
  if (window._kmrcProductSize) enriched._selected_size = window._kmrcProductSize;
  addToCart(enriched);
}

function _quickFromProductModal(product) {
  const needSize = COUTURE_CATS.some(c => (product.category || '').toLowerCase().includes(c));
  if (needSize && !window._kmrcProductSize) {
    toast('⚠️ Choisissez une taille', 'error');
    return;
  }
  const enriched = Object.assign({}, product);
  if (window._kmrcProductSize) enriched._selected_size = window._kmrcProductSize;
  quickOrder(enriched);
  document.getElementById('kmrc-product-modal')?.remove();
}

async function _loadSimilar(product, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const data    = await apiGet('/api/products?category=' + encodeURIComponent(product.category || '') + '&limit=6');
  const all     = (data && data.products) ? data.products : [];
  // eslint-disable-next-line eqeqeq
  const similar = all.filter(p => p.id != product.id).slice(0, 4);

  if (similar.length === 0) {
    container.innerHTML = '<span style="color:#94a3b8;font-size:.82rem;">Aucun produit similaire trouvé.</span>';
    return;
  }

  container.innerHTML =
    '<div style="display:flex;gap:.8rem;overflow-x:auto;padding-bottom:.4rem;">' +
    similar.map(p => {
      const pd = JSON.stringify(p).replace(/"/g, '&quot;');
      return `<div onclick="openProduct(JSON.parse(this.dataset.pp))" data-pp="${pd}"
        style="flex:0 0 140px;border:1.5px solid #e2e8f0;border-radius:12px;
               overflow:hidden;cursor:pointer;background:#fff;
               transition:box-shadow .15s,transform .15s;"
        onmouseenter="this.style.boxShadow='0 4px 16px rgba(26,58,92,.12)';this.style.transform='translateY(-2px)'"
        onmouseleave="this.style.boxShadow='none';this.style.transform='translateY(0)'">
        <div style="height:90px;overflow:hidden;background:#f0f4f8;
                    display:flex;align-items:center;justify-content:center;">
          <img src="${getProductImage(p)}" alt="${p.name}"
            style="width:100%;height:100%;object-fit:cover;display:block;"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span style="display:none;align-items:center;justify-content:center;
                       width:100%;height:100%;font-size:2.5rem;">${p.emoji || '📦'}</span>
        </div>
        <div style="padding:.55rem .65rem;">
          <div style="font-size:.76rem;font-weight:700;color:#1a3a5c;
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
          <div style="font-size:.72rem;color:#e8a020;font-weight:700;margin:.2rem 0;">${kmf(p.price_kmf)}</div>
          <button onclick="event.stopPropagation();addToCart(JSON.parse(this.dataset.pp))" data-pp="${pd}"
            style="width:100%;padding:.3rem;background:#1a3a5c;color:#fff;
                   border:none;border-radius:7px;font-size:.72rem;font-weight:700;cursor:pointer;">
            🛒 Ajouter
          </button>
        </div>
      </div>`;
    }).join('') +
    '</div>';
}

// ═══════════════════════════════════════════════════════════════════════
//  2. TRACKING — 7 STATUTS v7.1
// ═══════════════════════════════════════════════════════════════════════

const STEPS = [
  { code: 'ordered',         icon: '✅', label: 'Commandé',       desc: 'Commande confirmée' },
  { code: 'purchasing',      icon: '🛒', label: 'En achat',       desc: 'Article en cours d\'achat au hub' },
  { code: 'preparation',     icon: '📦', label: 'Préparation',    desc: 'Colis emballé et prêt — Hub Dubai' },
  { code: 'shipped',         icon: '🚢', label: 'Expédié',        desc: 'En transit maritime (3–5 semaines)' },
  { code: 'transit_comores', icon: '🏝️', label: 'Arrivé Comores', desc: 'Dédouanement en cours — Mutsamudu' },
  { code: 'available',       icon: '🏪', label: 'Disponible',     desc: 'Prêt à retirer au point relais' },
  { code: 'collected',       icon: '🎉', label: 'Remis',          desc: 'Remis au destinataire — Merci !' },
];

function initTracking() {
  const section = document.getElementById('suivi');
  if (!section) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'max-width:520px;margin:0 auto 2rem;';
  wrap.innerHTML = `
    <div style="display:flex;gap:.6rem;">
      <input id="tracking-ref-input" type="text"
        placeholder="Votre référence KOM-2026-XXXX"
        style="flex:1;padding:.85rem 1.2rem;border:2px solid #e2e8f0;border-radius:10px;
               font-size:.95rem;outline:none;transition:border .2s;"
        onfocus="this.style.borderColor='#1a3a5c'"
        onblur="this.style.borderColor='#e2e8f0'" />
      <button onclick="searchTracking()"
        style="background:#1a3a5c;color:#fff;border:none;border-radius:10px;
               padding:.85rem 1.4rem;font-weight:700;cursor:pointer;white-space:nowrap;">
        Suivre →
      </button>
    </div>
    <div id="tracking-result" style="margin-top:1.2rem;"></div>
  `;

  const sub = section.querySelector('.section-sub');
  if (sub) sub.after(wrap); else section.prepend(wrap);
}

async function searchTracking() {
  const input  = $('tracking-ref-input');
  const result = $('tracking-result');
  if (!input || !result) return;

  const ref = input.value.trim().toUpperCase();
  if (!ref) { toast('Entrez votre référence commande', 'error'); return; }

  result.innerHTML = '<p style="text-align:center;color:#64748b;padding:1rem;">Recherche…</p>';

  const data = await apiGet(`/api/orders/${ref}/tracking`);

  if (!data || data.error) {
    result.innerHTML = `
      <div style="text-align:center;padding:1.2rem;background:#fef2f2;border-radius:10px;color:#dc2626;">
        Commande introuvable. Vérifiez votre référence.
      </div>`;
    return;
  }

  const curIdx = STEPS.findIndex(s => s.code === data.status);

  const stepsHtml = STEPS.map((s, i) => {
    const done   = i < curIdx;
    const active = i === curIdx;
    const dot    = done   ? 'background:#16a34a;color:#fff;'
                 : active ? 'background:#1a3a5c;color:#fff;box-shadow:0 0 0 4px rgba(26,58,92,.15);'
                 :          'background:#e2e8f0;color:#94a3b8;';
    const line   = done ? '#16a34a' : '#e2e8f0';
    return `
      <div style="flex:1;text-align:center;position:relative;min-width:0;">
        ${i > 0 ? `<div style="position:absolute;top:16px;left:-50%;right:50%;
          height:2px;background:${line};z-index:0;"></div>` : ''}
        <div style="width:34px;height:34px;border-radius:50%;${dot}
          display:flex;align-items:center;justify-content:center;
          font-size:.82rem;font-weight:700;margin:0 auto 6px;position:relative;z-index:1;">
          ${done ? '✓' : s.icon}
        </div>
        <div style="font-size:.68rem;font-weight:${active ? '700' : '500'};
          color:${active ? '#1a3a5c' : done ? '#16a34a' : '#94a3b8'};line-height:1.2;">
          ${s.label}
        </div>
      </div>`;
  }).join('');

  const relaisHtml = data.relais ? `
    <div style="margin-top:1rem;padding:.9rem 1rem;background:#f8fafc;
                border-radius:10px;font-size:.83rem;color:#1a3a5c;">
      📍 <strong>${data.relais.name}</strong>
      ${data.relais.zone ? ` · ${data.relais.zone}` : ''}
      ${data.relais.hours ? ` · <span style="color:#64748b;">${data.relais.hours}</span>` : ''}
      ${data.pickup_code ? `<br>🔑 Code retrait : <strong style="letter-spacing:.1em;font-size:1rem;">
        ${data.pickup_code}</strong>` : ''}
    </div>` : '';

  const cur = STEPS[curIdx] || {};
  result.innerHTML = `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:1.4rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem;">
        <span style="font-weight:700;color:#1a3a5c;font-size:.95rem;">${ref}</span>
        <span style="background:${data.status === 'collected' ? '#dcfce7'
                                 : data.status === 'cancelled' ? '#fef2f2' : '#eff6ff'};
          color:${data.status === 'collected' ? '#16a34a'
                : data.status === 'cancelled' ? '#dc2626' : '#1a3a5c'};
          padding:.3rem .9rem;border-radius:20px;font-size:.78rem;font-weight:700;">
          ${cur.icon || ''} ${cur.label || data.status}
        </span>
      </div>
      <div style="display:flex;gap:0;overflow-x:auto;padding-bottom:.5rem;">${stepsHtml}</div>
      ${relaisHtml}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
//  3. PANIER — ÉTAT & LOGIQUE
// ═══════════════════════════════════════════════════════════════════════

function cartQty()   { return _cart.reduce((s, i) => s + i.qty, 0); }
function cartTotal() { return _cart.reduce((s, i) => s + i.product.price_kmf * i.qty, 0); }

function hasCoutureProduct(p) {
  return COUTURE_CATS.some(c => (p.category || '').toLowerCase().includes(c));
}

function addToCart(product, initialQty) {
  // eslint-disable-next-line eqeqeq
  const existing = _cart.find(i => i.product.id == product.id);
  if (existing) {
    existing.qty += (initialQty || 1);
  } else {
    _cart.push({ product, qty: initialQty || 1, size: null }); // size: null = pas de taille choisie
  }
  refreshCartBadge();
  // Feedback visuel — icône panier
  const btn = document.querySelector(`[data-product-id="${product.id}"] .btn-order`);
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Ajouté !';
    btn.style.background = '#16a34a';
    setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 1200);
  }
  toast(`${product.emoji || '📦'} ${product.name} ajouté`, 'success');
  // Afficher le mini-preview après ajout (pas le tiroir complet)
  setTimeout(() => _showCartPreview(), 300);
}

function removeFromCart(productId) {
  // eslint-disable-next-line eqeqeq
  _cart = _cart.filter(i => i.product.id != productId);
  refreshCartBadge();
  renderCartBody();
}

function setQty(productId, qty) {
  // eslint-disable-next-line eqeqeq
  const item = _cart.find(i => i.product.id == productId);
  if (!item) return;
  if (qty < 1) { removeFromCart(productId); return; }
  item.qty = qty;
  refreshCartBadge();
  renderCartBody();
}

function clearCart() {
  _cart = [];
  refreshCartBadge();
  renderCartBody();
}

// ═══════════════════════════════════════════════════════════════════════
//  3a. PANIER — BOUTON FLOTTANT
// ═══════════════════════════════════════════════════════════════════════

function initCartButton() {
  const btn = document.createElement('button');
  btn.id = 'kmrc-cart-btn';
  btn.onclick = openCart;
  btn.setAttribute('aria-label', 'Ouvrir le panier');
  btn.innerHTML = `
    <img src="images/avatar_panier.png" alt="Panier"
      style="width:42px;height:42px;border-radius:50%;object-fit:cover;
             border:2px solid rgba(255,255,255,0.3);display:block;"
      onerror="this.outerHTML='<span style=\\'font-size:1.4rem;\\'>🛒</span>'" />
    <span id="kmrc-cart-badge" style="
      display:none;position:absolute;top:-5px;right:-5px;
      background:#e74c3c;color:#fff;border-radius:50%;
      width:22px;height:22px;font-size:.7rem;font-weight:800;
      align-items:center;justify-content:center;border:2px solid #1a3a5c;">
      0
    </span>
  `;
  btn.style.cssText = `
    position:fixed;bottom:1.5rem;right:1.5rem;z-index:9990;
    width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;
    background:#1a3a5c;
    box-shadow:0 4px 20px rgba(26,58,92,.45);
    display:flex;align-items:center;justify-content:center;
    transition:transform .2s,box-shadow .2s;overflow:visible;
  `;
  btn.onmouseenter = () => {
    btn.style.transform = 'scale(1.1)';
    _showCartPreview();
  };
  btn.onmouseleave = () => {
    btn.style.transform = 'scale(1)';
    setTimeout(() => {
      const p = $('kmrc-cart-preview');
      if (p && !p.matches(':hover')) p.remove();
    }, 250);
  };
  document.body.appendChild(btn);
}

function _showCartPreview() {
  if ($('kmrc-cart-drawer')) return; // tiroir déjà ouvert
  $('kmrc-cart-preview')?.remove();
  if (_cart.length === 0) return;

  const preview = document.createElement('div');
  preview.id = 'kmrc-cart-preview';
  preview.onmouseleave = () => preview.remove();

  const lastItems = _cart.slice(-3).reverse(); // 3 derniers articles
  const total     = cartTotal();
  const n         = cartQty();

  preview.style.cssText = `
    position:fixed;bottom:5.5rem;right:1.5rem;z-index:9989;
    background:#fff;border-radius:16px;padding:1rem;width:260px;
    box-shadow:0 8px 32px rgba(26,58,92,.22);border:1px solid #f0f4f8;
    animation:kmrcPreviewIn .18s ease;
  `;
  preview.innerHTML = `
    <style>
      @keyframes kmrcPreviewIn {
        from { opacity:0; transform:translateY(8px) scale(.97); }
        to   { opacity:1; transform:translateY(0)   scale(1);   }
      }
    </style>
    <div style="font-size:.72rem;font-weight:800;color:#64748b;text-transform:uppercase;
                letter-spacing:.06em;margin-bottom:.7rem;">
      🛒 ${n} article${n > 1 ? 's' : ''} dans le panier
    </div>
    ${lastItems.map(({ product: p, qty }) => `
      <div style="display:flex;align-items:center;gap:.6rem;padding:.4rem 0;
                  border-bottom:1px solid #f8fafc;">
        <div style="width:36px;height:36px;border-radius:8px;overflow:hidden;
                    background:#f8fafc;display:flex;align-items:center;
                    justify-content:center;font-size:1.2rem;flex-shrink:0;">
          ${p.image_url
            ? `<img src="${p.image_url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='${p.emoji||'📦'}';">`
            : (p.emoji || '📦')}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:.78rem;font-weight:700;color:#1a3a5c;
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${p.name}
          </div>
          <div style="font-size:.72rem;color:#e8a020;font-weight:600;">
            ×${qty} · ${(p.price_kmf * qty / 492).toFixed(0)} €
          </div>
        </div>
      </div>
    `).join('')}
    ${_cart.length > 3 ? `<div style="font-size:.72rem;color:#94a3b8;text-align:center;padding:.4rem 0;">
      + ${_cart.length - 3} autre${_cart.length - 3 > 1 ? 's' : ''} article${_cart.length - 3 > 1 ? 's' : ''}
    </div>` : ''}
    <div style="margin-top:.8rem;padding-top:.7rem;border-top:2px solid #f0f4f8;
                display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:.7rem;color:#64748b;">Total</div>
        <div style="font-size:1rem;font-weight:900;color:#1a3a5c;">
          ${(total / 492).toFixed(0)} € <span style="font-size:.7rem;color:#94a3b8;font-weight:400;">≈ ${total.toLocaleString('fr-FR')} KMF</span>
        </div>
      </div>
      <button onclick="$('kmrc-cart-preview')?.remove();openCart();"
        style="background:#1a3a5c;color:#fff;border:none;border-radius:10px;
               padding:.55rem 1rem;font-size:.82rem;font-weight:700;cursor:pointer;">
        Voir →
      </button>
    </div>
  `;
  document.body.appendChild(preview);
}

function refreshCartBadge() {
  const badge = $('kmrc-cart-badge');
  const n     = cartQty();
  const total = cartTotal();

  // Badge flottant
  if (badge) {
    badge.textContent = n;
    badge.style.display = n > 0 ? 'flex' : 'none';
  }

  // Nav : badge count + total KMF sous l'icône
  const navCount = document.getElementById('cart-count');
  if (navCount) {
    navCount.textContent = n;
    navCount.style.display = n > 0 ? 'flex' : 'none';
  }
  // Afficher le total dans la nav si l'élément existe
  let navTotal = document.getElementById('cart-total-nav');
  if (!navTotal && n > 0) {
    // Créer l'élément total sous l'icône panier nav
    const cartIcon = document.querySelector('.cart-icon');
    if (cartIcon) {
      navTotal = document.createElement('div');
      navTotal.id = 'cart-total-nav';
      navTotal.style.cssText = `
        position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);
        background:#e8a020;color:#fff;font-size:.62rem;font-weight:800;
        padding:2px 6px;border-radius:10px;white-space:nowrap;pointer-events:none;
        box-shadow:0 2px 6px rgba(0,0,0,.2);
      `;
      cartIcon.style.position = 'relative';
      cartIcon.appendChild(navTotal);
    }
  }
  if (navTotal) {
    if (n > 0) {
      navTotal.textContent = (total / 492).toFixed(0) + ' €';
      navTotal.style.display = 'block';
    } else {
      navTotal.style.display = 'none';
    }
  }

  // Bounce animation sur bouton flottant + nav badge
  const btn = $('kmrc-cart-btn');
  if (btn && n > 0) {
    btn.style.transform = 'scale(1.18)';
    setTimeout(() => btn.style.transform = 'scale(1)', 220);
  }
  if (navCount && n > 0) {
    navCount.style.transform = 'scale(1.4)';
    setTimeout(() => navCount.style.transform = 'scale(1)', 220);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  3b. PANIER — TIROIR
// ═══════════════════════════════════════════════════════════════════════

function openCart() {
  // Toggle
  if ($('kmrc-cart-drawer')) { closeCart(); return; }

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'kmrc-cart-overlay';
  overlay.onclick = closeCart;
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9991;
    animation:kmrcFadeIn .2s ease;
  `;

  // Tiroir
  const drawer = document.createElement('div');
  drawer.id = 'kmrc-cart-drawer';
  drawer.style.cssText = `
    position:fixed;bottom:0;right:0;
    width:100%;max-width:440px;height:85vh;
    background:#fff;border-radius:20px 20px 0 0;
    z-index:9992;display:flex;flex-direction:column;
    box-shadow:0 -8px 40px rgba(0,0,0,.15);
    animation:kmrcSlideUp .3s ease;
  `;

  drawer.innerHTML = `
    <style>
      @keyframes kmrcFadeIn  { from{opacity:0}     to{opacity:1} }
      @keyframes kmrcSlideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
    </style>

    <!-- Poignée + En-tête -->
    <div style="padding:1rem 1.4rem .8rem;border-bottom:1px solid #f0f4f8;flex-shrink:0;">
      <div style="width:40px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto .8rem;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <span style="font-size:1.05rem;font-weight:800;color:#1a3a5c;">🛒 Mon panier</span>
          <span id="kmrc-cart-count"
            style="margin-left:.5rem;background:#f0f4f8;color:#64748b;
                   font-size:.75rem;font-weight:700;padding:2px 10px;border-radius:20px;">
          </span>
        </div>
        <div style="display:flex;gap:.5rem;align-items:center;">
          <button onclick="shareCart()"
            title="Partager le panier"
            style="background:#f0f4f8;border:none;border-radius:8px;
                   padding:.4rem .7rem;cursor:pointer;font-size:.8rem;color:#64748b;">
            🔗 Partager
          </button>
          <button onclick="closeCart()"
            style="background:none;border:none;font-size:1.4rem;cursor:pointer;
                   color:#64748b;line-height:1;">✕</button>
        </div>
      </div>
    </div>

    <!-- Liste articles -->
    <div id="kmrc-cart-body"
      style="flex:1;overflow-y:auto;padding:.6rem 1.4rem;">
    </div>

    <!-- Pied — total + CTA -->
    <div id="kmrc-cart-footer"
      style="padding:1rem 1.4rem 1.4rem;border-top:1px solid #f0f4f8;flex-shrink:0;">
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
  renderCartBody();
}

function closeCart() {
  $('kmrc-cart-overlay')?.remove();
  $('kmrc-cart-drawer')?.remove();
}

function renderCartBody() {
  const body    = $('kmrc-cart-body');
  const footer  = $('kmrc-cart-footer');
  const counter = $('kmrc-cart-count');
  if (!body) return;

  const n = cartQty();
  if (counter) counter.textContent = n + ' article' + (n > 1 ? 's' : '');

  // ── Panier vide ──
  if (_cart.length === 0) {
    body.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;color:#a0aec0;">
        <div style="font-size:3.5rem;margin-bottom:.8rem;opacity:.4;">🛒</div>
        <div style="font-weight:700;font-size:.95rem;margin-bottom:.4rem;">Votre panier est vide</div>
        <div style="font-size:.82rem;">Ajoutez des articles depuis la boutique</div>
        <button onclick="closeCart()"
          style="margin-top:1.2rem;background:#1a3a5c;color:#fff;border:none;
                 border-radius:10px;padding:.7rem 1.6rem;font-weight:700;cursor:pointer;">
          Voir les produits
        </button>
      </div>`;
    if (footer) footer.innerHTML = '';
    return;
  }

  // ── Articles ──
  const SIZES = ['XS','S','M','L','XL','XXL','XXXL'];

  body.innerHTML = _cart.map(({ product: p, qty, size }) => {
    const needsSize = hasCoutureProduct(p);
    const sizeWarn  = needsSize && !size;

    return `
    <div style="display:flex;gap:.8rem;padding:.9rem 0;
                border-bottom:1px solid #f8fafc;align-items:flex-start;">

      <!-- Image produit -->
      <div style="width:48px;height:48px;background:#f8fafc;border-radius:10px;
                  display:flex;align-items:center;justify-content:center;
                  font-size:1.6rem;flex-shrink:0;overflow:hidden;">
        ${p.image_url
          ? `<img src="${p.image_url}" alt="${p.name}"
               style="width:100%;height:100%;object-fit:cover;border-radius:10px;"
               onerror="this.style.display='none';this.nextSibling.style.display='flex'">
             <span style="display:none;align-items:center;justify-content:center;width:100%;height:100%;">${p.emoji || '📦'}</span>`
          : (p.emoji || '📦')
        }
      </div>

      <!-- Infos + contrôles -->
      <div style="flex:1;min-width:0;">
        <div style="font-size:.88rem;font-weight:700;color:#1a3a5c;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${p.name}
        </div>
        <div style="font-size:.8rem;color:#e8a020;font-weight:700;margin:.2rem 0;">
          ${kmf(p.price_kmf)} /u
          <span style="color:#94a3b8;font-weight:400;"> = ${kmf(p.price_kmf * qty)}</span>
        </div>

        ${needsSize ? `
        <!-- Sélecteur de taille -->
        <div style="margin-top:.4rem;">
          <div style="font-size:.7rem;color:#64748b;margin-bottom:.3rem;font-weight:600;">
            Taille ${sizeWarn ? '<span style="color:#dc2626;">*</span>' : ''}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:.3rem;">
            ${SIZES.map(s => `
              <button onclick="setSize('${p.id}', '${s}')"
                style="padding:.25rem .55rem;border-radius:6px;cursor:pointer;
                       font-size:.75rem;font-weight:700;transition:all .15s;
                       border:1.5px solid ${size===s ? '#1a3a5c' : '#e2e8f0'};
                       background:${size===s ? '#1a3a5c' : '#fff'};
                       color:${size===s ? '#fff' : '#64748b'};">
                ${s}
              </button>`).join('')}
          </div>
          ${size ? `
            <div style="margin-top:.3rem;font-size:.72rem;color:#16a34a;font-weight:600;">
              ✂️ Taille ${size} · Retouches locales incluses
            </div>` : `
            <div style="margin-top:.3rem;font-size:.72rem;color:#94a3b8;">
              Choisissez une taille — retouche locale incluse
            </div>`}
        </div>` : ''}

        <!-- Contrôles quantité -->
        <div style="display:flex;align-items:center;gap:.5rem;margin-top:.5rem;">
          <div style="display:flex;align-items:center;border:1.5px solid #e2e8f0;
                      border-radius:8px;overflow:hidden;">
            <button onclick="setQty('${p.id}', ${qty - 1})"
              style="width:30px;height:30px;border:none;background:#f8fafc;
                     cursor:pointer;font-size:1rem;font-weight:700;color:#4a5568;">−</button>
            <span style="width:28px;text-align:center;font-size:.9rem;
                          font-weight:700;color:#1a3a5c;">${qty}</span>
            <button onclick="setQty('${p.id}', ${qty + 1})"
              style="width:30px;height:30px;border:none;background:#f8fafc;
                     cursor:pointer;font-size:1rem;font-weight:700;color:#4a5568;">+</button>
          </div>
          <button onclick="removeFromCart('${p.id}')"
            style="background:#fef2f2;border:none;border-radius:8px;
                   width:30px;height:30px;cursor:pointer;color:#dc2626;font-size:.8rem;">
            🗑️
          </button>
        </div>
      </div>
    </div>`;
  }).join('');

  // ── Pied ──
  const total        = cartTotal();
  const nItems       = _cart.length;
  const hasRetouche  = _cart.some(i => hasCoutureProduct(i.product));   // article vêtement
  const missingSizes = _cart.filter(i => hasCoutureProduct(i.product) && !i.size).length;
  const isD          = _profil === 'diaspora';

  footer.innerHTML = `
    <!-- Infos livraison -->
    <div style="background:#f0f9ff;border-radius:10px;padding:.65rem 1rem;
                font-size:.77rem;color:#0369a1;margin-bottom:.75rem;display:flex;gap:.5rem;">
      <span>🚢</span>
      <span><strong>Livraison 3–5 semaines</strong> · prix tout compris
        ${hasRetouche ? ' · retouches locales incluses ✂️' : ''}</span>
    </div>

    ${missingSizes ? `
    <div style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:8px;
                padding:.55rem .9rem;font-size:.77rem;color:#92400e;
                margin-bottom:.7rem;display:flex;gap:.5rem;align-items:center;">
      <span>⚠️</span>
      <span>${missingSizes} article${missingSizes>1?'s vêtements n\'ont':' vêtement n\'a'} pas de taille sélectionnée</span>
    </div>` : ''}

    <!-- Toggle Pour moi / Pour ma famille -->
    <div style="display:flex;background:#f0f4f8;border-radius:10px;
                padding:3px;margin-bottom:.8rem;gap:3px;">
      <button id="kmrc-toggle-local"
        onclick="setProfil('local')"
        style="flex:1;padding:.55rem .4rem;border:none;border-radius:8px;cursor:pointer;
               font-size:.82rem;font-weight:700;transition:all .18s;
               background:${!isD ? '#fff' : 'transparent'};
               color:${!isD ? '#16a34a' : '#94a3b8'};
               box-shadow:${!isD ? '0 1px 4px rgba(0,0,0,.1)' : 'none'};">
        🏝️ Pour moi
      </button>
      <button id="kmrc-toggle-diaspora"
        onclick="setProfil('diaspora')"
        style="flex:1;padding:.55rem .4rem;border:none;border-radius:8px;cursor:pointer;
               font-size:.82rem;font-weight:700;transition:all .18s;
               background:${isD ? '#fff' : 'transparent'};
               color:${isD ? '#2563eb' : '#94a3b8'};
               box-shadow:${isD ? '0 1px 4px rgba(0,0,0,.1)' : 'none'};">
        ✈️ Ma famille
      </button>
    </div>

    <!-- Total -->
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:.4rem 0;margin-bottom:.7rem;border-top:2px solid #f0f4f8;">
      <div>
        <div style="font-size:.78rem;color:#64748b;">${nItems} produit${nItems>1?'s':''} · ${cartQty()} article${cartQty()>1?'s':''}</div>
        <div style="font-size:.72rem;color:#94a3b8;">≈ ${eur(total)}</div>
      </div>
      <div style="font-size:1.3rem;font-weight:800;color:#1a3a5c;">${kmf(total)}</div>
    </div>

    <!-- CTA Commander -->
    <button onclick="checkoutCart()"
      style="width:100%;border:none;border-radius:12px;padding:1rem;
             font-size:1rem;font-weight:800;cursor:pointer;letter-spacing:.02em;
             background:${isD
               ? 'linear-gradient(135deg,#1e40af,#2563eb)'
               : 'linear-gradient(135deg,#14532d,#16a34a)'};
             color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.18);">
      ${isD ? '✈️ Commander pour ma famille →' : '🛒 Commander →'}
    </button>

    <!-- Vider -->
    <button onclick="clearCart()"
      style="width:100%;background:none;border:none;color:#94a3b8;
             font-size:.75rem;cursor:pointer;margin-top:.4rem;padding:.3rem;">
      Vider le panier
    </button>
  `;
}

function setSize(productId, size) {
  // eslint-disable-next-line eqeqeq
  const item = _cart.find(i => i.product.id == productId);
  if (!item) return;
  item.size = item.size === size ? null : size; // deselect si re-clic
  renderCartBody();
}

function setProfil(p) {
  _profil = p;
  // Re-render uniquement le footer (plus léger)
  renderCartBody();
}

// ═══════════════════════════════════════════════════════════════════════
//  4. PANIER PARTAGÉ (K-XXXX · 7 jours)
// ═══════════════════════════════════════════════════════════════════════

function shareCart() {
  if (_cart.length === 0) { toast('Le panier est vide', 'error'); return; }

  // Encoder le panier dans un paramètre URL (MVP sans API persistance)
  const data = _cart.map(i => `${i.product.id}:${i.qty}`).join(',');
  const code = 'K-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const url  = `${window.location.origin}${window.location.pathname}?panier=${btoa(data)}&ref=${code}`;

  // Copier dans le presse-papier
  navigator.clipboard.writeText(url).then(() => {
    toast('🔗 Lien copié ! Valable 7 jours', 'success');
  }).catch(() => {
    // Fallback — afficher le lien
    showShareModal(url, code);
  });
}

function showShareModal(url, code) {
  const m = document.createElement('div');
  m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;
    display:flex;align-items:center;justify-content:center;padding:1rem;`;
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:1.8rem;max-width:420px;width:100%;">
      <h3 style="font-weight:800;color:#1a3a5c;margin:0 0 .4rem;">🔗 Partager ce panier</h3>
      <p style="font-size:.82rem;color:#64748b;margin:0 0 1rem;">Code : <strong>${code}</strong> · Valable 7 jours</p>
      <div style="display:flex;gap:.5rem;">
        <input value="${url}" readonly
          style="flex:1;padding:.7rem;border:2px solid #e2e8f0;border-radius:8px;
                 font-size:.78rem;color:#4a5568;" />
        <button onclick="navigator.clipboard.writeText('${url}').then(()=>this.textContent='✓')"
          style="background:#1a3a5c;color:#fff;border:none;border-radius:8px;
                 padding:.7rem 1rem;font-weight:700;cursor:pointer;">
          Copier
        </button>
      </div>
      <button onclick="this.closest('div[style]').remove()"
        style="width:100%;margin-top:.8rem;background:none;border:1.5px solid #e2e8f0;
               border-radius:8px;padding:.6rem;cursor:pointer;color:#64748b;">
        Fermer
      </button>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
}

// ═══════════════════════════════════════════════════════════════════════
//  5. CHECKOUT — CHOIX PROFIL
// ═══════════════════════════════════════════════════════════════════════

function checkoutCart() {
  if (_cart.length === 0) return;
  closeCart();
  // Utiliser le checkout diaspora-aware si disponible (Komerce_Web_refait)
  if (typeof window.openCheckout === 'function') {
    window.openCheckout();
  } else {
    openOrderForm(_profil, _cart);
  }
}

function quickOrder(product) {
  // Pré-remplir le panier avec cet article unique puis ouvrir le checkout
  _cart = [{ product, qty: 1, size: null }];
  refreshCartBadge();
  if (typeof window.openCheckout === 'function') {
    window.openCheckout();
  } else {
    openOrderForm(_profil, _cart);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  5b. CHECKOUT — FORMULAIRE
// ═══════════════════════════════════════════════════════════════════════

function openOrderForm(profil, items) {
  document.getElementById('kmrc-profil-modal')?.remove();
  document.getElementById('kmrc-form-modal')?.remove();

  const isDiaspora = profil === 'diaspora';
  const relaisOpts = _relaisList.length
    ? _relaisList.map(r =>
        `<option value="${r.id}">${r.name}${r.zone ? ' · ' + r.zone : ''}</option>`
      ).join('')
    : '<option value="">Aucun relais disponible</option>';

  const sizedItems  = items.filter(i => i.size);   // articles vêtements avec taille choisie
  const missingSizes = items.filter(i => hasCoutureProduct(i.product) && !i.size);

  const modal = document.createElement('div');
  modal.id = 'kmrc-form-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:1rem;`;

  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;max-width:460px;width:100%;
                max-height:92vh;overflow-y:auto;position:relative;
                animation:kmrcSlideUp .25s ease;">

      <!-- En-tête + switcher profil -->
      <div style="padding:1.2rem 1.4rem .9rem;border-bottom:1px solid #f0f4f8;
                  position:sticky;top:0;background:#fff;z-index:1;border-radius:20px 20px 0 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;">
          <span style="font-size:.95rem;font-weight:800;color:#1a3a5c;">Commander</span>
          <button onclick="document.getElementById('kmrc-form-modal').remove()"
            style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#94a3b8;">✕</button>
        </div>
        <!-- Toggle profil intégré dans le formulaire -->
        <div style="display:flex;background:#f0f4f8;border-radius:10px;padding:3px;gap:3px;">
          <button
            onclick="switchFormProfil('local',${JSON.stringify(items).replace(/"/g,'&quot;')})"
            style="flex:1;padding:.5rem;border:none;border-radius:8px;cursor:pointer;
                   font-size:.82rem;font-weight:700;transition:all .18s;
                   background:${!isDiaspora ? '#fff' : 'transparent'};
                   color:${!isDiaspora ? '#16a34a' : '#94a3b8'};
                   box-shadow:${!isDiaspora ? '0 1px 4px rgba(0,0,0,.1)' : 'none'};">
            🏝️ Pour moi
          </button>
          <button
            onclick="switchFormProfil('diaspora',${JSON.stringify(items).replace(/"/g,'&quot;')})"
            style="flex:1;padding:.5rem;border:none;border-radius:8px;cursor:pointer;
                   font-size:.82rem;font-weight:700;transition:all .18s;
                   background:${isDiaspora ? '#fff' : 'transparent'};
                   color:${isDiaspora ? '#2563eb' : '#94a3b8'};
                   box-shadow:${isDiaspora ? '0 1px 4px rgba(0,0,0,.1)' : 'none'};">
            ✈️ Ma famille
          </button>
        </div>
      </div>

      <form id="kmrc-order-form" onsubmit="submitOrder(event, ${JSON.stringify(items).replace(/"/g,'&quot;')})"
        style="padding:1.4rem 1.6rem;display:flex;flex-direction:column;gap:.9rem;">

        <input type="hidden" name="profil"        value="${profil}" />
        <input type="hidden" name="country"       value="${isDiaspora ? 'FR' : 'KM'}" />
        <input type="hidden" name="payment_mode"  value="${isDiaspora ? 'stripe' : 'cash_relais'}" />

        ${isDiaspora ? `
          <!-- Diaspora : vos coordonnées -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
            ${fld('full_name',  'Votre nom *',       'Prénom Nom',        'text', true)}
            ${fld('phone',      'Votre téléphone *',  '+33 6 xx xx xx xx', 'tel',  true)}
          </div>

          <div style="font-size:.82rem;font-weight:700;color:#1a3a5c;
                      padding-bottom:.2rem;border-bottom:1px solid #f0f4f8;">
            📍 Votre famille aux Comores
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
            ${fld('recipient_name',  'Nom *',       'Nom de famille',  'text', true)}
            ${fld('recipient_phone', 'Téléphone *', '+269 321 xx xx',  'tel',  true)}
          </div>

          <!-- Relais automatique s'il n'y en a qu'un, sinon choix -->
          ${_relaisList.length === 1
            ? `<input type="hidden" name="relais_id" value="${_relaisList[0].id}" />
               <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;
                           padding:.7rem 1rem;font-size:.83rem;color:#1a3a5c;">
                 📍 ${_relaisList[0].name}${_relaisList[0].zone ? ' · ' + _relaisList[0].zone : ''}
               </div>`
            : `<div>
                 <label style="font-size:.72rem;font-weight:700;color:#4a5568;
                   display:block;margin-bottom:.3rem;text-transform:uppercase;">
                   Point relais *
                 </label>
                 <select name="relais_id" required
                   style="width:100%;padding:.7rem 1rem;border:2px solid #e2e8f0;
                          border-radius:8px;font-size:.88rem;">
                   <option value="">Choisir un relais</option>
                   ${relaisOpts}
                 </select>
               </div>`
          }

          <div style="background:#eff6ff;border-radius:8px;padding:.7rem 1rem;
                      font-size:.82rem;color:#2563eb;font-weight:600;">
            💳 Paiement par carte bancaire (EUR)
          </div>

        ` : `
          <!-- Local : 3 champs -->
          ${fld('full_name', 'Votre nom *',      'Prénom Nom',     'text', true)}
          ${fld('phone',     'Votre téléphone *', '+269 321 xx xx', 'tel',  true)}

          ${_relaisList.length === 1
            ? `<input type="hidden" name="relais_id" value="${_relaisList[0].id}" />
               <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;
                           padding:.7rem 1rem;font-size:.83rem;color:#1a3a5c;">
                 📍 ${_relaisList[0].name}${_relaisList[0].zone ? ' · ' + _relaisList[0].zone : ''}
               </div>`
            : `<div>
                 <label style="font-size:.72rem;font-weight:700;color:#4a5568;
                   display:block;margin-bottom:.3rem;text-transform:uppercase;">
                   Point relais *
                 </label>
                 <select name="relais_id" required
                   style="width:100%;padding:.7rem 1rem;border:2px solid #e2e8f0;
                          border-radius:8px;font-size:.88rem;">
                   <option value="">Choisir un relais</option>
                   ${relaisOpts}
                 </select>
               </div>`
          }

          <div style="background:#f0fdf4;border-radius:8px;padding:.7rem 1rem;
                      font-size:.82rem;color:#16a34a;font-weight:600;">
            💵 Paiement cash à la récupération au relais
          </div>
        `}

        ${missingSizes.length ? `
          <div style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:8px;
                      padding:.65rem 1rem;font-size:.8rem;color:#92400e;">
            ⚠️ Taille manquante pour : ${missingSizes.map(i=>i.product.name).join(', ')}.
            <a href="javascript:document.getElementById('kmrc-form-modal').remove();openCart()"
               style="color:#92400e;font-weight:700;text-decoration:underline;">
              Retour au panier
            </a>
          </div>` : ''}

        ${sizedItems.length ? `
          <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:8px;
                      padding:.65rem 1rem;font-size:.8rem;color:#15803d;line-height:1.5;">
            ✂️ <strong>Retouches locales incluses</strong> — les tailles standards commandées
            seront ajustées par nos artisans locaux pour un rendu parfait.
          </div>` : ''}

        <!-- Résumé commande -->
        <div style="background:#f8fafc;border-radius:10px;padding:.9rem 1rem;">
          <div style="font-size:.78rem;font-weight:700;color:#4a5568;
                      text-transform:uppercase;margin-bottom:.5rem;">
            Récapitulatif
          </div>
          ${items.map(i => `
            <div style="display:flex;justify-content:space-between;
                        font-size:.83rem;padding:.25rem 0;color:#1a3a5c;">
              <span>${i.product.emoji || '📦'} ${i.product.name} ×${i.qty}
                ${i.size ? `<span style="font-size:.72rem;background:#e0f2fe;
                  color:#0369a1;border-radius:4px;padding:1px 5px;margin-left:.3rem;">
                  ${i.size}</span>` : ''}
              </span>
              <span style="font-weight:700;">${kmf(i.product.price_kmf * i.qty)}</span>
            </div>`
          ).join('')}
          <div style="display:flex;justify-content:space-between;
                      border-top:1.5px solid #e2e8f0;margin-top:.5rem;padding-top:.5rem;
                      font-weight:800;font-size:.92rem;color:#1a3a5c;">
            <span>Total</span>
            <span style="color:#e8a020;">
              ${kmf(items.reduce((s,i)=>s+i.product.price_kmf*i.qty,0))}
            </span>
          </div>
        </div>

        <button type="submit" id="kmrc-submit-btn"
          style="width:100%;background:linear-gradient(135deg,#1a3a5c,#2563eb);
                 color:#fff;border:none;border-radius:12px;padding:1rem;
                 font-size:1rem;font-weight:800;cursor:pointer;
                 box-shadow:0 4px 16px rgba(37,99,235,.3);">
          Confirmer ma commande →
        </button>

        <div id="kmrc-form-error"
          style="color:#dc2626;font-size:.83rem;text-align:center;display:none;"></div>

      </form>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// Helper champ formulaire
function fld(name, label, placeholder, type='text', required=false) {
  return `
    <div>
      <label style="font-size:.72rem;font-weight:700;color:#4a5568;
        display:block;margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.3px;">
        ${label}
      </label>
      <input name="${name}" type="${type}" ${required ? 'required' : ''}
        placeholder="${placeholder}"
        style="width:100%;padding:.75rem 1rem;border:2px solid #e2e8f0;
               border-radius:8px;font-size:.9rem;box-sizing:border-box;
               transition:border .2s;"
        onfocus="this.style.borderColor='#2563eb'"
        onblur="this.style.borderColor='#e2e8f0'" />
    </div>`;
}

// Changer de profil depuis le formulaire ouvert (recharge le formulaire)
function switchFormProfil(newProfil, items) {
  _profil = newProfil;
  openOrderForm(newProfil, items);
}

// ═══════════════════════════════════════════════════════════════════════
//  6. SOUMISSION COMMANDE
// ═══════════════════════════════════════════════════════════════════════

async function submitOrder(e, items) {
  e.preventDefault();
  const form  = e.target;
  const btn   = $('kmrc-submit-btn');
  const errEl = $('kmrc-form-error');
  const data  = Object.fromEntries(new FormData(form));

  btn.disabled = true;
  btn.textContent = 'Traitement en cours…';
  errEl.style.display = 'none';

  try {
    // ── Étape 1 : auth (auto-register ou login silencieux) ──
    if (!_token) {
      const reg = await apiPost('/api/auth/auto-register', {
        full_name: data.full_name,
        phone:     data.phone || undefined,
        email:     data.email || undefined,
        country:   data.country || 'KM',
      });

      if (reg?.token)  { _token = reg.token; }
      else { throw new Error(reg?.error || 'Erreur d\'authentification'); }
    }

    // ── Étape 2 : créer une commande par article ──
    const refs = [];
    for (const item of items) {
      const res = await apiPost('/api/orders', {
        product_id:               item.product.id,
        quantity:                 item.qty,
        relais_id:                data.relais_id || undefined,
        recipient_name:           data.recipient_name  || data.full_name,
        recipient_phone:          data.recipient_phone || data.phone,
        payment_mode:             data.payment_mode,
        confection_type:          item.size ? 'retouche_locale' : 'aucun',
        confection_instructions:  item.size ? `Taille ${item.size}` : undefined,
      });
      if (res?.error) throw new Error(res.error);
      const ref = res?.order?.reference || res?.reference;
      if (ref) refs.push(ref);
    }

    // ── Succès ──
    document.getElementById('kmrc-form-modal')?.remove();
    _cart = [];
    refreshCartBadge();
    showOrderSuccess(refs, data);

  } catch (err) {
    errEl.textContent = err.message || 'Erreur lors de la commande. Réessayez.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Confirmer ma commande →';
  }
}

function showOrderSuccess(refs, data) {
  const modal = document.createElement('div');
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;
    display:flex;align-items:center;justify-content:center;padding:1rem;`;

  const refsHtml = refs.length > 0
    ? refs.map(r => `
        <div style="background:#1a3a5c;color:#fff;border-radius:8px;
                    padding:.6rem 1.2rem;font-size:1.05rem;font-weight:800;
                    letter-spacing:.05em;text-align:center;">${r}</div>`
      ).join('')
    : `<div style="color:#64748b;font-size:.85rem;">Référence en cours de génération…</div>`;

  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:2rem;max-width:420px;width:100%;
                text-align:center;">
      <div style="font-size:3.5rem;margin-bottom:.8rem;">🎉</div>
      <h2 style="font-size:1.2rem;font-weight:800;color:#1a3a5c;margin:0 0 .4rem;">
        Commande confirmée !
      </h2>
      <p style="font-size:.85rem;color:#64748b;margin:0 0 1.4rem;line-height:1.5;">
        ${refs.length > 1 ? `${refs.length} commandes créées.` : 'Votre commande a été enregistrée.'}
        ${data.payment_mode === 'cash_relais'
          ? ' Présentez-vous au point relais avec votre référence pour payer et récupérer.'
          : ' Un lien de paiement par carte vous sera envoyé.'}
      </p>

      <div style="font-size:.78rem;font-weight:700;color:#4a5568;
                  text-transform:uppercase;margin-bottom:.6rem;">
        Vos références
      </div>
      <div style="display:flex;flex-direction:column;gap:.4rem;margin-bottom:1.4rem;">
        ${refsHtml}
      </div>

      <div style="background:#f0f9ff;border-radius:10px;padding:.8rem;
                  font-size:.8rem;color:#0369a1;margin-bottom:1.2rem;text-align:left;">
        📱 <strong>Suivi :</strong> Gardez votre référence pour suivre votre commande.
        Vous recevrez un SMS à chaque étape (7 statuts).
      </div>

      <button onclick="this.closest('div[style]').remove()"
        style="width:100%;background:#1a3a5c;color:#fff;border:none;
               border-radius:12px;padding:.9rem;font-weight:700;cursor:pointer;">
        Fermer
      </button>
    </div>`;

  document.body.appendChild(modal);
}

// ═══════════════════════════════════════════════════════════════════════
//  6b. CÉRÉMONIE — 3 types de commande
//      ready_made       : article prêt (Dubai) · taille + option retouche
//      fabric_only      : tissu au mètre/yard  · quantité (+ accessoires)
//      custom_from_fabric : confection sur tissu · taille + option retouche
// ═══════════════════════════════════════════════════════════════════════

const CEREMONY_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

// État local du module cérémonie
let _ceremonyState = {
  type: null,        // 'ready_made' | 'fabric_only' | 'custom_from_fabric'
  product: null,
  size: null,
  retouche: false,
  qty: 1,
  accessoires: [],
};

function openCeremony(product) {
  // Réinitialiser l'état
  _ceremonyState = { type: null, product, size: null, retouche: false, qty: 1, accessoires: [] };

  const modal = document.createElement('div');
  modal.id = 'kmrc-ceremony-modal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(4px);
    z-index:10100;display:flex;align-items:center;justify-content:center;
    padding:1rem;animation:fadeIn .2s ease;
  `;

  modal.innerHTML = `
    <div id="kmrc-ceremony-sheet" style="
      background:#fff;border-radius:20px;width:100%;max-width:520px;
      max-height:92vh;overflow-y:auto;padding:1.5rem 1.5rem 2rem;
      animation:slideUp .25s ease;
    ">
      <!-- Poignée -->
      <div style="width:40px;height:4px;background:#e2e8f0;border-radius:2px;
                  margin:0 auto 1.2rem;"></div>

      <!-- En-tête produit -->
      <div style="display:flex;gap:.8rem;align-items:center;margin-bottom:1.4rem;">
        <div style="width:52px;height:52px;background:#f0f4f8;border-radius:12px;
                    display:flex;align-items:center;justify-content:center;
                    font-size:1.8rem;flex-shrink:0;overflow:hidden;">
          ${product?.image_url
            ? `<img src="${product.image_url}" style="width:100%;height:100%;object-fit:cover;"
                 onerror="this.style.display='none'">`
            : (product?.emoji || '🪡')}
        </div>
        <div>
          <div style="font-weight:800;color:#1a3a5c;font-size:.95rem;">
            ${product?.name || 'Commande cérémonie'}
          </div>
          ${product?.price_kmf ? `
          <div style="font-size:.82rem;color:#e8a020;font-weight:700;">
            ${kmf(product.price_kmf)}
            <span style="color:#94a3b8;font-weight:400;font-size:.75rem;"> ≈ ${eur(product.price_kmf)}</span>
          </div>` : ''}
        </div>
        <button onclick="document.getElementById('kmrc-ceremony-modal').remove()"
          style="margin-left:auto;background:none;border:none;font-size:1.3rem;
                 cursor:pointer;color:#94a3b8;padding:.2rem;">✕</button>
      </div>

      <!-- Titre section -->
      <div style="font-size:.72rem;font-weight:700;color:#64748b;letter-spacing:.08em;
                  text-transform:uppercase;margin-bottom:.8rem;">
        Type de commande
      </div>

      <!-- 3 types -->
      <div style="display:flex;flex-direction:column;gap:.6rem;margin-bottom:1.5rem;">

        <!-- 1. ready_made -->
        <button onclick="_selectCeremonyType('ready_made')" id="ctype-ready_made"
          style="text-align:left;padding:.85rem 1rem;border-radius:12px;cursor:pointer;
                 border:2px solid #e2e8f0;background:#fff;transition:all .15s;width:100%;">
          <div style="display:flex;align-items:center;gap:.6rem;">
            <span style="font-size:1.3rem;">👗</span>
            <div>
              <div style="font-weight:700;color:#1a3a5c;font-size:.9rem;">Article prêt à porter</div>
              <div style="font-size:.75rem;color:#64748b;margin-top:.15rem;">
                Fabriqué à Dubaï · tailles standard · retouche possible aux Comores
              </div>
            </div>
          </div>
        </button>

        <!-- 2. fabric_only -->
        <button onclick="_selectCeremonyType('fabric_only')" id="ctype-fabric_only"
          style="text-align:left;padding:.85rem 1rem;border-radius:12px;cursor:pointer;
                 border:2px solid #e2e8f0;background:#fff;transition:all .15s;width:100%;">
          <div style="display:flex;align-items:center;gap:.6rem;">
            <span style="font-size:1.3rem;">🧵</span>
            <div>
              <div style="font-weight:700;color:#1a3a5c;font-size:.9rem;">Achat tissu</div>
              <div style="font-size:.75rem;color:#64748b;margin-top:.15rem;">
                Au mètre / yard · accessoires disponibles
              </div>
            </div>
          </div>
        </button>

        <!-- 3. custom_from_fabric -->
        <button onclick="_selectCeremonyType('custom_from_fabric')" id="ctype-custom_from_fabric"
          style="text-align:left;padding:.85rem 1rem;border-radius:12px;cursor:pointer;
                 border:2px solid #e2e8f0;background:#fff;transition:all .15s;width:100%;">
          <div style="display:flex;align-items:center;gap:.6rem;">
            <span style="font-size:1.3rem;">✂️</span>
            <div>
              <div style="font-weight:700;color:#1a3a5c;font-size:.9rem;">Confection sur tissu</div>
              <div style="font-size:.75rem;color:#64748b;margin-top:.15rem;">
                Choix tissu · taille standard · retouche possible
              </div>
            </div>
          </div>
        </button>
      </div>

      <!-- Zone formulaire dynamique -->
      <div id="kmrc-ceremony-form"></div>

      <!-- CTA -->
      <div id="kmrc-ceremony-cta" style="display:none;margin-top:1rem;">
        <button id="kmrc-ceremony-add-btn"
          onclick="_confirmCeremonyOrder()"
          style="width:100%;padding:.9rem;background:linear-gradient(135deg,#1a3a5c,#2563eb);
                 color:#fff;border:none;border-radius:12px;font-weight:800;
                 font-size:.95rem;cursor:pointer;">
          🛒 Ajouter au panier
        </button>
      </div>
    </div>
  `;

  // Styles animation (idempotent)
  if (!document.getElementById('kmrc-ceremony-styles')) {
    const s = document.createElement('style');
    s.id = 'kmrc-ceremony-styles';
    s.textContent = `
      @keyframes fadeIn  { from { opacity:0 } to { opacity:1 } }
      @keyframes slideUp { from { transform:translateY(40px);opacity:0 } to { transform:translateY(0);opacity:1 } }
    `;
    document.head.appendChild(s);
  }

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function _selectCeremonyType(type) {
  _ceremonyState.type = type;
  _ceremonyState.size = null;
  _ceremonyState.retouche = false;
  _ceremonyState.qty = 1;
  _ceremonyState.accessoires = [];

  // Highlight sélection
  ['ready_made', 'fabric_only', 'custom_from_fabric'].forEach(t => {
    const btn = document.getElementById('ctype-' + t);
    if (!btn) return;
    btn.style.borderColor   = t === type ? '#1a3a5c' : '#e2e8f0';
    btn.style.background    = t === type ? '#f0f4f8' : '#fff';
  });

  _renderCeremonyForm(type);
}

function _renderCeremonyForm(type) {
  const form = document.getElementById('kmrc-ceremony-form');
  const cta  = document.getElementById('kmrc-ceremony-cta');
  if (!form) return;

  // ── 1. ready_made ────────────────────────────────────────────────────
  if (type === 'ready_made') {
    form.innerHTML = `
      <!-- Taille -->
      <div style="margin-bottom:1rem;">
        <div style="font-size:.72rem;font-weight:700;color:#64748b;letter-spacing:.07em;
                    text-transform:uppercase;margin-bottom:.55rem;">
          Taille <span id="csize-warn" style="color:#dc2626;">*</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem;">
          ${CEREMONY_SIZES.map(s => `
            <button onclick="_setCeremonySize('${s}')" id="csize-${s}"
              style="padding:.35rem .7rem;border-radius:8px;cursor:pointer;font-size:.8rem;
                     font-weight:700;border:1.5px solid #e2e8f0;background:#fff;
                     color:#64748b;transition:all .12s;">
              ${s}
            </button>`).join('')}
        </div>
      </div>

      <!-- Retouche -->
      <div style="background:#f0f9ff;border-radius:10px;padding:.8rem 1rem;
                  display:flex;align-items:center;justify-content:space-between;cursor:pointer;"
           onclick="_toggleCeremonyRetouche()">
        <div>
          <div style="font-weight:700;color:#0369a1;font-size:.88rem;">✂️ Retouche aux Comores</div>
          <div style="font-size:.72rem;color:#0284c7;margin-top:.1rem;">Incluse · ajustement local à la livraison</div>
        </div>
        <div id="retouche-toggle" style="
          width:38px;height:22px;border-radius:11px;background:#e2e8f0;
          position:relative;transition:background .2s;flex-shrink:0;">
          <div id="retouche-thumb" style="
            position:absolute;top:3px;left:3px;width:16px;height:16px;
            border-radius:50%;background:#fff;transition:left .2s;
            box-shadow:0 1px 4px rgba(0,0,0,.2);"></div>
        </div>
      </div>
    `;
  }

  // ── 2. fabric_only ───────────────────────────────────────────────────
  else if (type === 'fabric_only') {
    form.innerHTML = `
      <!-- Quantité -->
      <div style="margin-bottom:1rem;">
        <div style="font-size:.72rem;font-weight:700;color:#64748b;letter-spacing:.07em;
                    text-transform:uppercase;margin-bottom:.55rem;">
          Quantité (mètres / yards)
        </div>
        <div style="display:flex;align-items:center;gap:.5rem;">
          <div style="display:flex;align-items:center;border:1.5px solid #e2e8f0;
                      border-radius:10px;overflow:hidden;">
            <button onclick="_setCeremonyQty(_ceremonyState.qty - 1)"
              style="width:38px;height:38px;border:none;background:#f8fafc;
                     cursor:pointer;font-size:1.1rem;font-weight:700;color:#4a5568;">−</button>
            <span id="cqty-display"
              style="width:44px;text-align:center;font-size:1rem;font-weight:800;color:#1a3a5c;">
              1
            </span>
            <button onclick="_setCeremonyQty(_ceremonyState.qty + 1)"
              style="width:38px;height:38px;border:none;background:#f8fafc;
                     cursor:pointer;font-size:1.1rem;font-weight:700;color:#4a5568;">+</button>
          </div>
          <span style="font-size:.8rem;color:#94a3b8;">m / yd</span>
        </div>
      </div>

      <!-- Accessoires -->
      <div style="margin-bottom:.5rem;">
        <div style="font-size:.72rem;font-weight:700;color:#64748b;letter-spacing:.07em;
                    text-transform:uppercase;margin-bottom:.55rem;">
          Accessoires (optionnel)
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem;">
          ${['Fil assorti', 'Doublure', 'Boutons', 'Fermeture éclair', 'Dentelle', 'Broderie'].map(a => `
            <button onclick="_toggleAccessoire('${a}')" id="acc-${a.replace(/ /g,'-')}"
              style="padding:.35rem .7rem;border-radius:8px;cursor:pointer;font-size:.78rem;
                     font-weight:600;border:1.5px solid #e2e8f0;background:#fff;
                     color:#64748b;transition:all .12s;">
              ${a}
            </button>`).join('')}
        </div>
      </div>
    `;
    cta.style.display = 'block';
  }

  // ── 3. custom_from_fabric ─────────────────────────────────────────────
  else if (type === 'custom_from_fabric') {
    form.innerHTML = `
      <!-- Tissu -->
      <div style="margin-bottom:1rem;">
        <div style="font-size:.72rem;font-weight:700;color:#64748b;letter-spacing:.07em;
                    text-transform:uppercase;margin-bottom:.55rem;">
          Type de tissu
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem;">
          ${['Wax', 'Dentelle', 'Mousseline', 'Soie', 'Coton', 'Bogolan'].map(t => `
            <button onclick="_selectTissu('${t}')" id="tissu-${t}"
              style="padding:.35rem .7rem;border-radius:8px;cursor:pointer;font-size:.8rem;
                     font-weight:700;border:1.5px solid #e2e8f0;background:#fff;
                     color:#64748b;transition:all .12s;">
              ${t}
            </button>`).join('')}
        </div>
      </div>

      <!-- Taille -->
      <div style="margin-bottom:1rem;">
        <div style="font-size:.72rem;font-weight:700;color:#64748b;letter-spacing:.07em;
                    text-transform:uppercase;margin-bottom:.55rem;">
          Taille <span id="csize-warn" style="color:#dc2626;">*</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem;">
          ${CEREMONY_SIZES.map(s => `
            <button onclick="_setCeremonySize('${s}')" id="csize-${s}"
              style="padding:.35rem .7rem;border-radius:8px;cursor:pointer;font-size:.8rem;
                     font-weight:700;border:1.5px solid #e2e8f0;background:#fff;
                     color:#64748b;transition:all .12s;">
              ${s}
            </button>`).join('')}
        </div>
      </div>

      <!-- Retouche -->
      <div style="background:#f0f9ff;border-radius:10px;padding:.8rem 1rem;
                  display:flex;align-items:center;justify-content:space-between;cursor:pointer;"
           onclick="_toggleCeremonyRetouche()">
        <div>
          <div style="font-weight:700;color:#0369a1;font-size:.88rem;">✂️ Retouche aux Comores</div>
          <div style="font-size:.72rem;color:#0284c7;margin-top:.1rem;">Incluse · ajustement local à la livraison</div>
        </div>
        <div id="retouche-toggle" style="
          width:38px;height:22px;border-radius:11px;background:#e2e8f0;
          position:relative;transition:background .2s;flex-shrink:0;">
          <div id="retouche-thumb" style="
            position:absolute;top:3px;left:3px;width:16px;height:16px;
            border-radius:50%;background:#fff;transition:left .2s;
            box-shadow:0 1px 4px rgba(0,0,0,.2);"></div>
        </div>
      </div>
    `;
  }

  // Afficher CTA pour les types avec taille obligatoire (masqué jusqu'à sélection)
  if (type === 'ready_made' || type === 'custom_from_fabric') {
    cta.style.display = 'none'; // affiché quand taille sélectionnée
  }
}

function _setCeremonySize(size) {
  _ceremonyState.size = size;
  CEREMONY_SIZES.forEach(s => {
    const btn = document.getElementById('csize-' + s);
    if (!btn) return;
    btn.style.borderColor = s === size ? '#1a3a5c' : '#e2e8f0';
    btn.style.background  = s === size ? '#1a3a5c' : '#fff';
    btn.style.color       = s === size ? '#fff'    : '#64748b';
  });
  const warn = document.getElementById('csize-warn');
  if (warn) warn.style.display = 'none';
  const cta = document.getElementById('kmrc-ceremony-cta');
  if (cta) cta.style.display = 'block';
}

function _setCeremonyQty(qty) {
  if (qty < 1) qty = 1;
  _ceremonyState.qty = qty;
  const el = document.getElementById('cqty-display');
  if (el) el.textContent = qty;
}

function _toggleCeremonyRetouche() {
  _ceremonyState.retouche = !_ceremonyState.retouche;
  const toggle = document.getElementById('retouche-toggle');
  const thumb  = document.getElementById('retouche-thumb');
  if (toggle) toggle.style.background = _ceremonyState.retouche ? '#0369a1' : '#e2e8f0';
  if (thumb)  thumb.style.left        = _ceremonyState.retouche ? '19px'   : '3px';
}

function _selectTissu(tissu) {
  _ceremonyState.tissu = tissu;
  ['Wax','Dentelle','Mousseline','Soie','Coton','Bogolan'].forEach(t => {
    const btn = document.getElementById('tissu-' + t);
    if (!btn) return;
    btn.style.borderColor = t === tissu ? '#e8a020' : '#e2e8f0';
    btn.style.background  = t === tissu ? '#fffbeb' : '#fff';
    btn.style.color       = t === tissu ? '#92400e' : '#64748b';
  });
}

function _toggleAccessoire(nom) {
  const idx = _ceremonyState.accessoires.indexOf(nom);
  if (idx === -1) _ceremonyState.accessoires.push(nom);
  else _ceremonyState.accessoires.splice(idx, 1);
  const btn = document.getElementById('acc-' + nom.replace(/ /g, '-'));
  const selected = _ceremonyState.accessoires.includes(nom);
  if (btn) {
    btn.style.borderColor = selected ? '#1a3a5c' : '#e2e8f0';
    btn.style.background  = selected ? '#f0f4f8' : '#fff';
    btn.style.color       = selected ? '#1a3a5c' : '#64748b';
  }
}

function _confirmCeremonyOrder() {
  const { type, product, size, retouche, qty, accessoires, tissu } = _ceremonyState;

  if ((type === 'ready_made' || type === 'custom_from_fabric') && !size) {
    toast('⚠️ Choisissez une taille', 'error');
    const warn = document.getElementById('csize-warn');
    if (warn) warn.style.display = 'inline';
    return;
  }

  // Construire l'objet produit enrichi avec les options cérémonie
  const enriched = {
    ...product,
    _ceremony_type:   type,
    _ceremony_size:   size    || null,
    _ceremony_retouche: retouche,
    _ceremony_qty:    qty,
    _ceremony_acc:    accessoires,
    _ceremony_tissu:  tissu   || null,
    // Nom enrichi pour l'affichage panier
    name: [
      product?.name || 'Tenue cérémonie',
      size          ? `· T.${size}`                   : '',
      tissu         ? `· ${tissu}`                    : '',
      retouche      ? '· Retouche ✂️'                : '',
      accessoires?.length ? `· +${accessoires.length} acc.` : '',
    ].filter(Boolean).join(' '),
  };

  addToCart(enriched, qty);
  document.getElementById('kmrc-ceremony-modal')?.remove();

  // Labels lisibles
  const typeLabel = {
    ready_made: 'Prêt à porter',
    fabric_only: 'Tissu',
    custom_from_fabric: 'Confection',
  }[type] || type;

  toast(`🪡 ${typeLabel} ajouté au panier`, 'success');
}



async function loadRelais() {
  const data = await apiGet('/api/relais');
  _relaisList = Array.isArray(data) ? data : [];
}

// ═══════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  // Câbler immédiatement les boutons statiques (avant que l'API réponde)
  wireStaticButtons();

  // Charger en parallèle relais + produits API (remplace les cartes statiques)
  await Promise.all([loadRelais(), loadProducts()]);

  // Tracking
  initTracking();

  // Bouton flottant panier
  initCartButton();

  // Restaurer un panier partagé depuis l'URL
  const params = new URLSearchParams(window.location.search);
  if (params.has('panier')) {
    try {
      const decoded = atob(params.get('panier'));
      // decoded = "id:qty,id:qty,..." — nécessite un fetch produits déjà chargé
      // Simplifié MVP : juste un toast d'info
      toast('🔗 Panier partagé détecté — consultez les produits', 'info');
    } catch { /* ignore */ }
  }

  // Entrée tracking au clavier
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.activeElement?.id === 'tracking-ref-input') {
      searchTracking();
    }
  });
});
