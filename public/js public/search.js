/* ============================================================
   KOMERCE — Recherche live
   v2.0 — KState.searchIdx uniquement
   ============================================================ */

function heroSearch() {
  var input = $('hero-search-input');
  if (!input) return;
  var q = input.value.trim().toLowerCase();
  closeSearchDropdown();
  if (!q) { renderProducts(KState.products); return; }
  var filtered = KState.products.filter(function(p) {
    return (p.name || '').toLowerCase().indexOf(q) !== -1 ||
           (p.category || '').toLowerCase().indexOf(q) !== -1 ||
           (p.description || '').toLowerCase().indexOf(q) !== -1;
  });
  renderProducts(filtered);
  var catalogue = document.getElementById('catalogue');
  if (catalogue) catalogue.scrollIntoView({ behavior: 'smooth' });
}

function liveSearch(q) {
  var dd = $('search-dropdown');
  if (!dd) return;
  if (!q || !KState.products.length) { closeSearchDropdown(); return; }

  var results = KState.products.filter(function(p) {
    return (p.name || '').toLowerCase().indexOf(q.toLowerCase()) !== -1 ||
           (p.category || '').toLowerCase().indexOf(q.toLowerCase()) !== -1;
  }).slice(0, 6);

  if (!results.length) { closeSearchDropdown(); return; }

  dd.innerHTML = '';
  dd.style.display = 'block';
  KState.searchIdx = -1;

  results.forEach(function(p, i) {
    var item = document.createElement('div');
    item.className = 'search-item';
    item.setAttribute('data-idx', i);

    if (p.image_url) {
      var img = document.createElement('img');
      img.src = p.image_url;
      img.alt = sanitize(p.name);
      img.className = 'search-item-emoji';
      img.style.cssText = 'width:36px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0;';
      item.appendChild(img);
    } else {
      var emo = document.createElement('span');
      emo.className = 'search-item-emoji';
      emo.textContent = productEmoji(p);
      item.appendChild(emo);
    }

    var info = document.createElement('div');
    info.className = 'search-item-info';
    var nameEl = document.createElement('div');
    nameEl.className = 'search-item-name';
    nameEl.textContent = p.name || '';
    var priceEl = document.createElement('div');
    priceEl.className = 'search-item-price';
    priceEl.textContent = fmt(p.price_kmf || 0, 'KMF');
    info.appendChild(nameEl);
    info.appendChild(priceEl);
    item.appendChild(info);

    item.addEventListener('mousedown', function(e) {
      e.preventDefault();
      closeSearchDropdown();
      openProductModal(p);
    });
    dd.appendChild(item);
  });
}

function closeSearchDropdown() {
  var dd = $('search-dropdown');
  if (dd) dd.style.display = 'none';
  KState.searchIdx = -1;
}

function initHeroSearch() {
  var input = $('hero-search-input');
  var btn = $('hero-search-btn');
  if (!input) return;

  input.addEventListener('input', function() {
    liveSearch(input.value.trim());
  });

  input.addEventListener('keydown', function(e) {
    var dd = $('search-dropdown');
    var items = dd ? dd.querySelectorAll('.search-item') : [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      KState.searchIdx = Math.min(KState.searchIdx + 1, items.length - 1);
      items.forEach(function(el, i) { el.classList.toggle('active', i === KState.searchIdx); });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      KState.searchIdx = Math.max(KState.searchIdx - 1, -1);
      items.forEach(function(el, i) { el.classList.toggle('active', i === KState.searchIdx); });
    } else if (e.key === 'Enter') {
      if (KState.searchIdx >= 0 && items[KState.searchIdx]) {
        items[KState.searchIdx].dispatchEvent(new MouseEvent('mousedown'));
      } else {
        heroSearch();
      }
    } else if (e.key === 'Escape') {
      closeSearchDropdown();
    }
  });

  document.addEventListener('click', function(e) {
    var wrap = document.querySelector('.nav-search-wrap');
    if (wrap && !wrap.contains(e.target)) {
      closeSearchDropdown();
    }
  });

  if (btn) btn.addEventListener('click', heroSearch);
}
