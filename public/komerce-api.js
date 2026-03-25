/**
 * KOMERCE — Connexion front-end ↔ backend API
 * À inclure dans Komerce_Web.html et Komerce_PWA_Mobile.html
 *
 * Fonctions connectées :
 *   1. Chargement des produits depuis l'API
 *   2. Suivi de commande par référence (tracking réel)
 *   3. Création de commande (Commander + auth intégrée)
 *   4. Panier partagé / Cadeau
 */

const KOMERCE_API = 'https://komerce-backend-production.up.railway.app';

// Token JWT en mémoire (pas de localStorage)
let _token = null;
let _currentUser = null;
let _selectedProduct = null;
let _relaisList = [];

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(KOMERCE_API + path, {
    headers: _token ? { Authorization: 'Bearer ' + _token } : {}
  });
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(KOMERCE_API + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(_token ? { Authorization: 'Bearer ' + _token } : {})
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

function kmf(n) {
  return Number(n).toLocaleString('fr-FR') + ' KMF';
}

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:${type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1a3a5c'};
    color:#fff; padding:14px 28px; border-radius:12px; font-size:.95rem;
    font-weight:600; z-index:9999; box-shadow:0 4px 20px rgba(0,0,0,.3);
    animation: slideUp .3s ease;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── 1. PRODUITS ─────────────────────────────────────────────────────────────
// Charge les produits depuis l'API et remplace les cartes statiques

async function loadProducts() {
  try {
    const products = await apiGet('/api/products?promo=true');
    if (!products || products.error) return;

    const grid = document.querySelector('.promo-grid');
    if (!grid) return;

    grid.innerHTML = products.map(p => {
      const promo = p.promo_pct ? Math.round(p.promo_pct) : null;
      const prix = kmf(p.price_kmf);

      return `
        <div class="promo-card" data-product-id="${p.id}">
          <div class="promo-card-img">
            ${p.emoji ? `<span style="font-size:3rem">${p.emoji}</span>` : ''}
            ${promo ? `<div class="promo-badge">−${promo}%</div>` : ''}
          </div>
          <div class="promo-card-body">
            <div class="promo-card-name">${p.name}</div>
            <div class="promo-card-cat">${p.emoji || ''} ${p.category || ''}</div>
            <div class="promo-prices">
              <span class="promo-price-now">${prix}</span>
              ${p.stock < 3 ? '<span style="color:#dc2626;font-size:.78rem;font-weight:700;">⚠️ Stock limité</span>' : ''}
            </div>
            <div style="display:flex;gap:.6rem;margin-top:.8rem">
              <button class="btn-order" onclick="openOrderModal(${JSON.stringify(p).replace(/"/g,'&quot;')})">
                🛒 Commander pour ma famille
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (e) {
    console.warn('Produits non chargés depuis API, version statique affichée.');
  }
}

// ─── 2. TRACKING ─────────────────────────────────────────────────────────────
// Injecte un formulaire de suivi dans la section #suivi

function initTracking() {
  const section = document.getElementById('suivi');
  if (!section) return;

  // Injecter le formulaire de recherche avant la timeline
  const form = document.createElement('div');
  form.style.cssText = 'max-width:480px;margin:0 auto 2rem;';
  form.innerHTML = `
    <div style="display:flex;gap:.6rem;">
      <input
        id="tracking-ref-input"
        type="text"
        placeholder="Votre référence KOM-2026-XXXX"
        style="flex:1;padding:.85rem 1.2rem;border:2px solid #e2e8f0;border-radius:10px;
               font-size:.95rem;outline:none;transition:border .2s;"
        onfocus="this.style.borderColor='#1a3a5c'"
        onblur="this.style.borderColor='#e2e8f0'"
      />
      <button onclick="searchTracking()"
        style="background:#1a3a5c;color:#fff;border:none;border-radius:10px;
               padding:.85rem 1.4rem;font-weight:700;cursor:pointer;white-space:nowrap;">
        Suivre →
      </button>
    </div>
    <div id="tracking-result" style="margin-top:1.2rem;"></div>
  `;

  const title = section.querySelector('.section-sub');
  if (title) title.after(form);
}

const STEP_LABELS = {
  paid:        { label: 'Payé',          icon: '✅', desc: 'Paiement confirmé' },
  preparation: { label: 'Préparation',   icon: '📦', desc: 'Article acheté et préparé au hub' },
  shipped:     { label: 'Expédié',       icon: '🚢', desc: 'En transit maritime' },
  available:   { label: 'Disponible',    icon: '🏪', desc: 'Arrivé au point relais' },
  collected:   { label: 'Récupéré',      icon: '🎉', desc: 'Remis au destinataire' },
  cancelled:   { label: 'Annulé',        icon: '❌', desc: 'Commande annulée' },
};

async function searchTracking() {
  const input = document.getElementById('tracking-ref-input');
  const result = document.getElementById('tracking-result');
  if (!input || !result) return;

  const ref = input.value.trim().toUpperCase();
  if (!ref) { showToast('Entrez votre référence commande', 'error'); return; }

  result.innerHTML = '<p style="color:#64748b;text-align:center;">Recherche en cours…</p>';

  try {
    const data = await apiGet(`/api/orders/${ref}/tracking`);

    if (data.error) {
      result.innerHTML = `
        <div style="text-align:center;padding:1.2rem;background:#fef2f2;border-radius:10px;color:#dc2626;">
          Commande introuvable. Vérifiez votre référence.
        </div>`;
      return;
    }

    const currentStep = data.status;
    const steps = ['paid', 'preparation', 'shipped', 'available', 'collected'];
    const currentIdx = steps.indexOf(currentStep);

    const stepsHtml = steps.map((step, i) => {
      const info = STEP_LABELS[step];
      const isDone    = i < currentIdx;
      const isActive  = i === currentIdx;
      const dotStyle  = isDone
        ? 'background:#16a34a;color:#fff;'
        : isActive
          ? 'background:#1a3a5c;color:#fff;box-shadow:0 0 0 4px rgba(26,58,92,.15);'
          : 'background:#e2e8f0;color:#94a3b8;';

      return `
        <div style="flex:1;text-align:center;position:relative;">
          ${i > 0 ? `<div style="position:absolute;top:16px;left:-50%;right:50%;height:2px;background:${isDone ? '#16a34a' : '#e2e8f0'};z-index:0;"></div>` : ''}
          <div style="width:34px;height:34px;border-radius:50%;${dotStyle}display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:700;margin:0 auto 8px;position:relative;z-index:1;">
            ${isDone ? '✓' : info.icon}
          </div>
          <div style="font-size:.78rem;font-weight:${isActive ? '700' : '500'};color:${isActive ? '#1a3a5c' : isDone ? '#16a34a' : '#94a3b8'};">
            ${info.label}
          </div>
          <div style="font-size:.7rem;color:#94a3b8;margin-top:2px;">${info.desc}</div>
        </div>
      `;
    }).join('');

    // Infos destinataire + relais
    const infoHtml = data.relais ? `
      <div style="margin-top:1rem;padding:1rem;background:#f8fafc;border-radius:10px;font-size:.85rem;">
        <strong>📍 Point relais :</strong> ${data.relais.name}
        ${data.relais.zone ? ` · ${data.relais.zone}` : ''}
        ${data.relais.hours ? ` · ${data.relais.hours}` : ''}
        ${data.pickup_code ? `<br><strong>🔑 Code retrait :</strong> <span style="font-size:1.1rem;font-weight:800;color:#1a3a5c;letter-spacing:.1em;">${data.pickup_code}</span>` : ''}
      </div>` : '';

    result.innerHTML = `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:1.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem;">
          <span style="font-weight:700;color:#1a3a5c;">${ref}</span>
          <span style="background:${currentStep === 'collected' ? '#dcfce7' : currentStep === 'cancelled' ? '#fef2f2' : '#eff6ff'};
                       color:${currentStep === 'collected' ? '#16a34a' : currentStep === 'cancelled' ? '#dc2626' : '#1a3a5c'};
                       padding:.3rem .8rem;border-radius:20px;font-size:.78rem;font-weight:700;">
            ${STEP_LABELS[currentStep]?.icon || ''} ${STEP_LABELS[currentStep]?.label || currentStep}
          </span>
        </div>
        <div style="display:flex;gap:0;overflow-x:auto;padding-bottom:.5rem;">
          ${stepsHtml}
        </div>
        ${infoHtml}
      </div>`;

  } catch (e) {
    result.innerHTML = '<div style="color:#dc2626;text-align:center;">Erreur réseau. Réessayez.</div>';
  }
}

// ─── 3. MODAL COMMANDE ────────────────────────────────────────────────────────

async function loadRelais() {
  try {
    const data = await apiGet('/api/relais');
    _relaisList = data || [];
  } catch (e) {
    _relaisList = [];
  }
}

function openOrderModal(product) {
  _selectedProduct = product;

  // Supprimer modal existant si présent
  const existing = document.getElementById('komerce-order-modal');
  if (existing) existing.remove();

  const relaisOptions = _relaisList.length
    ? _relaisList.map(r => `<option value="${r.id}">${r.name} · ${r.zone || r.island || ''}</option>`).join('')
    : '<option value="">Chargement…</option>';

  const modal = document.createElement('div');
  modal.id = 'komerce-order-modal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;
    display:flex;align-items:center;justify-content:center;padding:1rem;
  `;

  modal.innerHTML = `
    <div style="background:#fff;border-radius:18px;padding:2rem;max-width:480px;width:100%;
                max-height:90vh;overflow-y:auto;position:relative;">

      <button onclick="closeOrderModal()"
        style="position:absolute;top:1rem;right:1rem;background:none;border:none;
               font-size:1.4rem;cursor:pointer;color:#64748b;">✕</button>

      <div style="margin-bottom:1.4rem;">
        <div style="font-size:1.8rem;margin-bottom:.3rem;">${product.emoji || '📦'}</div>
        <h3 style="font-size:1.1rem;font-weight:700;color:#1a3a5c;margin:0 0 .3rem;">${product.name}</h3>
        <div style="font-size:1.2rem;font-weight:800;color:#e8a020;">${kmf(product.price_kmf)}</div>
      </div>

      <form id="order-form" onsubmit="submitOrder(event)" style="display:flex;flex-direction:column;gap:1rem;">

        <div style="background:#f0f9ff;border-radius:10px;padding:1rem;font-size:.85rem;color:#1a3a5c;">
          <strong>Vous commandez depuis</strong> — Entrez vos coordonnées pour créer votre compte ou suivre votre commande.
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem;">
          <div>
            <label style="font-size:.78rem;font-weight:700;color:#1a3a5c;display:block;margin-bottom:.3rem;">Votre nom *</label>
            <input name="full_name" required placeholder="Prénom Nom"
              style="width:100%;padding:.7rem 1rem;border:2px solid #e2e8f0;border-radius:8px;font-size:.9rem;box-sizing:border-box;" />
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:700;color:#1a3a5c;display:block;margin-bottom:.3rem;">Pays *</label>
            <select name="country"
              style="width:100%;padding:.7rem 1rem;border:2px solid #e2e8f0;border-radius:8px;font-size:.9rem;box-sizing:border-box;">
              <option value="FR">🇫🇷 France</option>
              <option value="AE">🇦🇪 Émirats</option>
              <option value="BE">🇧🇪 Belgique</option>
              <option value="KM">🇰🇲 Comores</option>
              <option value="OTHER">Autre</option>
            </select>
          </div>
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:700;color:#1a3a5c;display:block;margin-bottom:.3rem;">Email *</label>
          <input name="email" type="email" required placeholder="votre@email.com"
            style="width:100%;padding:.7rem 1rem;border:2px solid #e2e8f0;border-radius:8px;font-size:.9rem;box-sizing:border-box;" />
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:700;color:#1a3a5c;display:block;margin-bottom:.3rem;">Téléphone (optionnel)</label>
          <input name="phone" type="tel" placeholder="+33 6 xx xx xx xx"
            style="width:100%;padding:.7rem 1rem;border:2px solid #e2e8f0;border-radius:8px;font-size:.9rem;box-sizing:border-box;" />
        </div>

        <hr style="border:none;border-top:1px solid #e2e8f0;margin:.2rem 0;" />
        <div style="font-size:.85rem;font-weight:700;color:#1a3a5c;">📍 Destinataire aux Comores</div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem;">
          <div>
            <label style="font-size:.78rem;font-weight:700;color:#64748b;display:block;margin-bottom:.3rem;">Nom destinataire *</label>
            <input name="recipient_name" required placeholder="Nom de famille"
              style="width:100%;padding:.7rem 1rem;border:2px solid #e2e8f0;border-radius:8px;font-size:.9rem;box-sizing:border-box;" />
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:700;color:#64748b;display:block;margin-bottom:.3rem;">Tél. destinataire *</label>
            <input name="recipient_phone" required type="tel" placeholder="+269 321 xx xx"
              style="width:100%;padding:.7rem 1rem;border:2px solid #e2e8f0;border-radius:8px;font-size:.9rem;box-sizing:border-box;" />
          </div>
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:700;color:#64748b;display:block;margin-bottom:.3rem;">Point relais *</label>
          <select name="relais_id" required
            style="width:100%;padding:.7rem 1rem;border:2px solid #e2e8f0;border-radius:8px;font-size:.9rem;box-sizing:border-box;">
            <option value="">Choisir un relais</option>
            ${relaisOptions}
          </select>
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:700;color:#64748b;display:block;margin-bottom:.5rem;">Mode de paiement *</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;">
            <label style="display:flex;align-items:center;gap:.6rem;padding:.8rem;border:2px solid #e2e8f0;border-radius:8px;cursor:pointer;">
              <input type="radio" name="payment_mode" value="stripe_eur" required />
              <span style="font-size:.85rem;font-weight:600;">💳 Carte bancaire (EUR)</span>
            </label>
            <label style="display:flex;align-items:center;gap:.6rem;padding:.8rem;border:2px solid #e2e8f0;border-radius:8px;cursor:pointer;">
              <input type="radio" name="payment_mode" value="cash_relais" />
              <span style="font-size:.85rem;font-weight:600;">💵 Cash au relais (KMF)</span>
            </label>
          </div>
        </div>

        <button type="submit" id="order-submit-btn"
          style="background:#1a3a5c;color:#fff;border:none;border-radius:10px;padding:1rem;
                 font-size:1rem;font-weight:700;cursor:pointer;margin-top:.4rem;
                 transition:background .2s;">
          Confirmer ma commande →
        </button>

        <div id="order-error" style="color:#dc2626;font-size:.85rem;text-align:center;display:none;"></div>

      </form>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeOrderModal(); });
}

function closeOrderModal() {
  const m = document.getElementById('komerce-order-modal');
  if (m) m.remove();
}

async function submitOrder(e) {
  e.preventDefault();
  const form  = e.target;
  const btn   = document.getElementById('order-submit-btn');
  const error = document.getElementById('order-error');
  const data  = Object.fromEntries(new FormData(form));

  btn.disabled = true;
  btn.textContent = 'Traitement en cours…';
  error.style.display = 'none';

  try {
    // Étape 1 : créer le compte ou s'authentifier
    if (!_token) {
      const password = 'K' + Math.random().toString(36).slice(2, 10); // mot de passe temporaire
      const regRes = await apiPost('/api/auth/register', {
        full_name:     data.full_name,
        email:         data.email,
        phone:         data.phone || undefined,
        password,
        country:       data.country || 'FR',
        currency_pref: data.country === 'KM' ? 'KMF' : 'EUR',
      });

      if (regRes.error && regRes.error.includes('déjà')) {
        // Compte existant → login avec mot de passe par défaut (à gérer proprement en phase 2)
        showToast('Compte existant détecté — commande liée à votre profil', 'info');
      } else if (regRes.token) {
        _token = regRes.token;
        _currentUser = regRes.user;
      } else if (regRes.error) {
        throw new Error(regRes.error);
      }
    }

    // Étape 2 : créer la commande
    const orderRes = await apiPost('/api/orders', {
      product_id:      _selectedProduct.id,
      quantity:        1,
      relais_id:       data.relais_id,
      recipient_name:  data.recipient_name,
      recipient_phone: data.recipient_phone,
      payment_mode:    data.payment_mode,
    });

    if (orderRes.error) throw new Error(orderRes.error);

    // Succès
    closeOrderModal();
    showOrderSuccess(orderRes);

  } catch (err) {
    error.textContent = err.message || 'Erreur lors de la commande. Réessayez.';
    error.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Confirmer ma commande →';
  }
}

function showOrderSuccess(order) {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;
    display:flex;align-items:center;justify-content:center;padding:1rem;
  `;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:18px;padding:2rem;max-width:420px;width:100%;text-align:center;">
      <div style="font-size:3rem;margin-bottom:1rem;">🎉</div>
      <h3 style="color:#1a3a5c;font-size:1.2rem;margin:0 0 .5rem;">Commande confirmée !</h3>
      <div style="font-size:2rem;font-weight:800;color:#1a3a5c;letter-spacing:.1em;margin:1rem 0;">
        ${order.reference}
      </div>
      <p style="color:#64748b;font-size:.9rem;margin:0 0 1.2rem;">
        Notez votre référence — elle vous permettra de suivre votre colis à chaque étape.
      </p>
      ${order.cash_ref_code ? `
        <div style="background:#f0fdf4;border-radius:10px;padding:1rem;margin-bottom:1rem;">
          <div style="font-size:.78rem;font-weight:700;color:#16a34a;margin-bottom:.3rem;">CODE PAIEMENT CASH RELAIS</div>
          <div style="font-size:2rem;font-weight:800;letter-spacing:.15em;color:#1a3a5c;">${order.cash_ref_code}</div>
          <div style="font-size:.78rem;color:#64748b;margin-top:.3rem;">À donner à l'agent relais · Valable 36h</div>
        </div>` : ''}
      <button onclick="this.closest('[style]').remove()"
        style="background:#1a3a5c;color:#fff;border:none;border-radius:10px;
               padding:.9rem 2rem;font-weight:700;cursor:pointer;width:100%;">
        Fermer
      </button>
    </div>
  `;
  document.body.appendChild(modal);
}

// ─── 4. RELAIS (endpoint public) ─────────────────────────────────────────────

async function loadRelaisPublic() {
  try {
    const data = await apiGet('/api/relais');
    _relaisList = Array.isArray(data) ? data : [];
  } catch (e) {
    _relaisList = [];
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Charger les relais en arrière-plan
  await loadRelaisPublic();

  // Charger les produits
  await loadProducts();

  // Initialiser le suivi
  initTracking();

  // Permettre la recherche tracking avec la touche Entrée
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.activeElement?.id === 'tracking-ref-input') {
      searchTracking();
    }
  });
});
