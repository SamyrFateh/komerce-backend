/* ============================================================
   KOMERCE — Panier
   v2.0 — KState.cart uniquement (plus d'alias _cart)
   ============================================================ */

function cartQty() {
  return KState.cart.reduce(function(s, i) { return s + i.qty; }, 0);
}

function cartTotal() {
  return KState.cart.reduce(function(s, i) {
    return s + (i.product.price_kmf || 0) * i.qty;
  }, 0);
}

function saveCart() {
  try { localStorage.setItem('komerce_cart', JSON.stringify(KState.cart)); } catch(e) {}
}

function refreshCartBadge() {
  var badge = $('cart-count');
  if (!badge) return;
  var qty = cartQty();
  badge.textContent = qty;
  badge.classList.toggle('hidden', qty === 0);
}

function updateCartBadges() {
  var badges = document.querySelectorAll('[data-badge-pid]');
  badges.forEach(function(b) {
    var pid = b.getAttribute('data-badge-pid');
    var item = KState.cart.find(function(i) { return i.product.id === pid; });
    var qty = item ? item.qty : 0;
    var qtyEl = b.querySelector('.badge-qty');
    if (qtyEl) qtyEl.textContent = qty;
    b.style.display = qty > 0 ? 'flex' : 'none';
  });
}

function addToCart(product, qty, btn) {
  var existing = KState.cart.find(function(i) { return i.product.id === product.id; });
  if (existing) {
    existing.qty += (qty || 1);
  } else {
    KState.cart.push({ product: product, qty: qty || 1 });
  }
  saveCart();
  refreshCartBadge();
  updateCartBadges();
  if (btn) btnAddedFeedback(btn, btn.textContent);
  flyToCart(btn, product);
  toast(product.name + ' ajouté au panier', 'success');
}

function removeFromCart(productId) {
  KState.cart = KState.cart.filter(function(i) { return i.product.id !== productId; });
  saveCart();
  refreshCartBadge();
  updateCartBadges();
  renderCartBody();
}

function setQty(productId, newQty) {
  if (newQty < 1) { removeFromCart(productId); return; }
  var item = KState.cart.find(function(i) { return i.product.id === productId; });
  if (item) {
    item.qty = newQty;
    saveCart();
    refreshCartBadge();
    updateCartBadges();
    renderCartBody();
  }
}

function openCart() {
  var overlay = $('cart-overlay');
  var drawer = $('cart-drawer');
  if (overlay) overlay.classList.add('open');
  if (drawer) drawer.classList.add('open');
  renderCartBody();
}

function closeCart() {
  var overlay = $('cart-overlay');
  var drawer = $('cart-drawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
}

function openCartWithHighlight(productId) {
  openCart();
  setTimeout(function() {
    var item = document.querySelector('.cart-item[data-pid="' + productId + '"]');
    if (item) {
      item.classList.add('just-added');
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(function() { item.classList.remove('just-added'); }, 2000);
    }
  }, 100);
}

function renderCartBody(highlightId) {
  var body = $('cart-body');
  var footer = $('cart-footer');
  var emptyEl = $('cart-empty');
  if (!body) return;

  body.innerHTML = '';

  if (KState.cart.length === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (footer) footer.style.display = 'none';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (footer) footer.style.display = 'block';

  var continueBtn = document.createElement('button');
  continueBtn.className = 'cart-continue-shop';
  continueBtn.textContent = '← Continuer mes achats';
  continueBtn.addEventListener('click', closeCart);
  body.appendChild(continueBtn);

  KState.cart.forEach(function(item) {
    var p = item.product;
    var div = document.createElement('div');
    div.className = 'cart-item' + (highlightId === p.id ? ' just-added' : '');
    div.setAttribute('data-pid', p.id);

    var emojiDiv = document.createElement('div');
    emojiDiv.className = 'cart-item-emoji';
    if (p.image_url) {
      var img = document.createElement('img');
      img.src = p.image_url;
      img.alt = sanitize(p.name);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:6px;';
      emojiDiv.appendChild(img);
    } else {
      emojiDiv.textContent = productEmoji(p);
    }
    div.appendChild(emojiDiv);

    var info = document.createElement('div');
    info.className = 'cart-item-info';

    var nameEl = document.createElement('div');
    nameEl.className = 'cart-item-name';
    nameEl.textContent = p.name || '';
    info.appendChild(nameEl);

    var priceEl = document.createElement('div');
    priceEl.className = 'cart-item-price';
    priceEl.textContent = fmt(p.price_kmf || 0, 'KMF');
    info.appendChild(priceEl);

    var qtyDiv = document.createElement('div');
    qtyDiv.className = 'cart-item-qty';

    var minusBtn = document.createElement('button');
    minusBtn.className = 'qty-btn';
    minusBtn.textContent = '−';
    (function(pid, q) {
      minusBtn.addEventListener('click', function() { setQty(pid, q - 1); });
    })(p.id, item.qty);
    qtyDiv.appendChild(minusBtn);

    var qtyVal = document.createElement('span');
    qtyVal.className = 'qty-val';
    qtyVal.textContent = item.qty;
    qtyDiv.appendChild(qtyVal);

    var plusBtn = document.createElement('button');
    plusBtn.className = 'qty-btn';
    plusBtn.textContent = '+';
    (function(pid, q) {
      plusBtn.addEventListener('click', function() { setQty(pid, q + 1); });
    })(p.id, item.qty);
    qtyDiv.appendChild(plusBtn);
    info.appendChild(qtyDiv);
    div.appendChild(info);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'cart-item-remove';
    removeBtn.textContent = '✕';
    (function(pid) {
      removeBtn.addEventListener('click', function() { removeFromCart(pid); });
    })(p.id);
    div.appendChild(removeBtn);

    body.appendChild(div);
  });

  var total = cartTotal();
  var totalEl = $('cart-total-kmf');
  var totalConv = $('cart-total-conv');
  if (totalEl) totalEl.textContent = fmt(total, 'KMF');
  if (totalConv) totalConv.textContent = fmt(total, 'EUR');
}

function flyToCart(sourceEl, product) {
  if (!sourceEl) return;
  var cartBtn = $('nav-cart-btn');
  if (!cartBtn) return;
  var srcRect = sourceEl.getBoundingClientRect();
  var destRect = cartBtn.getBoundingClientRect();

  var fly = document.createElement('div');
  fly.style.cssText = [
    'position:fixed',
    'width:40px', 'height:40px',
    'border-radius:50%',
    'background:var(--primary)',
    'z-index:9999',
    'pointer-events:none',
    'opacity:0.85',
    'transition:transform 0.6s cubic-bezier(0.2,1,0.3,1), opacity 0.6s',
    'left:' + (srcRect.left + srcRect.width/2 - 20) + 'px',
    'top:' + (srcRect.top + srcRect.height/2 - 20) + 'px'
  ].join(';');
  document.body.appendChild(fly);

  requestAnimationFrame(function() {
    var dx = destRect.left + destRect.width/2 - (srcRect.left + srcRect.width/2);
    var dy = destRect.top + destRect.height/2 - (srcRect.top + srcRect.height/2);
    fly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(0.3)';
    fly.style.opacity = '0';
    setTimeout(function() {
      if (fly.parentNode) fly.parentNode.removeChild(fly);
      var badge = $('cart-count');
      if (badge) badge.classList.add('bump');
      setTimeout(function() {
        if (badge) badge.classList.remove('bump');
      }, 600);
    }, 650);
  });
}

function shareCartWhatsApp() {
  if (KState.cart.length === 0) { toast('Panier vide', 'info'); return; }
  var lines = KState.cart.map(function(i) {
    return '• ' + i.product.name + ' x' + i.qty + ' — ' + fmt(i.product.price_kmf * i.qty, 'KMF');
  });
  lines.push('\nTotal : ' + fmt(cartTotal(), 'KMF'));
  var msg = encodeURIComponent('Bonjour, je voudrais commander :\n' + lines.join('\n'));
  window.open('https://wa.me/+2693210000?text=' + msg, '_blank');
}

function clearCart() {
  KState.cart = [];
  saveCart();
  refreshCartBadge();
  updateCartBadges();
  renderCartBody();
  toast('Panier vidé', 'info');
}
