/* ============================================================
   KOMERCE — Modales (produit, look, commande)
   v2.0 — KState uniquement, plus d'alias _xxx legacy
   ============================================================ */

function openProductModal(p) {
  KState.pdQty = 1;
  var body = $('product-modal-body');
  body.innerHTML = '';
  body.scrollTop = 0;

  /* ── Image + infos ── */
  var top = document.createElement('div');
  top.className = 'pd-top';

  var emojiBox = document.createElement('div');
  emojiBox.className = 'pd-emoji';
  emojiBox.style.position = 'relative';
  if (p.image_url) {
    var img = document.createElement('img');
    img.src = p.image_url;
    img.alt = sanitize(p.name);
    emojiBox.appendChild(img);
  } else {
    emojiBox.textContent = productEmoji(p);
  }

  /* Bouton favori sur l'image */
  var favBtn = document.createElement('button');
  favBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:white;border:none;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);font-size:1.1rem;transition:transform 0.2s;';
  favBtn.textContent = isFav(p.id) ? '♥' : '♡';
  favBtn.style.color = isFav(p.id) ? '#ef4444' : '#ccc';
  favBtn.addEventListener('click', function() {
    toggleFav(p.id);
    favBtn.textContent = isFav(p.id) ? '♥' : '♡';
    favBtn.style.color = isFav(p.id) ? '#ef4444' : '#ccc';
    toast(isFav(p.id) ? 'Ajouté aux favoris' : 'Retiré des favoris', 'info');
    updateFavBadge();
  });
  emojiBox.appendChild(favBtn);
  top.appendChild(emojiBox);

  var info = document.createElement('div');
  info.className = 'pd-info';

  var catEl = document.createElement('div');
  catEl.className = 'pd-cat';
  catEl.textContent = categoryLabel(p.category);
  info.appendChild(catEl);

  var nameEl = document.createElement('div');
  nameEl.className = 'pd-name';
  nameEl.style.fontSize = '1.1rem';
  nameEl.textContent = p.name || 'Produit';
  info.appendChild(nameEl);

  /* Prix avec promo */
  if (p.is_promo && p.promo_pct) {
    var origPrice = Math.round(p.price_kmf / (1 - p.promo_pct / 100));
    var origEl = document.createElement('div');
    origEl.style.cssText = 'font-size:0.82rem;color:var(--muted);text-decoration:line-through;';
    origEl.textContent = fmt(origPrice, 'KMF');
    info.appendChild(origEl);
  }

  var priceEl = document.createElement('div');
  priceEl.className = 'pd-price';
  priceEl.textContent = fmt(p.price_kmf || 0, 'KMF');
  info.appendChild(priceEl);

  if (KState.currency === 'EUR') {
    var convEl = document.createElement('div');
    convEl.className = 'pd-price-conv';
    convEl.textContent = '≈ ' + fmt(p.price_kmf || 0, 'EUR');
    info.appendChild(convEl);
  }

  var avail = availabilityInfo(p);
  var availTag = document.createElement('div');
  availTag.className = 'avail-badge ' + avail.cls;
  availTag.style.cssText = 'margin-top:8px;';
  availTag.textContent = avail.icon + ' ' + avail.label;
  info.appendChild(availTag);

  top.appendChild(info);
  body.appendChild(top);

  /* Description */
  if (p.description) {
    var desc = document.createElement('p');
    desc.className = 'pd-desc';
    desc.textContent = p.description;
    body.appendChild(desc);
  }

  /* ── Contrôles qty + ajouter ── */
  var controls = document.createElement('div');
  controls.className = 'pd-controls';

  var qtyWrap = document.createElement('div');
  qtyWrap.className = 'pd-qty-wrap';
  var minusBtn = document.createElement('button');
  minusBtn.className = 'qty-btn';
  minusBtn.textContent = '−';
  var qtyVal = document.createElement('span');
  qtyVal.className = 'qty-val';
  qtyVal.textContent = '1';
  var plusBtn = document.createElement('button');
  plusBtn.className = 'qty-btn';
  plusBtn.textContent = '+';
  minusBtn.addEventListener('click', function() { if (KState.pdQty > 1) { KState.pdQty--; qtyVal.textContent = KState.pdQty; } });
  plusBtn.addEventListener('click', function() { KState.pdQty++; qtyVal.textContent = KState.pdQty; });
  qtyWrap.appendChild(minusBtn);
  qtyWrap.appendChild(qtyVal);
  qtyWrap.appendChild(plusBtn);
  controls.appendChild(qtyWrap);

  var addBtn = document.createElement('button');
  addBtn.className = 'pd-add-btn';
  addBtn.style.cssText = 'background:var(--primary);color:white;font-weight:700;';
  addBtn.textContent = 'Ajouter au panier';
  addBtn.addEventListener('click', function() {
    addToCart(p, KState.pdQty, addBtn);
    setTimeout(function() { closeProductModal(); }, 500);
  });
  controls.appendChild(addBtn);
  body.appendChild(controls);

  /* ── Bouton Look complet (Mode & Sur-mesure) ── */
  if (p.category === 'Mode' || p.category === 'Sur-mesure') {
    var lookBtn = document.createElement('button');
    lookBtn.style.cssText = 'width:100%;margin-top:10px;padding:10px;background:var(--bg);border:2px dashed var(--primary);border-radius:var(--radius);color:var(--primary);font-weight:700;font-size:0.88rem;cursor:pointer;transition:all 0.2s;';
    lookBtn.textContent = 'Voir le look complet';
    lookBtn.addEventListener('mouseenter', function() { lookBtn.style.background='var(--primary-light)'; });
    lookBtn.addEventListener('mouseleave', function() { lookBtn.style.background='var(--bg)'; });
    lookBtn.addEventListener('click', function() { openLookModal(p); });
    body.appendChild(lookBtn);
  }

  /* ── Fonction swipe carousel natif pour la modale ── */
  function makeSwipeSection(items, label, borderColor) {
    var section = document.createElement('div');
    section.style.cssText = 'margin-top:20px;margin-bottom:8px;';

    var title = document.createElement('div');
    title.style.cssText = 'font-size:0.85rem;font-weight:700;color:var(--dark);margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid ' + borderColor + ';display:inline-block;';
    title.textContent = label;
    section.appendChild(title);

    var track = document.createElement('div');
    track.className = 'modal-swipe-track';

    items.forEach(function(sp) {
      var card = document.createElement('div');
      card.style.cssText = 'flex:0 0 140px;background:white;border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;scroll-snap-align:start;transition:transform 0.15s;';
      card.addEventListener('click', function() { openProductModal(sp); });
      card.addEventListener('touchstart', function() { card.style.transform='scale(0.97)'; }, {passive:true});
      card.addEventListener('touchend', function() { card.style.transform=''; }, {passive:true});

      var mImg = document.createElement('div');
      mImg.style.cssText = 'height:100px;overflow:hidden;background:var(--primary-light);';
      if (sp.image_url) {
        var mi = document.createElement('img');
        mi.src = sp.image_url;
        mi.alt = sanitize(sp.name);
        mi.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        mImg.appendChild(mi);
      } else {
        mImg.style.cssText += 'display:flex;align-items:center;justify-content:center;font-size:2.5rem;';
        mImg.textContent = productEmoji(sp);
      }
      card.appendChild(mImg);

      var mBody = document.createElement('div');
      mBody.style.cssText = 'padding:7px 8px;';
      var mName = document.createElement('div');
      mName.style.cssText = 'font-size:0.73rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;';
      mName.textContent = sp.name;
      mBody.appendChild(mName);
      var mPrice = document.createElement('div');
      mPrice.style.cssText = 'font-size:0.78rem;color:var(--primary);font-weight:700;margin-bottom:4px;';
      mPrice.textContent = fmt(sp.price_kmf || 0, 'KMF');
      mBody.appendChild(mPrice);
      var mAdd = document.createElement('button');
      mAdd.style.cssText = 'width:100%;padding:5px;background:' + (sp.is_promo ? 'var(--accent);color:#1e2a38' : 'var(--primary);color:white') + ';border:none;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;';
      mAdd.textContent = '+ Panier';
      mAdd.addEventListener('click', function(e) {
        e.stopPropagation();
        addToCart(sp, 1, mAdd);
        toast(sp.name + ' ajouté', 'success');
      });
      mBody.appendChild(mAdd);
      card.appendChild(mBody);
      track.appendChild(card);
    });

    section.appendChild(track);
    return section;
  }
}

var KState.lookLabels = ['La pièce', 'Chaussures', 'Beauté', 'Accessoire'];

function openLookModal(mainProduct) {
  var body = $('look-modal-body');
  body.innerHTML = '';
  body.scrollTop = 0;

  /* Sélectionner les pièces du look */
  var lookItems = [mainProduct];

  /* Chaussures depuis Mode */
  var shoes = KState.products.filter(function(p) {
    return p.id !== mainProduct.id && p.category === 'Mode' &&
      (p.name.toLowerCase().includes('chaussure') ||
       p.name.toLowerCase().includes('sandale') ||
       p.name.toLowerCase().includes('botte') ||
       p.name.toLowerCase().includes('mocassin') ||
       p.name.toLowerCase().includes('sneaker') ||
       p.name.toLowerCase().includes('babouche'));
  });
  if (shoes.length) lookItems.push(shoes[Math.floor(Math.random() * Math.min(shoes.length, 5))]);

  /* Beauté */
  var beauty = KState.products.filter(function(p) { return p.category === 'Beauté'; });
  if (beauty.length) lookItems.push(beauty[Math.floor(Math.random() * Math.min(beauty.length, 10))]);

  /* Accessoire (bijoux, sac) */
  var access = KState.products.filter(function(p) {
    return p.id !== mainProduct.id && p.category === 'Mode' &&
      (p.name.toLowerCase().includes('sac') ||
       p.name.toLowerCase().includes('bijou') ||
       p.name.toLowerCase().includes('collier') ||
       p.name.toLowerCase().includes('bracelet') ||
       p.name.toLowerCase().includes('montre'));
  });
  if (access.length) lookItems.push(access[Math.floor(Math.random() * Math.min(access.length, 5))]);

  /* ── Layout lookbook ── */
  var lookGrid = document.createElement('div');
  lookGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;';

  lookItems.forEach(function(item, idx) {
    var card = document.createElement('div');
    var isMain = idx === 0;
    card.style.cssText = isMain
      ? 'grid-column:1/-1;border-radius:12px;overflow:hidden;border:' + (isMain ? '2px solid var(--primary)' : '1px solid var(--border)') + ';background:white;cursor:pointer;position:relative;'
      : 'border-radius:12px;overflow:hidden;border:1px solid var(--border);background:white;cursor:pointer;position:relative;';

    card.addEventListener('click', function() { openProductModal(item); });

    /* Badge pièce */
    var pieceLabel = document.createElement('div');
    pieceLabel.style.cssText = 'position:absolute;top:8px;left:8px;background:' + (isMain ? 'var(--primary)' : 'rgba(0,0,0,0.5)') + ';color:white;font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;z-index:2;';
    pieceLabel.textContent = KState.lookLabels[idx] || item.category;
    card.appendChild(pieceLabel);

    /* Image */
    var imgDiv = document.createElement('div');
    imgDiv.style.cssText = 'height:' + (isMain ? '200px' : '130px') + ';overflow:hidden;background:var(--primary-light);';
    if (item.image_url) {
      var img = document.createElement('img');
      img.src = item.image_url;
      img.alt = sanitize(item.name);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      imgDiv.appendChild(img);
    } else {
      imgDiv.style.cssText += 'display:flex;align-items:center;justify-content:center;font-size:' + (isMain ? '4rem' : '2.5rem') + ';';
      imgDiv.textContent = productEmoji(item);
    }
    card.appendChild(imgDiv);

    var cardBody = document.createElement('div');
    cardBody.style.cssText = 'padding:8px 10px;';
    var cardName = document.createElement('div');
    cardName.style.cssText = 'font-size:' + (isMain ? '0.88rem' : '0.78rem') + ';font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;';
    cardName.textContent = item.name;
    cardBody.appendChild(cardName);
    var cardPrice = document.createElement('div');
    cardPrice.style.cssText = 'font-size:0.82rem;font-weight:800;color:var(--primary);';
    cardPrice.textContent = fmt(item.price_kmf || 0, 'KMF');
    cardBody.appendChild(cardPrice);
    card.appendChild(cardBody);
    lookGrid.appendChild(card);
  });

  body.appendChild(lookGrid);

  /* ── Total du look ── */
  var total = lookItems.reduce(function(sum, item) { return sum + (item.price_kmf || 0); }, 0);
  var totalDiv = document.createElement('div');
  totalDiv.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px;background:var(--primary-light);border-radius:var(--radius);margin-bottom:12px;';
  var totalLabel = document.createElement('div');
  totalLabel.style.cssText = 'font-size:0.85rem;color:var(--muted);font-weight:600;';
  totalLabel.textContent = 'Total du look (' + lookItems.length + ' pièces)';
  var totalPrice = document.createElement('div');
  totalPrice.style.cssText = 'font-size:1.1rem;font-weight:800;color:var(--primary);';
  totalPrice.textContent = fmt(total, 'KMF');
  totalDiv.appendChild(totalLabel);
  totalDiv.appendChild(totalPrice);
  body.appendChild(totalDiv);

  /* ── Bouton tout ajouter ── */
  var addAllBtn = document.createElement('button');
  addAllBtn.style.cssText = 'width:100%;padding:14px;background:var(--primary);color:white;border:none;border-radius:var(--radius);font-weight:700;font-size:1rem;cursor:pointer;transition:background 0.2s;margin-bottom:8px;';
  addAllBtn.textContent = 'Ajouter tout le look au panier';
  addAllBtn.addEventListener('click', function() {
    lookItems.forEach(function(item) { addToCart(item, 1, null); });
    toast('Look complet ajouté au panier !', 'success');
    closeLookModal();
  });
  body.appendChild(addAllBtn);

  /* ── Bouton rafraîchir le look ── */
  var refreshBtn = document.createElement('button');
  refreshBtn.style.cssText = 'width:100%;padding:10px;background:white;color:var(--primary);border:2px solid var(--primary);border-radius:var(--radius);font-weight:700;font-size:0.88rem;cursor:pointer;';
  refreshBtn.textContent = 'Proposer un autre look';
  refreshBtn.addEventListener('click', function() { openLookModal(mainProduct); });
  body.appendChild(refreshBtn);

  $('look-modal').classList.add('open');
}

function closeLookModal() {
  $('look-modal').classList.remove('open');
}

function closeProductModal() {
  $('product-modal').classList.remove('open');
}

/* ──────────────────────────────────────

/* ── Commande ── */
function checkoutCart() {
  if (KState.cart.length === 0) { toast('Votre panier est vide.', 'error'); return; }
  closeCart();
  KState.orderData = { is_self_pickup: true, payment_mode: 'cashKState.relais' };
  renderCheckout();
  $('order-modal').classList.add('open');
}

function closeOrderModal() {
  $('order-modal').classList.remove('open');
}

function renderCheckout() {
  var body = $('order-modal-body');
  body.innerHTML = '';
  $('order-modal-title').textContent = '\u{1F6D2} Finaliser ma commande';

  /* ── Cart Summary ── */
  var summary = document.createElement('div');
  summary.style.cssText = 'background:#f8fafc;border-radius:10px;padding:10px 14px;margin-bottom:14px;border:1px solid var(--border);';

  var countLine = document.createElement('div');
  countLine.style.cssText = 'font-size:0.82rem;color:var(--muted);';
  countLine.textContent = cartQty() + ' article' + (cartQty() > 1 ? 's' : '');
  summary.appendChild(countLine);

  var priceLine = document.createElement('div');
  priceLine.style.cssText = 'display:flex;align-items:baseline;gap:8px;margin-top:2px;';
  var bigPrice = document.createElement('span');
  bigPrice.style.cssText = 'font-family:Poppins,sans-serif;font-weight:800;font-size:1.25rem;color:var(--text);';
  bigPrice.textContent = fmt(cartTotal(), 'KMF');
  priceLine.appendChild(bigPrice);
  var eurEquiv = document.createElement('span');
  eurEquiv.style.cssText = 'font-size:0.88rem;color:var(--muted);';
  eurEquiv.textContent = '\u2248 ' + fmt(cartTotal(), 'EUR');
  priceLine.appendChild(eurEquiv);
  summary.appendChild(priceLine);
  body.appendChild(summary);

  /* ── Toggle: C'est moi qui récupère ── */
  var toggleWrap = document.createElement('div');
  toggleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;background:' + (KState.orderData.is_self_pickup ? 'var(--primary-light)' : '#f8fafc') + ';border-radius:var(--radius);margin-bottom:14px;cursor:pointer;border:2px solid ' + (KState.orderData.is_self_pickup ? 'var(--primary)' : 'var(--border)') + ';transition:all 0.2s;user-select:none;';

  var toggleTrack = document.createElement('div');
  toggleTrack.style.cssText = 'width:40px;height:22px;border-radius:11px;background:' + (KState.orderData.is_self_pickup ? 'var(--primary)' : 'var(--border)') + ';position:relative;transition:background 0.3s;flex-shrink:0;';
  var toggleThumb = document.createElement('div');
  toggleThumb.style.cssText = 'width:18px;height:18px;border-radius:50%;background:white;position:absolute;top:2px;left:' + (KState.orderData.is_self_pickup ? '20px' : '2px') + ';transition:left 0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.2);';
  toggleTrack.appendChild(toggleThumb);
  toggleWrap.appendChild(toggleTrack);

  var toggleLabel = document.createElement('span');
  toggleLabel.style.cssText = 'font-size:0.88rem;color:var(--text);font-weight:600;';
  toggleLabel.textContent = '\u{1F3EA} C\u2019est moi qui r\u00e9cup\u00e8re au relais';
  toggleWrap.appendChild(toggleLabel);

  toggleWrap.addEventListener('click', function() {
    KState.orderData.is_self_pickup = !KState.orderData.is_self_pickup;
    renderCheckout();
  });
  body.appendChild(toggleWrap);

  if (KState.orderData.is_self_pickup) {
    /* ── MODE: Je récupère moi-même → 1 seul formulaire ── */
    var secTitle = document.createElement('div');
    secTitle.style.cssText = 'font-weight:700;font-size:0.92rem;margin-bottom:10px;color:var(--text);';
    secTitle.textContent = '\u{1F464} Vos coordonn\u00e9es';
    body.appendChild(secTitle);

    /* Nom */
    var nameGroup = document.createElement('div');
    nameGroup.className = 'of-group';
    var nameLabel = document.createElement('label');
    nameLabel.textContent = 'Nom complet *';
    nameGroup.appendChild(nameLabel);
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'of-my-name';
    nameInput.placeholder = 'Votre nom';
    nameInput.value = KState.orderData.my_name || '';
    nameInput.addEventListener('input', function() { KState.orderData.my_name = this.value; });
    nameGroup.appendChild(nameInput);
    body.appendChild(nameGroup);

    /* Tél +269 */
    var phoneGroup = document.createElement('div');
    phoneGroup.className = 'of-group';
    var phoneLabel = document.createElement('label');
    phoneLabel.textContent = 'T\u00e9l\u00e9phone (+269) *';
    phoneGroup.appendChild(phoneLabel);
    var phoneWrap = document.createElement('div');
    phoneWrap.style.cssText = 'display:flex;gap:0;';
    var phonePrefix = document.createElement('div');
    phonePrefix.style.cssText = 'background:var(--bg);border:2px solid var(--border);border-right:none;border-radius:var(--radius) 0 0 var(--radius);padding:9px 10px;font-weight:700;color:var(--muted);white-space:nowrap;display:flex;align-items:center;font-size:0.88rem;';
    phonePrefix.textContent = '+269';
    phoneWrap.appendChild(phonePrefix);
    var phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.id = 'of-my-phone';
    phoneInput.placeholder = '321 12 34';
    phoneInput.value = KState.orderData.my_phone || '';
    phoneInput.style.cssText = 'flex:1;border-radius:0 var(--radius) var(--radius) 0;padding:9px 12px;border:2px solid var(--border);outline:none;font-size:inherit;transition:border-color 0.2s;';
    phoneInput.maxLength = 10;
    phoneInput.pattern = '[0-9 ]{7,10}';
    phoneInput.addEventListener('focus', function() { this.style.borderColor = 'var(--primary)'; });
    phoneInput.addEventListener('blur', function() { this.style.borderColor = 'var(--border)'; });
    phoneInput.addEventListener('input', function() {
      var raw = this.value.replace(/[^0-9]/g, '');
      if (raw.length > 7) raw = raw.substring(0, 7);
      if (raw.length >= 4) raw = raw.substring(0,3) + ' ' + raw.substring(3);
      if (raw.length >= 7) raw = raw.substring(0,6) + ' ' + raw.substring(6);
      this.value = raw;
      KState.orderData.my_phone = raw;
    });
    phoneWrap.appendChild(phoneInput);
    phoneGroup.appendChild(phoneWrap);
    body.appendChild(phoneGroup);

    /* Email optionnel */
    var emailGroup = document.createElement('div');
    emailGroup.className = 'of-group';
    var emailLabel = document.createElement('label');
    emailLabel.textContent = 'Email (pour le suivi)';
    emailGroup.appendChild(emailLabel);
    var emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.id = 'of-my-email';
    emailInput.placeholder = 'votre@email.com';
    emailInput.value = KState.orderData.my_email || '';
    emailInput.addEventListener('input', function() { KState.orderData.my_email = this.value; });
    emailGroup.appendChild(emailInput);
    body.appendChild(emailGroup);

  } else {
    /* ── MODE: Quelqu'un d'autre récupère → 2 sections ── */

    /* Section 1: Récupérateur */
    var pickTitle = document.createElement('div');
    pickTitle.style.cssText = 'font-weight:700;font-size:0.92rem;margin-bottom:10px;color:var(--text);';
    pickTitle.textContent = '\u{1F4CD} Personne qui r\u00e9cup\u00e8re au relais';
    body.appendChild(pickTitle);

    var pnGroup = document.createElement('div');
    pnGroup.className = 'of-group';
    var pnLabel = document.createElement('label');
    pnLabel.textContent = 'Nom complet *';
    pnGroup.appendChild(pnLabel);
    var pnInput = document.createElement('input');
    pnInput.type = 'text';
    pnInput.id = 'of-pickup-name';
    pnInput.placeholder = 'Nom de la personne locale';
    pnInput.value = KState.orderData.pickup_name || '';
    pnInput.addEventListener('input', function() { KState.orderData.pickup_name = this.value; });
    pnGroup.appendChild(pnInput);
    body.appendChild(pnGroup);

    var ppGroup = document.createElement('div');
    ppGroup.className = 'of-group';
    var ppLabel = document.createElement('label');
    ppLabel.textContent = 'T\u00e9l\u00e9phone (+269) *';
    ppGroup.appendChild(ppLabel);
    var ppWrap = document.createElement('div');
    ppWrap.style.cssText = 'display:flex;gap:0;';
    var ppPrefix = document.createElement('div');
    ppPrefix.style.cssText = 'background:var(--bg);border:2px solid var(--border);border-right:none;border-radius:var(--radius) 0 0 var(--radius);padding:9px 10px;font-weight:700;color:var(--muted);white-space:nowrap;display:flex;align-items:center;font-size:0.88rem;';
    ppPrefix.textContent = '+269';
    ppWrap.appendChild(ppPrefix);
    var ppInput = document.createElement('input');
    ppInput.type = 'tel';
    ppInput.id = 'of-pickup-phone';
    ppInput.placeholder = '321 12 34';
    ppInput.value = KState.orderData.pickup_phone || '';
    ppInput.style.cssText = 'flex:1;border-radius:0 var(--radius) var(--radius) 0;padding:9px 12px;border:2px solid var(--border);outline:none;font-size:inherit;transition:border-color 0.2s;';
    ppInput.addEventListener('focus', function() { this.style.borderColor = 'var(--primary)'; });
    ppInput.addEventListener('blur', function() { this.style.borderColor = 'var(--border)'; });
    ppInput.maxLength = 10;
    ppInput.pattern = '[0-9 ]{7,10}';
    ppInput.addEventListener('input', function() {
      var raw = this.value.replace(/[^0-9]/g, '');
      if (raw.length > 7) raw = raw.substring(0, 7);
      if (raw.length >= 4) raw = raw.substring(0,3) + ' ' + raw.substring(3);
      if (raw.length >= 7) raw = raw.substring(0,6) + ' ' + raw.substring(6);
      this.value = raw;
      KState.orderData.pickup_phone = raw;
    });
    ppWrap.appendChild(ppInput);
    ppGroup.appendChild(ppWrap);
    body.appendChild(ppGroup);

    /* Section 2: Vos coordonnées (payeur) */
    var payerTitle = document.createElement('div');
    payerTitle.style.cssText = 'font-weight:700;font-size:0.92rem;margin:14px 0 10px;color:var(--text);';
    payerTitle.textContent = '\u{1F464} Vos coordonn\u00e9es';
    body.appendChild(payerTitle);

    var payerHint = document.createElement('div');
    payerHint.style.cssText = 'font-size:0.78rem;color:var(--muted);margin:-6px 0 10px;';
    payerHint.textContent = 'Pour recevoir le suivi de votre commande';
    body.appendChild(payerHint);

    var cnGroup = document.createElement('div');
    cnGroup.className = 'of-group';
    var cnLabel = document.createElement('label');
    cnLabel.textContent = 'Votre nom';
    cnGroup.appendChild(cnLabel);
    var cnInput = document.createElement('input');
    cnInput.type = 'text';
    cnInput.id = 'of-client-name';
    cnInput.placeholder = 'Votre nom';
    cnInput.value = KState.orderData.client_name || '';
    cnInput.addEventListener('input', function() { KState.orderData.client_name = this.value; });
    cnGroup.appendChild(cnInput);
    body.appendChild(cnGroup);

    var rowClient = document.createElement('div');
    rowClient.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';

    var cpGroup = document.createElement('div');
    cpGroup.className = 'of-group';
    var cpLabel = document.createElement('label');
    cpLabel.textContent = 'T\u00e9l\u00e9phone';
    cpGroup.appendChild(cpLabel);
    var cpInput = document.createElement('input');
    cpInput.type = 'tel';
    cpInput.id = 'of-client-phone';
    cpInput.placeholder = '+33 6 ...';
    cpInput.value = KState.orderData.client_phone || '';
    cpInput.addEventListener('input', function() { KState.orderData.client_phone = this.value; });
    cpGroup.appendChild(cpInput);
    rowClient.appendChild(cpGroup);

    var ceGroup = document.createElement('div');
    ceGroup.className = 'of-group';
    var ceLabel = document.createElement('label');
    ceLabel.textContent = 'Email';
    ceGroup.appendChild(ceLabel);
    var ceInput = document.createElement('input');
    ceInput.type = 'email';
    ceInput.id = 'of-client-email';
    ceInput.placeholder = 'votre@email.com';
    ceInput.value = KState.orderData.client_email || '';
    ceInput.addEventListener('input', function() { KState.orderData.client_email = this.value; });
    ceGroup.appendChild(ceInput);
    rowClient.appendChild(ceGroup);

    body.appendChild(rowClient);
  }

  /* ── Mode de paiement ── */
  var payTitle = document.createElement('div');
  payTitle.style.cssText = 'font-weight:700;font-size:0.92rem;margin:6px 0 8px;color:var(--text);';
  payTitle.textContent = '\u{1F4B3} Paiement';
  body.appendChild(payTitle);

  var cashOpt = document.createElement('label');
  cashOpt.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid var(--primary);border-radius:var(--radius);margin-bottom:6px;cursor:pointer;background:var(--primary-light);';
  var cashRadio = document.createElement('input');
  cashRadio.type = 'radio';
  cashRadio.name = 'payment_mode';
  cashRadio.value = 'cashKState.relais';
  cashRadio.checked = true;
  cashRadio.style.cssText = 'width:16px;height:16px;accent-color:var(--primary);flex-shrink:0;';
  cashOpt.appendChild(cashRadio);
  var cashInfo = document.createElement('div');
  var cashL = document.createElement('div');
  cashL.style.cssText = 'font-weight:700;font-size:0.88rem;';
  cashL.textContent = '\u{1F3EA} Cash au point relais';
  cashInfo.appendChild(cashL);
  var cashS = document.createElement('div');
  cashS.style.cssText = 'font-size:0.75rem;color:var(--muted);margin-top:1px;';
  cashS.textContent = 'Payez en KMF au retrait';
  cashInfo.appendChild(cashS);
  cashOpt.appendChild(cashInfo);
  body.appendChild(cashOpt);

  /* MVola option — Bientôt */
  var mvolaOpt = document.createElement('label');
  mvolaOpt.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid var(--border);border-radius:var(--radius);margin-bottom:6px;cursor:not-allowed;background:white;opacity:0.6;';
  var mvolaRadio = document.createElement('input');
  mvolaRadio.type = 'radio';
  mvolaRadio.name = 'payment_mode';
  mvolaRadio.value = 'mvola';
  mvolaRadio.disabled = true;
  mvolaRadio.style.cssText = 'width:16px;height:16px;flex-shrink:0;';
  mvolaOpt.appendChild(mvolaRadio);
  var mvolaInfo = document.createElement('div');
  var mvolaL = document.createElement('div');
  mvolaL.style.cssText = 'font-weight:700;font-size:0.88rem;display:flex;align-items:center;gap:6px;';
  mvolaL.innerHTML = '<img src="https://www.mvola.km/wp-content/uploads/2023/12/logo.svg" alt="MVola Comores" style="height:22px;"> MVola <span style="font-size:0.65rem;background:#00a651;color:white;padding:1px 6px;border-radius:8px;font-weight:700;">Bient\u00f4t</span>';
  mvolaInfo.appendChild(mvolaL);
  var mvolaSub = document.createElement('div');
  mvolaSub.style.cssText = 'font-size:0.75rem;color:var(--text-light);margin-top:1px;';
  mvolaSub.textContent = 'Paiement mobile money';
  mvolaInfo.appendChild(mvolaSub);
  mvolaOpt.appendChild(mvolaInfo);
  body.appendChild(mvolaOpt);

  var stripeOpt = document.createElement('label');
  stripeOpt.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid var(--border);border-radius:var(--radius);margin-bottom:14px;cursor:not-allowed;background:white;opacity:0.6;';
  var stripeRadio = document.createElement('input');
  stripeRadio.type = 'radio';
  stripeRadio.name = 'payment_mode';
  stripeRadio.value = 'stripe_eur';
  stripeRadio.disabled = true;
  stripeRadio.style.cssText = 'width:16px;height:16px;flex-shrink:0;';
  stripeOpt.appendChild(stripeRadio);
  var stripeInfo = document.createElement('div');
  var stripeL = document.createElement('div');
  stripeL.style.cssText = 'font-weight:700;font-size:0.88rem;display:flex;align-items:center;gap:6px;';
  stripeL.innerHTML = '\u{1F4B3} Carte bancaire <span style="font-size:0.65rem;background:var(--accent);color:white;padding:1px 6px;border-radius:8px;font-weight:700;">Bient\u00f4t</span>';
  stripeInfo.appendChild(stripeL);
  stripeOpt.appendChild(stripeInfo);
  body.appendChild(stripeOpt);

  /* ── Confirm Button ── */
  var confirmBtn = document.createElement('button');
  confirmBtn.id = 'btn-confirm-order';
  confirmBtn.style.cssText = 'width:100%;padding:13px;border-radius:var(--radius);background:linear-gradient(135deg,#d97706,#f59e0b);color:white;font-weight:800;font-size:1rem;border:none;cursor:pointer;transition:filter 0.2s,transform 0.15s;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 14px rgba(217,119,6,0.3);';
  confirmBtn.textContent = '\u2705 Confirmer \u2014 ' + fmt(cartTotal(), 'KMF');
  confirmBtn.addEventListener('click', function() { submitOrder(confirmBtn); });
  confirmBtn.addEventListener('mouseenter', function() { this.style.filter = 'brightness(1.08)'; this.style.transform = 'translateY(-1px)'; });
  confirmBtn.addEventListener('mouseleave', function() { this.style.filter = ''; this.style.transform = ''; });
  body.appendChild(confirmBtn);

  var hint = document.createElement('div');
  hint.style.cssText = 'text-align:center;font-size:0.75rem;color:var(--muted);margin-top:8px;';
  hint.textContent = 'Code + QR envoy\u00e9s par SMS pour le retrait';
  body.appendChild(hint);
}

async function submitOrder(btn) {
  var recipName, recipPhone, clientName, clientPhone, clientEmail;

  if (KState.orderData.is_self_pickup) {
    recipName = (document.getElementById('of-my-name').value || '').trim();
    recipPhone = (document.getElementById('of-my-phone').value || '').trim();
    clientName = recipName;
    clientPhone = '+269' + recipPhone.replace(/\s/g, '');
    var emailEl = document.getElementById('of-my-email');
    clientEmail = emailEl ? emailEl.value.trim() : '';
  } else {
    recipName = (document.getElementById('of-pickup-name').value || '').trim();
    recipPhone = (document.getElementById('of-pickup-phone').value || '').trim();
    clientName = (document.getElementById('of-client-name').value || '').trim() || recipName;
    clientPhone = (document.getElementById('of-client-phone').value || '').trim() || ('+269' + recipPhone.replace(/\s/g, ''));
    clientEmail = (document.getElementById('of-client-email').value || '').trim();
  }

  if (!recipName) { toast('Indiquez le nom de la personne qui r\u00e9cup\u00e8re.', 'error'); return; }
  if (!recipPhone) { toast('Indiquez le t\u00e9l\u00e9phone du r\u00e9cup\u00e9rateur.', 'error'); return; }

  var fullRecipPhone = '+269' + recipPhone.replace(/\s/g, '');

  btn.disabled = true;
  btn.textContent = '\u23f3 Envoi en cours\u2026';
  btn.style.opacity = '0.7';

  try {
    /* Step 1 : guest-checkout — cr\u00e9e ou retrouve le client par t\u00e9l\u00e9phone */
    await apiPost('/api/auth/guest-checkout', {
      full_name: clientName,
      phone: clientPhone,
      email: clientEmail || undefined
    });

    /* Step 2 : cr\u00e9er la commande */
    var items = KState.cart.map(function(i) {
      return { product_id: String(i.product.id), quantity: i.qty, confection_type: 'aucun' };
    });

    var relaisId = KState.relais.length > 0 ? KState.relais[0].id : undefined;

    var apiResult = await apiPost('/api/orders', {
      items: items,
      relais_id: relaisId,
      recipient_name: recipName,
      recipient_phone: fullRecipPhone,
      payment_mode: KState.orderData.payment_mode
    });

    /* API retourne { order: {...}, discount_pct, discount_kmf, loyalty_label } */
    var orderData = apiResult.order || apiResult;

    /* Step 3 : vider le panier */
    KState.cart = [];
    saveCart();
    renderCartBody();

    /* Step 4 : \u00e9cran de succ\u00e8s */
    renderOrderSuccess(orderData, recipName, clientEmail, apiResult);
    toast('Commande confirm\u00e9e !', 'success');

  } catch (e) {
    console.error('submitOrder:', e);
    toast(e.message || 'Erreur lors de la commande.', 'error');
    btn.disabled = false;
    btn.textContent = '\u2705 Confirmer \u2014 ' + fmt(cartTotal(), 'KMF');
    btn.style.opacity = '1';
  }
}


function renderOrderSuccess(order, recipientName, clientEmail, fullResult) {
  var body = $('order-modal-body');
  body.innerHTML = '';
  $('order-modal-title').textContent = '\u2705 Commande confirm\u00e9e';

  var wrap = document.createElement('div');
  wrap.style.cssText = 'text-align:center;padding:14px 0;';

  /* Icon */
  var icon = document.createElement('div');
  icon.style.cssText = 'font-size:3.2rem;margin-bottom:8px;';
  icon.textContent = '\u{1F389}';
  wrap.appendChild(icon);

  /* Title */
  var h3 = document.createElement('h3');
  h3.style.cssText = 'font-family:Poppins,sans-serif;color:var(--primary);margin-bottom:6px;font-size:1.1rem;';
  h3.textContent = 'Commande enregistr\u00e9e !';
  wrap.appendChild(h3);

  /* Reference */
  var refLabel = document.createElement('p');
  refLabel.style.cssText = 'color:var(--muted);font-size:0.85rem;margin-bottom:2px;';
  refLabel.textContent = 'Votre r\u00e9f\u00e9rence :';
  wrap.appendChild(refLabel);

  var refBox = document.createElement('div');
  refBox.style.cssText = 'display:inline-block;background:var(--primary-light);color:var(--primary-dark);font-weight:800;font-size:1.15rem;padding:8px 20px;border-radius:10px;margin:6px 0;letter-spacing:2px;font-family:monospace;';
  refBox.textContent = order.reference || '\u2014';
  wrap.appendChild(refBox);

  /* Cash ref code — affich\u00e9 uniquement pour paiement cash */
  if (order.cash_ref_code && order.payment_mode === 'cashKState.relais') {
    var cashLabel = document.createElement('p');
    cashLabel.style.cssText = 'margin-top:10px;font-weight:700;color:var(--text);font-size:0.88rem;';
    cashLabel.textContent = '\u{1F3EA} Code de paiement au relais :';
    wrap.appendChild(cashLabel);

    var cashCode = document.createElement('div');
    cashCode.style.cssText = 'display:inline-block;background:#fffbeb;color:#92400e;font-weight:800;font-size:1.15rem;padding:8px 22px;border-radius:10px;margin:6px 0;letter-spacing:2px;border:2px solid #fde68a;font-family:monospace;';
    cashCode.textContent = order.cash_ref_code;
    wrap.appendChild(cashCode);
  }

  /* Discount fid\u00e9lit\u00e9 */
  if (fullResult && fullResult.discount_pct > 0) {
    var discDiv = document.createElement('div');
    discDiv.style.cssText = 'margin-top:10px;padding:8px 12px;background:#ecfdf5;border-radius:8px;border:1px solid #a7f3d0;font-size:0.82rem;color:#065f46;font-weight:600;';
    discDiv.textContent = '\u{1F381} Fid\u00e9lit\u00e9 ' + (fullResult.loyalty_label || '') + ' : -' + fullResult.discount_pct + '% (-' + fmt(fullResult.discount_kmf, 'KMF') + ')';
    wrap.appendChild(discDiv);
  }

  /* Info block */
  var info = document.createElement('div');
  info.style.cssText = 'margin-top:12px;padding:10px 12px;background:var(--bg);border-radius:10px;font-size:0.82rem;color:var(--muted);line-height:1.6;text-align:left;';

  var l1 = document.createElement('div');
  l1.textContent = '\u{1F3EA} Paiement en cash (KMF) au point relais lors du retrait.';
  info.appendChild(l1);

  var l2 = document.createElement('div');
  l2.style.marginTop = '4px';
  l2.textContent = '\u{1F4F1} ' + sanitize(recipientName || '') + ' recevra un SMS de confirmation.';
  info.appendChild(l2);

  if (clientEmail) {
    var l3 = document.createElement('div');
    l3.style.marginTop = '4px';
    l3.textContent = '\u{1F4E7} Suivi envoy\u00e9 \u00e0 ' + sanitize(clientEmail);
    info.appendChild(l3);
  }

  var l4 = document.createElement('div');
  l4.style.marginTop = '4px';
  l4.textContent = '\u{1F4CD} Pr\u00e9sentez la r\u00e9f\u00e9rence ou le code au point relais.';
  info.appendChild(l4);

  wrap.appendChild(info);

  /* Bouton Suivre */
  var trackBtn = document.createElement('button');
  trackBtn.style.cssText = 'margin-top:12px;width:100%;padding:11px;border-radius:var(--radius);font-weight:700;font-size:0.9rem;background:var(--primary);color:white;border:none;cursor:pointer;transition:background 0.2s;';
  trackBtn.textContent = '\u{1F4CD} Suivre ma commande';
  trackBtn.addEventListener('mouseenter', function() { this.style.background = 'var(--primary-dark)'; });
  trackBtn.addEventListener('mouseleave', function() { this.style.background = 'var(--primary)'; });
  trackBtn.addEventListener('click', function() {
    closeOrderModal();
    var refVal = order.reference || '';
    if (refVal) {
      var trackInput = document.getElementById('tracking-input');
      if (trackInput) {
        trackInput.value = refVal;
        var trackSection = document.getElementById('tracking');
        if (trackSection) trackSection.scrollIntoView({ behavior: 'smooth' });
        setTimeout(function() { if (typeof searchTracking === 'function') searchTracking(); }, 500);
      }
    }
  });
  wrap.appendChild(trackBtn);

  /* Bouton Fermer */
  var closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'margin-top:6px;width:100%;padding:10px;border-radius:var(--radius);font-weight:600;font-size:0.85rem;background:var(--bg);color:var(--text);border:1px solid var(--border);cursor:pointer;transition:background 0.2s;';
  closeBtn.textContent = 'Fermer';
  closeBtn.addEventListener('mouseenter', function() { this.style.background = 'var(--border)'; });
  closeBtn.addEventListener('mouseleave', function() { this.style.background = 'var(--bg)'; });
  closeBtn.addEventListener('click', closeOrderModal);
  wrap.appendChild(closeBtn);

  body.appendChild(wrap);
}

/* ──────────────────────────────────────
   TRACKING
   ────────────────────────────────────── */
var TRACKING_STEPS = [
  { key: 'confirmed', label: 'Commande confirmée', icon: '📋' },
  { key: 'ordered', label: 'Paiement validé', icon: '💳' },
  { key: 'preparation', label: 'Préparation', icon: '📦' },
  { key: 'shipped', label: 'Expédié', icon: '✈️' },
  { key: 'in_transit', label: 'En transit', icon: '🚢' },
  { key: 'available', label: 'Disponible au relais', icon: '🏪' },
  { key: 'collected', label: 'Remis au client', icon: '✅' }
];

