/* ============================================================
   KOMERCE — Couche API
   ============================================================ */

async function apiGet(path) {
  var res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function apiPost(path, body) {
  var res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  var data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erreur'), { data });
  return data;
}

async function loadProducts() {
  try {
    var data = await apiGet('/api/products?limit=250');
    KState.products = data.products || data || [];
    /* Alias backward compat */
    _products = KState.products;
    KState.lastList = KState.products;
    _lastList = KState.lastList;
    renderProducts(KState.products);
    updateCartBadges();
  } catch(e) {
    console.error('loadProducts:', e);
    var track = $('product-track');
    if (track) {
      track.innerHTML = '';
      var err = document.createElement('p');
      err.style.cssText = 'text-align:center;color:var(--muted);padding:40px;grid-column:1/-1;';
      err.textContent = 'Impossible de charger le catalogue.';
      track.appendChild(err);
    }
  }
}

async function loadRelais() {
  try {
    var data = await apiGet('/api/relais');
    KState.relais = Array.isArray(data) ? data : [];
  } catch(e) {
    console.warn('loadRelais:', e);
    KState.relais = [];
  }
}

async function loadRates() {
  try {
    var data = await apiGet('/api/rates');
    if (data && data.eur_kmf) {
      KState.rates = { EUR: data.eur_kmf, KMF: 1 };
    }
  } catch(e) {
    /* Garder les taux par défaut */
  }
}
