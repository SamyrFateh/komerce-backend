/**
 * CT View — Economic Engine
 * Tabs: Vue exécutive, Variables, Charges, Cohérence
 */

window.CT = window.CT || {};
CT.views = CT.views || {};

// ─── Inject CSS ──────────────────────────────────────────────────────
(function() {
  if (document.getElementById('ct-economic-css')) return;
  var style = document.createElement('style');
  style.id = 'ct-economic-css';
  style.textContent = [
    /* Tabs */
    '.eco-tabs { display:flex; gap:4px; border-bottom:2px solid #e5e7eb; margin-bottom:20px; padding-bottom:0; flex-wrap:wrap; }',
    '.eco-tab { padding:10px 18px; border:none; background:none; font-size:14px; font-weight:500; color:#6b7280; cursor:pointer; border-bottom:3px solid transparent; margin-bottom:-2px; border-radius:6px 6px 0 0; transition:all .2s; }',
    '.eco-tab:hover { background:#f3f4f6; color:#111827; }',
    '.eco-tab.active { color:#7c3aed; border-bottom-color:#7c3aed; font-weight:600; }',

    /* Expert toggle */
    '.eco-expert-toggle { float:right; padding:6px 14px; border:1px solid #d1d5db; border-radius:20px; font-size:12px; background:#fff; cursor:pointer; transition:all .2s; }',
    '.eco-expert-toggle:hover { background:#f3f4f6; }',
    '.eco-expert-toggle.active { background:#7c3aed; color:#fff; border-color:#7c3aed; }',

    /* Status badge */
    '.eco-status { display:inline-flex; align-items:center; gap:8px; padding:10px 20px; border-radius:12px; font-size:18px; font-weight:700; margin-bottom:20px; }',
    '.eco-status-stable { background:#dcfce7; color:#16a34a; }',
    '.eco-status-surveiller { background:#fef9c3; color:#a16207; }',
    '.eco-status-tension { background:#ffedd5; color:#c2410c; }',
    '.eco-status-blocking { background:#fecaca; color:#dc2626; }',

    /* Alert cards */
    '.eco-alert { padding:12px 16px; border-radius:10px; margin-bottom:10px; border-left:4px solid; }',
    '.eco-alert-blocking { background:#fef2f2; border-color:#dc2626; }',
    '.eco-alert-critical { background:#fff7ed; border-color:#f97316; }',
    '.eco-alert-warning { background:#fefce8; border-color:#eab308; }',
    '.eco-alert-info { background:#eff6ff; border-color:#3b82f6; }',
    '.eco-alert-severity { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; text-transform:uppercase; margin-right:8px; }',
    '.eco-alert-severity.blocking { background:#dc2626; color:#fff; }',
    '.eco-alert-severity.critical { background:#f97316; color:#fff; }',
    '.eco-alert-severity.warning { background:#eab308; color:#fff; }',
    '.eco-alert-severity.info { background:#3b82f6; color:#fff; }',
    '.eco-alert-msg { font-weight:600; font-size:14px; }',
    '.eco-alert-detail { font-size:12px; color:#6b7280; margin-top:4px; }',

    /* Recommendation */
    '.eco-reco { padding:14px 18px; border-radius:10px; background:#f0fdf4; border:1px solid #bbf7d0; margin-top:16px; }',
    '.eco-reco.high { background:#fef2f2; border-color:#fecaca; }',
    '.eco-reco.medium { background:#fffbeb; border-color:#fde68a; }',
    '.eco-reco-label { font-size:11px; font-weight:700; text-transform:uppercase; color:#6b7280; margin-bottom:4px; }',
    '.eco-reco-text { font-size:14px; font-weight:500; }',

    /* Charges summary bar */
    '.eco-charges-bar { display:flex; gap:16px; flex-wrap:wrap; margin-top:16px; }',
    '.eco-charges-item { padding:10px 16px; border-radius:8px; background:#f3f4f6; flex:1; min-width:140px; }',
    '.eco-charges-item-label { font-size:11px; color:#6b7280; text-transform:uppercase; }',
    '.eco-charges-item-value { font-size:18px; font-weight:700; color:#111827; }',

    /* Variable cards */
    '.eco-var-group { margin-bottom:24px; }',
    '.eco-var-group-title { font-size:16px; font-weight:700; margin-bottom:12px; display:flex; align-items:center; gap:8px; }',
    '.eco-var-card { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid #f3f4f6; transition:background .15s; }',
    '.eco-var-card:hover { background:#faf5ff; }',
    '.eco-var-card.computed { background:#f9fafb; }',
    '.eco-var-label { font-size:14px; color:#374151; flex:1; }',
    '.eco-var-value { font-size:16px; font-weight:700; color:#111827; min-width:100px; text-align:right; }',
    '.eco-var-unit { font-size:12px; color:#9ca3af; margin-left:4px; }',
    '.eco-var-critical { border-left:3px solid #f97316; }',
    '.eco-var-edit-btn { padding:4px 10px; font-size:12px; border:1px solid #d1d5db; border-radius:6px; background:#fff; cursor:pointer; margin-left:10px; }',
    '.eco-var-edit-btn:hover { background:#f3f4f6; }',

    /* SOV badges */
    '.eco-sov { display:flex; gap:6px; margin-left:12px; }',
    '.eco-sov-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }',
    '.eco-sov-s { background:#dbeafe; color:#1d4ed8; }',
    '.eco-sov-o { background:#dcfce7; color:#16a34a; }',
    '.eco-sov-u { background:#ede9fe; color:#7c3aed; }',

    /* Inline edit form */
    '.eco-edit-form { padding:12px 16px; background:#faf5ff; border:1px solid #e9d5ff; border-radius:8px; margin:4px 0 8px 0; display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }',
    '.eco-edit-field { display:flex; flex-direction:column; gap:2px; }',
    '.eco-edit-field label { font-size:11px; color:#6b7280; font-weight:600; }',
    '.eco-edit-field input, .eco-edit-field select { padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:13px; width:130px; }',

    /* Charge cards */
    '.eco-charge-family { margin-bottom:20px; }',
    '.eco-charge-family-header { display:flex; align-items:center; gap:8px; padding:10px 0; font-size:16px; font-weight:700; cursor:pointer; border-bottom:1px solid #e5e7eb; }',
    '.eco-charge-family-header:hover { color:#7c3aed; }',
    '.eco-charge-family-total { margin-left:auto; font-size:14px; color:#6b7280; font-weight:400; }',
    '.eco-charge-card { display:flex; align-items:center; padding:10px 14px; border-bottom:1px solid #f3f4f6; gap:12px; }',
    '.eco-charge-card.inactive { opacity:0.5; }',
    '.eco-charge-name { font-weight:600; flex:1; font-size:14px; }',
    '.eco-charge-amount { font-weight:700; font-size:15px; min-width:100px; text-align:right; }',
    '.eco-charge-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:600; background:#e0e7ff; color:#3730a3; margin-left:6px; }',
    '.eco-charge-toggle { width:40px; height:22px; border-radius:11px; border:none; cursor:pointer; position:relative; transition:background .2s; }',
    '.eco-charge-toggle.on { background:#16a34a; }',
    '.eco-charge-toggle.off { background:#d1d5db; }',
    '.eco-charge-toggle::after { content:""; position:absolute; top:2px; width:18px; height:18px; border-radius:50%; background:#fff; transition:left .2s; }',
    '.eco-charge-toggle.on::after { left:20px; }',
    '.eco-charge-toggle.off::after { left:2px; }',
    '.eco-charge-notes { font-size:11px; color:#9ca3af; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',

    /* Add charge form */
    '.eco-add-form { padding:16px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; margin-bottom:16px; }',
    '.eco-add-form-title { font-size:14px; font-weight:700; margin-bottom:10px; }',
    '.eco-add-form-grid { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }',
    '.eco-add-form-grid .eco-edit-field input, .eco-add-form-grid .eco-edit-field select { width:160px; }',

    /* Toast */
    '.eco-toast { position:fixed; bottom:24px; right:24px; padding:12px 20px; border-radius:10px; background:#16a34a; color:#fff; font-weight:600; font-size:14px; z-index:9999; animation:eco-toast-in .3s ease; }',
    '@keyframes eco-toast-in { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }',

    /* History */
    '.eco-history-row { display:flex; gap:12px; padding:8px 0; border-bottom:1px solid #f3f4f6; font-size:13px; }',
    '.eco-history-date { color:#6b7280; min-width:160px; }',
    '.eco-history-status { font-weight:600; min-width:100px; }',
    '.eco-history-trigger { color:#9ca3af; flex:1; }',

    /* Totals row */
    '.eco-totals { display:flex; gap:16px; flex-wrap:wrap; padding:14px; background:#f9fafb; border-radius:10px; margin-top:16px; }',
    '.eco-total-item { text-align:center; flex:1; min-width:120px; }',
    '.eco-total-label { font-size:11px; color:#6b7280; text-transform:uppercase; }',
    '.eco-total-value { font-size:20px; font-weight:700; color:#111827; }'
  ].join('\n');
  document.head.appendChild(style);
})();

// ─── Format helpers ──────────────────────────────────────────────────

function fmtKMF(n) { return Number(n).toLocaleString('fr-FR') + ' KMF'; }
function fmtPct(n) { return Number(n).toFixed(1) + '%'; }
function fmtVal(n, unit) {
  if (unit === 'KMF') return fmtKMF(n);
  if (unit === '%') return fmtPct(n);
  if (unit === 'ratio') return Number(n).toLocaleString('fr-FR');
  if (unit === 'count') return String(Math.round(n));
  return String(n);
}

function ecoToast(msg) {
  var el = document.createElement('div');
  el.className = 'eco-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 2500);
}

function isExpertMode() {
  return localStorage.getItem('kmrc_eco_expert') === '1';
}

// ─── Recurrence labels ──────────────────────────────────────────────
var RECURRENCE_LABELS = {
  monthly: 'Mensuelle',
  weekly: 'Hebdomadaire',
  per_order: 'Par commande',
  per_parcel: 'Par colis'
};

var FAMILY_OPTIONS = [
  { value: 'demarrage', label: '🚀 Démarrage' },
  { value: 'croisiere', label: '⛵ Croisière' },
  { value: 'operationnelle', label: '⚙️ Opérationnelle' },
  { value: 'exceptionnelle', label: '⚡ Exceptionnelle' },
  { value: 'incident', label: '🔧 Incident / Rattrapage' }
];

// ─── Main View ───────────────────────────────────────────────────────

CT.views.economic = async function(container) {
  container.innerHTML = '<div class="ct-loading">🧠 Chargement du moteur économique...</div>';

  try {
    var activeTab = 'executif';

    function render() {
      var expert = isExpertMode();
      var html = '';

      // Header
      html += '<div class="ct-view-header">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
      html += '<h2 style="margin:0;">⚙️ Moteur Économique</h2>';
      html += '<button id="eco-expert-btn" class="eco-expert-toggle' + (expert ? ' active' : '') + '">';
      html += expert ? 'Mode expert 🔧' : 'Mode simple 📱';
      html += '</button>';
      html += '</div>';
      html += '<div class="ct-subtitle">Pilotage financier en temps réel</div>';
      html += '</div>';

      // Tabs
      html += '<div class="eco-tabs">';
      var tabs = [
        { id: 'executif', label: '📊 Vue exécutive' },
        { id: 'variables', label: '🔢 Variables' },
        { id: 'charges', label: '💸 Charges' },
        { id: 'coherence', label: '🛡️ Cohérence' },
        { id: 'config', label: '⚙️ Config & Fidélité' }
      ];
      if (expert) {
        tabs.push({ id: 'history', label: '📜 Historique' });
      }
      for (var t = 0; t < tabs.length; t++) {
        html += '<button class="eco-tab' + (activeTab === tabs[t].id ? ' active' : '') + '" data-tab="' + tabs[t].id + '">' + tabs[t].label + '</button>';
      }
      html += '</div>';

      // Tab content placeholder
      html += '<div id="eco-tab-content"><div class="ct-loading">Chargement...</div></div>';

      container.innerHTML = html;

      // Wire tab buttons
      var tabBtns = container.querySelectorAll('.eco-tab');
      tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          activeTab = btn.getAttribute('data-tab');
          render();
        });
      });

      // Wire expert toggle
      var expertBtn = document.getElementById('eco-expert-btn');
      if (expertBtn) {
        expertBtn.addEventListener('click', function() {
          var cur = isExpertMode();
          localStorage.setItem('kmrc_eco_expert', cur ? '0' : '1');
          render();
        });
      }

      // Load tab content
      loadTab(activeTab);
    }

    async function loadTab(tab) {
      var content = document.getElementById('eco-tab-content');
      if (!content) return;
      content.innerHTML = '<div class="ct-loading">Chargement...</div>';

      try {
        if (tab === 'executif') await renderExecutive(content);
        else if (tab === 'variables') await renderVariables(content);
        else if (tab === 'charges') await renderCharges(content);
        else if (tab === 'coherence') await renderCoherence(content);
        else if (tab === 'config') await renderConfig(content);
        else if (tab === 'history') await renderHistory(content);
      } catch (err) {
        content.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
      }
    }

    // ─── Tab 1: Executive ────────────────────────────────────────────

    async function renderExecutive(content) {
      var data = await CT.api.get('/api/admin/economic/executive');
      var html = '';

      // Status badge
      html += '<div class="eco-status eco-status-' + data.status + '">';
      html += data.status_emoji + ' ' + data.status_label;
      html += '</div>';

      // KPIs
      html += '<div class="ct-kpi-grid">';
      for (var k = 0; k < data.kpis.length; k++) {
        var kpi = data.kpis[k];
        var color = '#7c3aed';
        if (kpi.key === 'safety_ratio') color = kpi.value >= 15 ? '#16a34a' : kpi.value >= 5 ? '#eab308' : '#dc2626';
        if (kpi.key === 'margin_pressure') color = kpi.value <= 25 ? '#16a34a' : '#f97316';
        if (kpi.key === 'net_profit_per_order') color = kpi.value >= 0 ? '#16a34a' : '#dc2626';
        html += CT.pc.kpiCard(kpi.icon, kpi.label, fmtVal(kpi.value, kpi.unit), color);
      }
      html += '</div>';

      // Alerts
      if (data.alerts && data.alerts.length > 0) {
        html += '<div class="ct-section-block" style="margin-top:20px;">';
        html += '<h3 style="margin:0 0 12px 0;">⚠️ Alertes</h3>';
        for (var a = 0; a < data.alerts.length; a++) {
          var alert = data.alerts[a];
          html += '<div class="eco-alert eco-alert-' + alert.severity + '">';
          html += '<span class="eco-alert-severity ' + alert.severity + '">' + alert.severity.toUpperCase() + '</span>';
          html += '<span class="eco-alert-msg">' + alert.message + '</span>';
          if (isExpertMode() && alert.detail) {
            html += '<div class="eco-alert-detail">' + alert.detail + '</div>';
          }
          html += '</div>';
        }
        html += '</div>';
      }

      // Recommendation
      if (data.recommendation) {
        html += '<div class="eco-reco ' + data.recommendation.priority + '">';
        html += '<div class="eco-reco-label">💡 Recommandation (' + data.recommendation.priority + ')</div>';
        html += '<div class="eco-reco-text">' + data.recommendation.text + '</div>';
        html += '</div>';
      }

      // Charges summary
      if (data.charges_summary) {
        var cs = data.charges_summary;
        html += '<div class="ct-section-block" style="margin-top:20px;">';
        html += '<h3 style="margin:0 0 12px 0;">💸 Résumé des charges</h3>';
        html += '<div class="eco-charges-bar">';
        html += '<div class="eco-charges-item"><div class="eco-charges-item-label">Par commande</div><div class="eco-charges-item-value">' + fmtKMF(cs.total_per_order) + '</div></div>';
        html += '<div class="eco-charges-item"><div class="eco-charges-item-label">Mensuel fixe</div><div class="eco-charges-item-value">' + fmtKMF(cs.total_monthly) + '</div></div>';
        html += '<div class="eco-charges-item"><div class="eco-charges-item-label">Charges actives</div><div class="eco-charges-item-value">' + cs.count_active + '</div></div>';
        html += '</div>';

        // By family
        if (isExpertMode() && cs.by_family) {
          html += '<div style="margin-top:12px;">';
          var families = Object.keys(cs.by_family);
          for (var f = 0; f < families.length; f++) {
            html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;">';
            html += '<span>' + families[f] + '</span>';
            html += '<span style="font-weight:600;">' + fmtKMF(cs.by_family[families[f]]) + '</span>';
            html += '</div>';
          }
          html += '</div>';
        }
        html += '</div>';
      }

      // Generated at
      html += '<div style="text-align:right;font-size:11px;color:#9ca3af;margin-top:12px;">Généré le ' + new Date(data.generated_at).toLocaleString('fr-FR') + '</div>';

      content.innerHTML = html;
    }

    // ─── Tab 2: Variables ────────────────────────────────────────────

    async function renderVariables(content) {
      var data = await CT.api.get('/api/admin/economic/variables');
      var expert = isExpertMode();
      var html = '';
      var editingKey = null;

      var catOrder = ['cost', 'revenue', 'margin', 'mix', 'exchange', 'health'];

      for (var ci = 0; ci < catOrder.length; ci++) {
        var catKey = catOrder[ci];
        var cat = data.categories[catKey];
        if (!cat) continue;

        html += '<div class="ct-section-block eco-var-group">';
        html += '<div class="eco-var-group-title">' + cat.icon + ' ' + cat.label + '</div>';

        for (var vi = 0; vi < cat.variables.length; vi++) {
          var v = cat.variables[vi];
          var val = v.value_used != null ? v.value_used : v.value_supposed;
          var isComp = v.is_computed;

          html += '<div class="eco-var-card' + (isComp ? ' computed' : '') + (v.is_critical ? ' eco-var-critical' : '') + '">';
          html += '<span class="eco-var-label">' + v.label + '</span>';

          // SOV badges in expert mode
          if (expert && !isComp) {
            html += '<div class="eco-sov">';
            html += '<span class="eco-sov-badge eco-sov-s" title="Supposé">S: ' + (v.value_supposed != null ? v.value_supposed : '–') + '</span>';
            html += '<span class="eco-sov-badge eco-sov-o" title="Observé">O: ' + (v.value_observed != null ? v.value_observed : '–') + '</span>';
            html += '<span class="eco-sov-badge eco-sov-u" title="Utilisé">U: ' + (val != null ? val : '–') + '</span>';
            html += '</div>';
          }

          html += '<span class="eco-var-value">' + (val != null ? fmtVal(val, v.unit) : '–') + '</span>';

          if (!isComp) {
            html += '<button class="eco-var-edit-btn" data-key="' + v.key + '">✏️</button>';
          } else {
            html += '<span style="margin-left:10px;font-size:11px;color:#9ca3af;">calculé</span>';
          }
          html += '</div>';

          // Inline edit form placeholder
          html += '<div id="eco-edit-' + v.key + '"></div>';
        }

        html += '</div>';
      }

      content.innerHTML = html;

      // Wire edit buttons
      var editBtns = content.querySelectorAll('.eco-var-edit-btn');
      editBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          var key = btn.getAttribute('data-key');
          showEditForm(key, data);
        });
      });
    }

    function showEditForm(key, data) {
      // Find the variable
      var v = null;
      var cats = Object.keys(data.categories);
      for (var c = 0; c < cats.length; c++) {
        var vars = data.categories[cats[c]].variables;
        for (var vi = 0; vi < vars.length; vi++) {
          if (vars[vi].key === key) { v = vars[vi]; break; }
        }
        if (v) break;
      }
      if (!v) return;

      var target = document.getElementById('eco-edit-' + key);
      if (!target) return;

      // Toggle: if already showing, hide it
      if (target.innerHTML !== '') {
        target.innerHTML = '';
        return;
      }

      // Close all other edit forms
      var allEdits = document.querySelectorAll('[id^="eco-edit-"]');
      allEdits.forEach(function(el) { el.innerHTML = ''; });

      var formHtml = '<div class="eco-edit-form">';
      formHtml += '<div class="eco-edit-field"><label>Supposé</label>';
      formHtml += '<input type="number" id="eco-inp-supposed-' + key + '" value="' + (v.value_supposed != null ? v.value_supposed : '') + '" step="any" /></div>';
      formHtml += '<div class="eco-edit-field"><label>Observé</label>';
      formHtml += '<input type="number" id="eco-inp-observed-' + key + '" value="' + (v.value_observed != null ? v.value_observed : '') + '" step="any" /></div>';
      formHtml += '<div class="eco-edit-field"><label>Source utilisée</label>';
      formHtml += '<select id="eco-inp-source-' + key + '">';
      formHtml += '<option value="supposed"' + (v.source_used === 'supposed' ? ' selected' : '') + '>Supposé</option>';
      formHtml += '<option value="observed"' + (v.source_used === 'observed' ? ' selected' : '') + '>Observé</option>';
      formHtml += '<option value="manual"' + (v.source_used === 'manual' ? ' selected' : '') + '>Manuel</option>';
      formHtml += '</select></div>';

      if (v.source_used === 'manual' || true) {
        formHtml += '<div class="eco-edit-field" id="eco-manual-wrap-' + key + '" style="' + (v.source_used === 'manual' ? '' : 'display:none;') + '"><label>Valeur manuelle</label>';
        formHtml += '<input type="number" id="eco-inp-manual-' + key + '" value="' + (v.source_used === 'manual' && v.value_used != null ? v.value_used : '') + '" step="any" /></div>';
      }

      formHtml += '<button class="ct-btn ct-btn-primary" id="eco-save-' + key + '">Enregistrer</button>';
      formHtml += '<button class="ct-btn ct-btn-ghost" id="eco-cancel-' + key + '">Annuler</button>';
      formHtml += '</div>';

      target.innerHTML = formHtml;

      // Toggle manual field on source change
      var sourceSelect = document.getElementById('eco-inp-source-' + key);
      var manualWrap = document.getElementById('eco-manual-wrap-' + key);
      if (sourceSelect && manualWrap) {
        sourceSelect.addEventListener('change', function() {
          manualWrap.style.display = sourceSelect.value === 'manual' ? '' : 'none';
        });
      }

      // Cancel
      var cancelBtn = document.getElementById('eco-cancel-' + key);
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
          target.innerHTML = '';
        });
      }

      // Save
      var saveBtn = document.getElementById('eco-save-' + key);
      if (saveBtn) {
        saveBtn.addEventListener('click', async function() {
          try {
            var body = {};
            var supposedVal = document.getElementById('eco-inp-supposed-' + key).value;
            var observedVal = document.getElementById('eco-inp-observed-' + key).value;
            var sourceVal = document.getElementById('eco-inp-source-' + key).value;

            if (supposedVal !== '') body.value_supposed = Number(supposedVal);
            if (observedVal !== '') body.value_observed = Number(observedVal);
            body.source_used = sourceVal;

            // Set value_used based on source
            if (sourceVal === 'supposed' && supposedVal !== '') {
              body.value_used = Number(supposedVal);
            } else if (sourceVal === 'observed' && observedVal !== '') {
              body.value_used = Number(observedVal);
            } else if (sourceVal === 'manual') {
              var manualVal = document.getElementById('eco-inp-manual-' + key).value;
              if (manualVal !== '') body.value_used = Number(manualVal);
            }

            await CT.api.put('/api/admin/economic/variables/' + key, body);
            ecoToast('✅ Variable mise à jour');
            // Refresh variables tab
            var content = document.getElementById('eco-tab-content');
            if (content) await renderVariables(content);
          } catch (err) {
            ecoToast('❌ Erreur: ' + err.message);
          }
        });
      }
    }

    // ─── Tab 3: Charges ──────────────────────────────────────────────

    async function renderCharges(content) {
      var data = await CT.api.get('/api/admin/economic/charges');
      var html = '';

      // Add charge button
      html += '<button class="ct-btn ct-btn-primary" id="eco-add-charge-btn" style="margin-bottom:16px;">+ Ajouter une charge</button>';
      html += '<div id="eco-add-form-container"></div>';

      // Families
      var familyOrder = ['operationnelle', 'croisiere', 'demarrage', 'exceptionnelle', 'incident'];
      for (var fi = 0; fi < familyOrder.length; fi++) {
        var fKey = familyOrder[fi];
        var fam = data.families[fKey];
        if (!fam || !fam.charges || fam.charges.length === 0) continue;

        html += '<div class="eco-charge-family ct-section-block">';
        html += '<div class="eco-charge-family-header" data-family="' + fKey + '">';
        html += fam.emoji + ' ' + fam.label;
        html += '<span class="eco-charge-family-total">' + fmtKMF(fam.total_kmf) + '</span>';
        html += '</div>';
        html += '<div class="eco-charge-list" id="eco-family-' + fKey + '">';

        for (var ci = 0; ci < fam.charges.length; ci++) {
          var ch = fam.charges[ci];
          html += '<div class="eco-charge-card' + (ch.is_active ? '' : ' inactive') + '">';
          html += '<span class="eco-charge-name">' + ch.name + '</span>';
          if (ch.is_recurring && ch.recurrence_period) {
            html += '<span class="eco-charge-badge">' + (RECURRENCE_LABELS[ch.recurrence_period] || ch.recurrence_period) + '</span>';
          }
          if (ch.notes) {
            html += '<span class="eco-charge-notes" title="' + ch.notes + '">' + ch.notes + '</span>';
          }
          html += '<span class="eco-charge-amount">' + fmtKMF(ch.amount_kmf) + '</span>';
          html += '<button class="eco-charge-toggle ' + (ch.is_active ? 'on' : 'off') + '" data-charge-id="' + ch.id + '" title="' + (ch.is_active ? 'Désactiver' : 'Activer') + '"></button>';
          html += '</div>';
        }

        html += '</div></div>';
      }

      // Totals
      html += '<div class="eco-totals">';
      html += '<div class="eco-total-item"><div class="eco-total-label">Par commande</div><div class="eco-total-value">' + fmtKMF(data.totals.per_order) + '</div></div>';
      html += '<div class="eco-total-item"><div class="eco-total-label">Mensuel</div><div class="eco-total-value">' + fmtKMF(data.totals.monthly) + '</div></div>';
      html += '<div class="eco-total-item"><div class="eco-total-label">Hebdomadaire</div><div class="eco-total-value">' + fmtKMF(data.totals.weekly) + '</div></div>';
      html += '<div class="eco-total-item"><div class="eco-total-label">Ponctuel</div><div class="eco-total-value">' + fmtKMF(data.totals.one_time) + '</div></div>';
      html += '</div>';

      content.innerHTML = html;

      // Wire toggle buttons
      var toggleBtns = content.querySelectorAll('.eco-charge-toggle');
      toggleBtns.forEach(function(btn) {
        btn.addEventListener('click', async function() {
          try {
            var chargeId = btn.getAttribute('data-charge-id');
            await CT.api.put('/api/admin/economic/charges/' + chargeId + '/toggle', {});
            ecoToast('✅ Charge mise à jour');
            await renderCharges(content);
          } catch (err) {
            ecoToast('❌ Erreur: ' + err.message);
          }
        });
      });

      // Wire add charge button
      var addBtn = document.getElementById('eco-add-charge-btn');
      if (addBtn) {
        addBtn.addEventListener('click', function() {
          showAddChargeForm();
        });
      }
    }

    function showAddChargeForm() {
      var formContainer = document.getElementById('eco-add-form-container');
      if (!formContainer) return;

      if (formContainer.innerHTML !== '') {
        formContainer.innerHTML = '';
        return;
      }

      var html = '<div class="eco-add-form">';
      html += '<div class="eco-add-form-title">➕ Nouvelle charge</div>';
      html += '<div class="eco-add-form-grid">';

      // Family
      html += '<div class="eco-edit-field"><label>Famille</label><select id="eco-new-family">';
      for (var f = 0; f < FAMILY_OPTIONS.length; f++) {
        html += '<option value="' + FAMILY_OPTIONS[f].value + '">' + FAMILY_OPTIONS[f].label + '</option>';
      }
      html += '</select></div>';

      // Name
      html += '<div class="eco-edit-field"><label>Nom</label><input type="text" id="eco-new-name" placeholder="Ex: Frais douane" /></div>';

      // Amount
      html += '<div class="eco-edit-field"><label>Montant (KMF)</label><input type="number" id="eco-new-amount" placeholder="0" min="0" /></div>';

      // Recurring
      html += '<div class="eco-edit-field"><label>Récurrente</label>';
      html += '<input type="checkbox" id="eco-new-recurring" style="width:auto;" /></div>';

      // Period
      html += '<div class="eco-edit-field" id="eco-new-period-wrap" style="display:none;"><label>Période</label>';
      html += '<select id="eco-new-period">';
      html += '<option value="per_order">Par commande</option>';
      html += '<option value="monthly">Mensuelle</option>';
      html += '<option value="weekly">Hebdomadaire</option>';
      html += '<option value="per_parcel">Par colis</option>';
      html += '</select></div>';

      // Notes
      html += '<div class="eco-edit-field"><label>Notes</label><input type="text" id="eco-new-notes" placeholder="Optionnel" /></div>';

      // Buttons
      html += '<button class="ct-btn ct-btn-primary" id="eco-new-save">Ajouter</button>';
      html += '<button class="ct-btn ct-btn-ghost" id="eco-new-cancel">Annuler</button>';

      html += '</div></div>';

      formContainer.innerHTML = html;

      // Toggle period visibility
      var recurCheck = document.getElementById('eco-new-recurring');
      var periodWrap = document.getElementById('eco-new-period-wrap');
      if (recurCheck && periodWrap) {
        recurCheck.addEventListener('change', function() {
          periodWrap.style.display = recurCheck.checked ? '' : 'none';
        });
      }

      // Cancel
      var cancelBtn = document.getElementById('eco-new-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
          formContainer.innerHTML = '';
        });
      }

      // Save
      var saveBtn = document.getElementById('eco-new-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', async function() {
          try {
            var family = document.getElementById('eco-new-family').value;
            var name = document.getElementById('eco-new-name').value.trim();
            var amount = document.getElementById('eco-new-amount').value;
            var isRecurring = document.getElementById('eco-new-recurring').checked;
            var period = isRecurring ? document.getElementById('eco-new-period').value : null;
            var notes = document.getElementById('eco-new-notes').value.trim();

            if (!name) { ecoToast('❌ Nom requis'); return; }
            if (!amount || Number(amount) <= 0) { ecoToast('❌ Montant invalide'); return; }

            var body = {
              family: family,
              name: name,
              amount_kmf: Number(amount),
              is_recurring: isRecurring,
              recurrence_period: period,
              notes: notes || null
            };

            await CT.api.post('/api/admin/economic/charges', body);
            ecoToast('✅ Charge ajoutée');
            var content = document.getElementById('eco-tab-content');
            if (content) await renderCharges(content);
          } catch (err) {
            ecoToast('❌ Erreur: ' + err.message);
          }
        });
      }
    }

    // ─── Tab 4: Cohérence ────────────────────────────────────────────

    async function renderCoherence(content) {
      var data = await CT.api.get('/api/admin/economic/coherence');
      var html = '';

      // Status badge
      html += '<div class="eco-status eco-status-' + data.status + '">';
      var statusLabels = { stable: '🟢 Stable', surveiller: '🟡 À surveiller', tension: '🟠 Sous tension', blocking: '🔴 Bloquant' };
      html += statusLabels[data.status] || data.status;
      html += '</div>';

      // Alerts
      if (data.alerts && data.alerts.length > 0) {
        html += '<div class="ct-section-block">';
        html += '<h3 style="margin:0 0 12px 0;">🔍 Résultats de vérification</h3>';

        // Sort by severity
        var severityOrder = { blocking: 0, critical: 1, warning: 2, info: 3 };
        var sorted = data.alerts.sort(function(a, b) {
          return (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9);
        });

        for (var i = 0; i < sorted.length; i++) {
          var alert = sorted[i];
          html += '<div class="eco-alert eco-alert-' + alert.severity + '">';
          html += '<span class="eco-alert-severity ' + alert.severity + '">' + alert.severity.toUpperCase() + '</span>';
          html += '<span class="eco-alert-msg">' + alert.message + '</span>';
          if (alert.detail) {
            html += '<div class="eco-alert-detail">' + alert.detail + '</div>';
          }
          html += '</div>';
        }

        html += '</div>';
      } else {
        html += '<div class="ct-section-block">';
        html += '<div class="ct-empty">✅ Aucune alerte — le modèle est cohérent</div>';
        html += '</div>';
      }

      // Redistribute button
      html += '<div style="margin-top:16px;display:flex;align-items:center;gap:12px;">';
      html += '<button class="ct-btn ct-btn-action" id="eco-redistribute-btn">🔄 Recalculer maintenant</button>';
      html += '<span style="font-size:12px;color:#9ca3af;">Dernière vérification : ' + new Date(data.checked_at).toLocaleString('fr-FR') + '</span>';
      html += '</div>';

      content.innerHTML = html;

      // Wire redistribute button
      var redistBtn = document.getElementById('eco-redistribute-btn');
      if (redistBtn) {
        redistBtn.addEventListener('click', async function() {
          try {
            redistBtn.textContent = '⏳ Recalcul en cours...';
            redistBtn.disabled = true;
            await CT.api.post('/api/admin/economic/redistribute', {});
            ecoToast('✅ Redistribution terminée');
            await renderCoherence(content);
          } catch (err) {
            ecoToast('❌ Erreur: ' + err.message);
            redistBtn.textContent = '🔄 Recalculer maintenant';
            redistBtn.disabled = false;
          }
        });
      }
    }

    // ─── Tab 5: History (expert only) ────────────────────────────────

    async function renderHistory(content) {
      var data = await CT.api.get('/api/admin/economic/history');
      var html = '';

      html += '<div class="ct-section-block">';
      html += '<h3 style="margin:0 0 12px 0;">📜 Historique des snapshots</h3>';

      if (!data.snapshots || data.snapshots.length === 0) {
        html += '<div class="ct-empty">Aucun snapshot enregistré</div>';
      } else {
        var statusEmojis = { stable: '🟢', surveiller: '🟡', tension: '🟠', blocking: '🔴' };

        for (var i = 0; i < data.snapshots.length; i++) {
          var snap = data.snapshots[i];
          var sd = snap.snapshot_data;
          if (typeof sd === 'string') sd = JSON.parse(sd);

          html += '<div class="eco-history-row">';
          html += '<span class="eco-history-date">' + new Date(snap.created_at).toLocaleString('fr-FR') + '</span>';
          html += '<span class="eco-history-status">' + (statusEmojis[snap.model_status] || '⚪') + ' ' + snap.model_status + '</span>';
          html += '<span class="eco-history-trigger">' + (snap.trigger_event || '–') + '</span>';

          // Key metrics
          if (sd) {
            html += '<span style="font-size:12px;color:#6b7280;">';
            if (sd.totalCostPerOrder != null) html += 'Coût: ' + fmtKMF(sd.totalCostPerOrder) + ' · ';
            if (sd.safetyRatio != null) html += 'Sécu: ' + fmtPct(sd.safetyRatio) + ' · ';
            if (sd.netProfit != null) html += 'Profit: ' + fmtKMF(sd.netProfit);
            html += '</span>';
          }

          html += '</div>';
        }
      }

      html += '</div>';
      content.innerHTML = html;
    }

    // ─── Tab 5: Config & Fidélité ──────────────────────────────────

    async function renderConfig(content) {
      var html = '';

      // ── Section 1: Finance Config (variabilisée) ──────────────────
      html += '<div class="eco-section">';
      html += '<h3>⚙️ Configuration financière</h3>';
      html += '<p style="color:#6b7280;font-size:13px;margin-bottom:12px;">Tous les paramètres métier pilotables — modifiez ici, le moteur recalcule tout.</p>';

      try {
        var cfgResp = await CT.api.get('/api/admin/finance-config');
        var configs = cfgResp.configs || cfgResp || [];

        if (!configs.length) {
          html += '<div class="ct-empty">Aucune config. Le seed se crée au premier redémarrage.</div>';
        } else {
          // Group by category
          var groups = {};
          for (var i = 0; i < configs.length; i++) {
            var c = configs[i];
            var cat = c.category || 'Général';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(c);
          }

          var cats = Object.keys(groups).sort();
          for (var g = 0; g < cats.length; g++) {
            html += '<div class="eco-config-group">';
            html += '<h4 style="font-size:14px;color:#374151;margin:12px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">' + cats[g] + '</h4>';

            var items = groups[cats[g]];
            for (var j = 0; j < items.length; j++) {
              var item = items[j];
              html += '<div class="eco-config-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f6;">';
              html += '<span style="flex:1;font-size:13px;color:#374151;" title="' + (item.description || '') + '">' + item.label + '</span>';
              html += '<input type="number" class="eco-config-input" data-key="' + item.key + '" value="' + (item.value != null ? item.value : '') + '" step="any" style="width:100px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;text-align:right;">';
              html += '<span style="font-size:12px;color:#9ca3af;width:50px;">' + (item.unit || '') + '</span>';
              html += '<button class="eco-config-save btn-sm" data-key="' + item.key + '" style="padding:3px 10px;font-size:12px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;">💾</button>';
              html += '</div>';
            }
            html += '</div>';
          }
        }
      } catch (e) {
        html += '<div class="ct-error">Erreur config: ' + e.message + '</div>';
      }
      html += '</div>';

      // ── Section 2: Seuils fidélité ────────────────────────────────
      html += '<div class="eco-section">';
      html += '<h3>🎁 Programme fidélité</h3>';
      html += '<p style="color:#6b7280;font-size:13px;margin-bottom:12px;">Seuils, taux, et paliers — tout est dans la config financière ci-dessus (catégorie "Fidélité").</p>';

      // Pending rewards
      try {
        var loyResp = await CT.api.get('/api/admin/loyalty/pending');
        var pending = loyResp.rewards || loyResp || [];

        if (pending.length > 0) {
          html += '<h4 style="font-size:14px;color:#f59e0b;margin:12px 0 8px;">🎁 Cadeaux en attente (' + pending.length + ')</h4>';
          html += '<div class="eco-table-wrap" style="overflow-x:auto;">';
          html += '<table class="ct-table" style="width:100%;font-size:13px;">';
          html += '<thead><tr><th>Client</th><th>Téléphone</th><th>Commandes</th><th>Panier moyen</th><th>Cadeau suggéré</th><th>Action</th></tr></thead>';
          html += '<tbody>';
          for (var p = 0; p < pending.length; p++) {
            var rw = pending[p];
            html += '<tr>';
            html += '<td>' + (rw.name || '—') + '</td>';
            html += '<td>' + (rw.phone || '—') + '</td>';
            html += '<td style="text-align:center;">' + (rw.order_count || 0) + '</td>';
            html += '<td style="text-align:right;">' + fmtKMF(rw.avg_basket || 0) + '</td>';
            html += '<td>' + (rw.suggested_gift || 'À définir') + '</td>';
            html += '<td>';
            html += '<button class="btn-sm loyalty-grant" data-user-id="' + rw.user_id + '" style="padding:3px 8px;font-size:11px;background:#10b981;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-right:4px;">✅ Accorder</button>';
            html += '<button class="btn-sm loyalty-skip" data-user-id="' + rw.user_id + '" style="padding:3px 8px;font-size:11px;background:#6b7280;color:#fff;border:none;border-radius:6px;cursor:pointer;">⏭ Ignorer</button>';
            html += '</td>';
            html += '</tr>';
          }
          html += '</tbody></table></div>';
        } else {
          html += '<div class="ct-empty" style="padding:12px;color:#6b7280;font-size:13px;">Aucun cadeau en attente — tout va bien 🎉</div>';
        }
      } catch (e) {
        html += '<div style="color:#6b7280;font-size:12px;">Module fidélité pas encore actif (' + e.message + ')</div>';
      }

      // Recent rewards history
      try {
        var histResp = await CT.api.get('/api/admin/loyalty/history');
        var history = histResp.rewards || histResp || [];

        if (history.length > 0) {
          html += '<h4 style="font-size:14px;color:#374151;margin:16px 0 8px;">📋 Historique récent</h4>';
          html += '<div class="eco-table-wrap" style="overflow-x:auto;">';
          html += '<table class="ct-table" style="width:100%;font-size:12px;">';
          html += '<thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Description</th><th>Statut</th></tr></thead>';
          html += '<tbody>';
          for (var h = 0; h < Math.min(history.length, 20); h++) {
            var hr = history[h];
            html += '<tr>';
            html += '<td>' + new Date(hr.created_at).toLocaleDateString('fr-FR') + '</td>';
            html += '<td>' + (hr.user_name || hr.phone || '—') + '</td>';
            html += '<td>' + (hr.reward_type || '—') + '</td>';
            html += '<td>' + (hr.description || '—') + '</td>';
            var stColor = hr.status === 'granted' ? '#10b981' : hr.status === 'skipped' ? '#6b7280' : '#f59e0b';
            html += '<td style="color:' + stColor + ';">' + (hr.status || '—') + '</td>';
            html += '</tr>';
          }
          html += '</tbody></table></div>';
        }
      } catch (e) {
        // Silent — history may not exist yet
      }

      html += '</div>';
      content.innerHTML = html;

      // ── Wire save buttons (config) ────────────────────────────────
      var saveBtns = content.querySelectorAll('.eco-config-save');
      saveBtns.forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var key = btn.getAttribute('data-key');
          var input = content.querySelector('.eco-config-input[data-key="' + key + '"]');
          if (!input) return;
          btn.textContent = '⏳';
          try {
            await CT.api.put('/api/admin/finance-config/' + key, { value: parseFloat(input.value) });
            btn.textContent = '✅';
            setTimeout(function() { btn.textContent = '💾'; }, 1500);
            // Trigger redistribution
            await CT.api.post('/api/admin/economic/redistribute');
          } catch (e) {
            btn.textContent = '❌';
            alert('Erreur: ' + e.message);
          }
        });
      });

      // ── Wire loyalty actions ──────────────────────────────────────
      var grantBtns = content.querySelectorAll('.loyalty-grant');
      grantBtns.forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var userId = btn.getAttribute('data-user-id');
          btn.textContent = '⏳';
          try {
            await CT.api.post('/api/admin/loyalty/' + userId + '/grant');
            btn.textContent = '✅ Accordé';
            btn.disabled = true;
          } catch (e) {
            btn.textContent = '❌';
            alert('Erreur: ' + e.message);
          }
        });
      });

      var skipBtns = content.querySelectorAll('.loyalty-skip');
      skipBtns.forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var userId = btn.getAttribute('data-user-id');
          btn.textContent = '⏳';
          try {
            await CT.api.post('/api/admin/loyalty/' + userId + '/skip');
            btn.textContent = '⏭ Ignoré';
            btn.disabled = true;
          } catch (e) {
            btn.textContent = '❌';
            alert('Erreur: ' + e.message);
          }
        });
      });
    }

    // Start
    render();

  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};
