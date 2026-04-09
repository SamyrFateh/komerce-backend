/* ============================================================
   KOMERCE — Catalogue produits
   renderProducts, renderRows, cards, filtres
   ============================================================ */

/* ── Grille 2+ colonnes ── */
function renderProducts(list) {
  KState.lastList = list || [];

  var track = $('product-track');
  if (!track) return;
  track.className = 'product-grid';
  track.innerHTML = '';

  if (!list || list.length === 0) {
    var empty = document.createElement('p');
    empty.style.cssText = 'text-align:center;color:var(--muted);padding:40px;grid-column:1/-1;';
    empty.textContent = 'Aucun produit trouvé.';
    track.appendChild(empty);
    return;
  }

  list.forEach(function(p) {
    track.appendChild(makeProductCard(p));
  });
}

/* ── Card produit ── */
function makeProductCard(p) {
  var card = document.createElement('div');
  card.className = 'product-card';
  card.setAttribute('data-id', p.id);
  card.addEventListener('click', function(e) {
    if (e.target.closest('.btn-add-cart') || e.target.closest('.btn-fav')) return;
    openProductModal(p);
  });

  /* Image */
  var imgDiv = document.createElement('div');
  imgDiv.className = 'card-img';
  imgDiv.style.position = 'relative';

  if (p.image_url) {
    var img = document.createElement('img');
    img.src = p.image_url;
    img.alt = sanitize(p.name);
    imgDiv.appendChild(img);
  } else {
    imgDiv.textContent = productEmoji(p);
  }

  /* Badge SOLDES */
  if (p.is_promo && p.promo_pct) {
    var badge = document.createElement('div');
    badge.className = 'card-badge';
    badge.textContent = 'SOLDES -' + p.promo_pct + '%';
    imgDiv.appendChild(badge);
  }
  card.appendChild(imgDiv);

  /* Badge panier */
  var cartBadge = document.createElement('div');
  cartBadge.className = 'card-cart-badge';
  cartBadge.setAttribute('data-badge-pid', p.id);
  var cbIcon = document.createElement('span');
  cbIcon.textContent = '🛒';
  cbIcon.style.fontSize = '0.7rem';
  cartBadge.appendChild(cbIcon);
  var cbQty = document.createElement('span');
  cbQty.className = 'badge-qty';
  cbQty.textContent = '0';
  cartBadge.appendChild(cbQty);
  card.appendChild(cartBadge);

  /* Corps */
  var body = document.createElement('div');
  body.className = 'card-body';

  var cat = document.createElement('div');
  cat.className = 'card-category';
  cat.textContent = categoryLabel(p.category);
  body.appendChild(cat);

  var name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = p.name || 'Produit';
  name.title = p.name || '';
  body.appendChild(name);

  /* Prix barré si solde */
  if (p.is_promo && p.promo_pct) {
    var origPrice = Math.round(p.price_kmf / (1 - p.promo_pct / 100));
    var orig = document.createElement('div');
    orig.className = 'card-price-original';
    orig.textContent = fmt(origPrice, 'KMF');
    body.appendChild(orig);
  }

  var price = document.createElement('div');
  price.className = 'card-price';
  price.textContent = fmt(p.price_kmf || 0, 'KMF');
  body.appendChild(price);

  if (KState.currency === 'EUR') {
    var conv = document.createElement('div');
    conv.className = 'card-price-conv';
    conv.textContent = fmt(p.price_kmf || 0, 'EUR');
    body.appendChild(conv);
  }

  var avail = availabilityInfo(p);
  var availBadge = document.createElement('div');
  availBadge.className = 'avail-badge ' + avail.cls;
  availBadge.textContent = avail.icon + ' ' + avail.label;
  body.appendChild(availBadge);

  var actions = document.createElement('div');
  actions.className = 'card-actions';

  var addBtn = document.createElement('button');
  addBtn.className = 'btn-add-cart';
  addBtn.setAttribute('data-product-id', p.id);
  addBtn.textContent = '🛒 Ajouter';
  (function(product, btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      addToCart(product, 1, btn);
    });
  })(p, addBtn);
  actions.appendChild(addBtn);

  var favBtn = document.createElement('button');
  favBtn.className = 'btn-fav';
  favBtn.textContent = isFav(p.id) ? '❤️' : '🤍';
  favBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleFav(p.id);
    favBtn.textContent = isFav(p.id) ? '❤️' : '🤍';
    updateFavBadge();
  });
  actions.appendChild(favBtn);

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

/* ── Vue rangées swipeables par catégorie ── */
function renderRows(list) {
  KState.lastList = list || [];

  var track = $('product-track');
  if (!track) return;
  track.className = 'cat-rows-view';
  track.innerHTML = '';

  var byCategory = {};
  KState.catOrder.forEach(function(cat) { byCategory[cat] = []; });
  list.forEach(function(p) {
    if (byCategory[p.category] !== undefined) {
      byCategory[p.category].push(p);
    }
  });

  KState.catOrder.forEach(function(cat) {
    var items = byCategory[cat];
    if (!items || !items.length) return;

    var section = document.createElement('div');
    section.className = 'cat-row-section';

    var header = document.createElement('div');
    header.className = 'cat-row-header';

    var title = document.createElement('div');
    title.className = 'cat-row-title';
    title.textContent = cat;

    var more = document.createElement('button');
    more.className = 'cat-row-more';
    more.textContent = 'Voir tout →';
    more.addEventListener('click', function() {
      document.querySelectorAll('.cat-circle').forEach(function(c) { c.classList.remove('active'); });
      var pill = document.querySelector('.cat-circle[data-cat="' + cat + '"]');
      if (pill) pill.classList.add('active');
      KState.viewMode = 'grid';
      updateViewToggle();
      renderProducts(list.filter(function(p) { return p.category === cat; }));
    });

    header.appendChild(title);
    header.appendChild(more);
    section.appendChild(header);

    var swipeTrack = document.createElement('div');
    swipeTrack.className = 'swipe-track';

    items.forEach(function(p) {
      swipeTrack.appendChild(makeSwipeCard(p));
    });

    section.appendChild(swipeTrack);
    track.appendChild(section);
  });
}

/* ── Card swipe (vue rangées) ── */
function makeSwipeCard(p) {
  var card = document.createElement('div');
  card.className = 'swipe-card';
  card.addEventListener('click', function(e) {
    if (e.target.closest('.swipe-card-add')) return;
    openProductModal(p);
  });
  card.addEventListener('touchstart', function() { card.style.transform='scale(0.97)'; }, {passive:true});
  card.addEventListener('touchend', function() { card.style.transform=''; }, {passive:true});

  var imgDiv = document.createElement('div');
  imgDiv.className = 'swipe-card-img';

  if (p.is_promo && p.promo_pct) {
    var badge = document.createElement('div');
    badge.style.cssText = 'position:absolute;top:8px;left:8px;background:var(--accent);color:#1e2a38;font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;z-index:2;';
    badge.textContent = 'SOLDES -' + p.promo_pct + '%';
    imgDiv.appendChild(badge);
  }

  if (p.image_url) {
    var img = document.createElement('img');
    img.src = p.image_url;
    img.alt = sanitize(p.name);
    imgDiv.appendChild(img);
  } else {
    imgDiv.style.cssText += 'display:flex;align-items:center;justify-content:center;font-size:3rem;';
    imgDiv.textContent = productEmoji(p);
  }
  card.appendChild(imgDiv);

  var body = document.createElement('div');
  body.className = 'swipe-card-body';

  var name = document.createElement('div');
  name.className = 'swipe-card-name';
  name.textContent = p.name;
  body.appendChild(name);

  var price = document.createElement('div');
  price.className = 'swipe-card-price';
  price.textContent = fmt(p.price_kmf || 0, 'KMF');
  body.appendChild(price);

  var addBtn = document.createElement('button');
  addBtn.className = 'swipe-card-add' + (p.is_promo ? ' solde' : '');
  addBtn.textContent = '+ Panier';
  addBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    addToCart(p, 1, addBtn);
  });
  body.appendChild(addBtn);

  card.appendChild(body);
  return card;
}

/* ── Toggle vue grille / rangées ── */
function updateViewToggle() {
  var gridBtn = document.getElementById('view-grid-btn');
  var rowsBtn = document.getElementById('view-rows-btn');
  if (!gridBtn || !rowsBtn) return;

  if (KState.viewMode === 'grid') {
    gridBtn.style.background = 'var(--primary)';
    gridBtn.style.borderColor = 'var(--primary)';
    gridBtn.style.color = 'white';
    rowsBtn.style.background = 'white';
    rowsBtn.style.borderColor = 'var(--border)';
    rowsBtn.style.color = 'var(--muted)';
    var track = $('product-track');
    if (track) track.className = 'product-grid';
  } else {
    rowsBtn.style.background = 'var(--primary)';
    rowsBtn.style.borderColor = 'var(--primary)';
    rowsBtn.style.color = 'white';
    gridBtn.style.background = 'white';
    gridBtn.style.borderColor = 'var(--border)';
    gridBtn.style.color = 'var(--muted)';
  }
}

/* ── Filtres rapides ── */
function applyFilter(sort, baselist) {
  var list = (baselist || KState.lastList).slice();
  if (sort === 'promo')      return list.filter(function(p) { return p.is_promo; });
  if (sort === 'price-asc')  return list.sort(function(a,b) { return a.price_kmf - b.price_kmf; });
  if (sort === 'price-desc') return list.sort(function(a,b) { return b.price_kmf - a.price_kmf; });
  if (sort === 'stock')      return list.filter(function(p) { return p.stock > 0; });
  return list;
}
