/**
 * @module b-checkout
 * @brief §11 CHECKOUT — Commande, paiement, wallet, order success
 *
 * Extrait de boutique.js — Option C Phase 8
 */

import { bus }           from './b-bus.js';
import { state, dom, $, $$, scroll }  from './b-store.js';
import { fmt, sanitize, genIdempotencyKey, apiGet, apiPost } from './b-utils.js';
import { showToast, cartTotal, saveCart }   from './b-cart-core.js';
import { openCart, closeCart, renderCart }  from './b-cart.js';

// Stripe globals (initialized on demand)
let _stripe = (typeof window !== 'undefined' && window.Stripe) ? null : null;
let _stripeCard = null;
let _stripeElements = null;

const PHONE_COUNTRIES = [
  { code: '+269', flag: '🇰🇲', name: 'Comores', digits: 7, max: 7, ph: '321 12 34' },
  { code: '+33',  flag: '🇫🇷', name: 'France', digits: 9, max: 10, ph: '06 12 34 56 78' },
  { code: '+262', flag: '🇷🇪', name: 'Réunion', digits: 9, max: 10, ph: '0692 12 34 56' },
  { code: '+32',  flag: '🇧🇪', name: 'Belgique', digits: 9, max: 10, ph: '0470 12 34 56' },
  { code: '+41',  flag: '🇨🇭', name: 'Suisse', digits: 9, max: 10, ph: '076 123 45 67' },
  { code: '+44',  flag: '🇬🇧', name: 'Royaume-Uni', digits: 10, max: 11, ph: '07911 123456' },
  { code: '+1',   flag: '🇺🇸', name: 'USA / Canada', digits: 10, max: 10, ph: '202 555 0147' },
  { code: '+971', flag: '🇦🇪', name: 'Émirats', digits: 9, max: 10, ph: '050 123 4567' },
  { code: '+966', flag: '🇸🇦', name: 'Arabie Saoudite', digits: 9, max: 10, ph: '055 123 4567' },
  { code: '+60',  flag: '🇲🇾', name: 'Malaisie', digits: 9, max: 10, ph: '012 345 6789' },
  { code: '+212', flag: '🇲🇦', name: 'Maroc', digits: 9, max: 10, ph: '0612 345678' },
];

async function ensureStripe() {
  if (_stripe) return _stripe;
  try {
    if (typeof window.Stripe !== 'function') {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://js.stripe.com/v3/';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const cfg = await apiGet('/api/public/config');
    const key = cfg && cfg.stripe_public_key;
    if (key && typeof window.Stripe === 'function') {
      _stripe = window.Stripe(key);
    }
  } catch(e) { console.warn('[Stripe] init failed:', e.message || e); }
  return _stripe;
}



  // ║  §11 · CHECKOUT — Commande, paiement, wallet, order success      ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-checkout.js

  /**
   * @brief checkoutCart — Lance le flow de commande depuis le panier
   * Prérequis : panier non vide (sinon toast error)
   * Ferme le tiroir panier, initialise state.orderData, affiche renderCheckout()
   */
export function digitsOnly(v) {
    return String(v || '').replace(/\D+/g, '');
  }

export function normalizeLocal(code, digits) {
    // On accepte le 0 national saisi par l'utilisateur pour certains pays
    if (
      ['+33', '+262', '+32', '+41', '+44', '+971', '+966', '+60', '+212'].includes(code) &&
      digits.startsWith('0')
    ) {
      return digits.slice(1);
    }
    return digits;
  }

export function prettifyLocal(raw, country) {
    const d = digitsOnly(raw).slice(0, country.max);
    if (!d) return '';
    // formatage léger visuel seulement
    if (country.code === '+33' || country.code === '+262' || country.code === '+32' || country.code === '+41') {
      return d.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
    }
    if (country.code === '+44') {
      return d.replace(/(\d{5})(\d{0,6})/, function(_, a, b){ return b ? a + ' ' + b : a; }).trim();
    }
    if (country.code === '+1') {
      return d.replace(/(\d{3})(\d{0,3})(\d{0,4})/, function(_, a, b, c){
        return [a, b, c].filter(Boolean).join(' ');
      }).trim();
    }
    return d.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
  }

export function buildE164(code, raw) {
    let digits = digitsOnly(raw);
    if (!digits) return '';
    digits = normalizeLocal(code, digits);
    return code + digits;
  }

export function checkoutCart() {
    if (state.cart.length === 0) { showToast('Votre panier est vide.', 'error'); return; }
    closeCart();
    state.orderData = { payment_mode: 'cash_relais' };
    renderCheckout();
    dom.orderModal.classList.add('open');
    scroll.savedY = window.scrollY;
    document.body.classList.add('cart-open');
    // FIX : masquer bnav pour voir bouton Payer
    const bnav = document.getElementById('k-bnav');
    if (bnav) {
      bnav.classList.add('u-hidden');
    }
  }

  /**
   * Ferme et détruit le modal de confirmation de commande.
   */
export function closeOrderModal() {
    dom.orderModal.classList.remove('open');
    document.body.classList.remove('cart-open');
    // FIX : restaurer bnav
    const bnav = document.getElementById('k-bnav');
    if (bnav) {
      bnav.classList.remove('u-hidden');
    }
    if (scroll.savedY) {
      window.scrollTo(0, scroll.savedY);
      scroll.savedY = 0;
    }
  }

  /**
   * Rend l'interface complète de passage de commande (récap + formulaire contact + paiement).
   * Gère les étapes : validation panier → saisie infos → confirmation.
   */
async function _loadRelaisSection(container, od) {
  try {
    const data = await apiGet('/api/relais');
    const list = Array.isArray(data) ? data : (data.relais || data.data || []);
    if (!list.length) { container.innerHTML = '<div class="ck-relais-empty">Aucun relais disponible</div>'; return; }
    const byIle = {};
    list.forEach(r => { const ile = classifyRelayGroup(r); if (!byIle[ile]) byIle[ile] = []; byIle[ile].push(r); });
    container.classList.remove('is-error');
    container.innerHTML = '';
    const zone = od.fulfillment_zone || 'comoros';
    const groups = getRelayGroupOrder(Object.keys(byIle)).filter(ile => zone === 'france' ? ile === 'France' : ile !== 'France');
    if (!groups.length) {
      container.innerHTML = '<div class="ck-relais-empty">Aucun relais disponible pour cette zone</div>';
      return;
    }

    const ileLabel = document.createElement('div'); ileLabel.className = 'ck-relais-ile-label'; ileLabel.textContent = ''; container.appendChild(ileLabel);
    const ileGrid = document.createElement('div'); ileGrid.className = 'ck-relais-ile-grid';
    const listWrap = document.createElement('div'); listWrap.id = 'ck-relais-list';
    groups.forEach(ile => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ck-relais-ile-btn'; btn.textContent = ile; btn.dataset.ile = ile;
      btn.addEventListener('click', () => {
        clearRelaySelectionError();
        ileGrid.querySelectorAll('.ck-relais-ile-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _renderRelaisForIle(listWrap, byIle[ile], od);
      });
      ileGrid.appendChild(btn);
    });
    container.appendChild(ileGrid);
    container.appendChild(listWrap);
    const firstBtn = ileGrid.querySelector('.ck-relais-ile-btn'); if (firstBtn) firstBtn.click();
  } catch(e) { container.innerHTML = '<div class="ck-relais-error">Erreur chargement relais — réessayez</div>'; console.warn('[checkout] relais:', e); }
}

function classifyRelayGroup(relais) {
  const haystack = [
    relais.country,
    relais.country_name,
    relais.island,
    relais.ile,
    relais.island_name,
    relais.zone,
    relais.name,
    relais.address,
    relais.adresse,
    relais.location,
  ].filter(Boolean).join(' ').toLowerCase();

  if (haystack.includes('france') || haystack.includes('paris')) return 'France';
  if (haystack.includes('anjouan')) return 'Ndzouani';
  if (haystack.includes('grande comore') || haystack.includes('ngazidja') || haystack.includes('moroni')) return 'Ngazidja';
  if (haystack.includes('moh') || haystack.includes('fomboni')) return 'Mwali';
  return relais.island || relais.ile || relais.island_name || 'Comores';
}

function getRelayGroupOrder(groups) {
  const order = ['Ndzouani', 'Ngazidja', 'Mwali', 'France', 'Comores'];
  return groups.slice().sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'fr');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function _renderRelaisForIle(listEl, relaisList, od) {
  listEl.innerHTML = '';
  const visibleRelais = relaisList.filter(r => {
    const haystack = [
      r.name,
      r.nom,
      r.address,
      r.adresse,
      r.location,
    ].filter(Boolean).join(' ').toLowerCase();
    return !haystack.includes('domoni');
  });

  if (visibleRelais.length === 1) {
    const r = visibleRelais[0];
    const item = document.createElement('div');
    item.className = 'ck-relais-item ck-relais-item--compact selected';
    item.dataset.id = r.id;
    item.innerHTML =
      '<span class="ck-relais-name">' + (r.name || r.nom || '') + '</span>' +
      (r.address || r.adresse || r.location
        ? '<span class="ck-relais-addr">' + (r.address || r.adresse || r.location) + '</span>'
        : '');
    od.selectedRelaisId = r.id;
    clearRelaySelectionError();
    listEl.appendChild(item);
    refreshCheckoutComputedUI();
    return;
  }

  visibleRelais.forEach(r => {
    const item = document.createElement('div'); item.className = 'ck-relais-item'; item.dataset.id = r.id;
    item.innerHTML = '<span class="ck-relais-name">' + (r.name || r.nom || '') + '</span>' + (r.address || r.adresse || r.location ? '<span class="ck-relais-addr">' + (r.address || r.adresse || r.location) + '</span>' : '');
    item.addEventListener('click', () => {
      listEl.querySelectorAll('.ck-relais-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      od.selectedRelaisId = r.id;
      clearRelaySelectionError();
      refreshCheckoutComputedUI();
    });
    listEl.appendChild(item);
  });

  const first = listEl.querySelector('.ck-relais-item');
  if (first && !od.selectedRelaisId) {
    first.click();
  } else {
    refreshCheckoutComputedUI();
  }
}

function readIntlPhoneValue(id, fallbackValue) {
  const input = document.getElementById(id);
  const countrySel = document.getElementById(id + '-country');
  if (!input || !countrySel) return (fallbackValue || '').trim();
  const country = PHONE_COUNTRIES.find(c => c.code === countrySel.value);
  const digits = normalizeLocal(countrySel.value, digitsOnly(input.value));
  if (!country || !digits || digits.length !== country.digits) return '';
  return buildE164(countrySel.value, digits);
}

function renderFulfillmentSelector(container, od, onChange) {
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

function getDefaultPhoneCodeForZone(zone) {
  return zone === 'france' ? '+33' : '+269';
}

function setIntlPhoneDefault(id, zone, force) {
  const sel = document.getElementById(id + '-country');
  const input = document.getElementById(id);
  if (!sel) return;
  const nextCode = getDefaultPhoneCodeForZone(zone);
  const hasValue = !!String(input?.value || '').trim();
  if (force || !hasValue) {
    sel.value = nextCode;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function clearRelaySelectionError() {
  document.getElementById('ck-relais-section')?.classList.remove('is-error');
}

function markRelaySelectionError() {
  document.getElementById('ck-relais-section')?.classList.add('is-error');
}

function setCheckoutConfirmButton(button, mainText, subText) {
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

function refreshCheckoutComputedUI() {
  const confirmBtn = document.getElementById('btn-confirm-order');
  if (!confirmBtn) return;
  const od = state.orderData || {};
  const mode = document.querySelector('input[name="payment_mode"]:checked')?.value || od.payment_mode || 'cash_relais';
  const relayName = document.querySelector('#ck-relais-section .ck-relais-item.selected .ck-relais-name')?.textContent?.trim() || '';
  const mainText = mode === 'stripe_eur'
    ? '💳 Payer ' + fmt(cartTotal(), 'KMF')
    : '✅ Confirmer — ' + fmt(cartTotal(), 'KMF');
  const subText = mode === 'stripe_eur'
    ? (relayName ? 'Carte via Stripe • ' + relayName : 'Carte via Stripe')
    : (relayName ? 'Cash au relais • ' + relayName : 'Cash au relais');
  setCheckoutConfirmButton(confirmBtn, mainText, subText);
  const cashHelper = document.getElementById('ck-pay-cash-helper');
  if (cashHelper) cashHelper.hidden = mode !== 'cash_relais';
}

function renderCheckoutCompact() {
  const body = dom.orderBody;
  body.innerHTML = '';
  body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());
  dom.orderTitle.textContent = 'Commander';

  const od = state.orderData;
  if (!od.checkout_step) od.checkout_step = 1;

  const backBtn = document.createElement('button');
  backBtn.className = 'ck-back-btn';
  backBtn.type = 'button';
  backBtn.innerHTML = '← Panier';
  backBtn.addEventListener('click', () => {
    closeOrderModal();
    setTimeout(() => { if (typeof openCart === 'function') openCart(); }, 150);
  });
  body.appendChild(backBtn);

  // Pas de stepper — tout sur une page

  const step1 = document.createElement('div');
  step1.className = 'ck-step-panel';
  step1.dataset.step = '1';
  step1.style.display = 'block'; // toujours visible
  step1.innerHTML = '';
  step1.appendChild(makeInput('of-beneficiary-name', 'Nom *', 'text', 'Prénom Nom', od, 'beneficiary_name'));
  step1.appendChild(makeIntlPhoneInput('of-beneficiary-phone', 'Téléphone du bénéficiaire *', od, 'beneficiary_phone'));

  body.appendChild(step1);

  const step2 = document.createElement('div');
  step2.className = 'ck-step-panel';
  step2.dataset.step = '2';
  step2.style.display = 'block'; // toujours visible
  step2.innerHTML = '';
  body.appendChild(step2);

  const sRelais = document.createElement('div');
  sRelais.className = 'ck-label';
  sRelais.textContent = 'Île de retrait *';
  step2.appendChild(sRelais);
  const relayNote = document.createElement('div');
  relayNote.className = 'ck-relay-note';
  // note relais supprimée
  const relaisSection = document.createElement('div');
  relaisSection.id = 'ck-relais-section';
  relaisSection.className = 'ck-relais-section';
  relaisSection.innerHTML = '<div class="ck-relais-loading">⏳ Chargement des relais...</div>';
  step2.appendChild(relaisSection);
  _loadRelaisSection(relaisSection, od);

  const s2 = document.createElement('div');
  s2.className = 'ck-label';
  s2.textContent = 'Mode de paiement';
  step2.appendChild(s2);

  const payGrid = document.createElement('div');
  payGrid.className = 'ck-pay-grid';
  payGrid.innerHTML = '<label class="ck-pay-chip" id="ck-chip-cash"><input type="radio" name="payment_mode" value="cash_relais" checked><span class="ck-chip-icon">🏪</span><span class="ck-chip-lbl">Cash</span></label><label class="ck-pay-chip ck-pay-chip--off"><input type="radio" name="payment_mode" value="mvola" disabled><span class="ck-chip-icon">📱</span><span class="ck-chip-lbl">MVola<br><em class="ck-soon">Bientôt</em></span></label><label class="ck-pay-chip" id="ck-chip-stripe"><input type="radio" name="payment_mode" value="stripe_eur"><span class="ck-chip-icon">💳</span><span class="ck-chip-lbl">Carte</span></label>';
  step2.appendChild(payGrid);

  document.querySelectorAll('#stripe-card-wrap').forEach(el => el.remove());
  if (_stripeCard) { try { _stripeCard.unmount(); } catch(e){} _stripeCard = null; _stripeElements = null; }
  const stripeCardWrap = document.createElement('div');
  stripeCardWrap.id = 'stripe-card-wrap';
  stripeCardWrap.className = 'k-stripe-wrap';
  stripeCardWrap.innerHTML = '<div class="k-stripe-title">🔒 Informations de carte</div><div id="stripe-card-element" class="k-stripe-element"></div><div id="stripe-card-error" class="k-stripe-error"></div><div id="stripe-eur-display" class="k-stripe-eur"></div>';
  step2.appendChild(stripeCardWrap);

  const senderGroup = makeIntlPhoneInput('of-sender-phone', 'Recevoir le suivi (optionnel)', od, 'sender_phone');
  step2.appendChild(senderGroup);

  checkWalletBalance();
  const walletSection = document.createElement('div');
  walletSection.id = 'wallet-section';
  walletSection.className = 'k-wallet-section';
  walletSection.innerHTML = '<label class="k-wallet-label"><input type="checkbox" id="cb-use-wallet" class="k-wallet-cb"><div class="k-wallet-info"><div class="k-wallet-title">💰 Utiliser mon crédit</div><div id="wallet-balance-text" class="k-wallet-balance">Chargement…</div></div></label><div id="wallet-deduction" class="k-wallet-ded"></div>';
  step2.appendChild(walletSection);

  const step2Actions = document.createElement('div');
  step2Actions.className = 'ck-step-actions';
  step2Actions.innerHTML = '<button type="button" class="ck-step-btn ck-step-btn--ghost" id="ck-prev-step">← Modifier</button>';
  step2.appendChild(step2Actions);

  document.querySelectorAll('#btn-confirm-order').forEach(el => el.remove());
  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'btn-confirm-order';
  confirmBtn.className = 'ck-confirm-btn';
  confirmBtn.innerHTML = '<span class="ck-confirm-main">Confirmer la commande</span><span class="ck-confirm-amount">' + fmt(cartTotal(), 'KMF') + '</span>';
  body.parentElement.appendChild(confirmBtn);

  function validateStep1() {
    const recipName = (document.getElementById('of-beneficiary-name')?.value || '').trim();
    const recipPhone = readIntlPhoneValue('of-beneficiary-phone', od.beneficiary_phone);
    if (!recipName) { showToast('Indiquez le nom de la personne qui récupère.', 'error'); return false; }
    if (!recipPhone) { showToast('Indiquez un téléphone valide pour le bénéficiaire.', 'error'); return false; }
    od.beneficiary_name = recipName;
    od.beneficiary_phone = recipPhone;
    return true;
  }

  function setStep(step) {
    od.checkout_step = step;
    body.querySelectorAll('.ck-step-panel').forEach(el => el.classList.toggle('active', el.dataset.step === String(step)));
    body.querySelectorAll('.ck-step-chip').forEach(el => el.classList.toggle('active', el.dataset.step === String(step)));
    confirmBtn.style.display = step === 2 ? '' : 'none';
    body.scrollTop = 0;
  }

  function updatePaymentUI() {
    const mode = document.querySelector('input[name="payment_mode"]:checked');
    const isStripe = mode && mode.value === 'stripe_eur';
    od.payment_mode = mode ? mode.value : 'cash_relais';
    document.querySelectorAll('.ck-pay-chip').forEach(chip => {
      const r = chip.querySelector('input[type=radio]');
      if (r && !r.disabled) chip.classList.toggle('ck-pay-chip--active', r.checked);
    });
    const wrap = document.getElementById('stripe-card-wrap');
    if (wrap) {
      wrap.classList.toggle('is-visible', isStripe);
      if (isStripe) { const ed = document.getElementById('stripe-eur-display'); if (ed) ed.classList.add('is-visible'); }
    }
    if (isStripe && !_stripeCard) {
      ensureStripe().then(stripe => {
        if (!stripe) {
          const errEl = document.getElementById('stripe-card-error');
          if (errEl) { errEl.textContent = 'Paiement carte indisponible.'; errEl.classList.add('is-visible'); }
          return;
        }
        if (_stripeCard) return;
        _stripeElements = stripe.elements();
        _stripeCard = _stripeElements.create('card', {
          style: { base: { fontSize: '15px', color: '#1e293b', '::placeholder': { color: '#94a3b8' } }, invalid: { color: '#dc2626' } },
          hidePostalCode: true
        });
        _stripeCard.mount('#stripe-card-element');
        _stripeCard.on('change', ev => {
          const errEl = document.getElementById('stripe-card-error');
          if (errEl) { errEl.textContent = ev.error ? ev.error.message : ''; errEl.classList.toggle('is-visible', !!ev.error); }
        });
      });
    }
    confirmBtn.innerHTML = isStripe
      ? '<span class="ck-confirm-main">💳 Payer par carte</span><span class="ck-confirm-amount">' + fmt(cartTotal(), 'KMF') + '</span>'
      : '<span class="ck-confirm-main">Confirmer la commande</span><span class="ck-confirm-amount">' + fmt(cartTotal(), 'KMF') + '</span>';
  }

  payGrid.addEventListener('change', updatePaymentUI);
  document.getElementById('ck-next-step')?.addEventListener('click', () => { if (validateStep1()) setStep(2); });
  document.getElementById('ck-prev-step')?.addEventListener('click', () => setStep(1));
  setTimeout(() => {
    const cb = document.getElementById('cb-use-wallet');
    if (cb) cb.addEventListener('change', function() { od.use_wallet = this.checked; updateWalletDisplay(); });
  }, 0);
  updatePaymentUI();
  setStep(od.checkout_step);
  confirmBtn.addEventListener('click', () => submitOrder(confirmBtn));
}
export function renderCheckout() {
    const body = dom.orderBody;
    body.innerHTML = '';
    body.classList.add('k-order-body--checkout');
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());
    dom.orderTitle.innerHTML = '<button type="button" class="ck-modal-back-btn ck-modal-back-btn--header" aria-label="Retour au panier">← Panier</button><span class="ck-order-title-text">🛒 Commander</span>';

    const od = state.orderData;
    if (!od.fulfillment_zone) od.fulfillment_zone = 'comoros';

    const headerBackBtn = dom.orderTitle.querySelector('.ck-modal-back-btn--header');
    if (headerBackBtn) {
      headerBackBtn.addEventListener('click', () => {
        closeOrderModal();
        setTimeout(() => { if (typeof openCart === 'function') openCart(); }, 150);
      });
    }

    renderFulfillmentSelector(body, od, refreshFulfillment);

      body.appendChild(makeInput('of-beneficiary-name',  'Nom du bénéficiaire *', 'text', 'Prénom Nom', od, 'beneficiary_name'));
    body.appendChild(makeIntlPhoneInput('of-beneficiary-phone', 'Téléphone du bénéficiaire *', od, 'beneficiary_phone'));

    /* ── 2b. Point relais ── */
    const sRelais = document.createElement('div');
    sRelais.className = 'ck-label';
    sRelais.textContent = 'Île de retrait *';
    body.appendChild(sRelais);
    const relaisSection = document.createElement('div');
    relaisSection.id = 'ck-relais-section';
    relaisSection.className = 'ck-relais-section';
    relaisSection.innerHTML = '<div class="ck-relais-loading">⏳ Chargement des relais...</div>';
    body.appendChild(relaisSection);
    _loadRelaisSection(relaisSection, od);

    /* ── 3. Paiement ── */
    const s2 = document.createElement('div');
    s2.className = 'ck-label';
    s2.textContent = 'Mode de paiement';
    body.appendChild(s2);

    const payGrid = document.createElement('div');
    payGrid.className = 'ck-pay-grid';
    payGrid.innerHTML =
      '<label class="ck-pay-chip" id="ck-chip-cash">'
      + '<input type="radio" name="payment_mode" value="cash_relais" checked>'
      + '<span class="ck-chip-icon">🏪</span><span class="ck-chip-lbl">Cash</span>'
      + '</label>'
      + '<label class="ck-pay-chip ck-pay-chip--off">'
      + '<input type="radio" name="payment_mode" value="mvola" disabled>'
      + '<span class="ck-chip-icon">📱</span>'
      + '<span class="ck-chip-lbl">MVola<br><em class="ck-soon">Bientôt</em></span>'
      + '</label>'
      + '<label class="ck-pay-chip" id="ck-chip-stripe">'
      + '<input type="radio" name="payment_mode" value="stripe_eur">'
      + '<span class="ck-chip-icon">💳</span><span class="ck-chip-lbl">Carte<br><em class="ck-stripe-tag">Stripe</em></span>'
      + '</label>';
    body.appendChild(payGrid);

    const cashHelper = document.createElement('div');
    cashHelper.id = 'ck-pay-cash-helper';
    cashHelper.className = 'ck-pay-helper';
    cashHelper.hidden = true;
    cashHelper.textContent = 'Un code de paiement vous sera envoyé pour régler au relais.';
    body.appendChild(cashHelper);

    // Stripe card wrap : inline dans le scroll, juste sous les chips paiement
    // FIX: supprimer tout ancien wrap (sinon doublons => Stripe casse en silence)
    document.querySelectorAll('#stripe-card-wrap').forEach(el => el.remove());
    if (_stripeCard) { try { _stripeCard.unmount(); } catch(e){} _stripeCard = null; _stripeElements = null; }
    const stripeCardWrap = document.createElement('div');
    stripeCardWrap.id = 'stripe-card-wrap';
    stripeCardWrap.className = 'k-stripe-wrap';
    stripeCardWrap.innerHTML = '<div class="k-stripe-title">🔒 Informations de carte</div>'
      + '<div id="stripe-card-element" class="k-stripe-element"></div>'
      + '<div id="stripe-card-error" class="k-stripe-error"></div>'
      + '<div id="stripe-eur-display" class="k-stripe-eur"></div>';
    body.appendChild(stripeCardWrap);

    const senderGroup2 = makeIntlPhoneInput('of-sender-phone', 'Recevoir le suivi (optionnel)', od, 'sender_phone');
    body.appendChild(senderGroup2);

    function refreshFulfillment() {
      setIntlPhoneDefault('of-beneficiary-phone', od.fulfillment_zone, !od.beneficiary_phone);
      setIntlPhoneDefault('of-sender-phone', od.fulfillment_zone, !od.sender_phone);
      _loadRelaisSection(relaisSection, od);
    }
    refreshFulfillment();

    /* ── 5. Wallet ── */
    checkWalletBalance();
    const walletSection = document.createElement('div');
    walletSection.id = 'wallet-section';
    walletSection.className = 'k-wallet-section';
    walletSection.innerHTML = '<label class="k-wallet-label">'
      + '<input type="checkbox" id="cb-use-wallet" class="k-wallet-cb">'
      + '<div class="k-wallet-info"><div class="k-wallet-title">💰 Utiliser mon crédit</div>'
      + '<div id="wallet-balance-text" class="k-wallet-balance">Chargement…</div></div></label>'
      + '<div id="wallet-deduction" class="k-wallet-ded"></div>';
    body.appendChild(walletSection);

    /* ── 6. Confirm (sticky) ── */
    // FIX: supprimer tout ancien bouton confirm
    document.querySelectorAll('#btn-confirm-order').forEach(el => el.remove());
    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'btn-confirm-order';
    confirmBtn.className = 'ck-confirm-btn';
    setCheckoutConfirmButton(confirmBtn, '✅ Confirmer — ' + fmt(cartTotal(), 'KMF'), 'Cash au relais');
    // Bouton confirm HORS du scroll area → toujours visible en bas du modal
    body.parentElement.appendChild(confirmBtn);

    /* ── Payment switching ── */
    // stripeCardWrap reste dans body (inline sous les chips)

    /**
 * Met à jour le récapitulatif paiement en checkout.
 */
  function updatePaymentUI() {
      const mode = document.querySelector('input[name="payment_mode"]:checked');
      const isStripe = mode && mode.value === 'stripe_eur';
      od.payment_mode = mode ? mode.value : 'cash_relais';

      document.querySelectorAll('.ck-pay-chip').forEach(chip => {
        const r = chip.querySelector('input[type=radio]');
        if (r && !r.disabled) chip.classList.toggle('ck-pay-chip--active', r.checked);
      });

      const wrap = document.getElementById('stripe-card-wrap');
      if (wrap) {
        wrap.classList.toggle('is-visible', isStripe);
        if (isStripe) { const ed = document.getElementById('stripe-eur-display'); if (ed) ed.classList.add('is-visible'); }
      }

      if (isStripe && !_stripeCard) {
        ensureStripe().then(stripe => {
          if (!stripe) {
            const errEl = document.getElementById('stripe-card-error');
            if (errEl) { errEl.textContent = 'Paiement carte indisponible.'; errEl.classList.add('is-visible'); }
            return;
          }
          if (_stripeCard) return;
          _stripeElements = stripe.elements();
          _stripeCard = _stripeElements.create('card', {
            style: { base: { fontSize: '15px', color: '#1e293b', '::placeholder': { color: '#94a3b8' } }, invalid: { color: '#dc2626' } },
            hidePostalCode: true
          });
          _stripeCard.mount('#stripe-card-element');
          _stripeCard.on('change', ev => {
            const errEl = document.getElementById('stripe-card-error');
            if (errEl) { errEl.textContent = ev.error ? ev.error.message : ''; errEl.classList.toggle('is-visible', !!ev.error); }
          });
        });
      }

      refreshCheckoutComputedUI();
    }

    payGrid.addEventListener('change', updatePaymentUI);
    updatePaymentUI(); // init état chip cash
    refreshCheckoutComputedUI();

    setTimeout(() => {
      const cb = document.getElementById('cb-use-wallet');
      if (cb) cb.addEventListener('change', function() { od.use_wallet = this.checked; updateWalletDisplay(); });
    }, 0);

    confirmBtn.addEventListener('click', () => submitOrder(confirmBtn));
  }

    /* ── Checkout form helpers ── */

  /**
 * Crée un input stylé pour le checkout.
 * @param {string} type
 * @param {string} name
 * @param {string} placeholder
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
   * Crée un champ de saisie téléphone international avec sélecteur d'indicatif.
   * @param {string} id       - ID HTML du champ
   * @param {string} label    - Label affiché
   * @param {Object} dataObj  - Objet de données où écrire la valeur normalisée
   * @param {string} key      - Clé de l'objet dataObj à mettre à jour
   */
export function makeIntlPhoneInput(id, label, dataObj, key) {
  const COUNTRIES = PHONE_COUNTRIES;

  const group = document.createElement('div');
  group.className = 'k-ck-group';

  const lbl = document.createElement('label');
  lbl.className = 'k-ck-label';
  lbl.textContent = label;
  group.appendChild(lbl);

  const wrap = document.createElement('div');
  wrap.className = 'k-ck-phone-wrap';

  const sel = document.createElement('select');
  sel.id = id + '-country';
  sel.className = 'k-ck-phone-select';
  COUNTRIES.forEach(function(c) {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.flag + ' ' + c.code;
    if (c.code === '+269') opt.selected = true;
    sel.appendChild(opt);
  });

  const input = document.createElement('input');
  input.type = 'tel';
  input.id = id;
  input.inputMode = 'numeric';
  input.autocomplete = 'tel';
  input.placeholder = '321 12 34';
  input.className = 'k-ck-phone-input';

  const help = document.createElement('div');
  help.className = 'k-ck-phone-help';
  help.textContent = '';

  function currentCountry() {
    return COUNTRIES.find(c => c.code === sel.value) || COUNTRIES[0];
  }

  function sync() {
    const country = currentCountry();
    input.placeholder = country.ph;

    let rawDigits = digitsOnly(input.value).slice(0, country.max);
    input.value = prettifyLocal(rawDigits, country);

    const e164 = buildE164(country.code, rawDigits);
    dataObj[key] = e164 || '';
  }

  sel.addEventListener('change', function() {
    const c = currentCountry();
    help.textContent = '';
    sync();
  });

  input.addEventListener('blur', sync);
  input.addEventListener('input', sync);

  // Pré-remplissage depuis dataObj si déjà existant
  if (dataObj[key]) {
    const existing = String(dataObj[key]).trim();
    const found = COUNTRIES.find(c => existing.startsWith(c.code));
    if (found) {
      sel.value = found.code;
      const local = existing.slice(found.code.length);
      input.value = prettifyLocal(local, found);
    }
  }

  wrap.appendChild(sel);
  wrap.appendChild(input);
  group.appendChild(wrap);
  group.appendChild(help);

  // Sync initial
  sync();

  return group;
}

  /**
   * Crée un champ téléphone simplifié (sans sélecteur d'indicatif) pour les Comores.
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
      if (raw.length >= 4) raw = raw.substring(0,3) + ' ' + raw.substring(3);
      if (raw.length >= 7) raw = raw.substring(0,6) + ' ' + raw.substring(6);
      input.value = raw;
      dataObj[key] = raw;
    });
    wrap.appendChild(input);
    group.appendChild(wrap);
    return group;
  }


  /* ── Wallet ── */
export async function checkWalletBalance() {
    try {
      const res = await fetch('/api/wallet', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        state.walletBalance = data.balance_kmf || 0;
        const section = document.getElementById('wallet-section');
        if (section && state.walletBalance > 0) {
          section.classList.add('is-visible');
          const balText = document.getElementById('wallet-balance-text');
          if (balText) balText.textContent = 'Solde disponible : ' + fmt(state.walletBalance, 'KMF');
        }
      }
    } catch(e) { /* wallet balance non disponible */ }
  }

export function updateWalletDisplay() {
    const ded = document.getElementById('wallet-deduction');
    if (!ded) return;
    const cb = document.getElementById('cb-use-wallet');
    if (cb && cb.checked && state.walletBalance > 0) {
      const total = cartTotal();
      const applied = Math.min(state.walletBalance, total);
      const remaining = total - applied;
      ded.classList.add('is-visible');
      ded.innerHTML = '<div class="k-wal-row"><span>💰 Crédit appliqué</span><span class="k-wal-value">-' + fmt(applied, 'KMF') + '</span></div>' +
        (remaining > 0 ? '<div class="k-wal-row"><span>Reste à payer</span><span class="k-wal-bold">' + fmt(remaining, 'KMF') + '</span></div>' : '<div class="k-wal-success">✅ Entièrement couvert par votre crédit !</div>');
    } else {
      ded.classList.remove('is-visible');
    }
  }

export async function submitOrder(btn) {
  const od = state.orderData;
  const recipName  = (document.getElementById('of-beneficiary-name')?.value || '').trim();
  const recipPhone = readIntlPhoneValue('of-beneficiary-phone', od.beneficiary_phone);

  let senderPhone = (od.sender_phone || '').trim();
  if (senderPhone.length < 8) {
    const _phoneInput = document.getElementById('of-sender-phone');
    const _countrySel = document.getElementById('of-sender-phone-country');
    const _code = _countrySel?.value || '+269';
    const RULES = { '+33': 9, '+269': 7, '+262': 9, '+32': 9, '+41': 9, '+44': 10, '+1': 10, '+971': 9, '+966': 9, '+60': 9, '+212': 9 };
    let _digits = String(_phoneInput?.value || '').replace(/\D/g, '');
    if (['+33', '+262', '+32', '+41', '+44', '+971', '+966', '+60', '+212'].includes(_code) && _digits.startsWith('0')) {
      _digits = _digits.slice(1);
    }
    if (_digits.length > 0) {
      const expected = RULES[_code] || 9;
      if (_digits.length !== expected) {
        showToast(`Numéro invalide pour ${_code}. ${expected} chiffres attendus.`, 'error');
        return;
      }
      senderPhone = _code + _digits;
    }
  }

  const clientName = recipName;
  const fullRecipPhone = recipPhone;
  const clientEmail = undefined;

  if (!recipName) { showToast('Indiquez le nom de la personne qui récupère.', 'error'); return; }
  if (!recipPhone) { showToast('Indiquez un téléphone valide pour le bénéficiaire.', 'error'); return; }

  const isStripe = od.payment_mode === 'stripe_eur';
  const trackingPhone = senderPhone && senderPhone.length >= 8 ? senderPhone : null;

  if (!od.selectedRelaisId) {
    markRelaySelectionError();
    document.getElementById('ck-relais-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Veuillez choisir un point relais pour la livraison.', 'error');
    return;
  }

  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  setCheckoutConfirmButton(btn, isStripe ? '⏳ Paiement en cours…' : '⏳ Envoi en cours…', '');
  btn.style.opacity = '0.7';

  try {
    const items = state.cart.map(i => ({
      product_id: String(i.product.id),
      quantity: i.qty,
      confection_type: 'aucun'
    }));

    let orderData = null;
    let apiResult = null;

    if (isStripe) {
      if (!state.checkoutAttemptKey) state.checkoutAttemptKey = genIdempotencyKey();
      if (!state.pendingStripeOrderRef) {
        apiResult = await apiPost('/api/orders', {
          items, relais_id: od.selectedRelaisId || undefined,
          recipient_name: recipName, recipient_phone: fullRecipPhone,
          payment_mode: od.payment_mode, use_wallet: od.use_wallet || false,
          tracking_phone: trackingPhone || undefined, share_token: state.shareToken || undefined
        }, { idempotencyKey: state.checkoutAttemptKey });
        orderData = apiResult.order || apiResult;
        state.pendingStripeOrderRef = orderData.reference;
      } else {
        orderData = { reference: state.pendingStripeOrderRef };
      }
    } else {
      apiResult = await apiPost('/api/orders', {
        items, relais_id: od.selectedRelaisId || undefined,
        recipient_name: recipName, recipient_phone: fullRecipPhone,
        payment_mode: od.payment_mode, use_wallet: od.use_wallet || false,
        tracking_phone: trackingPhone || undefined, share_token: state.shareToken || undefined
      });
      orderData = apiResult.order || apiResult;
    }

    if (isStripe) {
      if (!_stripe) await ensureStripe();
      if (!_stripe || !_stripeCard) throw new Error('Stripe non chargé. Rechargez la page.');
      btn.textContent = '🔒 Sécurisation du paiement…';
      const intentResult = await apiPost('/api/payments/stripe/intent', { order_reference: orderData.reference });
      btn.textContent = '💳 Validation en cours…';
      const stripeResult = await _stripe.confirmCardPayment(intentResult.client_secret, {
        payment_method: { card: _stripeCard, billing_details: { name: clientName, email: clientEmail || undefined } }
      });
      if (stripeResult.error) {
        const errEl = document.getElementById('stripe-card-error');
        if (errEl) { errEl.textContent = stripeResult.error.message; errEl.classList.remove('u-hidden'); }
        throw new Error(stripeResult.error.message);
      }
      showToast('🎉 Paiement accepté !', 'success');
      state.checkoutAttemptKey = null;
      state.pendingStripeOrderRef = null;
    }

    state.cart = [];
    saveCart();
    renderCart();
    renderOrderSuccess(orderData, recipName, clientEmail, apiResult || orderData);
    showToast('Commande confirmée !', 'success');
    btn.dataset.busy = '0';
  } catch (e) {
    console.error('submitOrder:', e);
    showToast(e.message || 'Erreur lors de la commande.', 'error');
    btn.disabled = false;
    btn.dataset.busy = '0';
    refreshCheckoutComputedUI();
    btn.style.opacity = '1';
  }
}

export function renderOrderSuccess(order, recipientName, clientEmail, fullResult) {
    const body = dom.orderBody;
    body.innerHTML = '';
    body.classList.remove('k-order-body--checkout');
    dom.orderTitle.textContent = '✅ Commande confirmée';
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());
    body.querySelectorAll('.ck-back-btn').forEach(b => b.remove());

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

    const orderQty = order.items_count || (order.items && order.items.length) || null;
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

    setTimeout(() => {
      const copyBtn = document.getElementById('k-copy-ref-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(order.reference || '').then(() => {
              showToast('📋 Référence copiée !', 'success');
              copyBtn.textContent = '✓ Copié';
              setTimeout(() => { copyBtn.textContent = '📋 Copier'; }, 2000);
            });
          }
        });
      }
      const closeBtn = document.getElementById('k-order-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', () => { closeOrderModal(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      const trackBtn = document.getElementById('k-order-track-btn');
      if (trackBtn) {
        trackBtn.addEventListener('click', () => {
          closeOrderModal();
          if (typeof renderTrackView === 'function') renderTrackView();
          if (typeof switchView === 'function') switchView('track');
          document.querySelectorAll('.k-bnav-item').forEach(i => i.classList.remove('active'));
          const trackNav = document.querySelector('.k-bnav-item[data-tab="track"]');
          if (trackNav) trackNav.classList.add('active');
          setTimeout(() => {
            const refInput = document.getElementById('k-otp-ref');
            if (refInput) { refInput.value = order.reference || ''; document.getElementById('k-otp-ref-btn')?.click(); }
          }, 350);
        });
      }
    }, 0);
  }
