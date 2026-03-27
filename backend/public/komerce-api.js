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
        <div class="promo-card-m" data-product-id="${p.id}">
          <div class="promo-card-m-img">
            ${p.emoji || '📦'}
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
                onclick="addToCart(JSON.parse(this.dataset.p))"
                data-p="${pData}"
                style="flex:1;">
                🛒 Ajouter
              </button>
              <button
                onclick="quickOrder(JSON.parse(this.dataset.p))"
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
        <div class="promo-card" data-product-id="${p.id}">
          <div class="promo-card-img">
            ${p.emoji ? `<span style="font-size:3rem">${p.emoji}</span>` : ''}
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
                onclick="addToCart(JSON.parse(this.dataset.p))"
                data-p="${pData}"
                class="btn-order"
                style="flex:1;display:flex;align-items:center;justify-content:center;gap:.4rem;">
                🛒 Ajouter
              </button>
              <button
                onclick="quickOrder(JSON.parse(this.dataset.p))"
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
    if (btn.onclick) return; // déjà câblé
    const card = btn.closest('[data-product]');
    if (!card) return;
    try {
      const p = JSON.parse(card.dataset.product);
      btn.onclick = () => addToCart(p);
    } catch (e) { /* ignorer */ }
  });
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

function addToCart(product) {
  const existing = _cart.find(i => i.product.id === product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    _cart.push({ product, qty: 1, size: null }); // size: null = pas de taille choisie
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
  // Ouvrir le panier si déjà des articles
  if (_cart.length >= 2) openCart();
}

function removeFromCart(productId) {
  _cart = _cart.filter(i => i.product.id !== productId);
  refreshCartBadge();
  renderCartBody();
}

function setQty(productId, qty) {
  const item = _cart.find(i => i.product.id === productId);
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
    <span style="font-size:1.4rem;">🛒</span>
    <span id="kmrc-cart-badge" style="
      display:none;position:absolute;top:-5px;right:-5px;
      background:#e8a020;color:#fff;border-radius:50%;
      width:22px;height:22px;font-size:.7rem;font-weight:800;
      align-items:center;justify-content:center;border:2px solid #fff;">
      0
    </span>
  `;
  btn.style.cssText = `
    position:fixed;bottom:1.5rem;right:1.5rem;z-index:9990;
    width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;
    background:linear-gradient(135deg,#1a3a5c,#2563eb);
    box-shadow:0 4px 20px rgba(37,99,235,.4);
    display:flex;align-items:center;justify-content:center;
    transition:transform .2s,box-shadow .2s;
  `;
  btn.onmouseenter = () => btn.style.transform = 'scale(1.1)';
  btn.onmouseleave = () => btn.style.transform = 'scale(1)';
  document.body.appendChild(btn);
}

function refreshCartBadge() {
  const badge = $('kmrc-cart-badge');
  if (!badge) return;
  const n = cartQty();
  badge.textContent = n;
  badge.style.display = n > 0 ? 'flex' : 'none';
  // Pulse animation
  const btn = $('kmrc-cart-btn');
  if (btn && n > 0) {
    btn.style.transform = 'scale(1.18)';
    setTimeout(() => btn.style.transform = 'scale(1)', 200);
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

      <!-- Emoji produit -->
      <div style="width:48px;height:48px;background:#f8fafc;border-radius:10px;
                  display:flex;align-items:center;justify-content:center;
                  font-size:1.6rem;flex-shrink:0;">
        ${p.emoji || '📦'}
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
              <button onclick="setSize(${p.id}, '${s}')"
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
            <button onclick="setQty(${p.id}, ${qty - 1})"
              style="width:30px;height:30px;border:none;background:#f8fafc;
                     cursor:pointer;font-size:1rem;font-weight:700;color:#4a5568;">−</button>
            <span style="width:28px;text-align:center;font-size:.9rem;
                          font-weight:700;color:#1a3a5c;">${qty}</span>
            <button onclick="setQty(${p.id}, ${qty + 1})"
              style="width:30px;height:30px;border:none;background:#f8fafc;
                     cursor:pointer;font-size:1rem;font-weight:700;color:#4a5568;">+</button>
          </div>
          <button onclick="removeFromCart(${p.id})"
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
  const item = _cart.find(i => i.product.id === productId);
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
  openOrderForm(_profil, _cart);
}

function quickOrder(product) {
  openOrderForm(_profil, [{ product, qty: 1, size: null }]);
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
//  7. RELAIS
// ═══════════════════════════════════════════════════════════════════════

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
