/**
 * @komerce-arch
 * @role          checkout-dom-renderer
 * @domain        checkout
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        order_data, identity, relay_options, payment_state
 * @outputs       checkout_form_dom, identity_recap, success_dom, confirm_button_state
 * @depends       b-utils.js
 * @used-by       b-checkout.js, b-share-cart.js
 * @doctrine      checkout_sans_friction, otp_une_fois, rendu_sans_logique_metier
 * @impact-areas  checkout, otp, relais, payment-ui, order-success
 * @version       2026-06
 */
'use strict';

/**
 * @module b-checkout-render
 * @brief S3.1 — Fonctions de rendu DOM pures extraites de b-checkout.js
 *
 * Principe : ces fonctions construisent du HTML, ne lisent pas le state global,
 * et ne déclenchent pas d'effets de bord métier. Elles acceptent les données
 * en paramètre et retournent des éléments DOM ou mutent un container passé.
 *
 * Ce module ne doit jamais importer b-cart.js, b-checkout.js, b-store.js
 * (risque de cycle). Il peut importer b-utils.js pour sanitize/fmt.
 */

import { fmt, sanitize, optimizeImgUrl } from './b-utils.js';

/**
 * Rayon de continuité affiché sous le récapitulatif desktop.
 *
 * Fonction pure : les décisions (déjà inclus, variante à choisir, ajout
 * direct possible) sont préparées par b-checkout.js. Ce renderer ne lit
 * aucun état global et ne mute jamais le panier ou CheckoutSelection.
 */
export function renderCheckoutRecentProducts(container, entries = [], actions = {}) {
  if (!container || !Array.isArray(entries) || !entries.length) return null;

  const {
    onOpen,
    onAdd,
    sectionClass = 'ck-checkout-recent',
    titleId = 'ck-checkout-recent-title',
    title = 'Récemment consultés',
    subtitle = 'Retrouvez vos derniers choix sans quitter la commande.',
    defaultDetailLabel = 'Consulté récemment',
  } = actions;

  const section = document.createElement('section');
  section.className = sectionClass;
  section.setAttribute('aria-labelledby', titleId);

  const heading = document.createElement('div');
  heading.className = 'ck-checkout-recent-heading';
  heading.innerHTML =
    '<div>'
      + `<h3 id="${titleId}">${sanitize(title)}</h3>`
      + `<p>${sanitize(subtitle)}</p>`
    + '</div>';

  const grid = document.createElement('div');
  grid.className = 'ck-checkout-recent-grid';

  entries.forEach((entry) => {
    const product = entry?.product || {};
    const card = document.createElement('article');
    card.className = 'ck-checkout-recent-card';
    card.dataset.productId = String(product.id ?? '');

    const productLink = document.createElement('button');
    productLink.type = 'button';
    productLink.className = 'ck-checkout-recent-product';
    productLink.setAttribute('aria-label', 'Voir ' + (product.name || 'ce produit'));

    const media = document.createElement('span');
    media.className = 'ck-checkout-recent-media';
    const rawImage = product.image_url
      || product.image
      || product.images?.[0]?.url
      || product.images?.[0]
      || '';
    if (rawImage) {
      const image = document.createElement('img');
      image.src = optimizeImgUrl(rawImage, 240);
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove(), { once: true });
      media.appendChild(image);
    }

    const copy = document.createElement('span');
    copy.className = 'ck-checkout-recent-copy';

    const name = document.createElement('strong');
    name.className = 'ck-checkout-recent-name';
    name.textContent = product.name || 'Produit';

    const detail = document.createElement('span');
    detail.className = 'ck-checkout-recent-detail';
    detail.textContent = entry.variantLabel
      || (entry.action === 'choose' ? 'Options à choisir' : defaultDetailLabel);

    copy.append(name, detail);
    productLink.append(media, copy);
    productLink.addEventListener('click', () => onOpen?.(entry));

    const footer = document.createElement('div');
    footer.className = 'ck-checkout-recent-footer';

    const price = document.createElement('span');
    price.className = 'ck-checkout-recent-price';
    price.textContent = fmt(
      Number(product.price_kmf ?? product.price ?? 0) || 0,
      'KMF'
    );
    footer.appendChild(price);

    if (entry.action === 'included') {
      const status = document.createElement('span');
      status.className = 'ck-checkout-recent-status';
      status.textContent = '✓ Dans la commande';
      footer.appendChild(status);
    } else {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'ck-checkout-recent-action';
      action.disabled = entry.action === 'unavailable';
      action.textContent = entry.action === 'choose'
        ? 'Choisir'
        : entry.action === 'unavailable'
          ? 'Indisponible'
          : 'Ajouter';
      action.addEventListener('click', () => {
        if (entry.action === 'choose') onOpen?.(entry);
        else if (entry.action === 'add') onAdd?.(entry, action);
      });
      footer.appendChild(action);
    }

    card.append(productLink, footer);
    grid.appendChild(card);
  });

  section.append(heading, grid);
  container.appendChild(section);
  return section;
}

// ── Sélecteur de zone de livraison ───────────────────────────────────────────

/**
 * Construit le sélecteur Comores/France et l'attache à container.
 * @param {HTMLElement} container
 * @param {Object} od - orderData (lu + écrit : od.fulfillment_zone, od.selectedRelaisId)
 * @param {Function} onChange - callback appelé après changement de zone
 */
export function renderFulfillmentSelector(container, od, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'ck-fulfillment-switch';
  wrap.innerHTML =
    '<button type="button" class="ck-fulfillment-btn" data-zone="comoros">Retrait aux Comores</button>' +
    '<button type="button" class="ck-fulfillment-btn" data-zone="france">Retrait en France</button>';

  function syncActive() {
    wrap.querySelectorAll('.ck-fulfillment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.zone === od.fulfillment_zone);
    });
  }

  wrap.querySelectorAll('.ck-fulfillment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (od.fulfillment_zone === btn.dataset.zone) return;
      od.fulfillment_zone = btn.dataset.zone;
      od.selectedRelaisId = null;
      syncActive();
      onChange();
    });
  });

  syncActive();
  container.appendChild(wrap);
}

// ── Liste des points relais ───────────────────────────────────────────────────

/**
 * Rend la liste des relais pour une île dans listEl.
 * Callback onSelect(relaisId) appelé à chaque sélection.
 * @param {HTMLElement} listEl
 * @param {Array} relaisList
 * @param {{ selectedRelaisId: string|null }} selectionRef - objet partagé pour stocker l'id sélectionné
 * @param {Function} onSelect - appelé avec l'id du relais sélectionné
 * @param {Function} onClearError
 */
export function renderRelaisForIle(listEl, relaisList, selectionRef, onSelect, onClearError) {
  listEl.innerHTML = '';
  const visibleRelais = relaisList.filter(r => {
    const haystack = [r.name, r.nom, r.address, r.adresse, r.location]
      .filter(Boolean).join(' ').toLowerCase();
    return !haystack.includes('domoni');
  });

  const buildItem = (r, compact = false) => {
    const item = document.createElement('div');
    item.className = 'ck-relais-item' + (compact ? ' ck-relais-item--compact selected' : '');
    item.dataset.id = r.id;
    item.innerHTML =
      '<span class="ck-relais-name">' + sanitize(r.name || r.nom || '') + '</span>' +
      (r.address || r.adresse || r.location
        ? '<span class="ck-relais-addr">' + sanitize(r.address || r.adresse || r.location) + '</span>'
        : '');
    return item;
  };

  if (visibleRelais.length === 1) {
    const r = visibleRelais[0];
    const item = buildItem(r, true);
    selectionRef.selectedRelaisId = r.id;
    if (onClearError) onClearError();
    listEl.appendChild(item);
    if (onSelect) onSelect(r.id);
    return;
  }

  visibleRelais.forEach(r => {
    const item = buildItem(r);
    item.addEventListener('click', () => {
      listEl.querySelectorAll('.ck-relais-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      selectionRef.selectedRelaisId = r.id;
      if (onClearError) onClearError();
      if (onSelect) onSelect(r.id);
    });
    listEl.appendChild(item);
  });

  const first = listEl.querySelector('.ck-relais-item');
  if (first && !selectionRef.selectedRelaisId) {
    first.click();
  } else if (onSelect) {
    onSelect(selectionRef.selectedRelaisId);
  }
}

// ── Bouton de confirmation ────────────────────────────────────────────────────

/**
 * Met à jour le contenu du bouton confirm : texte principal + sous-texte.
 * @param {HTMLElement} button
 * @param {string} mainText
 * @param {string} [subText]
 */
export function setCheckoutConfirmButton(button, mainText, subText) {
  if (!button) return;
  button.innerHTML = '';
  const main = document.createElement('span');
  main.className = 'ck-confirm-main';
  main.textContent = mainText;
  button.appendChild(main);
  if (subText) {
    const sub = document.createElement('span');
    sub.className = 'ck-confirm-subtext';
    sub.textContent = subText;
    button.appendChild(sub);
  }
}

// ── Champs de formulaire ──────────────────────────────────────────────────────

/**
 * Factory : groupe label + input texte lié à dataObj[key].
 * @param {string} id
 * @param {string} label
 * @param {string} type - type HTML de l'input
 * @param {string} placeholder
 * @param {Object} dataObj
 * @param {string} key
 * @returns {HTMLElement}
 */
export function makeInput(id, label, type, placeholder, dataObj, key) {
  const group = document.createElement('div');
  group.className = 'k-ck-group';
  const lbl = document.createElement('label');
  lbl.className = 'k-ck-label';
  lbl.textContent = label;
  group.appendChild(lbl);
  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  input.className = 'k-ck-input';
  input.placeholder = placeholder;
  input.value = dataObj[key] || '';
  input.addEventListener('input', () => { dataObj[key] = input.value; });
  group.appendChild(input);
  return group;
}

/**
 * Factory : groupe label + input téléphone Comores (+269) lié à dataObj[key].
 * @param {string} id
 * @param {string} label
 * @param {Object} dataObj
 * @param {string} key
 * @returns {HTMLElement}
 */
export function makePhoneInput(id, label, dataObj, key) {
  const group = document.createElement('div');
  group.className = 'k-ck-group';
  if (label) {
    const lbl = document.createElement('label');
    lbl.className = 'k-ck-label k-ck-label--sm';
    lbl.textContent = label;
    group.appendChild(lbl);
  }
  const wrap = document.createElement('div');
  wrap.className = 'k-ck-km-wrap';
  const prefix = document.createElement('div');
  prefix.className = 'k-ck-km-prefix';
  prefix.innerHTML = '🇰🇲 <span class="k-ck-km-code">+269</span>';
  wrap.appendChild(prefix);
  const input = document.createElement('input');
  input.type = 'tel';
  input.id = id;
  input.className = 'k-ck-km-input';
  input.placeholder = '321 12 34';
  input.value = dataObj[key] || '';
  input.maxLength = 10;
  input.addEventListener('input', () => {
    let raw = input.value.replace(/[^0-9]/g, '');
    if (raw.length > 7) raw = raw.substring(0, 7);
    if (raw.length >= 4) raw = raw.substring(0, 3) + ' ' + raw.substring(3);
    if (raw.length >= 7) raw = raw.substring(0, 6) + ' ' + raw.substring(6);
    input.value = raw;
    dataObj[key] = raw;
  });
  wrap.appendChild(input);
  group.appendChild(wrap);
  return group;
}

// ── Écran de succès ───────────────────────────────────────────────────────────

/**
 * Construit le DOM de l'écran "commande confirmée" et l'insère dans body.
 * Retourne un objet { copyBtn, closeBtn, trackBtn } pour que l'appelant
 * puisse brancher les listeners métier sans accès au DOM global.
 *
 * @param {HTMLElement} body - conteneur cible (dom.orderBody)
 * @param {Object} order - order.reference, order.items_count, order.total_kmf,
 *                         order.cash_ref_code, order.payment_mode
 * @returns {{ copyBtn: HTMLElement|null, closeBtn: HTMLElement|null, trackBtn: HTMLElement|null }}
 */
export function buildOrderSuccessDOM(body, order) {
  body.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'k-confirm-wrap k-confirm-simple';

  const emoji = document.createElement('div');
  emoji.className = 'k-confirm-emoji';
  emoji.textContent = '🎉';
  wrap.appendChild(emoji);

  const title = document.createElement('h3');
  title.className = 'k-confirm-title';
  title.textContent = 'Commande confirmée !';
  wrap.appendChild(title);

  const refBlock = document.createElement('div');
  refBlock.className = 'k-confirm-ref-block';
  refBlock.innerHTML =
    '<div class="k-confirm-ref-label">Votre référence</div>' +
    '<div class="k-confirm-ref">' + sanitize(order.reference || '—') + '</div>' +
    '<button id="k-copy-ref-btn" class="k-confirm-copy">📋 Copier</button>';
  wrap.appendChild(refBlock);

  const orderQty   = order.items_count || (order.items && order.items.length) || null;
  const orderTotal = order.total_kmf != null ? order.total_kmf : null;
  if (orderQty && orderTotal) {
    const recapLine = document.createElement('div');
    recapLine.className = 'k-confirm-recap';
    recapLine.innerHTML =
      '<span class="k-confirm-recap-qty">' + orderQty + ' article' + (orderQty > 1 ? 's' : '') + '</span>' +
      '<span class="k-confirm-recap-sep">•</span>' +
      '<span class="k-confirm-recap-amount">' + fmt(orderTotal, 'KMF') + '</span>';
    wrap.appendChild(recapLine);
  }

  if (order.cash_ref_code && order.payment_mode === 'cash_relais') {
    const cashBlock = document.createElement('div');
    cashBlock.className = 'k-confirm-cash-block';
    cashBlock.innerHTML =
      '<div class="k-confirm-cash-label">🏪 Code à présenter au relais</div>' +
      '<div class="k-confirm-cash-code">' + sanitize(order.cash_ref_code) + '</div>';
    wrap.appendChild(cashBlock);
  }

  const notices = document.createElement('div');
  notices.className = 'k-confirm-notices';
  notices.innerHTML =
    '<div class="k-confirm-notice-row">📲 Vous allez recevoir un WhatsApp de confirmation</div>' +
    '<div class="k-confirm-notice-row">🏪 Rendez-vous au relais avec cette référence</div>';
  wrap.appendChild(notices);

  const actions = document.createElement('div');
  actions.className = 'k-confirm-actions';
  actions.innerHTML =
    '<button id="k-order-track-btn" class="k-confirm-btn k-confirm-btn-primary">📍 Suivre ma commande</button>' +
    '<button id="k-order-close-btn" class="k-confirm-btn k-confirm-btn-secondary">🛍️ Continuer mes achats</button>';
  wrap.appendChild(actions);
  body.appendChild(wrap);

  return {
    copyBtn:  body.querySelector('#k-copy-ref-btn'),
    closeBtn: body.querySelector('#k-order-close-btn'),
    trackBtn: body.querySelector('#k-order-track-btn'),
  };
}

// ── Step header réutilisable (accordéon checkout) ──────────────────────────────

/**
 * Ligne d'en-tête d'étape pour l'accordéon checkout (identité / relais / paiement).
 * Reprend le pastille visuel de b-tracking.js (.k-track-step-dot) pour garder
 * une seule sémantique done/current/pending à travers toute la boutique.
 * Fonction pure : ne lit pas state, ne déclenche aucun appel réseau.
 *
 * @param {Object} opts
 * @param {'done'|'current'|'pending'} opts.state
 * @param {string} opts.label       - ex. "Admin Komerce", "IT Hub Relais · Ndzouani"
 * @param {string} [opts.sublabel]  - ex. "identifié"
 * @param {Function} [opts.onChange] - si fourni, ajoute un bouton "Changer"
 * @returns {HTMLElement}
 */
export function renderStepHeader({ state: stepState, icon, label, sublabel, onChange }) {
  const visual = icon || (stepState === 'done' ? String.fromCharCode(10003) : '');

  const el = document.createElement('div');
  el.className = 'ck-step-header ck-step-header--' + stepState;
  el.innerHTML =
    '<span class="ck-step-header-icon" aria-hidden="true">' + sanitize(visual) + '</span>'
    + '<span class="ck-step-header-text">'
    +   '<span class="ck-step-header-label">' + sanitize(label || '') + '</span>'
    +   (sublabel ? '<span class="ck-step-header-sub">' + sanitize(sublabel) + '</span>' : '')
    + '</span>'
    + (onChange ? '<button type="button" class="ck-step-header-change">Changer</button>' : '');

  // Listener sur la ligne entière (el), pas seulement sur le bouton "Changer" :
  // le bouton n'est qu'un indice visuel, le clic bulle depuis n'importe quel
  // point de la ligne (comportement hérité de l'ancien ck-relais-summary).
  if (onChange) {
    el.addEventListener('click', onChange);
  }
  return el;
}

// ── Récapitulatif identité (S3.1) ─────────────────────────────────────────────

/**
 * Construit l'élément DOM du bloc "CONTACT RECONNU" pour le checkout.
 * Fonction pure : ne lit pas state, ne déclenche aucun appel réseau.
 *
 * @param {Object} identity - { full_name?, name?, phone? }
 * @returns {HTMLElement} div#ck-identity-recap
 */
function _idInitials(name) {
  return (String(name || '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2) || '·').toUpperCase();
}

export function buildIdentityRecapDOM(identity) {
  const el = document.createElement('div');
  el.id = 'ck-identity-recap';
  el.className = 'k-ck-identity-recap';
  const dName  = identity.full_name || identity.name  || '';
  const dPhone = identity.phone || '';
  // Ligne calme et aérée : avatar + check · 👋 nom / téléphone · actions à droite
  // (« Changer » + « Ce n'est pas vous ? » regroupés dans le même coin).
  el.innerHTML =
    '<div class="k-ck-id-card">'
    +   '<span class="k-ck-id-avatar" aria-hidden="true">'
    +     '<span class="k-ck-id-initials">' + sanitize(_idInitials(dName || dPhone)) + '</span>'
    +     '<span class="k-ck-id-check" title="Identité vérifiée">✓</span>'
    +   '</span>'
    +   '<span class="k-ck-id-ident">'
    +     '<span class="k-ck-id-value"><span class="k-ck-id-hi" aria-hidden="true">👋</span> '
    +       '<span class="k-ck-id-name">' + sanitize(dName || dPhone) + '</span>'
    +       '<span class="k-ck-id-verified" aria-label="Identit\u00e9 v\u00e9rifi\u00e9e"><span class="k-ck-id-verified-ic" aria-hidden="true">\u2705</span> identifi\u00e9</span>'
    +     '</span>'
    +     (dName && dPhone ? '<span class="k-ck-id-num">' + sanitize(dPhone) + '</span>' : '')
    +   '</span>'
    +   '<span class="k-ck-id-actions-col">'
    +     '<button type="button" class="k-ck-id-change">Votre num\u00e9ro a chang\u00e9\u00a0?</button>'
    +     '<button type="button" class="k-ck-id-notyou">Ce n\u2019est pas vous\u00a0?</button>'
    +   '</span>'
    + '</div>';
  return el;
}

/**
 * Met à jour une carte identité existante (après changement de numéro).
 * Pure DOM : ne lit pas le state, ne déclenche aucun réseau.
 * @param {HTMLElement} card  - le #ck-identity-recap déjà inséré
 * @param {Object} identity   - { full_name?, name?, phone? }
 */
export function applyIdentityToCard(card, identity) {
  if (!card || !identity) return;
  const n = identity.full_name || identity.name || '';
  const p = identity.phone || '';
  const iv = card.querySelector('.k-ck-id-initials'); if (iv) iv.textContent = _idInitials(n || p);
  const nv = card.querySelector('.k-ck-id-name');     if (nv) nv.textContent = n || p;
  let pv = card.querySelector('.k-ck-id-num');
  if (n && p) {
    if (!pv) {
      pv = document.createElement('span');
      pv.className = 'k-ck-id-num';
      // .k-ck-id-num est toujours le dernier enfant direct de .k-ck-id-ident
      // dans le gabarit d'origine (juste après .k-ck-id-value) — appendChild
      // reproduit cet ordre sans supposer une position de .k-ck-id-verified
      // qui n'est en réalité pas un enfant direct de .k-ck-id-ident (il est
      // imbriqué dans .k-ck-id-value), ce qui faisait planter insertBefore.
      card.querySelector('.k-ck-id-ident')?.appendChild(pv);
    }
    pv.textContent = p;
  } else if (pv) {
    pv.remove();
  }
}
