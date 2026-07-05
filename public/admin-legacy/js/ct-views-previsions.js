/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-previsions
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/**
 * KOMERCE Control Tower — Vue Prévision v1.0
 *
 * UI de forecast business :
 *   - Forecast CA (pessimiste / attendu / optimiste) sur date cible
 *     → utilise /api/dashboard/forecast (endpoint existant)
 *   - Ruptures stock imminentes (produits < seuil d'alerte)
 *     → utilise /api/products avec filtrage côté front
 *   - KPIs d'activité récente (vélocité des ventes)
 *
 * Injection dans CT.views.previsions (sans modifier ct-views-v7.js ni ct-app-v7.js).
 * Route déclarée dans ct-app-v7.js (ajouter au mapping navigate).
 */

(function() {
  'use strict';

  if (typeof window.CT === 'undefined') window.CT = {};
  if (typeof window.CT.views === 'undefined') window.CT.views = {};

  // ═══════════════════════════════════════════════════════════════════════
  // STYLES (injection unique)
  // ═══════════════════════════════════════════════════════════════════════

  const PREV_CSS = `
    .pv-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px; }
    .pv-header h2 { font-size:24px; }
    .pv-subtitle { color:#64748b; font-size:14px; }

    .pv-section { background:white; border-radius:12px; padding:20px; margin-bottom:16px; box-shadow:0 1px 3px rgba(0,0,0,0.06); }
    .pv-section-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; flex-wrap:wrap; gap:12px; }
    .pv-section-head h3 { font-size:17px; color:#334155; font-weight:700; }
    .pv-section-sub { font-size:12px; color:#94a3b8; margin-top:2px; }

    /* Form forecast */
    .pv-controls { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:16px; }
    .pv-controls label { font-size:13px; color:#475569; font-weight:600; }
    .pv-controls input[type="date"],
    .pv-controls input[type="number"] { padding:8px 12px; border:1px solid #e2e8f0; border-radius:8px; font-size:14px; outline:none; }
    .pv-controls input:focus { border-color:#3b82f6; }
    .pv-controls button { padding:8px 16px; background:#3b82f6; color:white; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; }
    .pv-controls button:hover { background:#2563eb; }

    /* Forecast projections (3 scénarios) */
    .pv-forecast-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:12px; }
    @media (max-width: 768px) { .pv-forecast-grid { grid-template-columns:1fr; } }
    .pv-scenario { padding:16px; border-radius:12px; border:2px solid; background:white; }
    .pv-scenario-label { font-size:11px; text-transform:uppercase; letter-spacing:1px; font-weight:700; color:#64748b; margin-bottom:6px; }
    .pv-scenario-value { font-size:24px; font-weight:800; line-height:1.1; }
    .pv-scenario-unit { font-size:13px; color:#94a3b8; font-weight:500; margin-left:3px; }
    .pv-scenario-sub { font-size:12px; color:#64748b; margin-top:6px; }
    .pv-pessimist { border-color:#fecaca; background:linear-gradient(135deg, #fef2f2 0%, white 100%); color:#991b1b; }
    .pv-expected  { border-color:#bfdbfe; background:linear-gradient(135deg, #eff6ff 0%, white 100%); color:#1e40af; }
    .pv-optimist  { border-color:#bbf7d0; background:linear-gradient(135deg, #f0fdf4 0%, white 100%); color:#166534; }

    /* Forecast meta */
    .pv-meta { background:#f8fafc; padding:12px 16px; border-radius:8px; font-size:13px; color:#475569; display:flex; flex-wrap:wrap; gap:20px; }
    .pv-meta strong { color:#1e293b; }
    .pv-realise { display:inline-flex; align-items:center; gap:6px; background:#dcfce7; color:#166534; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:700; }

    /* Stock ruptures */
    .pv-stock-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px; }
    .pv-stock-card { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:12px; display:flex; gap:12px; align-items:center; }
    .pv-stock-card.critical { border-left:4px solid #dc2626; background:#fef2f2; }
    .pv-stock-card.warning  { border-left:4px solid #f59e0b; background:#fffbeb; }
    .pv-stock-img { width:48px; height:48px; border-radius:8px; background:#f1f5f9; flex-shrink:0; object-fit:cover; }
    .pv-stock-body { flex:1; min-width:0; }
    .pv-stock-name { font-size:13px; font-weight:600; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pv-stock-meta { font-size:11px; color:#64748b; margin-top:2px; }
    .pv-stock-qty { font-size:22px; font-weight:800; }
    .pv-stock-qty.critical { color:#dc2626; }
    .pv-stock-qty.warning  { color:#f59e0b; }
    .pv-stock-qty-label { font-size:10px; color:#94a3b8; text-align:right; text-transform:uppercase; letter-spacing:0.5px; }

    .pv-empty { text-align:center; padding:32px; color:#94a3b8; font-size:14px; }
    .pv-error { background:#fef2f2; color:#dc2626; padding:16px; border-radius:8px; text-align:center; }

    /* Velocity KPIs */
    .pv-velocity-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:12px; }
    .pv-vkpi { background:#f8fafc; border-radius:10px; padding:14px; }
    .pv-vkpi-label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:1px; font-weight:600; }
    .pv-vkpi-value { font-size:22px; font-weight:800; color:#1e293b; margin-top:4px; line-height:1.1; }
    .pv-vkpi-sub { font-size:11px; color:#94a3b8; margin-top:3px; }
  `;

  function injectStyles() {
    if (document.getElementById('pv-styles')) return;
    const style = document.createElement('style');
    style.id = 'pv-styles';
    style.textContent = PREV_CSS;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  function fmt(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('fr-FR').replace(/,/g, ' ') + ' KMF';
  }

  function fmtShort(n) {
    if (n == null || isNaN(n)) return '—';
    n = Math.round(n);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'k';
    return String(n);
  }

  // Date par défaut : fin du mois courant
  function defaultTargetDate() {
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return endOfMonth.toISOString().slice(0, 10);
  }

  // Seuils de stock (configurable)
  const STOCK_CRITICAL = 3;
  const STOCK_WARNING = 10;

  // ═══════════════════════════════════════════════════════════════════════
  // API CALLS
  // ═══════════════════════════════════════════════════════════════════════

  async function fetchForecast(targetDate, refPeriod) {
    const url = '/api/dashboard/forecast?target_date=' + encodeURIComponent(targetDate) +
                '&ref_period=' + (refPeriod || 30);
    return CT.api.get(url);
  }

  async function fetchProducts() {
    // Endpoint public : liste produits actifs avec stock
    const data = await CT.api.get('/api/products?limit=500');
    return data.products || data || [];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER BLOCKS
  // ═══════════════════════════════════════════════════════════════════════

  function renderForecastBlock(forecast) {
    if (!forecast) {
      return '<div class="pv-empty">Aucune donnée de forecast disponible</div>';
    }

    const p = forecast.projection || {};
    const m = forecast.modele || {};
    const realise = forecast.realise_kmf || 0;
    const daysLeft = forecast.days_remaining || 0;

    return `
      <div class="pv-meta">
        <div>🎯 Cible : <strong>${forecast.target_date}</strong></div>
        <div>⏳ Jours restants : <strong>${daysLeft}</strong></div>
        <div>📊 Base de calcul : <strong>${m.ref_period_jours || 30} derniers jours</strong></div>
        <div>💰 CA moyen/jour : <strong>${fmt(m.avg_ca_jour)}</strong></div>
        <div><span class="pv-realise">✓ Déjà réalisé ce mois : ${fmt(realise)}</span></div>
      </div>

      <div class="pv-forecast-grid" style="margin-top:16px;">
        <div class="pv-scenario pv-pessimist">
          <div class="pv-scenario-label">📉 Pessimiste</div>
          <div class="pv-scenario-value">${fmtShort(p.pessimiste)}<span class="pv-scenario-unit">KMF</span></div>
          <div class="pv-scenario-sub">${fmt(p.pessimiste)}</div>
        </div>
        <div class="pv-scenario pv-expected">
          <div class="pv-scenario-label">🎯 Attendu</div>
          <div class="pv-scenario-value">${fmtShort(p.attendu)}<span class="pv-scenario-unit">KMF</span></div>
          <div class="pv-scenario-sub">${fmt(p.attendu)}</div>
        </div>
        <div class="pv-scenario pv-optimist">
          <div class="pv-scenario-label">📈 Optimiste</div>
          <div class="pv-scenario-value">${fmtShort(p.optimiste)}<span class="pv-scenario-unit">KMF</span></div>
          <div class="pv-scenario-sub">${fmt(p.optimiste)}</div>
        </div>
      </div>
    `;
  }

  function renderStockBlock(products) {
    // Filtrer les produits à stock faible (stock numérique non NULL)
    const lowStock = (products || [])
      .filter(p => p.stock !== null && p.stock !== undefined && Number(p.stock) <= STOCK_WARNING)
      .sort((a, b) => Number(a.stock) - Number(b.stock));

    if (!lowStock.length) {
      return '<div class="pv-empty">✅ Aucune rupture imminente — tous les stocks sont au-dessus de ' + STOCK_WARNING + ' unités.</div>';
    }

    const cards = lowStock.slice(0, 30).map(p => {
      const stock = Number(p.stock);
      const level = stock <= STOCK_CRITICAL ? 'critical' : 'warning';
      const img = p.image_url
        ? '<img class="pv-stock-img" src="' + escapeHtml(p.image_url) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
        : '<div class="pv-stock-img"></div>';
      return `
        <div class="pv-stock-card ${level}">
          ${img}
          <div class="pv-stock-body">
            <div class="pv-stock-name">${escapeHtml(p.name || '—')}</div>
            <div class="pv-stock-meta">${escapeHtml(p.category || '—')} · ${fmt(p.price_kmf)}</div>
          </div>
          <div>
            <div class="pv-stock-qty ${level}">${stock}</div>
            <div class="pv-stock-qty-label">en stock</div>
          </div>
        </div>
      `;
    }).join('');

    const critCount = lowStock.filter(p => Number(p.stock) <= STOCK_CRITICAL).length;
    const warnCount = lowStock.length - critCount;

    return `
      <div class="pv-meta" style="margin-bottom:12px;">
        <div><span style="color:#dc2626;font-weight:700;">🔴 ${critCount}</span> critique(s) (≤ ${STOCK_CRITICAL})</div>
        <div><span style="color:#f59e0b;font-weight:700;">🟡 ${warnCount}</span> à surveiller (≤ ${STOCK_WARNING})</div>
        <div>Total affichés : <strong>${Math.min(30, lowStock.length)}</strong> / ${lowStock.length}</div>
      </div>
      <div class="pv-stock-grid">${cards}</div>
    `;
  }

  function renderVelocityBlock(forecast, products) {
    const m = (forecast && forecast.modele) || {};
    const avgCA = m.avg_ca_jour || 0;
    const stddev = m.stddev || 0;
    const refDays = m.ref_period_jours || 30;
    const monthly = avgCA * 30;
    const volatility = avgCA > 0 ? Math.round((stddev / avgCA) * 100) : 0;
    const totalProducts = (products || []).length;
    const inStock = (products || []).filter(p => p.stock == null || Number(p.stock) > 0).length;

    return `
      <div class="pv-velocity-grid">
        <div class="pv-vkpi">
          <div class="pv-vkpi-label">💰 CA moyen / jour</div>
          <div class="pv-vkpi-value">${fmtShort(avgCA)} KMF</div>
          <div class="pv-vkpi-sub">Sur ${refDays} derniers jours</div>
        </div>
        <div class="pv-vkpi">
          <div class="pv-vkpi-label">📅 Projection 30j</div>
          <div class="pv-vkpi-value">${fmtShort(monthly)} KMF</div>
          <div class="pv-vkpi-sub">Si tendance se maintient</div>
        </div>
        <div class="pv-vkpi">
          <div class="pv-vkpi-label">📊 Volatilité</div>
          <div class="pv-vkpi-value">${volatility}%</div>
          <div class="pv-vkpi-sub">Écart-type / moyenne</div>
        </div>
        <div class="pv-vkpi">
          <div class="pv-vkpi-label">📦 Produits actifs</div>
          <div class="pv-vkpi-value">${inStock}<span style="font-size:14px;color:#94a3b8;"> / ${totalProducts}</span></div>
          <div class="pv-vkpi-sub">En stock / catalogue</div>
        </div>
      </div>
    `;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // VUE PRINCIPALE
  // ═══════════════════════════════════════════════════════════════════════

  CT.views.previsions = async function(container) {
    injectStyles();

    container.innerHTML = `
      <div class="pv-header">
        <div>
          <h2>🔮 Prévisions</h2>
          <div class="pv-subtitle">Forecast CA et anticipation des ruptures stock</div>
        </div>
      </div>

      <!-- Forecast CA -->
      <div class="pv-section">
        <div class="pv-section-head">
          <div>
            <h3>💰 Forecast chiffre d'affaires</h3>
            <div class="pv-section-sub">Projection basée sur la moyenne mobile des ventes récentes</div>
          </div>
        </div>
        <div class="pv-controls">
          <label>Date cible :
            <input type="date" id="pv-target-date" value="${defaultTargetDate()}">
          </label>
          <label>Base de calcul (jours) :
            <input type="number" id="pv-ref-period" value="30" min="7" max="365" step="1" style="width:80px;">
          </label>
          <button id="pv-refresh">🔄 Recalculer</button>
        </div>
        <div id="pv-forecast-body">
          <div class="pv-empty">Chargement...</div>
        </div>
      </div>

      <!-- Vélocité -->
      <div class="pv-section">
        <div class="pv-section-head">
          <h3>📊 Indicateurs de vélocité</h3>
        </div>
        <div id="pv-velocity-body">
          <div class="pv-empty">Chargement...</div>
        </div>
      </div>

      <!-- Stock -->
      <div class="pv-section">
        <div class="pv-section-head">
          <div>
            <h3>📦 Ruptures stock imminentes</h3>
            <div class="pv-section-sub">Produits ≤ ${STOCK_WARNING} unités (≤ ${STOCK_CRITICAL} = critique)</div>
          </div>
        </div>
        <div id="pv-stock-body">
          <div class="pv-empty">Chargement...</div>
        </div>
      </div>
    `;

    // Fonction de rafraîchissement
    async function refresh() {
      const targetDate = document.getElementById('pv-target-date').value || defaultTargetDate();
      const refPeriod  = Number(document.getElementById('pv-ref-period').value) || 30;
      const fcBody     = document.getElementById('pv-forecast-body');
      const velBody    = document.getElementById('pv-velocity-body');
      const stockBody  = document.getElementById('pv-stock-body');

      fcBody.innerHTML    = '<div class="pv-empty">⏳ Calcul du forecast...</div>';
      velBody.innerHTML   = '<div class="pv-empty">⏳ Chargement vélocité...</div>';
      stockBody.innerHTML = '<div class="pv-empty">⏳ Chargement produits...</div>';

      // Forecast + stock en parallèle
      const [fcResult, prodResult] = await Promise.allSettled([
        fetchForecast(targetDate, refPeriod),
        fetchProducts()
      ]);

      // Forecast
      if (fcResult.status === 'fulfilled') {
        fcBody.innerHTML = renderForecastBlock(fcResult.value);
        velBody.innerHTML = renderVelocityBlock(fcResult.value, prodResult.status === 'fulfilled' ? prodResult.value : []);
      } else {
        fcBody.innerHTML  = '<div class="pv-error">❌ ' + escapeHtml(fcResult.reason?.message || 'Erreur forecast') + '</div>';
        velBody.innerHTML = '<div class="pv-empty">—</div>';
      }

      // Stock
      if (prodResult.status === 'fulfilled') {
        stockBody.innerHTML = renderStockBlock(prodResult.value);
      } else {
        stockBody.innerHTML = '<div class="pv-error">❌ ' + escapeHtml(prodResult.reason?.message || 'Erreur produits') + '</div>';
      }
    }

    // Bind controls
    document.getElementById('pv-refresh').addEventListener('click', refresh);
    document.getElementById('pv-target-date').addEventListener('change', refresh);

    // Premier chargement
    await refresh();
  };

})();
