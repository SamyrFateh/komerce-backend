/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-action-center
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/* ===================================================================
   Komerce — Centre d'actions (CT)
   Vue cockpit : tout ce qui mérite une décision, regroupé et priorisé.
   Consomme les signaux via /api/admin/signals
   =================================================================== */
window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.actionCenter = function(main) {
  main.innerHTML = '<div class="ct-loading">⚡ Chargement du centre d\'actions...</div>';

  Promise.all([
    CT.api.signalsStats(),
    CT.api.signalsList({ limit: 100 })
  ]).then(function(results) {
    var stats = results[0];
    var data  = results[1];
    _renderActionCenter(main, stats, data.signals || []);
  }).catch(function(err) {
    main.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  });
};

/* ── Families for grouping ── */
var FAMILIES = [
  { id: 'ops',      emoji: '🚨', label: 'Opérations bloquées',  color: '#ef4444' },
  { id: 'eco',      emoji: '📊', label: 'Alertes économiques',   color: '#f59e0b' },
  { id: 'sourcing', emoji: '🔍', label: 'Sourcing à arbitrer',   color: '#8b5cf6' },
  { id: 'disputes', emoji: '⚖️', label: 'Incidents & litiges',   color: '#dc2626' }
];

var SEVERITY_COLORS = {
  urgent:   '#dc2626',
  critical: '#ef4444',
  warning:  '#f59e0b',
  info:     '#3b82f6'
};

var SEVERITY_ORDER = { urgent: 0, critical: 1, warning: 2, info: 3 };

/* ── Family mapping for signals ── */
function signalFamily(type) {
  var map = {
    parcel_blocked: 'ops', cash_expiring: 'ops', sla_breach: 'ops',
    hub_tension: 'ops', relay_tension: 'ops', loyalty_pending: 'ops',
    margin_drift: 'eco', pricing_outlier: 'eco', category_drift: 'eco', recon_anomaly: 'eco',
    sourcing_arbitrage: 'sourcing', product_dead: 'sourcing', product_star: 'sourcing', stock_rupture: 'sourcing',
    dispute_sensitive: 'disputes'
  };
  return map[type] || 'ops';
}

/* ═══════════════════════════════════════════════════════════════
   MAIN RENDER
   ═══════════════════════════════════════════════════════════════ */
function _renderActionCenter(main, stats, signals) {
  var totalOpen = stats.total || 0;

  /* Group signals by family */
  var byFamily = {};
  FAMILIES.forEach(function(f) { byFamily[f.id] = []; });
  signals.forEach(function(s) {
    var fam = signalFamily(s.signal_type);
    if (byFamily[fam]) byFamily[fam].push(s);
  });

  /* Sort each group by severity */
  Object.keys(byFamily).forEach(function(k) {
    byFamily[k].sort(function(a, b) {
      return (SEVERITY_ORDER[a.severity] || 9) - (SEVERITY_ORDER[b.severity] || 9);
    });
  });

  /* Count by severity */
  var countBySev = { urgent: 0, critical: 0, warning: 0, info: 0 };
  signals.forEach(function(s) { if (countBySev[s.severity] !== undefined) countBySev[s.severity]++; });

  var html = '';

  /* ── Header ── */
  html += '<div class="ct-view-header">';
  html += '  <h2>⚡ Centre d\'actions</h2>';
  html += '  <div class="ct-subtitle">Tout ce qui mérite une décision — ' + totalOpen + ' signal' + (totalOpen > 1 ? 'x' : '') + ' actif' + (totalOpen > 1 ? 's' : '') + '</div>';
  html += '</div>';

  /* ── Drill-back button if in drill-down ── */
  html += CT.platform.renderDrillBackButton();

  /* ── KPI bar ── */
  html += '<div class="ct-kpi-grid" style="margin-bottom:20px">';
  html += _kpi('🔴', countBySev.urgent + countBySev.critical, 'Urgent / Critique', '#fef2f2');
  html += _kpi('🟡', countBySev.warning, 'Avertissements', '#fffbeb');
  html += _kpi('🔵', countBySev.info, 'Informations', '#eff6ff');
  html += _kpi('📊', totalOpen, 'Total actifs', '#f8fafc');
  html += '</div>';

  /* ── Refresh button ── */
  html += '<div style="margin-bottom:20px;display:flex;gap:8px;align-items:center">';
  html += '<button class="ct-btn ct-btn-primary" id="ac-refresh">🔄 Rafraîchir les signaux</button>';
  html += '<span id="ac-refresh-status" style="font-size:13px;color:#64748b"></span>';
  html += '</div>';

  /* ── Family sections ── */
  FAMILIES.forEach(function(fam) {
    var items = byFamily[fam.id] || [];
    html += _renderFamilySection(fam, items);
  });

  /* ── Empty state ── */
  if (totalOpen === 0) {
    html += '<div class="ct-empty-state">';
    html += '  <div style="font-size:64px;margin-bottom:16px">✅</div>';
    html += '  <h3>Tout est en ordre</h3>';
    html += '  <p style="color:#64748b;margin-top:8px">Aucun signal actif — bonne nouvelle !</p>';
    html += '</div>';
  }

  main.innerHTML = html;

  /* ── Event listeners ── */
  var refreshBtn = document.getElementById('ac-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function() {
      var status = document.getElementById('ac-refresh-status');
      status.textContent = 'Génération en cours...';
      refreshBtn.disabled = true;
      CT.api.signalsGenerate().then(function(res) {
        status.textContent = '✅ Signaux régénérés';
        setTimeout(function() { CT.views.actionCenter(main); }, 500);
      }).catch(function(err) {
        status.textContent = '❌ ' + err.message;
        refreshBtn.disabled = false;
      });
    });
  }

  /* Delegate actions on signal cards */
  main.addEventListener('click', function handler(e) {
    var ackBtn = e.target.closest('[data-signal-ack]');
    var snoozeBtn = e.target.closest('[data-signal-snooze]');
    var resolveBtn = e.target.closest('[data-signal-resolve]');
    var drillBtn = e.target.closest('[data-signal-drill]');

    if (ackBtn) {
      CT.api.signalAcknowledge(ackBtn.dataset.signalAck).then(function() {
        CT.views.actionCenter(main);
      });
    }
    if (snoozeBtn) {
      CT.api.signalSnooze(snoozeBtn.dataset.signalSnooze, 24).then(function() {
        CT.views.actionCenter(main);
      });
    }
    if (resolveBtn) {
      CT.api.signalResolve(resolveBtn.dataset.signalResolve).then(function() {
        CT.views.actionCenter(main);
      });
    }
    if (drillBtn) {
      try {
        var params = JSON.parse(drillBtn.dataset.signalDrill);
        CT.platform.drillDown(params);
      } catch(_) {}
    }
  }, { once: true });
}

/* ═══════════════════════════════════════════════════════════════
   FAMILY SECTION — max 3 visible, "voir plus" pour le reste
   ═══════════════════════════════════════════════════════════════ */
function _renderFamilySection(fam, items) {
  if (items.length === 0) return '';
  var MAX_VISIBLE = 3;

  var html = '<div class="ct-section-block" style="border-left:4px solid ' + fam.color + '">';
  html += '<h3>' + fam.emoji + ' ' + fam.label + ' <span class="ct-badge" style="background:' + fam.color + '15;color:' + fam.color + '">' + items.length + '</span></h3>';

  items.forEach(function(signal, idx) {
    var hidden = idx >= MAX_VISIBLE ? ' style="display:none" data-ac-extra="' + fam.id + '"' : '';
    html += _renderSignalCard(signal, hidden);
  });

  if (items.length > MAX_VISIBLE) {
    html += '<button class="ct-btn ct-btn-ghost" style="margin-top:8px;font-size:13px" ' +
            'onclick="document.querySelectorAll(\'[data-ac-extra=' + fam.id + ']\').forEach(function(el){el.style.display=\'\'});this.remove()">' +
            '+ ' + (items.length - MAX_VISIBLE) + ' de plus</button>';
  }

  html += '</div>';
  return html;
}

/* ═══════════════════════════════════════════════════════════════
   SIGNAL CARD
   ═══════════════════════════════════════════════════════════════ */
function _renderSignalCard(signal, extraAttrs) {
  var sevColor = SEVERITY_COLORS[signal.severity] || '#94a3b8';
  var sevLabel = { urgent: '🔴 Urgent', critical: '🟠 Critique', warning: '🟡 Attention', info: '🔵 Info' }[signal.severity] || signal.severity;

  var html = '<div class="ct-parcel-card" style="border-left:3px solid ' + sevColor + ';margin-bottom:8px"' + (extraAttrs || '') + '>';

  /* Header */
  html += '<div class="ct-parcel-header">';
  html += '<span class="ct-badge" style="background:' + sevColor + '15;color:' + sevColor + ';font-size:11px">' + sevLabel + '</span>';
  html += '<strong style="font-size:14px">' + _esc(signal.title) + '</strong>';
  html += '</div>';

  /* Summary */
  if (signal.summary) {
    html += '<div class="ct-parcel-body">' + _esc(signal.summary) + '</div>';
  }

  /* Recommendation */
  if (signal.recommendation) {
    html += '<div style="margin-top:6px;padding:6px 10px;background:#f0fdf4;border-radius:6px;font-size:13px;color:#16a34a" data-nature="recommended">';
    html += '💡 ' + _esc(signal.recommendation);
    html += '</div>';
  }

  /* Actions */
  html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">';

  /* Drill-down button */
  if (signal.target_view) {
    var drillParams = {
      shell: signal.target_shell || 'bo',
      view: signal.target_view,
      filters: signal.target_filters || {},
      highlightId: signal.entity_id
    };
    html += '<button class="ct-btn ct-btn-ghost" style="font-size:12px;padding:4px 10px" ' +
            'data-signal-drill=\'' + JSON.stringify(drillParams).replace(/'/g, '&#39;') + '\'>🔗 Voir</button>';
  }

  html += '<button class="ct-btn ct-btn-secondary" style="font-size:12px;padding:4px 10px" ' +
          'data-signal-ack="' + signal.id + '">👁 Vu</button>';
  html += '<button class="ct-btn ct-btn-secondary" style="font-size:12px;padding:4px 10px" ' +
          'data-signal-snooze="' + signal.id + '">💤 24h</button>';
  html += '<button class="ct-btn ct-btn-action" style="font-size:12px;padding:4px 10px" ' +
          'data-signal-resolve="' + signal.id + '">✅ Résolu</button>';

  html += '</div>';

  /* Footer */
  html += '<div class="ct-parcel-footer">';
  html += '<span>🏷 ' + signal.signal_type + '</span>';
  html += '<span>' + _timeAgo(signal.created_at) + '</span>';
  html += '</div>';

  html += '</div>';
  return html;
}

/* ── KPI helper ── */
function _kpi(emoji, value, label, bg) {
  return '<div class="ct-kpi" style="background:' + bg + '">' +
    '<div class="ct-kpi-icon">' + emoji + '</div>' +
    '<div><div class="ct-kpi-value">' + value + '</div>' +
    '<div class="ct-kpi-label">' + label + '</div></div></div>';
}

/* ── Time ago ── */
function _timeAgo(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  var now = new Date();
  var diff = Math.floor((now - d) / 1000);
  if (diff < 60)    return 'à l\'instant';
  if (diff < 3600)  return Math.floor(diff/60) + ' min';
  if (diff < 86400) return Math.floor(diff/3600) + 'h';
  return Math.floor(diff/86400) + 'j';
}

/* ── Escape HTML ── */
function _esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
