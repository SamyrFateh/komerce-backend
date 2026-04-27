/**
 * @module b-checkout
 * @brief §11 CHECKOUT — Commande, paiement, wallet, order success
 *
 * Extrait de boutique.js — Option C Phase 8
 */

import { bus }           from './b-bus.js';
import { state, dom, $, $$ }  from './b-store.js';
import { fmt, sanitize, genIdempotencyKey } from './b-utils.js';
import { showToast, cartTotal, saveCart }   from './b-cart-core.js';
import { openCart, closeCart, renderCart }  from './b-cart.js';

  // ║  §11 · CHECKOUT — Commande, paiement, wallet, order success      ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-checkout.js

  /**
   * @brief checkoutCart — Lance le flow de commande depuis le panier
   * Prérequis : panier non vide (sinon toast error)
   * Ferme le tiroir panier, initialise state.orderData, affiche renderCheckout()
   */
    function checkoutCart() {
    if (state.cart.length === 0) { showToast('Votre panier est vide.', 'error'); return; }
    closeCart();
    state.orderData = { payment_mode: 'cash_relais' };
    renderCheckout();
    dom.orderModal.classList.add('open');
    window._savedScrollY = window.scrollY;
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
    if (typeof window._savedScrollY === 'number') {
      window.scrollTo(0, window._savedScrollY);
      window._savedScrollY = 0;
    }
  }

  /**
   * Rend l'interface complète de passage de commande (récap + formulaire contact + paiement).
   * Gère les étapes : validation panier → saisie infos → confirmation.
   */
export function renderCheckout() {
    const body = dom.orderBody;
    body.innerHTML = '';
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());
    dom.orderTitle.textContent = '🛒 Commander';

    const od = state.orderData;

    /* ── Bouton retour panier ── */
    const backBtn = document.createElement('button');
    backBtn.className = 'ck-back-btn';
    backBtn.type = 'button';
    backBtn.innerHTML = '← Retour au panier';
    backBtn.addEventListener('click', () => {
      closeOrderModal();
      setTimeout(() => { if (typeof openCart === 'function') openCart(); }, 150);
    });
    body.appendChild(backBtn);

    /* ── 2. Bénéficiaire ── */
    const s1 = document.createElement('div');
    s1.className = 'ck-label';
    s1.textContent = '📦 Bénéficiaire';
    body.appendChild(s1);
    body.appendChild(makeInput('of-beneficiary-name',  'Nom *',         'text', 'Prénom Nom',  od, 'beneficiary_name'));
    body.appendChild(makePhoneInput('of-beneficiary-phone', 'Tél. (+269) *', od, 'beneficiary_phone'));

    /* ── 3. Paiement ── */
    const s2 = document.createElement('div');
    s2.className = 'ck-label';
    s2.textContent = '💳 Paiement';
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
      + '<span class="ck-chip-icon">💳</span><span class="ck-chip-lbl">Carte</span>'
      + '</label>';
    body.appendChild(payGrid);

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

    /* ── 4. Suivi SMS accordion ── */
    const trackRow = document.createElement('div');
    trackRow.className = 'ck-track-row';
    trackRow.innerHTML = '<label class="k-ck-track-label">📲 Votre tél. pour le suivi (optionnel)</label>';
    body.appendChild(trackRow);

    const trackExtra = document.createElement('div');
    trackExtra.id = 'ck-track-extra';
    trackExtra.className = 'ck-track-extra';
    // Toujours visible — plus besoin de cocher une case
    const senderGroup = makeIntlPhoneInput('of-sender-phone', '', od, 'sender_phone');
    const trkHint = document.createElement('div');
    trkHint.className = 'ck-track-hint';
    trkHint.textContent = 'Notifié(e) par WhatsApp dès que la commande arrive au relais';
    trackExtra.appendChild(senderGroup);
    trackExtra.appendChild(trkHint);
    body.appendChild(trackExtra);

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
    confirmBtn.textContent = '✅ Confirmer — ' + fmt(cartTotal(), 'KMF');
    // Bouton confirm HORS du scroll area → toujours visible en bas du modal
    body.parentElement.appendChild(confirmBtn);

    /* ── Payment switching ── */
    // stripeCardWrap reste dans body (inline sous les chips)

    /**
 * Met à jour le récapitulatif paiement en checkout.
 */
export function updatePaymentUI() {
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

      if (isStripe && _stripe && !_stripeCard) {
        _stripeElements = _stripe.elements();
        _stripeCard = _stripeElements.create('card', {
          style: { base: { fontSize: '15px', color: '#1e293b', '::placeholder': { color: '#94a3b8' } }, invalid: { color: '#dc2626' } },
          hidePostalCode: true
        });
        _stripeCard.mount('#stripe-card-element');
        _stripeCard.on('change', ev => {
          const errEl = document.getElementById('stripe-card-error');
          if (errEl) { errEl.textContent = ev.error ? ev.error.message : ''; errEl.classList.toggle('is-visible', !!ev.error); }
        });
      }

      const btn = document.getElementById('btn-confirm-order');
      if (btn) btn.textContent = isStripe ? '💳 Payer ' + fmt(cartTotal(), 'KMF') : '✅ Confirmer — ' + fmt(cartTotal(), 'KMF');
    }

    payGrid.addEventListener('change', updatePaymentUI);
    updatePaymentUI(); // init état chip cash

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
  const COUNTRIES = [
    { code: '+33',  flag: '🇫🇷', name: 'France',          digits: 9,  max: 10, ph: '06 12 34 56 78' },
    { code: '+269', flag: '🇰🇲', name: 'Comores',         digits: 7,  max: 7,  ph: '321 12 34' },
    { code: '+262', flag: '🇷🇪', name: 'Réunion',         digits: 9,  max: 10, ph: '0692 12 34 56' },
    { code: '+32',  flag: '🇧🇪', name: 'Belgique',        digits: 9,  max: 10, ph: '0470 12 34 56' },
    { code: '+41',  flag: '🇨🇭', name: 'Suisse',          digits: 9,  max: 10, ph: '076 123 45 67' },
    { code: '+44',  flag: '🇬🇧', name: 'Royaume-Uni',     digits: 10, max: 11, ph: '07911 123456' },
    { code: '+1',   flag: '🇺🇸', name: 'USA / Canada',    digits: 10, max: 10, ph: '202 555 0147' },
    { code: '+971', flag: '🇦🇪', name: 'Émirats',         digits: 9,  max: 10, ph: '050 123 4567' },
    { code: '+966', flag: '🇸🇦', name: 'Arabie Saoudite', digits: 9,  max: 10, ph: '055 123 4567' },
    { code: '+60',  flag: '🇲🇾', name: 'Malaisie',        digits: 9,  max: 10, ph: '012 345 6789' },
    { code: '+212', flag: '🇲🇦', name: 'Maroc',           digits: 9,  max: 10, ph: '0612 345678' },
  ];

  /**
   * Supprime tous les caractères non numériques d'une chaîne.
   * @param {string} v - Chaîne à nettoyer
   * @returns {string} Chaîne ne contenant que des chiffres
   */
export function digitsOnly(v) {
    return String(v || '').replace(/\D+/g, '');
  }

  /**
   * Normalise un numéro local en retirant le 0 initial si présent.
   * @param {string} code   - Indicatif pays (ex: "+269")
   * @param {string} digits - Numéro brut
   * @returns {string} Numéro normalisé sans préfixe local
   */
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

  /**
   * Formate un numéro brut en affichage lisible selon le pays.
   * @param {string} raw     - Numéro brut
   * @param {string} country - Code pays ISO (ex: "KM")
   * @returns {string} Numéro formaté pour affichage
   */
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

  /**
   * Construit un numéro au format E.164 (+XXXXXXXXXXX).
   * @param {string} code - Indicatif pays (ex: "+269")
   * @param {string} raw  - Numéro local (chiffres uniquement)
   * @returns {string} Numéro E.164 complet
   */
export function buildE164(code, raw) {
    let digits = digitsOnly(raw);
    if (!digits) return '';
    digits = normalizeLocal(code, digits);
    return code + digits;
  }

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
    if (c.code === '+33') opt.selected = true; // défaut FR
    sel.appendChild(opt);
  });

  const input = document.createElement('input');
  input.type = 'tel';
  input.id = id;
  input.inputMode = 'numeric';
  input.autocomplete = 'tel';
  input.placeholder = '06 12 34 56 78';
  input.className = 'k-ck-phone-input';

  const help = document.createElement('div');
  help.className = 'k-ck-phone-help';
  help.textContent = 'Exemple France : 06 12 34 56 78';

export function currentCountry() {
    return COUNTRIES.find(c => c.code === sel.value) || COUNTRIES[0];
  }

export function sync() {
    const country = currentCountry();
    input.placeholder = country.ph;

    let rawDigits = digitsOnly(input.value).slice(0, country.max);
    input.value = prettifyLocal(rawDigits, country);

    const e164 = buildE164(country.code, rawDigits);
    dataObj[key] = e164 || '';
  }

  sel.addEventListener('change', function() {
    const c = currentCountry();
    help.textContent = 'Exemple ' + c.name + ' : ' + c.ph;
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
   * @param {string} id       - ID HTML du champ
   * @param {string} label    - Label affiché
   * @param {Object} dataObj  - Objet de données cible
   * @param {string} key      - Clé à mettre à jour dans dataObj
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
  /**
 * Vérifie le solde wallet KMF du client en checkout.
 */
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

  /**
 * Rafraîchit l'affichage du solde wallet.
 * @param {number} balance - Solde KMF
 */
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

  /* ── Submit Order ── */
/**
 * Soumet la commande finale après validation du formulaire.
 * @param {HTMLElement} btn - Bouton submit déclencheur
 * @returns {Promise<void>}
 */
export async function submitOrder(btn) {
  const od = state.orderData;
  const recipName  = (document.getElementById('of-beneficiary-name')?.value || '').trim();
  const recipPhone = (document.getElementById('of-beneficiary-phone')?.value || '').trim();

  // sender_phone : priorité à od.sender_phone, fallback DOM
  let senderPhone = (od.sender_phone || '').trim();
  if (senderPhone.length < 8) {
    const _phoneInput = document.getElementById('of-sender-phone');
    const _countrySel = document.getElementById('of-sender-phone-country');
    const _code = _countrySel?.value || '+33';

    const RULES = {
      '+33': 9,
      '+269': 7,
      '+262': 9,
      '+32': 9,
      '+41': 9,
      '+44': 10,
      '+1': 10,
      '+971': 9,
      '+966': 9,
      '+60': 9,
      '+212': 9
    };

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
  const recipDigits = recipPhone.replace(/\D/g, '');
  const fullRecipPhone = '+269' + recipDigits;
  const clientEmail = undefined;

  if (!recipName) {
    showToast('Indiquez le nom de la personne qui récupère.', 'error');
    return;
  }
  if (!recipPhone) {
    showToast('Indiquez le téléphone du bénéficiaire (+269).', 'error');
    return;
  }
  if (recipDigits.length !== 7) {
    showToast(`Téléphone +269 invalide : 7 chiffres attendus (vous en avez ${recipDigits.length}).`, 'error');
    return;
  }

  const isStripe = od.payment_mode === 'stripe_eur';
  const trackingPhone = senderPhone && senderPhone.length >= 8 ? senderPhone : null;

  // Anti double-clic / anti race
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.textContent = isStripe ? '⏳ Paiement en cours…' : '⏳ Envoi en cours…';
  btn.style.opacity = '0.7';

  try {
    const items = state.cart.map(i => ({
      product_id: String(i.product.id),
      quantity: i.qty,
      confection_type: 'aucun'
    }));

    let orderData = null;
    let apiResult = null;

    // CASH : comportement inchangé
    // STRIPE : créer la commande UNE seule fois par tentative
    if (isStripe) {
      if (!state.checkoutAttemptKey) {
        state.checkoutAttemptKey = genIdempotencyKey();
      }

      if (!state.pendingStripeOrderRef) {
        apiResult = await apiPost('/api/orders', {
          items,
          relais_id: state.relais.length > 0 ? state.relais[0].id : undefined,
          recipient_name: recipName,
          recipient_phone: fullRecipPhone,
          payment_mode: od.payment_mode,
          use_wallet: od.use_wallet || false,
          tracking_phone: trackingPhone || undefined,
          share_token: state.shareToken || undefined
        }, {
          idempotencyKey: state.checkoutAttemptKey
        });

        orderData = apiResult.order || apiResult;
        state.pendingStripeOrderRef = orderData.reference;
      } else {
        // Retry Stripe : on réutilise la même commande
        orderData = { reference: state.pendingStripeOrderRef };
      }
    } else {
      apiResult = await apiPost('/api/orders', {
        items,
        relais_id: state.relais.length > 0 ? state.relais[0].id : undefined,
        recipient_name: recipName,
        recipient_phone: fullRecipPhone,
        payment_mode: od.payment_mode,
        use_wallet: od.use_wallet || false,
        tracking_phone: trackingPhone || undefined,
        share_token: state.shareToken || undefined
      });

      orderData = apiResult.order || apiResult;
    }

    // Stripe payment
    if (isStripe) {
      if (!_stripe || !_stripeCard) {
        throw new Error('Stripe non chargé. Rechargez la page.');
      }

      btn.textContent = '🔒 Sécurisation du paiement…';

      const intentResult = await apiPost('/api/payments/stripe/intent', {
        order_reference: orderData.reference
      });

      btn.textContent = '💳 Validation en cours…';

      const stripeResult = await _stripe.confirmCardPayment(intentResult.client_secret, {
        payment_method: {
          card: _stripeCard,
          billing_details: {
            name: clientName,
            email: clientEmail || undefined
          }
        }
      });

      if (stripeResult.error) {
        const errEl = document.getElementById('stripe-card-error');
        if (errEl) {
          errEl.textContent = stripeResult.error.message;
          errEl.classList.remove('u-hidden');
        }
        // IMPORTANT :
        // on garde pendingStripeOrderRef et checkoutAttemptKey
        // pour que le retry réutilise la même commande
        throw new Error(stripeResult.error.message);
      }

      showToast('🎉 Paiement accepté !', 'success');

      // paiement OK => on nettoie l’état de tentative
      state.checkoutAttemptKey = null;
      state.pendingStripeOrderRef = null;
    }

    // clear cart
    state.cart = [];
    saveCart();
    renderCartBody();

    // success screen
    renderOrderSuccess(orderData, recipName, clientEmail, apiResult || orderData);
    showToast('Commande confirmée !', 'success');

    btn.dataset.busy = '0';
  } catch (e) {
    console.error('submitOrder:', e);
    showToast(e.message || 'Erreur lors de la commande.', 'error');

    btn.disabled = false;
    btn.dataset.busy = '0';
    btn.textContent = isStripe
      ? '💳 Payer ' + fmt(cartTotal(), 'KMF')
      : '✅ Confirmer — ' + fmt(cartTotal(), 'KMF');
    btn.style.opacity = '1';
  }
}

  /* ── Order Success ── */
  /**
 * Affiche la confirmation après commande réussie.
 * @param {Object} order - Commande retournée par l'API
 */
export function renderOrderSuccess(order, recipientName, clientEmail, fullResult) {
    const body = dom.orderBody;
    body.innerHTML = '';
    dom.orderTitle.textContent = '✅ Commande confirmée';

    // Retirer tout bouton Confirmer sticky résiduel
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());

    // Masquer le bouton retour panier s'il existe encore
    body.querySelectorAll('.ck-back-btn').forEach(b => b.remove());

    const wrap = document.createElement('div');
    wrap.className = 'k-confirm-wrap k-confirm-simple';

    // Émoji + titre
    const emoji = document.createElement('div');
    emoji.className = 'k-confirm-emoji';
    emoji.textContent = '🎉';
    wrap.appendChild(emoji);

    const title = document.createElement('h3');
    title.className = 'k-confirm-title';
    title.textContent = 'Commande confirmée !';
    wrap.appendChild(title);

    // Référence (élément central de l'écran)
    const refBlock = document.createElement('div');
    refBlock.className = 'k-confirm-ref-block';
    refBlock.innerHTML =
      '<div class="k-confirm-ref-label">Votre référence</div>' +
      '<div class="k-confirm-ref">' + sanitize(order.reference || '—') + '</div>' +
      '<button id="k-copy-ref-btn" class="k-confirm-copy">📋 Copier</button>';
    wrap.appendChild(refBlock);

    // NOUVEAU : ligne récap "N articles — XXX KMF"
    // On lit depuis order (renvoyé par l'API) ou depuis l'état sauvegardé
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

    // Code cash (seulement si paiement cash)
    if (order.cash_ref_code && order.payment_mode === 'cash_relais') {
      const cashBlock = document.createElement('div');
      cashBlock.className = 'k-confirm-cash-block';
      cashBlock.innerHTML =
        '<div class="k-confirm-cash-label">🏪 Code à présenter au relais</div>' +
        '<div class="k-confirm-cash-code">' + sanitize(order.cash_ref_code) + '</div>';
      wrap.appendChild(cashBlock);
    }

    // 2 consignes courtes
    const notices = document.createElement('div');
    notices.className = 'k-confirm-notices';
    notices.innerHTML =
      '<div class="k-confirm-notice-row">📲 Vous allez recevoir un WhatsApp de confirmation</div>' +
      '<div class="k-confirm-notice-row">🏪 Rendez-vous au relais avec cette référence</div>';
    wrap.appendChild(notices);

    // Actions : Suivre + Continuer
    const actions = document.createElement('div');
    actions.className = 'k-confirm-actions';
    actions.innerHTML =
      '<button id="k-order-track-btn" class="k-confirm-btn k-confirm-btn-primary">📍 Suivre ma commande</button>' +
      '<button id="k-order-close-btn" class="k-confirm-btn k-confirm-btn-secondary">🛍️ Continuer mes achats</button>';
    wrap.appendChild(actions);

    body.appendChild(wrap);

    // Bindings
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
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          closeOrderModal();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }

      const trackBtn = document.getElementById('k-order-track-btn');
      if (trackBtn) {
        trackBtn.addEventListener('click', () => {
          closeOrderModal();
          if (typeof renderTrackView === 'function') renderTrackView();
          if (typeof switchView === 'function') switchView('track');
          const navItems = document.querySelectorAll('.k-bnav-item');
          navItems.forEach(i => i.classList.remove('active'));
          const trackNav = document.querySelector('.k-bnav-item[data-tab="track"]');
          if (trackNav) trackNav.classList.add('active');
          setTimeout(() => {
            const refInput = document.getElementById('k-otp-ref');
            if (refInput) {
              refInput.value = order.reference || '';
              const refBtn = document.getElementById('k-otp-ref-btn');
              if (refBtn) refBtn.click();
            }
          }, 350);
        });
      }
    }, 0);
  }

    /* ── SETUP CART DRAWER ──────────────────────────────────── */

  // ╔══════════════════════════════════════════════════════════════════╗
