/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-settings
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/**
 * KOMERCE Control Tower — Vue Paramètres v1.0
 *
 * UI de gouvernance des règles business.
 * Intègre :
 *   - Liste groupée par catégorie avec recherche
 *   - Panneau de modification slide-in à droite
 *   - Historique des modifications par règle
 *   - Grilles éditables pour TAXES et DIMS
 *
 * Dépendances : CT.api (fetch wrapper), CT.pc (UI helpers) — déjà présents
 * Injection dans CT.views (sans modifier ct-views-v7.js)
 */

(function() {
  'use strict';

  if (typeof window.CT === 'undefined') window.CT = {};
  if (typeof window.CT.views === 'undefined') window.CT.views = {};

  // ═══════════════════════════════════════════════════════════════════════
  // STYLES (injection unique, pas besoin de CSS externe)
  // ═══════════════════════════════════════════════════════════════════════

  const SETTINGS_CSS = `
    .st-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px; }
    .st-header h2 { font-size:24px; }
    .st-subtitle { color:#64748b; font-size:14px; }
    .st-tabs { display:flex; gap:4px; margin-bottom:20px; border-bottom:2px solid #e2e8f0; }
    .st-tab { padding:10px 20px; background:none; border:none; cursor:pointer; font-size:14px; font-weight:600; color:#64748b; border-bottom:3px solid transparent; margin-bottom:-2px; transition:all 0.15s; }
    .st-tab:hover { color:#1e293b; }
    .st-tab.active { color:#3b82f6; border-bottom-color:#3b82f6; }
    .st-filters { display:flex; gap:12px; margin-bottom:20px; flex-wrap:wrap; }
    .st-search { flex:1; min-width:240px; padding:10px 14px; border:1px solid #e2e8f0; border-radius:8px; font-size:14px; outline:none; }
    .st-search:focus { border-color:#3b82f6; }
    .st-category { background:white; border-radius:12px; padding:16px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,0.06); }
    .st-category-header { display:flex; align-items:center; justify-content:space-between; cursor:pointer; padding:4px 0; font-weight:700; }
    .st-category-header h3 { font-size:16px; color:#334155; }
    .st-category-count { background:#f1f5f9; color:#475569; padding:2px 10px; border-radius:20px; font-size:12px; font-weight:600; }
    .st-category-rules { margin-top:12px; display:none; }
    .st-category.expanded .st-category-rules { display:block; }
    .st-category.expanded .st-category-header .st-caret::before { content:'▾'; }
    .st-category .st-category-header .st-caret::before { content:'▸'; }
    .st-rule { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-top:1px solid #f1f5f9; cursor:pointer; transition:background 0.15s; }
    .st-rule:hover { background:#f8fafc; }
    .st-rule-info { flex:1; min-width:0; }
    .st-rule-key { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; color:#64748b; }
    .st-rule-label { font-size:14px; color:#1e293b; margin-top:2px; font-weight:500; }
    .st-rule-value { font-size:15px; font-weight:700; color:#3b82f6; margin-left:16px; white-space:nowrap; }
    .st-rule-unit { font-size:13px; color:#94a3b8; font-weight:400; margin-left:4px; }
    .st-empty { text-align:center; padding:40px; color:#94a3b8; }

    /* Panneau latéral */
    .st-panel-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.3); z-index:500; animation:stFadeIn 0.2s; }
    .st-panel-overlay.open { display:block; }
    @keyframes stFadeIn { from { opacity:0; } to { opacity:1; } }
    .st-panel { position:fixed; top:0; right:0; bottom:0; width:480px; max-width:100vw; background:white; box-shadow:-4px 0 20px rgba(0,0,0,0.15); z-index:600; display:flex; flex-direction:column; transform:translateX(100%); transition:transform 0.25s; }
    .st-panel.open { transform:translateX(0); }
    .st-panel-header { padding:20px; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; justify-content:space-between; }
    .st-panel-title { font-size:12px; color:#64748b; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
    .st-panel-close { background:none; border:none; font-size:24px; cursor:pointer; color:#64748b; padding:0 4px; }
    .st-panel-body { flex:1; overflow-y:auto; padding:20px; }
    .st-panel-label { font-weight:700; color:#1e293b; margin-bottom:4px; font-size:16px; }
    .st-panel-desc { color:#475569; font-size:14px; margin-bottom:16px; line-height:1.5; }
    .st-panel-current { background:#f8fafc; border-radius:8px; padding:12px 16px; margin-bottom:16px; }
    .st-panel-current-label { font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:1px; }
    .st-panel-current-value { font-size:24px; font-weight:700; color:#1e293b; margin:4px 0; }
    .st-panel-current-bounds { font-size:12px; color:#94a3b8; }
    .st-field { margin-bottom:16px; }
    .st-field label { display:block; font-weight:600; font-size:13px; margin-bottom:6px; color:#334155; }
    .st-field input, .st-field select, .st-field textarea {
      width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; outline:none;
      font-family:inherit;
    }
    .st-field input:focus, .st-field textarea:focus, .st-field select:focus { border-color:#3b82f6; }
    .st-field textarea { resize:vertical; min-height:80px; }
    .st-field-hint { font-size:12px; color:#94a3b8; margin-top:4px; }
    .st-field-error { color:#dc2626; font-size:13px; margin-top:4px; }
    .st-panel-footer { padding:16px 20px; border-top:1px solid #e2e8f0; display:flex; gap:8px; justify-content:flex-end; }
    .st-btn { padding:10px 20px; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; border:none; transition:all 0.15s; }
    .st-btn:disabled { opacity:0.5; cursor:not-allowed; }
    .st-btn-primary { background:#3b82f6; color:white; }
    .st-btn-primary:hover:not(:disabled) { background:#2563eb; }
    .st-btn-secondary { background:#f1f5f9; color:#475569; }
    .st-btn-secondary:hover:not(:disabled) { background:#e2e8f0; }
    .st-btn-danger { background:transparent; color:#dc2626; border:1px solid #fca5a5; }
    .st-btn-danger:hover:not(:disabled) { background:#fef2f2; }

    /* Historique */
    .st-history { border-top:1px solid #e2e8f0; padding-top:16px; margin-top:16px; }
    .st-history h4 { font-size:14px; font-weight:700; color:#334155; margin-bottom:10px; }
    .st-history-item { padding:10px 0; border-top:1px solid #f1f5f9; font-size:13px; }
    .st-history-item:first-child { border-top:none; }
    .st-history-who { font-weight:600; color:#1e293b; }
    .st-history-when { color:#94a3b8; font-size:12px; }
    .st-history-change { color:#475569; margin-top:2px; }
    .st-history-reason { color:#64748b; font-style:italic; margin-top:2px; }

    /* Grilles matrices */
    .st-matrix { overflow-x:auto; background:white; border-radius:12px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,0.06); }
    .st-matrix table { width:100%; border-collapse:collapse; }
    .st-matrix th { background:#f8fafc; padding:10px; text-align:left; font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:1px; border-bottom:2px solid #e2e8f0; }
    .st-matrix td { padding:10px; border-bottom:1px solid #f1f5f9; }
    .st-matrix input[type=number] { width:80px; padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:14px; text-align:right; }
    .st-matrix .st-matrix-save { padding:6px 14px; border-radius:6px; font-size:12px; font-weight:600; border:none; cursor:pointer; background:#e2e8f0; color:#94a3b8; }
    .st-matrix tr.dirty .st-matrix-save { background:#3b82f6; color:white; }
    .st-matrix tr.dirty .st-matrix-save:hover { background:#2563eb; }

    /* Badge critique */
    .st-critical { display:inline-block; background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:600; margin-left:6px; }
  `;

  function injectStyles() {
    if (document.getElementById('st-styles')) return;
    const s = document.createElement('style');
    s.id = 'st-styles';
    s.textContent = SETTINGS_CSS;
    document.head.appendChild(s);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS API
  // ═══════════════════════════════════════════════════════════════════════

  async function apiGet(path) {
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) throw new Error((await res.json()).error || 'Erreur serveur');
    return res.json();
  }

  async function apiPatch(path, body) {
    const res = await fetch(path, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    return data;
  }

  async function apiPut(path, body) {
    const res = await fetch(path, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    return data;
  }

  async function apiPost(path) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LABELS & CATÉGORIES
  // ═══════════════════════════════════════════════════════════════════════

  const CATEGORY_ORDER = [
    'sla', 'compensation', 'orders', 'pricing',
    'shipping', 'parcel', 'wallet', 'loyalty',
    'alerting', 'system',
  ];

  const CATEGORY_ICONS = {
    sla:          '⏱️',
    compensation: '🎁',
    orders:       '🛒',
    pricing:      '💰',
    shipping:     '🚚',
    parcel:       '📦',
    wallet:       '💼',
    loyalty:      '⭐',
    alerting:     '🚨',
    system:       '⚙️',
  };

  const CRITICAL_KEYS = new Set([
    'MARGE_PCT',
    'FRAIS_STRIPE_PCT',
    'COMMISSION_AGENT_PCT',
    'CANCEL_PARTIAL_REFUND_PCT',
    'EUR_KMF_FALLBACK',
    'AED_KMF_FALLBACK',
    'WALLET_MAX_BALANCE_KMF',
  ]);

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAT LOCAL
  // ═══════════════════════════════════════════════════════════════════════

  let _allData = null;        // { rules: {...}, taxes: [...], dims: [...] }
  let _currentTab = 'rules';  // 'rules' | 'taxes' | 'dims' | 'audit'
  let _searchQuery = '';
  let _editingRule = null;

  // ═══════════════════════════════════════════════════════════════════════
  // VUE PRINCIPALE
  // ═══════════════════════════════════════════════════════════════════════

  CT.views.settings = async function(container) {
    injectStyles();
    container.innerHTML = '<div class="ct-loading">⚙️ Chargement des paramètres...</div>';

    try {
      // Charge en parallèle
      const [rulesData, taxesData, dimsData] = await Promise.all([
        apiGet('/api/admin/rules'),
        apiGet('/api/admin/pricing-matrices/taxes'),
        apiGet('/api/admin/pricing-matrices/dims'),
      ]);

      _allData = {
        rules: rulesData.categories,
        taxes: taxesData.taxes,
        dims:  dimsData.dims,
      };

      renderFullView(container);
    } catch (err) {
      container.innerHTML = `<div class="ct-error">❌ ${err.message}</div>`;
    }
  };

  function renderFullView(container) {
    container.innerHTML = `
      <div class="st-header">
        <div>
          <h2>⚙️ Paramètres business</h2>
          <div class="st-subtitle">Gouvernez les règles métier sans redéploiement</div>
        </div>
      </div>
      <div class="st-tabs">
        <button class="st-tab ${_currentTab === 'rules' ? 'active' : ''}" data-tab="rules">📋 Règles</button>
        <button class="st-tab ${_currentTab === 'taxes' ? 'active' : ''}" data-tab="taxes">💰 Taxes par catégorie</button>
        <button class="st-tab ${_currentTab === 'dims'  ? 'active' : ''}" data-tab="dims">📐 Dimensions par catégorie</button>
        <button class="st-tab ${_currentTab === 'audit' ? 'active' : ''}" data-tab="audit">📜 Historique global</button>
      </div>
      <div id="st-tab-content"></div>
      <div class="st-panel-overlay" id="st-overlay"></div>
      <aside class="st-panel" id="st-panel"></aside>
    `;

    // Tabs
    container.querySelectorAll('.st-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _currentTab = btn.dataset.tab;
        renderFullView(container);
      });
    });

    // Overlay fermeture
    container.querySelector('#st-overlay').addEventListener('click', closePanel);

    // Render du contenu de l'onglet
    const tabContent = container.querySelector('#st-tab-content');
    if (_currentTab === 'rules')  renderRulesTab(tabContent);
    if (_currentTab === 'taxes')  renderTaxesTab(tabContent);
    if (_currentTab === 'dims')   renderDimsTab(tabContent);
    if (_currentTab === 'audit')  renderAuditTab(tabContent);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB RÈGLES
  // ═══════════════════════════════════════════════════════════════════════

  function renderRulesTab(container) {
    container.innerHTML = `
      <div class="st-filters">
        <input type="search" class="st-search" id="st-search" placeholder="🔍 Rechercher une règle (clé, libellé, description)..." value="${escapeHtml(_searchQuery)}">
      </div>
      <div id="st-categories"></div>
    `;

    const searchInput = container.querySelector('#st-search');
    searchInput.addEventListener('input', (e) => {
      _searchQuery = e.target.value.trim().toLowerCase();
      renderCategories(container.querySelector('#st-categories'));
    });

    renderCategories(container.querySelector('#st-categories'));
  }

  function renderCategories(root) {
    const cats = _allData.rules;
    const orderedKeys = CATEGORY_ORDER.filter(k => cats[k]).concat(
      Object.keys(cats).filter(k => !CATEGORY_ORDER.includes(k))
    );

    let html = '';
    let totalMatches = 0;

    for (const catKey of orderedKeys) {
      const cat = cats[catKey];
      const icon = CATEGORY_ICONS[catKey] || '📁';

      const filteredRules = cat.rules.filter(r => {
        if (!_searchQuery) return true;
        const haystack = `${r.key} ${r.label_fr || ''} ${r.description || ''}`.toLowerCase();
        return haystack.includes(_searchQuery);
      });

      if (filteredRules.length === 0 && _searchQuery) continue;
      totalMatches += filteredRules.length;

      const expanded = (_searchQuery && filteredRules.length > 0) || catKey === 'sla';

      html += `
        <div class="st-category ${expanded ? 'expanded' : ''}" data-cat="${catKey}">
          <div class="st-category-header">
            <h3><span class="st-caret"></span> ${icon} ${escapeHtml(cat.label || catKey)}</h3>
            <span class="st-category-count">${filteredRules.length} règle${filteredRules.length > 1 ? 's' : ''}</span>
          </div>
          <div class="st-category-rules">
            ${filteredRules.map(renderRuleRow).join('')}
          </div>
        </div>
      `;
    }

    if (_searchQuery && totalMatches === 0) {
      html = `<div class="st-empty">Aucune règle ne correspond à "${escapeHtml(_searchQuery)}"</div>`;
    }

    root.innerHTML = html;

    // Toggle catégories
    root.querySelectorAll('.st-category-header').forEach(h => {
      h.addEventListener('click', () => h.parentElement.classList.toggle('expanded'));
    });

    // Click sur règle → panneau
    root.querySelectorAll('.st-rule').forEach(el => {
      el.addEventListener('click', () => openRulePanel(el.dataset.key));
    });
  }

  function renderRuleRow(r) {
    const isCritical = CRITICAL_KEYS.has(r.key);
    const criticalBadge = isCritical ? '<span class="st-critical">⚠️ critique</span>' : '';
    const value = r.value !== null && r.value !== undefined ? r.value : '—';
    const unit = guessUnit(r.key, r.value_type);

    return `
      <div class="st-rule" data-key="${r.key}">
        <div class="st-rule-info">
          <div class="st-rule-key">${r.key}${criticalBadge}</div>
          <div class="st-rule-label">${escapeHtml(r.label_fr || r.key)}</div>
        </div>
        <div class="st-rule-value">
          ${formatValue(value, r.value_type)}
          ${unit ? `<span class="st-rule-unit">${unit}</span>` : ''}
        </div>
      </div>
    `;
  }

  function guessUnit(key, type) {
    if (type === 'boolean') return '';
    if (/_DAYS$|DAYS_/.test(key)) return 'jours';
    if (/_HOURS$|HOURS_/.test(key)) return 'heures';
    if (/_MIN$/.test(key) && /INTERVAL/.test(key)) return 'min';
    if (/_KMF$|KMF_/.test(key)) return 'KMF';
    if (/_PCT$|PCT_/.test(key)) return '%';
    if (/_KG$|KG_/.test(key)) return 'kg';
    if (/_SEC$/.test(key)) return 's';
    return '';
  }

  function formatValue(v, type) {
    if (type === 'boolean') return v ? '✓ activé' : '✗ désactivé';
    if (typeof v === 'number') return v.toLocaleString('fr-FR');
    return escapeHtml(String(v));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PANNEAU DE MODIFICATION
  // ═══════════════════════════════════════════════════════════════════════

  async function openRulePanel(key) {
    const panel = document.getElementById('st-panel');
    const overlay = document.getElementById('st-overlay');
    panel.innerHTML = '<div class="ct-loading" style="padding:40px">Chargement...</div>';
    panel.classList.add('open');
    overlay.classList.add('open');

    try {
      const data = await apiGet(`/api/admin/rules/${key}`);
      _editingRule = data.rule;
      renderRulePanel(data.rule, data.history);
    } catch (err) {
      panel.innerHTML = `<div class="ct-error" style="margin:20px">❌ ${err.message}</div>`;
    }
  }

  function closePanel() {
    document.getElementById('st-panel').classList.remove('open');
    document.getElementById('st-overlay').classList.remove('open');
    _editingRule = null;
  }

  function renderRulePanel(rule, history) {
    const panel = document.getElementById('st-panel');
    const currentVal = rule.value && rule.value.value !== undefined ? rule.value.value : '';
    const isCritical = CRITICAL_KEYS.has(rule.key);
    const unit = guessUnit(rule.key, rule.value_type);

    // Input selon type
    let inputHtml = '';
    if (rule.value_type === 'boolean') {
      inputHtml = `
        <select class="st-new-value" id="st-new-value">
          <option value="true"  ${currentVal === true ? 'selected' : ''}>Activé</option>
          <option value="false" ${currentVal === false ? 'selected' : ''}>Désactivé</option>
        </select>`;
    } else if (rule.value_type === 'number') {
      inputHtml = `<input type="number" id="st-new-value" step="any" value="${currentVal}" />`;
    } else {
      inputHtml = `<input type="text" id="st-new-value" value="${escapeHtml(String(currentVal))}" />`;
    }

    const boundsHint = rule.value_type === 'number' && (rule.min_value !== null || rule.max_value !== null)
      ? `Min : ${rule.min_value ?? '—'} · Max : ${rule.max_value ?? '—'}`
      : '';

    panel.innerHTML = `
      <div class="st-panel-header">
        <div>
          <div class="st-panel-title">${rule.key}${isCritical ? '<span class="st-critical">⚠️ critique</span>' : ''}</div>
        </div>
        <button class="st-panel-close" id="st-close">&times;</button>
      </div>

      <div class="st-panel-body">
        <div class="st-panel-label">${escapeHtml(rule.label_fr || rule.key)}</div>
        <div class="st-panel-desc">${escapeHtml(rule.description || 'Pas de description.')}</div>

        <div class="st-panel-current">
          <div class="st-panel-current-label">Valeur actuelle</div>
          <div class="st-panel-current-value">
            ${formatValue(currentVal, rule.value_type)} ${unit}
          </div>
          <div class="st-panel-current-bounds">${boundsHint}</div>
        </div>

        <div class="st-field">
          <label for="st-new-value">Nouvelle valeur</label>
          ${inputHtml}
          ${boundsHint ? `<div class="st-field-hint">${boundsHint}</div>` : ''}
        </div>

        <div class="st-field">
          <label for="st-reason">Justification <span style="color:#dc2626">*</span></label>
          <textarea id="st-reason" placeholder="Minimum 10 caractères. Expliquez pourquoi vous modifiez cette règle."></textarea>
          <div class="st-field-hint">Cette justification sera visible dans l'historique.</div>
        </div>

        <div class="st-field-error" id="st-error" style="display:none"></div>

        <div class="st-history">
          <h4>📜 Historique (${history.length})</h4>
          ${history.length === 0 ? '<div class="st-empty" style="padding:16px">Aucune modification pour l\'instant.</div>' : ''}
          ${history.map(h => `
            <div class="st-history-item">
              <div class="st-history-who">${escapeHtml(h.changed_by_name || 'Système')}</div>
              <div class="st-history-when">${formatDate(h.created_at)}</div>
              <div class="st-history-change">
                <span style="color:#94a3b8">${formatValue(h.old_value?.value, rule.value_type)}</span>
                → <strong>${formatValue(h.new_value?.value, rule.value_type)}</strong>
              </div>
              ${h.change_reason ? `<div class="st-history-reason">"${escapeHtml(h.change_reason)}"</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <div class="st-panel-footer">
        <button class="st-btn st-btn-danger" id="st-reset" ${history.length === 0 ? 'disabled' : ''}>
          🔄 Réinitialiser
        </button>
        <button class="st-btn st-btn-secondary" id="st-cancel">Annuler</button>
        <button class="st-btn st-btn-primary" id="st-save">Valider ▶</button>
      </div>
    `;

    panel.querySelector('#st-close').onclick  = closePanel;
    panel.querySelector('#st-cancel').onclick = closePanel;
    panel.querySelector('#st-save').onclick   = saveRule;
    panel.querySelector('#st-reset').onclick  = resetRule;
  }

  async function saveRule() {
    if (!_editingRule) return;
    const errEl  = document.getElementById('st-error');
    errEl.style.display = 'none';

    const rawValue = document.getElementById('st-new-value').value;
    const reason   = document.getElementById('st-reason').value.trim();

    if (reason.length < 10) {
      errEl.textContent = 'Justification trop courte (minimum 10 caractères).';
      errEl.style.display = 'block';
      return;
    }

    let value;
    if (_editingRule.value_type === 'boolean') {
      value = rawValue === 'true';
    } else if (_editingRule.value_type === 'number') {
      value = Number(rawValue);
      if (!Number.isFinite(value)) {
        errEl.textContent = 'Valeur numérique invalide.';
        errEl.style.display = 'block';
        return;
      }
    } else {
      value = String(rawValue);
    }

    const saveBtn = document.getElementById('st-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement…';

    try {
      await apiPatch(`/api/admin/rules/${_editingRule.key}`, { value, reason });
      closePanel();
      await CT.views.settings(document.getElementById('ct-main'));
      showToast(`✓ Règle ${_editingRule.key} mise à jour.`);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Valider ▶';
    }
  }

  async function resetRule() {
    if (!_editingRule) return;
    if (!confirm(`Remettre ${_editingRule.key} à sa valeur d'origine ?`)) return;

    try {
      await apiPost(`/api/admin/rules/${_editingRule.key}/reset`);
      closePanel();
      await CT.views.settings(document.getElementById('ct-main'));
      showToast(`✓ Règle ${_editingRule.key} remise à zéro.`);
    } catch (err) {
      alert('Erreur : ' + err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB TAXES (grille éditable)
  // ═══════════════════════════════════════════════════════════════════════

  function renderTaxesTab(container) {
    container.innerHTML = `
      <div class="st-matrix">
        <p class="st-subtitle" style="margin-bottom:16px">
          ⚠️ <strong>Zone critique</strong> — Ces taux impactent directement le calcul de prix de vente de toutes les commandes.
          Toute modification s'applique immédiatement. Justification obligatoire.
        </p>
        <table>
          <thead>
            <tr>
              <th>Catégorie</th>
              <th>Douane</th>
              <th>TVA</th>
              <th>Taxe additionnelle</th>
              <th>Dernière modif</th>
              <th style="text-align:right">Action</th>
            </tr>
          </thead>
          <tbody id="st-taxes-tbody">
            ${_allData.taxes.map(renderTaxRow).join('')}
          </tbody>
        </table>
      </div>
    `;

    attachMatrixListeners(container, 'taxes');
  }

  function renderTaxRow(t) {
    return `
      <tr data-cat="${t.category}" data-type="taxes">
        <td><strong>${escapeHtml(t.label_fr)}</strong><br><small style="color:#94a3b8">${t.category}</small></td>
        <td><input type="number" step="0.0001" min="0" max="1" value="${t.douane_pct}" data-field="douane_pct" /><small> (×100 = %)</small></td>
        <td><input type="number" step="0.0001" min="0" max="1" value="${t.tva_pct}" data-field="tva_pct" /></td>
        <td><input type="number" step="0.0001" min="0" max="1" value="${t.taxe_add_pct}" data-field="taxe_add_pct" /></td>
        <td style="font-size:12px;color:#94a3b8">
          ${t.updated_at ? formatDate(t.updated_at) : '—'}<br>
          ${t.updated_by_name || ''}
        </td>
        <td style="text-align:right">
          <button class="st-matrix-save" disabled>💾 Enregistrer</button>
        </td>
      </tr>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB DIMS (grille éditable)
  // ═══════════════════════════════════════════════════════════════════════

  function renderDimsTab(container) {
    container.innerHTML = `
      <div class="st-matrix">
        <p class="st-subtitle" style="margin-bottom:16px">
          📐 Dimensions standard par catégorie (L × l × H en cm).
          Utilisées pour calculer le volume et le fret.
        </p>
        <table>
          <thead>
            <tr>
              <th>Catégorie</th>
              <th>Longueur (cm)</th>
              <th>Largeur (cm)</th>
              <th>Hauteur (cm)</th>
              <th>Volume (cm³)</th>
              <th>Dernière modif</th>
              <th style="text-align:right">Action</th>
            </tr>
          </thead>
          <tbody>
            ${_allData.dims.map(renderDimRow).join('')}
          </tbody>
        </table>
      </div>
    `;

    attachMatrixListeners(container, 'dims');
  }

  function renderDimRow(d) {
    const vol = d.length_cm * d.width_cm * d.height_cm;
    return `
      <tr data-cat="${d.category}" data-type="dims">
        <td><strong>${escapeHtml(d.label_fr)}</strong><br><small style="color:#94a3b8">${d.category}</small></td>
        <td><input type="number" step="1" min="1" max="200" value="${d.length_cm}" data-field="length_cm" /></td>
        <td><input type="number" step="1" min="1" max="200" value="${d.width_cm}" data-field="width_cm" /></td>
        <td><input type="number" step="1" min="1" max="200" value="${d.height_cm}" data-field="height_cm" /></td>
        <td style="color:#64748b">${vol.toLocaleString('fr-FR')}</td>
        <td style="font-size:12px;color:#94a3b8">
          ${d.updated_at ? formatDate(d.updated_at) : '—'}<br>
          ${d.updated_by_name || ''}
        </td>
        <td style="text-align:right">
          <button class="st-matrix-save" disabled>💾 Enregistrer</button>
        </td>
      </tr>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HANDLERS MATRICES
  // ═══════════════════════════════════════════════════════════════════════

  function attachMatrixListeners(container) {
    container.querySelectorAll('tr[data-cat]').forEach(tr => {
      const inputs = tr.querySelectorAll('input');
      const saveBtn = tr.querySelector('.st-matrix-save');
      const originalValues = {};
      inputs.forEach(i => { originalValues[i.dataset.field] = i.value; });

      inputs.forEach(i => {
        i.addEventListener('input', () => {
          const dirty = Array.from(inputs).some(
            inp => inp.value !== originalValues[inp.dataset.field]
          );
          if (dirty) {
            tr.classList.add('dirty');
            saveBtn.disabled = false;
          } else {
            tr.classList.remove('dirty');
            saveBtn.disabled = true;
          }
        });
      });

      saveBtn.addEventListener('click', () => saveMatrixRow(tr));
    });
  }

  async function saveMatrixRow(tr) {
    const type = tr.dataset.type;
    const cat  = tr.dataset.cat;
    const reason = prompt(
      `Justification (min 10 car.) pour modifier ${type === 'taxes' ? 'les taxes' : 'les dimensions'} de la catégorie "${cat}" :`
    );
    if (!reason || reason.trim().length < 10) {
      alert('Justification trop courte.');
      return;
    }

    const body = { reason: reason.trim() };
    tr.querySelectorAll('input').forEach(i => {
      body[i.dataset.field] = Number(i.value);
    });

    try {
      const url = `/api/admin/pricing-matrices/${type}/${cat}`;
      await apiPut(url, body);
      showToast(`✓ ${type} de "${cat}" mis à jour.`);
      await CT.views.settings(document.getElementById('ct-main'));
    } catch (err) {
      alert('Erreur : ' + err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB AUDIT
  // ═══════════════════════════════════════════════════════════════════════

  async function renderAuditTab(container) {
    container.innerHTML = '<div class="ct-loading">Chargement de l\'historique…</div>';
    try {
      const data = await apiGet('/api/admin/rules/audit');
      const items = data.history || [];

      if (items.length === 0) {
        container.innerHTML = '<div class="ct-empty-state">📜 Aucune modification enregistrée pour l\'instant.</div>';
        return;
      }

      container.innerHTML = `
        <div class="st-matrix" style="padding:0">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Règle</th>
                <th>Modifié par</th>
                <th>Ancienne</th>
                <th>Nouvelle</th>
                <th>Justification</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(h => `
                <tr>
                  <td style="white-space:nowrap;font-size:12px;color:#64748b">${formatDate(h.created_at)}</td>
                  <td>
                    <strong>${escapeHtml(h.rule_label || h.rule_key)}</strong><br>
                    <small style="color:#94a3b8">${h.rule_key || ''}</small>
                  </td>
                  <td style="font-size:13px">${escapeHtml(h.changed_by_name || 'Système')}</td>
                  <td style="color:#94a3b8">${formatValue(h.old_value?.value, 'auto')}</td>
                  <td><strong>${formatValue(h.new_value?.value, 'auto')}</strong></td>
                  <td style="max-width:300px;font-style:italic;color:#64748b">${escapeHtml(h.change_reason || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="ct-error">❌ ${err.message}</div>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UTILITAIRES
  // ═══════════════════════════════════════════════════════════════════════

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function showToast(msg) {
    let t = document.getElementById('st-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'st-toast';
      t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#16a34a;color:white;padding:14px 20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:1000;font-size:14px;font-weight:600;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._to);
    t._to = setTimeout(() => { t.style.display = 'none'; }, 3000);
  }

  console.log('[CT] ct-views-settings.js chargé (v1.0)');
})();
