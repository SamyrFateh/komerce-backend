/**
 * @module b-modal-approche-c-hybrid
 * @brief Approche C hybride pour la PDP desktop Komerce.
 *
 * Objectif : monter la fiche produit desktop en gamme sans toucher au mobile
 * ni réouvrir la refonte modale. Ce module est volontairement additif :
 * il écoute `modal:opened`, attend que les enhancers desktop existants aient
 * injecté leurs blocs, puis compacte Livraison/Paiement et applique une couche
 * visuelle premium desktop-only.
 *
 * Décision UX : pas de side-cart permanent dans la PDP desktop. La Buy Box reste
 * prioritaire ; le panier complet reste une action volontaire.
 */

import { bus } from './b-bus.js';
import { state } from './b-store.js';
import { isDesktop } from './b-scroll-owner.js';

'use strict';

let _installed = false;
let _styleInjected = false;

function injectHybridStyles() {
  if (_styleInjected || typeof document === 'undefined') return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'k-approche-c-hybrid-style';
  style.textContent = `
/* ══════════════════════════════════════════════════════════════
   APPROCHE C HYBRIDE — PDP Desktop premium compacte
   Injecté par b-modal-approche-c-hybrid.js
   Desktop only — mobile préservé
   ══════════════════════════════════════════════════════════════ */
@media (min-width: 900px) {
  #k-modal .k-modal-product-zone {
    grid-template-columns: minmax(0, 48%) minmax(0, 52%);
    background:
      radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--sand-warm) 60%, transparent), transparent 28%),
      var(--white);
  }

  #k-modal .k-modal-product-zone .k-modal-img-wrap {
    background:
      radial-gradient(circle at 62% 20%, color-mix(in srgb, var(--ocean) 10%, transparent), transparent 30%),
      linear-gradient(135deg, var(--sand) 0%, var(--sand-warm) 100%);
  }

  #k-modal .k-modal-slide { padding: 22px 30px 22px 92px; }

  #k-modal .k-modal-product-zone .k-modal-details {
    background:
      linear-gradient(180deg, var(--white) 0%, color-mix(in srgb, var(--sand) 48%, var(--white)) 100%);
    padding: 0 clamp(28px, 4.4vw, 72px);
  }

  #k-modal .k-modal-product-zone .k-modal-info {
    max-width: 760px;
    padding-top: clamp(22px, 3vh, 42px);
    padding-bottom: 14px;
  }

  #k-modal .k-modal-info h2 {
    font-family: var(--font-display, var(--font));
    font-size: clamp(30px, 3vw, 46px);
    line-height: .98;
    font-weight: 700;
    letter-spacing: -.035em;
    color: var(--text);
    max-width: 760px;
  }

  #k-modal .k-modal-name-row { margin-top: 10px; align-items: flex-start; }
  #k-modal .k-modal-fav-btn { margin-top: 2px; }
  #k-modal .k-modal-price-row { margin-top: 18px; gap: 12px; }
  #k-modal .k-modal-price { font-size: clamp(34px, 4vw, 56px); letter-spacing: -.04em; color: var(--coral); }
  #k-modal .k-modal-price-unit { font-size: .34em; letter-spacing: .06em; }
  #k-modal .k-modal-old-price { font-size: 16px; opacity: .72; }
  #k-modal .k-modal-aed-price { margin-top: 8px; margin-bottom: 10px; }
  #k-modal .k-modal-eur-ref,
  #k-modal .k-modal-price-saving { font-size: 13px; }
  #k-modal .k-modal-flash-bar { display: none; }

  #k-modal .k-modal-desc {
    font-style: italic;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-muted);
    margin-top: 8px;
    max-width: 680px;
  }

  #k-modal .k-modal-delivery,
  #k-modal .k-modal-payment {
    display: block;
    border-top: 0;
    margin-top: 18px;
    padding-top: 0;
  }

  #k-modal .k-buybox-relay-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 15px 16px;
    border-radius: 18px;
    border: 1px solid var(--border-ocean-14);
    background:
      linear-gradient(135deg,
        color-mix(in srgb, var(--ocean-bg-08) 78%, var(--white)) 0%,
        var(--white) 100%);
    box-shadow: 0 12px 28px var(--border-text-06);
  }

  #k-modal .k-buybox-relay-icon {
    width: 42px;
    height: 42px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    background: var(--ocean-bg-08);
    border: 1px solid var(--border-ocean-14);
    font-size: 22px;
  }

  #k-modal .k-buybox-relay-title {
    font-size: 14px;
    font-weight: 800;
    color: var(--text);
    line-height: 1.1;
  }

  #k-modal .k-buybox-relay-sub {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }

  #k-modal .k-buybox-relay-free {
    font-size: 12px;
    font-weight: 800;
    color: var(--ocean-dark);
    background: var(--ocean-bg-08);
    border: 1px solid var(--border-ocean-14);
    border-radius: 999px;
    padding: 5px 10px;
    white-space: nowrap;
  }

  #k-modal .k-modal-payment .k-modal-section-title { margin-bottom: 9px; }

  #k-modal .k-buybox-payment-tabs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
  }

  #k-modal .k-buybox-payment-tab {
    height: 42px;
    border-radius: 13px;
    border: 1px solid var(--border);
    background: var(--white);
    color: var(--text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: border-color .16s var(--ease), background .16s var(--ease), color .16s var(--ease), box-shadow .16s var(--ease), transform .16s var(--ease);
  }

  #k-modal .k-buybox-payment-tab:hover {
    transform: translateY(-1px);
    border-color: var(--ocean-light);
    box-shadow: 0 8px 18px var(--border-text-06);
  }

  #k-modal .k-buybox-payment-tab.is-active {
    border-color: var(--ocean);
    background: var(--ocean-bg-08);
    color: var(--ocean-dark);
    box-shadow: inset 0 0 0 1px var(--border-ocean-14);
  }

  #k-modal .k-buybox-payment-detail {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--white);
    border: 1px solid var(--border);
    box-shadow: 0 8px 22px var(--border-text-06);
  }

  #k-modal .k-buybox-payment-check {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 2px solid var(--ocean);
    position: relative;
  }

  #k-modal .k-buybox-payment-check::after {
    content: "";
    position: absolute;
    inset: 3px;
    border-radius: inherit;
    background: var(--ocean);
  }

  #k-modal .k-buybox-payment-icon { font-size: 18px; line-height: 1; }
  #k-modal .k-buybox-payment-copy { min-width: 0; }

  #k-modal .k-buybox-payment-copy strong {
    display: block;
    font-size: 14px;
    font-weight: 800;
    color: var(--text);
    line-height: 1.15;
  }

  #k-modal .k-buybox-payment-copy small {
    display: block;
    margin-top: 3px;
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  #k-modal .k-buybox-payment-badge {
    font-size: 11px;
    font-weight: 800;
    padding: 4px 9px;
    border-radius: 8px;
    color: var(--violet-dark);
    background: var(--violet-light);
    border: 1px solid var(--violet-mid);
  }

  #k-modal .k-modal-trust {
    border-top: 0;
    margin-top: 12px;
    padding: 0;
    gap: 8px;
  }

  #k-modal .k-modal-trust-item {
    background: color-mix(in srgb, var(--sand) 76%, var(--white));
    border: 1px solid var(--border-text-06);
    min-height: 30px;
  }

  #k-modal .k-modal-share-row {
    border-top: 0;
    margin-top: 12px;
    padding-top: 0;
    grid-template-columns: minmax(160px, 220px) minmax(140px, 180px);
    justify-content: start;
  }

  #k-modal .k-modal-share-btn { border-radius: 12px; min-height: 40px; }

  #k-modal .k-modal-product-zone .k-modal-actions {
    background:
      linear-gradient(180deg,
        color-mix(in srgb, var(--white) 84%, transparent) 0%,
        var(--white) 42%);
    border-top: 1px solid var(--border-text-08);
    box-shadow: 0 -18px 36px var(--border-text-06);
    padding-top: 14px;
    padding-bottom: 18px;
  }

  #k-modal .k-modal-product-zone .k-modal-actions .k-buy-now-btn {
    min-height: 48px;
    border-radius: 999px;
    font-size: 15px;
    font-weight: 850;
    box-shadow: 0 12px 26px color-mix(in srgb, var(--ocean) 22%, transparent);
  }

  #k-modal .k-modal-product-zone .k-modal-actions .k-add-cart-btn {
    min-height: 48px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 800;
    background: var(--white);
  }

  #k-modal .k-modal-product-zone .k-modal-actions .k-qty {
    min-height: 48px;
    border-radius: 999px;
    background: var(--sand);
  }

  #k-modal .k-modal-subtotal { font-size: 12px; color: var(--text-muted); }
  #k-modal .k-modal-subtotal strong { color: var(--coral); font-size: 15px; }

  #k-modal-suggestions.k-modal-suggestions--desktop-list {
    background: linear-gradient(180deg, var(--sand) 0%, var(--sand-warm) 100%);
    padding: 34px clamp(32px, 5vw, 72px) 56px;
  }

  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-title {
    border-bottom: 0;
    margin-bottom: 18px;
  }

  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-title-text {
    font-family: var(--font-display, var(--font));
    font-size: clamp(22px, 2vw, 30px);
    line-height: 1;
    letter-spacing: -.025em;
    color: var(--text);
  }

  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-grid,
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-grid--same,
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-grid--other {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px;
  }
}
`;

  document.head.appendChild(style);
}

function renderDelivery() {
  const el = document.getElementById('k-modal-delivery');
  if (!el) return;

  el.innerHTML =
    '<div class="k-buybox-relay-card">' +
      '<div class="k-buybox-relay-icon" aria-hidden="true">📦</div>' +
      '<div class="k-buybox-relay-copy">' +
        '<div class="k-buybox-relay-title">Retrait en relais</div>' +
        '<div class="k-buybox-relay-sub">Grande Comore · Anjouan · Mohéli</div>' +
      '</div>' +
      '<span class="k-buybox-relay-free">Gratuit</span>' +
    '</div>';
}

function renderPayment() {
  const el = document.getElementById('k-modal-payment');
  if (!el) return;

  const modes = {
    stripe: {
      icon: '💳',
      tab: 'Carte',
      title: 'Carte bancaire',
      sub: 'Visa, Mastercard — Stripe sécurisé',
      badge: 'Stripe',
    },
    cash: {
      icon: '💵',
      tab: 'Livraison',
      title: 'Paiement à la livraison',
      sub: 'En espèces à la réception',
      badge: 'Cash',
    },
    group: {
      icon: '👥',
      tab: 'Partagé',
      title: 'Panier partagé',
      sub: 'Invitez des proches à contribuer',
      badge: 'Partage',
    },
    pot: {
      icon: '🎁',
      tab: 'Cagnotte',
      title: 'Cagnotte collective',
      sub: 'Offrir ensemble, payer ensemble',
      badge: 'Collectif',
    },
  };

  const active = state.modalPaymentMode || 'stripe';

  function detailHTML(key) {
    const m = modes[key] || modes.stripe;
    return (
      '<div class="k-buybox-payment-detail" data-pay-detail="' + key + '">' +
        '<span class="k-buybox-payment-check" aria-hidden="true"></span>' +
        '<span class="k-buybox-payment-icon" aria-hidden="true">' + m.icon + '</span>' +
        '<span class="k-buybox-payment-copy">' +
          '<strong>' + m.title + '</strong>' +
          '<small>' + m.sub + '</small>' +
        '</span>' +
        '<span class="k-buybox-payment-badge">' + m.badge + '</span>' +
      '</div>'
    );
  }

  el.innerHTML =
    '<div class="k-modal-section-title">Mode de paiement</div>' +
    '<div class="k-buybox-payment-tabs" role="tablist" aria-label="Mode de paiement">' +
      Object.keys(modes).map(function(key) {
        const m = modes[key];
        return (
          '<button type="button" class="k-buybox-payment-tab' + (key === active ? ' is-active' : '') + '" data-pay="' + key + '" role="tab" aria-selected="' + (key === active ? 'true' : 'false') + '">' +
            '<span aria-hidden="true">' + m.icon + '</span>' +
            '<span>' + m.tab + '</span>' +
          '</button>'
        );
      }).join('') +
    '</div>' +
    '<div class="k-buybox-payment-detail-wrap">' + detailHTML(active) + '</div>';

  el.querySelectorAll('.k-buybox-payment-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      const key = tab.getAttribute('data-pay') || 'stripe';
      state.modalPaymentMode = key;

      el.querySelectorAll('.k-buybox-payment-tab').forEach(function(t) {
        const isActive = t === tab;
        t.classList.toggle('is-active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      const wrap = el.querySelector('.k-buybox-payment-detail-wrap');
      if (wrap) wrap.innerHTML = detailHTML(key);
    });
  });
}

function applyHybridPdp() {
  if (!isDesktop()) return;
  injectHybridStyles();
  renderDelivery();
  renderPayment();
}

export function setupApprocheCHybridPdp() {
  if (_installed) return;
  _installed = true;

  injectHybridStyles();

  bus.on('modal:opened', function() {
    if (!isDesktop()) return;
    // Les enhancers desktop existants injectent leurs blocs dans un RAF.
    // Deux RAF garantissent que cette couche hybride passe après eux.
    requestAnimationFrame(function() {
      requestAnimationFrame(applyHybridPdp);
    });
  });
}
