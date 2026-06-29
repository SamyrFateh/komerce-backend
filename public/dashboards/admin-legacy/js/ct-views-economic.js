/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-economic
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/* ═══════════════════════════════════════════════════════════════════════════
 *  ct-views-economic.js — Komerce Control Tower
 *  SANTÉ ÉCONOMIQUE GLOBALE (Lot B — Doctrine §9)
 *
 *  Cette vue ne calcule rien.
 *  Elle lit les données calculées par les services backend et les affiche.
 *
 *  Doctrine §9 — La vue répond à 5 questions :
 *    1. Est-ce que ce mois est rentable ?
 *    2. Combien de commandes faut-il pour être rentable ?
 *    3. Quelle est la contribution moyenne ?
 *    4. Quels produits vendent à perte ?
 *    5. Quels coûts terrain explosent ?
 *
 *  KPIs affichés (et seulement ceux-là) :
 *    - CA mensuel
 *    - Commandes collectées
 *    - Panier moyen
 *    - Coût variable moyen par commande
 *    - Contribution moyenne par commande
 *    - Charges fixes mensuelles
 *    - Seuil de rentabilité (commandes/mois)
 *    - Marge réelle moyenne
 *    - Nombre de produits par health_status
 *    - Alertes terrain principales
 *
 *  Ne pas afficher 40 KPI. Ne pas créer un cockpit stratégique complexe.
 *  Si tu hésites entre ajouter un KPI ou simplifier, simplifie.
 * ═══════════════════════════════════════════════════════════════════════════ */

(function() {
'use strict';

window.CT = window.CT || {};
CT.views = CT.views || {};

/* ─── STATE ──────────────────────────────────────────────────────────── */
const _es = {
  loaded: false,
  finance: null,
  sales: null,
  pricing: null,
  config: null,
};

/* ─── HELPERS ───────────────────────────────────────────────────────── */
const _esNF = new Intl.NumberFormat('fr-FR');
function _esFmt(n) { return _esNF.format(Math.round(n || 0)) + ' KMF'; }
function _esFmtPct(n) { return (Number(n) || 0).toFixed(1) + '%'; }
function _esFmtInt(n) { return _esNF.format(Math.round(n || 0)); }

async function _esApi(method, path) {
  const res = await fetch(path, { method, credentials: 'include' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('API ' + res.status + ' : ' + txt.slice(0, 150));
  }
  return res.json();
}

/* ─── STYLES ────────────────────────────────────────────────────────── */
function _esInjectStyles() {
  if (document.getElementById('ct-economic-styles-v2')) return;
  const s = document.createElement('style');
  s.id = 'ct-economic-styles-v2';
  s.textContent = `
    .es-wrap { max-width: 1200px; margin: 0 auto; padding: 20px 24px; color: #1e293b; }
    .es-h1 { font-size: 1.4rem; font-weight: 800; margin: 0 0 4px; }
    .es-sub { font-size: 0.88rem; color: #64748b; margin: 0 0 18px; }

    .es-tools { display: flex; gap: 8px; align-items: center; margin-bottom: 18px; }
    .es-btn { padding: 7px 14px; font-size: 0.85rem; font-weight: 600; border-radius: 6px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #1e293b; font-family: inherit; transition: all 0.15s; }
    .es-btn:hover { background: #f8fafc; border-color: #94a3b8; }

    /* Verdict de rentabilité */
    .es-verdict {
      background: #fff;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .es-verdict.profitable { border-color: #16a34a; background: linear-gradient(135deg, #f0fdf4, #fff); }
    .es-verdict.break-even { border-color: #f59e0b; background: linear-gradient(135deg, #fffbeb, #fff); }
    .es-verdict.loss { border-color: #dc2626; background: linear-gradient(135deg, #fef2f2, #fff); }
    .es-verdict-emoji { font-size: 2.4rem; }
    .es-verdict-text { flex: 1; }
    .es-verdict-title { font-size: 1.1rem; font-weight: 800; margin-bottom: 2px; }
    .es-verdict-detail { font-size: 0.92rem; color: #475569; }

    /* KPIs grille */
    .es-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .es-kpi-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    }
    .es-kpi-label { font-size: 0.72rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; margin-bottom: 6px; }
    .es-kpi-value { font-size: 1.5rem; font-weight: 800; color: #1e293b; font-family: ui-monospace, monospace; line-height: 1.1; }
    .es-kpi-detail { font-size: 0.78rem; color: #94a3b8; margin-top: 4px; }

    /* Section santé produits */
    .es-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 18px; }
    .es-section-title { font-size: 1rem; font-weight: 700; margin: 0 0 10px; }
    .es-health-bar { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 10px; }
    .es-health-cell {
      padding: 10px 8px;
      text-align: center;
      border-radius: 6px;
    }
    .es-health-cell .num { font-size: 1.2rem; font-weight: 800; font-family: ui-monospace, monospace; line-height: 1; }
    .es-health-cell .lbl { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600; margin-top: 4px; }
    .es-health-loss { background: #fee2e2; color: #b91c1c; }
    .es-health-danger { background: #ffedd5; color: #c2410c; }
    .es-health-fragile { background: #fef9c3; color: #a16207; }
    .es-health-healthy { background: #dcfce7; color: #166534; }
    .es-health-strong { background: #d1fae5; color: #065f46; }
    .es-health-unknown { background: #f1f5f9; color: #64748b; }

    /* Alertes */
    .es-alerts { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; }
    .es-alerts-head { font-size: 0.92rem; font-weight: 700; color: #1e293b; margin-bottom: 10px; }
    .es-alert { padding: 10px 12px; border-left: 3px solid #cbd5e1; background: #f8fafc; border-radius: 4px; margin-bottom: 6px; font-size: 0.85rem; }
    .es-alert:last-child { margin-bottom: 0; }
    .es-alert.critical { border-left-color: #dc2626; background: #fef2f2; }
    .es-alert.warning { border-left-color: #f59e0b; background: #fffbeb; }
    .es-alert.info { border-left-color: #3b82f6; background: #eff6ff; }
    .es-alert strong { color: #1e293b; }
    .es-alert-msg { color: #475569; margin-top: 2px; }

    .es-empty { padding: 30px 20px; text-align: center; color: #94a3b8; font-style: italic; }
    .es-loading { padding: 60px 20px; text-align: center; color: #64748b; }
  `;
  document.head.appendChild(s);
}

/* ─── DATA LOADING ──────────────────────────────────────────────────── */
async function _esLoadAll() {
  const [finance, sales, pricing, config] = await Promise.all([
    _esApi('GET', '/api/dashboard/finance').catch(() => null),
    _esApi('GET', '/api/dashboard/sales?period=this_month').catch(() => null),
    _esApi('GET', '/api/pricing/dashboard').catch(() => null),
    _esApi('GET', '/api/admin/finance-config').catch(() => null),
  ]);
  _es.finance = finance;
  _es.sales = sales;
  _es.pricing = pricing;
  _es.config = config;
}

/* ─── COMPUTE — KPIs depuis les sources ─────────────────────────────── */
function _esComputeKPIs() {
  const k = {
    ca_mensuel_kmf: 0,
    commandes_collectees: 0,
    panier_moyen_kmf: 0,
    cout_variable_moyen_kmf: 0,
    contribution_moyenne_kmf: 0,
    charges_fixes_mensuelles_kmf: 0,
    seuil_rentabilite_orders: 0,
    marge_reelle_moyenne_pct: 0,
    is_profitable: null,
  };

  const sales = _es.sales || {};
  k.ca_mensuel_kmf = Number(sales.ca_total_kmf || sales.revenue_kmf || sales.total_revenue || 0);
  k.commandes_collectees = Number(sales.commandes_collectees || sales.orders_count || sales.orders || 0);
  if (k.commandes_collectees > 0) {
    k.panier_moyen_kmf = Math.round(k.ca_mensuel_kmf / k.commandes_collectees);
  }

  const pricing = _es.pricing || {};
  const pkpis = pricing.kpis || {};
  const config = _es.config || {};
  const targets = config.targets || config || {};
  const objectifCommandes = Number(targets.objectif_commandes_mois || targets.target_orders_per_month || 100);
  k.charges_fixes_mensuelles_kmf = Number(pkpis.niveau2_kmf || 0) * objectifCommandes;

  k.marge_reelle_moyenne_pct = Number(pkpis.marge_moyenne_pct || 0);

  if (k.commandes_collectees > 0 && k.panier_moyen_kmf > 0 && k.marge_reelle_moyenne_pct > 0) {
    const cdr = k.panier_moyen_kmf * (1 - k.marge_reelle_moyenne_pct / 100);
    k.cout_variable_moyen_kmf = Math.round(cdr);
    k.contribution_moyenne_kmf = Math.round(k.panier_moyen_kmf - cdr);
  }

  if (k.contribution_moyenne_kmf > 0) {
    k.seuil_rentabilite_orders = Math.ceil(k.charges_fixes_mensuelles_kmf / k.contribution_moyenne_kmf);
  }

  if (k.commandes_collectees > 0 && k.seuil_rentabilite_orders > 0) {
    if (k.commandes_collectees >= k.seuil_rentabilite_orders * 1.1) k.is_profitable = 'profitable';
    else if (k.commandes_collectees >= k.seuil_rentabilite_orders * 0.9) k.is_profitable = 'break-even';
    else k.is_profitable = 'loss';
  }

  return k;
}

/* ─── RENDER ───────────────────────────────────────────────────────── */
async function _esRender(container) {
  _esInjectStyles();
  container.innerHTML = '<div class="es-loading">⏳ Chargement de la santé économique...</div>';
  try {
    await _esLoadAll();
    _es.loaded = true;
    _esRenderHTML(container);
  } catch (err) {
    container.innerHTML = '<div class="es-loading" style="color:#dc2626;">Erreur : ' + err.message + '</div>';
    console.error('[Économique] _esRender error:', err);
  }
}

function _esRenderHTML(container) {
  const k = _esComputeKPIs();
  let html = '<div class="es-wrap">';

  html += '<h1 class="es-h1">📊 Santé économique</h1>';
  html += '<p class="es-sub">Pilotage de la rentabilité par la contribution moyenne par commande collectée.</p>';

  html += '<div class="es-tools">';
  html += '<button class="es-btn" data-act="es-refresh">🔄 Rafraîchir</button>';
  html += '</div>';

  html += _esRenderVerdict(k);

  html += '<div class="es-kpis">';
  html += _esKPI('CA mensuel', _esFmt(k.ca_mensuel_kmf), k.ca_mensuel_kmf > 0 ? 'mois en cours' : 'aucune vente');
  html += _esKPI('Commandes collectées', _esFmtInt(k.commandes_collectees), 'mois en cours');
  html += _esKPI('Panier moyen', _esFmt(k.panier_moyen_kmf), '');
  html += _esKPI('Charges fixes mensuelles', _esFmt(k.charges_fixes_mensuelles_kmf), 'à amortir');
  html += _esKPI('Coût variable moyen', _esFmt(k.cout_variable_moyen_kmf), 'par commande');
  html += _esKPI('Contribution moyenne', _esFmt(k.contribution_moyenne_kmf), 'par commande');
  html += _esKPI('Seuil de rentabilité', _esFmtInt(k.seuil_rentabilite_orders) + ' cmds/mois', 'pour couvrir les charges');
  html += _esKPI('Marge réelle moyenne', _esFmtPct(k.marge_reelle_moyenne_pct), '');
  html += '</div>';

  html += _esRenderHealthDistribution();

  html += _esRenderAlerts();

  html += '</div>';
  container.innerHTML = html;
  _esBindEvents(container);
}

function _esKPI(label, value, detail) {
  return '<div class="es-kpi-card">' +
    '<div class="es-kpi-label">' + label + '</div>' +
    '<div class="es-kpi-value">' + value + '</div>' +
    (detail ? '<div class="es-kpi-detail">' + detail + '</div>' : '') +
  '</div>';
}

function _esRenderVerdict(k) {
  if (!k.is_profitable) {
    return '<div class="es-verdict">' +
      '<div class="es-verdict-emoji">❔</div>' +
      '<div class="es-verdict-text">' +
        '<div class="es-verdict-title">Rentabilité indéterminée</div>' +
        '<div class="es-verdict-detail">Pas assez de données pour conclure (CA, commandes ou marge manquantes).</div>' +
      '</div></div>';
  }
  let emoji, title, detail, klass;
  if (k.is_profitable === 'profitable') {
    emoji = '✅'; klass = 'profitable';
    title = 'Mois rentable';
    detail = 'Avec ' + k.commandes_collectees + ' commandes collectées, vous dépassez le seuil de ' +
      k.seuil_rentabilite_orders + ' commandes nécessaires pour couvrir les charges fixes.';
  } else if (k.is_profitable === 'break-even') {
    emoji = '⚖️'; klass = 'break-even';
    title = 'Proche du seuil de rentabilité';
    detail = 'Vous êtes à ' + k.commandes_collectees + ' / ' + k.seuil_rentabilite_orders +
      ' commandes nécessaires. Marge de manœuvre faible.';
  } else {
    emoji = '⚠️'; klass = 'loss';
    title = 'Mois non rentable';
    const manque = k.seuil_rentabilite_orders - k.commandes_collectees;
    detail = 'Il manque ' + manque + ' commande(s) pour couvrir les charges fixes ce mois (' +
      k.commandes_collectees + ' / ' + k.seuil_rentabilite_orders + ').';
  }
  return '<div class="es-verdict ' + klass + '">' +
    '<div class="es-verdict-emoji">' + emoji + '</div>' +
    '<div class="es-verdict-text">' +
      '<div class="es-verdict-title">' + title + '</div>' +
      '<div class="es-verdict-detail">' + detail + '</div>' +
    '</div></div>';
}

function _esRenderHealthDistribution() {
  const doc = _es.pricing?.doctrine;
  if (!doc) {
    return '<div class="es-section">' +
      '<h2 class="es-section-title">🩺 Santé du catalogue</h2>' +
      '<div class="es-empty">Données non disponibles. Vérifiez que le service pricing-engine est actif.</div>' +
    '</div>';
  }
  const h = doc.by_health;
  const total = doc.sample_size || 0;

  let html = '<div class="es-section">';
  html += '<h2 class="es-section-title">🩺 Santé du catalogue (' + total + ' produits)</h2>';
  html += '<div class="es-health-bar">';
  html += '<div class="es-health-cell es-health-loss"><div class="num">' + h.loss + '</div><div class="lbl">À perte</div></div>';
  html += '<div class="es-health-cell es-health-danger"><div class="num">' + h.danger + '</div><div class="lbl">Danger</div></div>';
  html += '<div class="es-health-cell es-health-fragile"><div class="num">' + h.fragile + '</div><div class="lbl">Fragile</div></div>';
  html += '<div class="es-health-cell es-health-healthy"><div class="num">' + h.healthy + '</div><div class="lbl">Sain</div></div>';
  html += '<div class="es-health-cell es-health-strong"><div class="num">' + h.strong + '</div><div class="lbl">Fort</div></div>';
  html += '<div class="es-health-cell es-health-unknown"><div class="num">' + h.unknown + '</div><div class="lbl">Inconnu</div></div>';
  html += '</div>';
  html += '<div style="font-size:0.78rem;color:#64748b;text-align:center;margin-top:6px;">' +
    'Pour le détail produit par produit : voir le module <strong>Pricing</strong>.' +
  '</div>';
  html += '</div>';
  return html;
}

function _esRenderAlerts() {
  const alerts = _es.pricing?.alerts || [];
  if (!alerts.length) {
    return '<div class="es-alerts">' +
      '<div class="es-alerts-head">⚠️ Alertes globales</div>' +
      '<div class="es-empty" style="padding:14px;">✓ Aucune anomalie détectée.</div>' +
    '</div>';
  }

  let html = '<div class="es-alerts">';
  html += '<div class="es-alerts-head">⚠️ Alertes globales (' + alerts.length + ')</div>';
  alerts.forEach(a => {
    const sev = a.severity || 'info';
    html += '<div class="es-alert ' + sev + '">' +
      '<strong>' + (a.title || a.code) + '</strong>' +
      '<div class="es-alert-msg">' + (a.message || '') + '</div>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

/* ─── EVENTS ───────────────────────────────────────────────────────── */
function _esBindEvents(container) {
  container.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'es-refresh') {
      t.textContent = '⏳ ...';
      t.disabled = true;
      try {
        await _esLoadAll();
        _esRenderHTML(container);
      } catch (err) {
        alert('Erreur : ' + err.message);
        t.textContent = '🔄 Rafraîchir';
        t.disabled = false;
      }
    }
  });
}

/* ─── ENTRY POINT ───────────────────────────────────────────────────── */
CT.views.economic = async function(container) {
  await _esRender(container);
};

})();
