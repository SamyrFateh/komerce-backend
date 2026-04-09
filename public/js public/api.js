/* ============================================================
   KOMERCE — Couche API (data uniquement, aucun appel UI)
   v2.0 — API → KState uniquement, pub/sub pour déclencher le rendu
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
    KState.lastList = KState.products;
    KState.emit('products:loaded', KState.products);
  } catch(e) {
    console.error('loadProducts:', e);
    KState.emit('products:error', e);
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
