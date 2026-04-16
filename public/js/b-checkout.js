/* ═══════════════════════════════════════════════════════════
   KOMERCE BOUTIQUE — b-checkout.js
   Order form, submission, success screen
   Depends on: b-config.js, b-state.js, b-ui.js, b-cart.js
   ═══════════════════════════════════════════════════════════ */
(function (K) {
  'use strict';

  // ── CLOSE ORDER MODAL ─────────────────────────────────────
  K.closeOrderModal = function () {
    K.dom.orderModal?.classList.remove('active');
    document.body.style.overflow = '';
    if (typeof window._savedScrollY === 'number') {
      window.scrollTo(0, window._savedScrollY);
      window._savedScrollY = 0;
    }
  };

  // ── HELPERS ───────────────────────────────────────────────
  function makeInput(id, label, type, placeholder, dataObj, key) {
    const wrap = document.createElement('div');
    wrap.className = 'k-form-section';
    wrap.innerHTML =
      '<label class="k-form-label" for="' + id + '">' + label + '</label>' +
      '<input class="k-form-input" id="' + id + '" type="' + type + '" placeholder="' + placeholder + '" autocomplete="off">';
    const input = wrap.querySelector('input');
    if (dataObj[key]) input.value = dataObj[key];
    input.addEventListener('input', () => { dataObj[key] = input.value; });
    return wrap;
  }

  function makePhoneInput(id, label, dataObj, key) {
    const wrap = document.createElement('div');
    wrap.className = 'k-form-section';
    wrap.innerHTML =
      (label ? '<label class="k-form-label">' + label + '</label>' : '') +
      '<div class="k-phone-row">' +
        '<span class="k-phone-prefix">+269</span>' +
        '<input class="k-phone-input" id="' + id + '" type="tel" inputmode="numeric" placeholder="3200000" autocomplete="tel">' +
      '</div>';
    const input = wrap.querySelector('input');
    if (dataObj[key]) input.value = String(dataObj[key]).replace(/^\+?269/, '');
    input.addEventListener('input', () => { dataObj[key] = input.value.replace(/\s/g, ''); });
    return wrap;
  }

  function makeIntlPhoneInput(id, label, dataObj, key) {
    const COUNTRIES = [
      { flag: '🇫🇷', code: '+33',  name: 'France' },
      { flag: '🇰🇲', code: '+269', name: 'Comores' },
      { flag: '🇧🇪', code: '+32',  name: 'Belgique' },
      { flag: '🇨🇭', code: '+41',  name: 'Suisse' },
      { flag: '🇬🇧', code: '+44',  name: 'UK' },
      { flag: '🇺🇸', code: '+1',   name: 'USA/Canada' },
      { flag: '🇦🇪', code: '+971', name: 'Émirats' },
      { flag: '🇸🇦', code: '+966', name: 'Arabie Saoudite' },
      { flag: '🇲🇾', code: '+60',  name: 'Malaisie' },
      { flag: '🇲🇦', code: '+212', name: 'Maroc' },
    ];
    let selectedCode = '+33';

    const wrap = document.createElement('div');
    wrap.className = 'k-form-section';
    wrap.innerHTML =
      (label ? '<label class="k-form-label">' + label + '</label>' : '') +
      '<div class="k-phone-row" style="gap:0;">' +
        '<select id="' + id + '-select" style="height:34px;border:1.5px solid var(--border);border-right:none;border-radius:var(--radius-sm) 0 0 var(--radius-sm);padding:0 6px;font-size:13px;background:var(--prairie-light);color:var(--ink);cursor:pointer;min-width:90px;">' +
        COUNTRIES.map(c => '<option value="' + c.code + '"' + (c.code === '+33' ? ' selected' : '') + '>' + c.flag + ' ' + c.code + '</option>').join('') +
        '</select>' +
        '<input id="' + id + '" type="tel" inputmode="numeric" placeholder="6 00 00 00" style="flex:1;height:34px;border:1.5px solid var(--border);border-left:none;border-radius:0 var(--radius-sm) var(--radius-sm) 0;padding:0 10px;font-size:14px;outline:none;font-family:var(--font);">' +
      '</div>';

    const select = wrap.querySelector('select');
    const input  = wrap.querySelector('input');

    const sync = () => {
      dataObj[key] = (selectedCode + input.value.replace(/\s/g, '')).trim();
    };
    select.addEventListener('change', () => { selectedCode = select.value; sync(); });
    input.addEventListener('input',   sync);
    if (dataObj[key]) {
      for (const c of COUNTRIES) {
        if (dataObj[key].startsWith(c.code)) {
          selectedCode = c.code;
          select.value = c.code;
          input.value  = dataObj[key].slice(c.code.length);
          break;
        }
      }
    }
    return wrap;
  }

  // ── RENDER CHECKOUT ───────────────────────────────────────
  K.renderCheckout = function () {
    const body = K.dom.orderBody;
    if (!body) return;
    body.innerHTML = '';
    body.parentElement.querySelectorAll('.k-confirm-bar').forEach(b => b.remove());
    K.dom.orderTitle.textContent = '🛒 Commander';

    const od = K.state.orderData;

    /* 1. Mini summary */
    const summary = document.createElement('div');
    summary.className = 'ck-summary';
    const qtyLabel = K.cartQty() + ' article' + (K.cartQty() > 1 ? 's' : '');
    summary.innerHTML =
      '<span class="ck-sum-qty">' + qtyLabel + '</span>' +
      '<span class="ck-sum-sep">·</span>' +
      '<span class="ck-sum-total">' + K.fmt(K.cartTotal(), 'KMF') + '</span>';
    body.appendChild(summary);

    /* 2. Items preview */
    const preview = document.createElement('div');
    preview.className = 'ck-items-preview';
    preview.innerHTML = K.state.cart.map(item => {
      const p = item.product;
      return '<div class="ck-item-row">' +
        '<img class="ck-item-img" src="' + K.optimizeImgUrl(p.image_url, 80) + '" alt="' + K.sanitize(p.name) + '" loading="lazy">' +
        '<span class="ck-item-name">' + K.sanitize(p.name) + '</span>' +
        '<span class="ck-item-qty">×' + item.qty + '</span>' +
        '<span class="ck-item-price">' + K.fmtPrice(p.price_kmf * item.qty) + '</span>' +
      '</div>';
    }).join('');
    body.appendChild(preview);

    /* 3. Bénéficiaire */
    const s1 = document.createElement('div');
    s1.className = 'ck-label';
    s1.textContent = '📦 Bénéficiaire';
    body.appendChild(s1);
    body.appendChild(makeInput('of-beneficiary-name',  'Nom *',          'text', 'Prénom Nom', od, 'beneficiary_name'));
    body.appendChild(makePhoneInput('of-beneficiary-phone', 'Tél. (+269) *', od, 'beneficiary_phone'));

    /* 4. Paiement */
    const s2 = document.createElement('div');
    s2.className = 'ck-label';
    s2.textContent = '💳 Paiement';
    body.appendChild(s2);

    const payGrid = document.createElement('div');
    payGrid.className = 'k-payment-chips';
    payGrid.innerHTML =
      '<label class="k-payment-chip" id="ck-chip-cash">' +
        '<input type="radio" name="payment_mode" value="cash_relais" checked>' +
        '<span style="font-size:18px;">🏪</span>' +
        '<span>Cash</span>' +
      '</label>' +
      '<label class="k-payment-chip" style="opacity:0.5;cursor:not-allowed;">' +
        '<input type="radio" name="payment_mode" value="mvola" disabled>' +
        '<span style="font-size:18px;">📱</span>' +
        '<span>MVola<br><em class="k-payment-chip-badge">Bientôt</em></span>' +
      '</label>' +
      '<label class="k-payment-chip" id="ck-chip-stripe">' +
        '<input type="radio" name="payment_mode" value="stripe_eur">' +
        '<span style="font-size:18px;">💳</span>' +
        '<span>Carte</span>' +
      '</label>';
    body.appendChild(payGrid);

    // Stripe card element
    const stripeWrap = document.createElement('div');
    stripeWrap.id = 'stripe-card-wrap';
    stripeWrap.style.cssText = 'display:none;margin:8px 0;padding:10px 12px;border:2px solid var(--prairie);border-radius:8px;background:var(--prairie-light);';
    stripeWrap.innerHTML =
      '<div style="font-size:12px;font-weight:600;margin-bottom:8px;">🔒 Informations de carte</div>' +
      '<div id="stripe-card-element" style="padding:10px;border:1px solid var(--border);border-radius:6px;background:white;"></div>' +
      '<div id="stripe-card-error" style="color:#dc2626;font-size:12px;margin-top:6px;display:none;"></div>' +
      '<div id="stripe-eur-display" style="display:none;text-align:center;font-size:13px;color:var(--terracotta);font-weight:700;margin-top:8px;">≈ ' + K.fmt(K.cartTotal(), 'EUR') + ' seront débités</div>';
    body.appendChild(stripeWrap);

    /* 5. Suivi SMS (accordion) */
    const accordion = document.createElement('div');
    accordion.className = 'k-form-section';
    accordion.innerHTML =
      '<button type="button" class="k-accordion-toggle">📲 Recevoir le suivi SMS (optionnel) <span>▼</span></button>' +
      '<div class="k-accordion-body" id="ck-track-extra"></div>';
    const toggleBtn = accordion.querySelector('.k-accordion-toggle');
    const accBody   = accordion.querySelector('.k-accordion-body');
    accBody.appendChild(makeIntlPhoneInput('of-sender-phone', '', od, 'sender_phone'));
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:var(--ink-3);margin-top:4px;';
    hint.textContent = 'Notifié(e) dès que la commande arrive au relais';
    accBody.appendChild(hint);
    toggleBtn.addEventListener('click', () => {
      const open = accBody.classList.toggle('open');
      toggleBtn.querySelector('span').textContent = open ? '▲' : '▼';
    });
    body.appendChild(accordion);

    /* 6. Payment switching */
    function updatePaymentUI() {
      const mode = document.querySelector('input[name="payment_mode"]:checked');
      od.payment_mode = mode ? mode.value : 'cash_relais';
      document.querySelectorAll('.k-payment-chip').forEach(chip => {
        const r = chip.querySelector('input[type=radio]');
        if (r && !r.disabled) chip.classList.toggle('selected', r.checked);
      });
      const wrap = document.getElementById('stripe-card-wrap');
      if (wrap) {
        const isStripe = od.payment_mode === 'stripe_eur';
        wrap.style.display = isStripe ? 'block' : 'none';
        if (isStripe && K._stripe && !K._stripeCard) {
          K._stripeElements = K._stripe.elements();
          K._stripeCard = K._stripeElements.create('card', {
            style: { base: { fontSize: '15px', color: '#1e293b', '::placeholder': { color: '#94a3b8' } }, invalid: { color: '#dc2626' } },
            hidePostalCode: true
          });
          K._stripeCard.mount('#stripe-card-element');
          K._stripeCard.on('change', e => {
            const errEl = document.getElementById('stripe-card-error');
            if (errEl) { errEl.textContent = e.error ? e.error.message : ''; errEl.style.display = e.error ? 'block' : 'none'; }
          });
        }
      }
      // Update confirm button text
      const confirmBtn = document.getElementById('btn-confirm-order');
      if (confirmBtn) {
        confirmBtn.textContent = od.payment_mode === 'stripe_eur'
          ? '💳 Payer ' + K.fmt(K.cartTotal(), 'EUR')
          : '✅ Confirmer — ' + K.fmt(K.cartTotal(), 'KMF');
      }
    }
    payGrid.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', updatePaymentUI));
    setTimeout(updatePaymentUI, 0);

    /* 7. Sticky confirm button OUTSIDE scroll area */
    const confirmBar = document.createElement('div');
    confirmBar.className = 'k-confirm-bar';
    const confirmBtn = document.createElement('button');
    confirmBtn.id        = 'btn-confirm-order';
    confirmBtn.className = 'k-confirm-btn';
    confirmBtn.textContent = '✅ Confirmer — ' + K.fmt(K.cartTotal(), 'KMF');
    confirmBtn.addEventListener('click', () => K.submitOrder(confirmBtn));
    confirmBar.appendChild(confirmBtn);
    body.parentElement.appendChild(confirmBar);
  };

  // ── SUBMIT ORDER ──────────────────────────────────────────
  K.submitOrder = async function (btn) {
    const od = K.state.orderData;
    const recipName  = (document.getElementById('of-beneficiary-name')?.value  || '').trim();
    const recipPhone = (document.getElementById('of-beneficiary-phone')?.value || '').trim();
    const senderPhone = (od.sender_phone || '').trim();

    if (!recipName)  { K.showToast('Indiquez le nom du bénéficiaire.', 'error'); return; }
    if (!recipPhone) { K.showToast('Indiquez le téléphone (+269) du bénéficiaire.', 'error'); return; }

    const fullRecipPhone = '+269' + recipPhone.replace(/\s/g, '');
    const isStripe       = od.payment_mode === 'stripe_eur';
    const trackingPhone  = senderPhone && senderPhone.length >= 8 ? senderPhone : null;

    btn.disabled     = true;
    btn.textContent  = isStripe ? '⏳ Paiement en cours…' : '⏳ Envoi en cours…';
    btn.style.opacity = '0.7';

    try {
      const items = K.state.cart.map(i => ({
        product_id:      String(i.product.id),
        quantity:        i.qty,
        confection_type: 'aucun'
      }));

      const apiResult = await K.apiPost('/api/orders', {
        items,
        relais_id:       K.state.relais.length > 0 ? K.state.relais[0].id : undefined,
        recipient_name:  recipName,
        recipient_phone: fullRecipPhone,
        payment_mode:    od.payment_mode,
        use_wallet:      od.use_wallet || false,
        tracking_phone:  trackingPhone || undefined
      });

      const orderData = apiResult.order || apiResult;

      // Stripe payment
      if (isStripe) {
        if (!K._stripe || !K._stripeCard) throw new Error('Stripe non chargé. Rechargez la page.');
        btn.textContent = '🔒 Sécurisation…';
        const intentResult = await K.apiPost('/api/payments/stripe/intent', { order_reference: orderData.reference });
        btn.textContent = '💳 Validation…';
        const stripeResult = await K._stripe.confirmCardPayment(intentResult.client_secret, {
          payment_method: { card: K._stripeCard, billing_details: { name: recipName } }
        });
        if (stripeResult.error) {
          const errEl = document.getElementById('stripe-card-error');
          if (errEl) { errEl.textContent = stripeResult.error.message; errEl.style.display = 'block'; }
          throw new Error(stripeResult.error.message);
        }
        K.showToast('🎉 Paiement accepté !', 'success');
      }

      // Clear cart
      K.state.cart = [];
      K.saveCart();
      K.renderCartBody();

      // Success screen
      K.renderOrderSuccess(orderData, recipName, undefined, apiResult);
      K.showToast('Commande confirmée !', 'success');

    } catch (e) {
      console.error('submitOrder:', e);
      K.showToast(e.message || 'Erreur lors de la commande.', 'error');
      btn.disabled     = false;
      btn.textContent  = isStripe ? '💳 Payer ' + K.fmt(K.cartTotal(), 'EUR') : '✅ Confirmer — ' + K.fmt(K.cartTotal(), 'KMF');
      btn.style.opacity = '1';
    }
  };

  // ── ORDER SUCCESS ─────────────────────────────────────────
  K.renderOrderSuccess = function (order, recipientName, clientEmail, fullResult) {
    const body = K.dom.orderBody;
    if (!body) return;
    body.innerHTML = '';
    K.dom.orderTitle.textContent = '✅ Commande confirmée';
    body.parentElement.querySelectorAll('.k-confirm-bar').forEach(b => b.remove());

    const hasDiaspora = (K.state.orderData.sender_phone || '').trim().length >= 8;
    const waNotice    = hasDiaspora
      ? '📲 Le bénéficiaire et vous recevrez une confirmation WhatsApp'
      : '📲 Le bénéficiaire recevra une confirmation WhatsApp';

    const wrap = document.createElement('div');
    wrap.className = 'k-success';

    wrap.innerHTML =
      '<div class="k-success-icon">🎉</div>' +
      '<h3 style="color:var(--prairie);font-size:17px;margin-bottom:4px;">Commande enregistrée !</h3>' +
      '<p style="color:var(--ink-3);font-size:13px;margin-bottom:4px;">Votre référence :</p>' +
      '<div class="k-success-ref">' + K.sanitize(order.reference || '—') + '</div>' +
      '<button class="k-success-copy" id="k-copy-ref-btn">📋 Copier la référence</button>';

    if (order.cash_ref_code && order.payment_mode === 'cash_relais') {
      wrap.innerHTML +=
        '<p style="margin-top:10px;font-weight:700;font-size:13px;">🏪 Code de paiement au relais :</p>' +
        '<div style="display:inline-block;background:#fffbeb;color:#92400e;font-weight:800;font-size:18px;padding:8px 22px;border-radius:10px;margin:6px 0;letter-spacing:2px;border:2px solid #fde68a;font-family:monospace;">' + K.sanitize(order.cash_ref_code) + '</div>';
    }

    if (fullResult && fullResult.discount_pct > 0) {
      wrap.innerHTML += '<div class="k-success-notice" style="background:var(--prairie-light);">🎁 Fidélité ' + K.sanitize(fullResult.loyalty_label || '') + ' : -' + fullResult.discount_pct + '% (-' + K.fmt(fullResult.discount_kmf, 'KMF') + ')</div>';
    }

    wrap.innerHTML +=
      '<div class="k-success-notice">' +
        '<div>🏪 Paiement en cash au point relais lors du retrait.</div>' +
        '<div style="margin-top:4px;">' + K.sanitize(waNotice) + '</div>' +
        '<div style="margin-top:4px;">📍 Présentez la référence au point relais.</div>' +
      '</div>' +
      '<div class="k-success-actions">' +
        '<button class="k-success-track-btn" id="k-order-track-btn">📍 Suivre ma commande</button>' +
        '<button class="k-success-wa-btn" id="k-order-wa-btn">📱 Partager sur WhatsApp</button>' +
        '<button class="k-success-close-btn" id="k-order-close-btn">Fermer (7)</button>' +
      '</div>';

    body.appendChild(wrap);

    setTimeout(() => {
      const copyBtn = document.getElementById('k-copy-ref-btn');
      if (copyBtn) copyBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(order.reference || '').then(() => K.showToast('📋 Référence copiée !'));
      });

      // Auto-close countdown 7s
      const closeBtn  = document.getElementById('k-order-close-btn');
      let countdown   = 7;
      const autoTimer = setInterval(() => {
        countdown--;
        if (closeBtn) closeBtn.textContent = 'Fermer (' + countdown + ')';
        if (countdown <= 0) {
          clearInterval(autoTimer);
          K.closeOrderModal();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 1000);

      if (closeBtn) closeBtn.addEventListener('click', () => {
        clearInterval(autoTimer);
        K.closeOrderModal();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      // Track button
      const trackBtn = document.getElementById('k-order-track-btn');
      if (trackBtn) trackBtn.addEventListener('click', () => {
        clearInterval(autoTimer);
        K.closeOrderModal();
        K.renderTrackView();
        K.switchView('track');
        K.$$('.k-bnav-item').forEach(i => i.classList.remove('active'));
        const trackNav = document.querySelector('.k-bnav-item[data-tab="track"]');
        if (trackNav) trackNav.classList.add('active');
        setTimeout(() => {
          const refInput = document.getElementById('k-otp-ref');
          if (refInput) {
            refInput.value = order.reference || '';
            document.getElementById('k-otp-ref-btn')?.click();
          }
        }, 350);
      });

      // M3 — WhatsApp share button
      const waBtn = document.getElementById('k-order-wa-btn');
      if (waBtn) waBtn.addEventListener('click', () => {
        const ref  = order.reference || '';
        const name = (document.getElementById('k-recipient-name') || {}).value || '';
        const msg  = encodeURIComponent(
          '🛍️ Commande Komerce confirmée !\n' +
          '📦 Référence : ' + ref + '\n' +
          (name ? '👤 Pour : ' + name + '\n' : '') +
          '📍 Suivre : https://komerce-backend-production.up.railway.app/boutique-v2.html'
        );
        window.open('https://wa.me/?text=' + msg, '_blank');
      });

    }, 0);
  };

})(window.K = window.K || {});
