/* ============================================================
   KOMERCE — Navigation
   v2.0 — KState uniquement, plus d'alias _currentSort/_viewMode/_favs
   ============================================================ */

/* ── Onglets principaux ── */
function initTabs() {
  var tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      tabBtns.forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      var panel = document.getElementById('tab-' + btn.dataset.tab);
      if (panel) panel.classList.add('active');
      if (btn.dataset.tab === 'favoris') renderFavs();
    });
  });
}

/* ── Cercles catégories ── */
function initCatCircles() {
  var circles = document.querySelectorAll('.cat-circle');
  circles.forEach(function(circle) {
    circle.addEventListener('click', function() {
      circles.forEach(function(c) { c.classList.remove('active'); });
      circle.classList.add('active');

      var cat = circle.dataset.cat;
      var filtered = cat
        ? KState.products.filter(function(p) {
            return (p.category || '').toLowerCase() === cat.toLowerCase();
          })
        : KState.products;

      KState.currentSort = '';
      document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
      var defaultBtn = document.querySelector('.filter-btn[data-sort=""]');
      if (defaultBtn) defaultBtn.classList.add('active');

      if (KState.viewMode === 'rows') {
        renderRows(filtered);
      } else {
        renderProducts(filtered);
      }

      var catalogue = document.getElementById('catalogue');
      if (catalogue) catalogue.scrollIntoView({ behavior: 'smooth' });
    });
  });
}

/* ── Filtres tri rapide ── */
function initFilters() {
  var filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      filterBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var sort = btn.dataset.sort;
      KState.currentSort = sort;

      var activeCat = document.querySelector('.cat-circle.active');
      var cat = activeCat ? activeCat.dataset.cat : '';
      var base = cat
        ? KState.products.filter(function(p) {
            return (p.category || '').toLowerCase() === cat.toLowerCase();
          })
        : KState.products.slice();

      var sorted = applyFilter(sort, base);

      if (KState.viewMode === 'rows') {
        renderRows(sorted);
      } else {
        renderProducts(sorted);
      }
    });
  });
}

/* ── Toggle vue grille / rangées ── */
function initViewToggle() {
  var gridBtn = document.getElementById('view-grid-btn');
  var rowsBtn = document.getElementById('view-rows-btn');

  if (gridBtn) {
    gridBtn.addEventListener('click', function() {
      KState.viewMode = 'grid';
      updateViewToggle();
      var track = $('product-track');
      if (track) track.className = 'product-grid';
      renderProducts(KState.lastList || KState.products);
    });
  }

  if (rowsBtn) {
    rowsBtn.addEventListener('click', function() {
      KState.viewMode = 'rows';
      updateViewToggle();
      renderRows(KState.lastList || KState.products);
    });
  }
}

/* ── Promo bar ── */
function initPromoBar() {
  var msgs = document.querySelectorAll('#promo-bar .promo-msg');
  if (!msgs.length) return;
  var idx = 0;
  msgs[0].classList.add('active');
  if (msgs.length <= 1) return;
  setInterval(function() {
    msgs[idx].classList.remove('active');
    idx = (idx + 1) % msgs.length;
    msgs[idx].classList.add('active');
  }, 4000);
}

/* ── Favoris ── */
function saveFavs() {
  try { localStorage.setItem('komerce_favs', JSON.stringify(KState.favs)); } catch(e) {}
}

function toggleFav(productId) {
  if (KState.favs[productId]) {
    delete KState.favs[productId];
  } else {
    KState.favs[productId] = true;
  }
  saveFavs();
}

function isFav(productId) { return !!KState.favs[productId]; }

function updateFavBadge() {
  var count = Object.keys(KState.favs).length;
  var badge = document.getElementById('fav-count-badge');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline' : 'none';
  }
}

function renderFavs() {
  var grid = document.getElementById('favs-grid');
  if (!grid) return;
  var favIds = Object.keys(KState.favs);
  if (!favIds.length) {
    grid.innerHTML = '<p style="color:var(--muted);grid-column:1/-1;text-align:center;padding:40px 0;">Aucun favori — cliquez sur ♡ sur un produit pour l\'ajouter.</p>';
    return;
  }
  var favProducts = KState.products.filter(function(p) { return KState.favs[p.id]; });
  grid.innerHTML = '';
  favProducts.forEach(function(p) {
    grid.appendChild(makeProductCard(p));
  });
}
