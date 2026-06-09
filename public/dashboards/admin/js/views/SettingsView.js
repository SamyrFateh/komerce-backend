/**
 * KOMERCE Dashboard â€” SettingsView /admin/settings
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Migration de CT.views.settings (ct-views-settings.js â€” v1.0)
 *
 * 4 onglets :
 *   1. RÃ¨gles       â€” liste groupÃ©e par catÃ©gorie, recherche, panneau slide-in
 *   2. Taxes        â€” grille Ã©ditable par catÃ©gorie
 *   3. Dimensions   â€” grille LÃ—lÃ—H par catÃ©gorie
 *   4. Historique   â€” audit trail global
 *
 * API : KmcApi.getSettings() / getSettingRule() / patchSettingRule() /
 *       resetSettingRule() / getSettingsTaxes() / putSettingsTaxes() /
 *       getSettingsDims() / putSettingsDims() / getSettingsAudit()
 */

(function (global) {
  'use strict';

  /* â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  function _injectStyles() {
    if (document.getElementById('sv-styles')) return;
    const s = document.createElement('style');
    s.id = 'sv-styles';
    s.textContent = `
      .sv-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px}
      .sv-header h2{font-size:22px;font-weight:800;color:var(--text-primary)}
      .sv-subtitle{color:var(--text-secondary);font-size:13px;margin-top:2px}
      .sv-tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:2px solid var(--border)}
      .sv-tab{padding:10px 20px;background:none;border:none;cursor:pointer;font-size:14px;font-weight:600;color:var(--text-secondary);border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .15s;font-family:inherit}
      .sv-tab:hover{color:var(--text-primary)}
      .sv-tab.active{color:#3b82f6;border-bottom-color:#3b82f6}
      .sv-search{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;outline:none;background:var(--bg-card);color:var(--text-primary);font-family:inherit;box-sizing:border-box;margin-bottom:16px}
      .sv-search:focus{border-color:#3b82f6}
      .sv-category{background:var(--bg-card);border-radius:12px;padding:16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      .sv-cat-header{display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:4px 0;font-weight:700}
      .sv-cat-header h3{font-size:15px;color:var(--text-primary)}
      .sv-cat-count{background:var(--bg-secondary);color:var(--text-secondary);padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600}
      .sv-cat-rules{margin-top:10px;display:none}
      .sv-category.expanded .sv-cat-rules{display:block}
      .sv-caret::before{content:'â–¸';display:inline-block;margin-right:6px;transition:transform .15s}
      .sv-category.expanded .sv-caret::before{content:'â–¾'}
      .sv-rule{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-top:1px solid var(--border);cursor:pointer;transition:background .1s}
      .sv-rule:hover{background:var(--bg-secondary);border-radius:6px}
      .sv-rule-info{flex:1;min-width:0}
      .sv-rule-key{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;color:var(--text-secondary)}
      .sv-rule-label{font-size:14px;color:var(--text-primary);margin-top:2px;font-weight:500}
      .sv-rule-val{font-size:15px;font-weight:700;color:#3b82f6;margin-left:16px;white-space:nowrap}
      .sv-rule-unit{font-size:12px;color:var(--text-secondary);font-weight:400;margin-left:3px}
      .sv-badge-critical{display:inline-block;background:#fef3c7;color:#b45309;padding:1px 7px;border-radius:20px;font-size:10px;font-weight:700;margin-left:6px}
      .sv-empty-msg{text-align:center;padding:36px;color:var(--text-secondary);font-style:italic}

      /* Overlay + panel */
      .sv-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:500;animation:svFadeIn .2s}
      .sv-overlay.open{display:block}
      @keyframes svFadeIn{from{opacity:0}to{opacity:1}}
      .sv-panel{position:fixed;top:0;right:0;bottom:0;width:480px;max-width:100vw;background:var(--bg-card);box-shadow:-4px 0 20px rgba(0,0,0,.15);z-index:600;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .25s}
      .sv-panel.open{transform:translateX(0)}
      .sv-panel-head{padding:18px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
      .sv-panel-key{font-family:ui-monospace,monospace;font-size:12px;color:var(--text-secondary)}
      .sv-panel-close{background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-secondary);padding:0 4px}
      .sv-panel-body{flex:1;overflow-y:auto;padding:20px}
      .sv-panel-lbl{font-weight:700;color:var(--text-primary);font-size:16px;margin-bottom:4px}
      .sv-panel-desc{color:var(--text-secondary);font-size:13px;margin-bottom:14px;line-height:1.5}
      .sv-current-box{background:var(--bg-secondary);border-radius:8px;padding:12px 16px;margin-bottom:16px}
      .sv-current-label{font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.8px}
      .sv-current-val{font-size:24px;font-weight:700;color:var(--text-primary);margin:4px 0}
      .sv-current-bounds{font-size:11px;color:var(--text-secondary)}
      .sv-field{margin-bottom:16px}
      .sv-field label{display:block;font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text-primary)}
      .sv-field input,.sv-field select,.sv-field textarea{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;outline:none;font-family:inherit;background:var(--bg-card);color:var(--text-primary);box-sizing:border-box}
      .sv-field input:focus,.sv-field select:focus,.sv-field textarea:focus{border-color:#3b82f6}
      .sv-field textarea{resize:vertical;min-height:80px}
      .sv-field-hint{font-size:11px;color:var(--text-secondary);margin-top:3px}
      .sv-field-error{color:#dc2626;font-size:13px;margin-top:4px}
      .sv-panel-foot{padding:14px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end}

      /* Historique panel */
      .sv-hist{border-top:1px solid var(--border);padding-top:16px;margin-top:16px}
      .sv-hist h4{font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:8px}
      .sv-hist-item{padding:10px 0;border-top:1px solid var(--border);font-size:13px}
      .sv-hist-item:first-child{border-top:none}
      .sv-hist-who{font-weight:600;color:var(--text-primary)}
      .sv-hist-when{color:var(--text-secondary);font-size:11px}
      .sv-hist-change{color:var(--text-secondary);margin-top:2px}
      .sv-hist-reason{color:var(--text-secondary);font-style:italic;margin-top:2px}

      /* Boutons */
      .sv-btn{padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;font-family:inherit;transition:all .15s}
      .sv-btn:disabled{opacity:.5;cursor:not-allowed}
      .sv-btn-primary{background:#3b82f6;color:#fff;border-color:#2563eb}
      .sv-btn-primary:hover:not(:disabled){background:#2563eb}
      .sv-btn-secondary{background:var(--bg-secondary);color:var(--text-secondary);border-color:var(--border)}
      .sv-btn-secondary:hover:not(:disabled){background:var(--border)}
      .sv-btn-danger{background:transparent;color:#dc2626;border-color:#fca5a5}
      .sv-btn-danger:hover:not(:disabled){background:#fef2f2}

      /* Matrices */
      .sv-matrix{overflow-x:auto;background:var(--bg-card);border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      .sv-matrix p{font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5}
      .sv-matrix table{width:100%;border-collapse:collapse}
      .sv-matrix th{background:var(--bg-secondary);padding:10px;text-align:left;font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.8px;border-bottom:2px solid var(--border)}
      .sv-matrix td{padding:10px;border-bottom:1px solid var(--border)}
      .sv-matrix tr:last-child td{border-bottom:none}
      .sv-matrix input[type=number]{width:88px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;text-align:right;background:var(--bg-card);color:var(--text-primary);font-family:inherit}
      .sv-matrix-save{padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:var(--bg-secondary);color:var(--text-secondary);font-family:inherit;transition:all .15s}
      .sv-matrix tr.dirty .sv-matrix-save{background:#3b82f6;color:#fff}
      .sv-matrix tr.dirty .sv-matrix-save:hover{background:#2563eb}

      /* Audit table */
      .sv-audit-table{width:100%;border-collapse:collapse;background:var(--bg-card);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      .sv-audit-table th{background:var(--bg-secondary);padding:10px 14px;text-align:left;font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.8px;border-bottom:2px solid var(--border)}
      .sv-audit-table td{padding:10px 14px;font-size:13px;border-bottom:1px solid var(--border)}
      .sv-audit-table tr:last-child td{border-bottom:none}

      /* Toast */
      #sv-toast{position:fixed;bottom:20px;right:20px;background:#16a34a;color:#fff;padding:12px 20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:1000;font-size:14px;font-weight:600;display:none}
    `;
    document.head.appendChild(s);
  }

  /* â”€â”€ Constantes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const CATEGORY_ORDER = ['sla','compensation','orders','pricing','shipping','parcel','wallet','loyalty','alerting','system'];
  const CATEGORY_ICONS = { sla:'â±ï¸', compensation:'ðŸŽ', orders:'ðŸ›’', pricing:'ðŸ’°', shipping:'ðŸšš', parcel:'ðŸ“¦', wallet:'ðŸ’¼', loyalty:'â­', alerting:'ðŸš¨', system:'âš™ï¸' };
  const CRITICAL_KEYS  = new Set(['MARGE_PCT','FRAIS_STRIPE_PCT','COMMISSION_AGENT_PCT','CANCEL_PARTIAL_REFUND_PCT','EUR_KMF_FALLBACK','AED_KMF_FALLBACK','WALLET_MAX_BALANCE_KMF']);

  /* â”€â”€ Ã‰tat local â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  let _data        = null;   // { rules, taxes, dims }
  let _tab         = 'rules';
  let _search      = '';
  let _editingRule = null;

  /* â”€â”€ Utilitaires â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function _fmtDate(iso) {
    if (!iso) return 'â€”';
    return new Date(iso).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function _fmtVal(v, type) {
    if (type === 'boolean') return v ? 'âœ“ activÃ©' : 'âœ— dÃ©sactivÃ©';
    if (typeof v === 'number') return v.toLocaleString('fr-FR');
    return _esc(String(v == null ? '' : v));
  }
  function _unit(key, type) {
    if (type === 'boolean') return '';
    if (/_DAYS$|DAYS_/.test(key)) return 'jours';
    if (/_HOURS$/.test(key))      return 'heures';
    if (/_KMF$/.test(key))        return 'KMF';
    if (/_PCT$/.test(key))        return '%';
    if (/_KG$/.test(key))         return 'kg';
    if (/_SEC$/.test(key))        return 's';
    return '';
  }
  function _toast(msg) {
    let t = document.getElementById('sv-toast');
    if (!t) { t = document.createElement('div'); t.id = 'sv-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._to);
    t._to = setTimeout(() => { t.style.display = 'none'; }, 3000);
  }

  /* â”€â”€ Rendu principal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  function _render(root) {
    root.innerHTML = `
      <div class="sv-header">
        <div>
          <h2>âš™ï¸ ParamÃ¨tres business</h2>
          <div class="sv-subtitle">Gouvernez les rÃ¨gles mÃ©tier sans redÃ©ploiement</div>
        </div>
      </div>
      <div class="sv-tabs">
        <button class="sv-tab ${_tab==='rules' ?'active':''}" data-tab="rules">ðŸ“‹ RÃ¨gles</button>
        <button class="sv-tab ${_tab==='taxes' ?'active':''}" data-tab="taxes">ðŸ’° Taxes</button>
        <button class="sv-tab ${_tab==='dims'  ?'active':''}" data-tab="dims">ðŸ“ Dimensions</button>
        <button class="sv-tab ${_tab==='audit' ?'active':''}" data-tab="audit">ðŸ“œ Historique</button>
      </div>
      <div id="sv-tab-body"></div>
      <div class="sv-overlay" id="sv-overlay"></div>
      <aside class="sv-panel" id="sv-panel"></aside>
    `;

    root.querySelectorAll('.sv-tab').forEach(btn => {
      btn.addEventListener('click', () => { _tab = btn.dataset.tab; _render(root); });
    });
    root.querySelector('#sv-overlay').addEventListener('click', _closePanel);

    const body = root.querySelector('#sv-tab-body');
    if (_tab === 'rules')  _renderRulesTab(body);
    if (_tab === 'taxes')  _renderTaxesTab(body);
    if (_tab === 'dims')   _renderDimsTab(body);
    if (_tab === 'audit')  _renderAuditTab(body);
  }

  /* â”€â”€ Tab RÃ¨gles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  function _renderRulesTab(container) {
    container.innerHTML = `
      <input type="search" class="sv-search" id="sv-search" placeholder="ðŸ” Rechercher (clÃ©, libellÃ©, description)â€¦" value="${_esc(_search)}">
      <div id="sv-cats"></div>
    `;
    container.querySelector('#sv-search').addEventListener('input', e => {
      _search = e.target.value.trim().toLowerCase();
      _renderCategories(container.querySelector('#sv-cats'));
    });
    _renderCategories(container.querySelector('#sv-cats'));
  }

  function _renderCategories(root) {
    const cats = _data.rules;
    const keys = CATEGORY_ORDER.filter(k => cats[k]).concat(Object.keys(cats).filter(k => !CATEGORY_ORDER.includes(k)));
    let html = '';
    let total = 0;

    for (const k of keys) {
      const cat = cats[k];
      const icon = CATEGORY_ICONS[k] || 'ðŸ“';
      const rules = cat.rules.filter(r => {
        if (!_search) return true;
        return `${r.key} ${r.label_fr||''} ${r.description||''}`.toLowerCase().includes(_search);
      });
      if (rules.length === 0 && _search) continue;
      total += rules.length;
      const expanded = (_search && rules.length) || k === 'sla';
      html += `
        <div class="sv-category ${expanded?'expanded':''}" data-cat="${k}">
          <div class="sv-cat-header">
            <h3><span class="sv-caret"></span>${icon} ${_esc(cat.label||k)}</h3>
            <span class="sv-cat-count">${rules.length}</span>
          </div>
          <div class="sv-cat-rules">
            ${rules.map(r => {
              const crit = CRITICAL_KEYS.has(r.key) ? '<span class="sv-badge-critical">âš ï¸ critique</span>' : '';
              const val  = r.value != null ? r.value : 'â€”';
              const unit = _unit(r.key, r.value_type);
              return `
                <div class="sv-rule" data-key="${r.key}">
                  <div class="sv-rule-info">
                    <div class="sv-rule-key">${r.key}${crit}</div>
                    <div class="sv-rule-label">${_esc(r.label_fr||r.key)}</div>
                  </div>
                  <div class="sv-rule-val">${_fmtVal(val, r.value_type)}${unit?`<span class="sv-rule-unit">${unit}</span>`:''}</div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    if (_search && total === 0) {
      html = `<div class="sv-empty-msg">Aucune rÃ¨gle ne correspond Ã  "${_esc(_search)}"</div>`;
    }

    root.innerHTML = html;
    root.querySelectorAll('.sv-cat-header').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('expanded')));
    root.querySelectorAll('.sv-rule').forEach(el => el.addEventListener('click', () => _openRulePanel(el.dataset.key)));
  }

  /* â”€â”€ Panneau de modification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  async function _openRulePanel(key) {
    const panel   = document.getElementById('sv-panel');
    const overlay = document.getElementById('sv-overlay');
    panel.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Chargementâ€¦</div>';
    panel.classList.add('open');
    overlay.classList.add('open');
    try {
      const data = await global.KmcApi.getSettingRule(key);
      _editingRule = data.rule;
      _renderRulePanel(data.rule, data.history || []);
    } catch (err) {
      panel.innerHTML = `<div style="padding:20px;color:#dc2626">âŒ ${_esc(err.message)}</div>`;
    }
  }

  function _closePanel() {
    document.getElementById('sv-panel').classList.remove('open');
    document.getElementById('sv-overlay').classList.remove('open');
    _editingRule = null;
  }

  function _renderRulePanel(rule, history) {
    const panel   = document.getElementById('sv-panel');
    const curVal  = rule.value?.value ?? '';
    const isCrit  = CRITICAL_KEYS.has(rule.key);
    const unit    = _unit(rule.key, rule.value_type);
    const boundsHint = rule.value_type === 'number' && (rule.min_value != null || rule.max_value != null)
      ? `Min : ${rule.min_value ?? 'â€”'} Â· Max : ${rule.max_value ?? 'â€”'}` : '';

    let inputHtml;
    if (rule.value_type === 'boolean') {
      inputHtml = `<select id="sv-new-val">
        <option value="true"  ${curVal===true ?'selected':''}>ActivÃ©</option>
        <option value="false" ${curVal===false?'selected':''}>DÃ©sactivÃ©</option>
      </select>`;
    } else if (rule.value_type === 'number') {
      inputHtml = `<input type="number" id="sv-new-val" step="any" value="${curVal}">`;
    } else {
      inputHtml = `<input type="text" id="sv-new-val" value="${_esc(String(curVal))}">`;
    }

    panel.innerHTML = `
      <div class="sv-panel-head">
        <div class="sv-panel-key">${rule.key}${isCrit?'<span class="sv-badge-critical">âš ï¸ critique</span>':''}</div>
        <button class="sv-panel-close" id="sv-close">&times;</button>
      </div>
      <div class="sv-panel-body">
        <div class="sv-panel-lbl">${_esc(rule.label_fr||rule.key)}</div>
        <div class="sv-panel-desc">${_esc(rule.description||'Pas de description.')}</div>
        <div class="sv-current-box">
          <div class="sv-current-label">Valeur actuelle</div>
          <div class="sv-current-val">${_fmtVal(curVal, rule.value_type)} ${unit}</div>
          <div class="sv-current-bounds">${boundsHint}</div>
        </div>
        <div class="sv-field"><label for="sv-new-val">Nouvelle valeur</label>${inputHtml}${boundsHint?`<div class="sv-field-hint">${boundsHint}</div>`:''}</div>
        <div class="sv-field">
          <label for="sv-reason">Justification <span style="color:#dc2626">*</span></label>
          <textarea id="sv-reason" placeholder="Minimum 10 caractÃ¨res. Expliquez pourquoi vous modifiez cette rÃ¨gle."></textarea>
          <div class="sv-field-hint">Sera visible dans l'historique.</div>
        </div>
        <div class="sv-field-error" id="sv-error" style="display:none"></div>
        <div class="sv-hist">
          <h4>ðŸ“œ Historique (${history.length})</h4>
          ${history.length===0 ? '<div class="sv-empty-msg" style="padding:12px">Aucune modification.</div>' : ''}
          ${history.map(h => `
            <div class="sv-hist-item">
              <div class="sv-hist-who">${_esc(h.changed_by_name||'SystÃ¨me')}</div>
              <div class="sv-hist-when">${_fmtDate(h.created_at)}</div>
              <div class="sv-hist-change"><span style="color:var(--text-secondary)">${_fmtVal(h.old_value?.value, rule.value_type)}</span> â†’ <strong>${_fmtVal(h.new_value?.value, rule.value_type)}</strong></div>
              ${h.change_reason?`<div class="sv-hist-reason">"${_esc(h.change_reason)}"</div>`:''}
            </div>`).join('')}
        </div>
      </div>
      <div class="sv-panel-foot">
        <button class="sv-btn sv-btn-danger" id="sv-reset" ${history.length===0?'disabled':''}>ðŸ”„ RÃ©initialiser</button>
        <button class="sv-btn sv-btn-secondary" id="sv-cancel">Annuler</button>
        <button class="sv-btn sv-btn-primary" id="sv-save">Valider â–¶</button>
      </div>
    `;

    panel.querySelector('#sv-close').onclick  = _closePanel;
    panel.querySelector('#sv-cancel').onclick = _closePanel;
    panel.querySelector('#sv-save').onclick   = _saveRule;
    panel.querySelector('#sv-reset').onclick  = _resetRule;
  }

  async function _saveRule() {
    if (!_editingRule) return;
    const errEl  = document.getElementById('sv-error');
    errEl.style.display = 'none';
    const rawVal = document.getElementById('sv-new-val').value;
    const reason = document.getElementById('sv-reason').value.trim();

    if (reason.length < 10) {
      errEl.textContent = 'Justification trop courte (minimum 10 caractÃ¨res).';
      errEl.style.display = 'block';
      return;
    }

    let value;
    if (_editingRule.value_type === 'boolean') {
      value = rawVal === 'true';
    } else if (_editingRule.value_type === 'number') {
      value = Number(rawVal);
      if (!Number.isFinite(value)) {
        errEl.textContent = 'Valeur numÃ©rique invalide.';
        errEl.style.display = 'block';
        return;
      }
    } else {
      value = String(rawVal);
    }

    const btn = document.getElementById('sv-save');
    btn.disabled = true; btn.textContent = 'Enregistrementâ€¦';

    try {
      await global.KmcApi.patchSettingRule(_editingRule.key, { value, reason });
      _closePanel();
      const root = document.getElementById('main-content');
      const fresh = await global.KmcApi.getSettings();
      _data.rules = fresh.categories;
      _render(root);
      _toast(`âœ“ RÃ¨gle ${_editingRule.key} mise Ã  jour.`);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Valider â–¶';
    }
  }

  async function _resetRule() {
    if (!_editingRule) return;
    if (!confirm(`Remettre ${_editingRule.key} Ã  sa valeur d'origine ?`)) return;
    try {
      await global.KmcApi.resetSettingRule(_editingRule.key);
      _closePanel();
      const root = document.getElementById('main-content');
      const fresh = await global.KmcApi.getSettings();
      _data.rules = fresh.categories;
      _render(root);
      _toast(`âœ“ RÃ¨gle ${_editingRule.key} remise Ã  zÃ©ro.`);
    } catch (err) { alert('Erreur : ' + err.message); }
  }

  /* â”€â”€ Tab Taxes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  function _renderTaxesTab(container) {
    container.innerHTML = `
      <div class="sv-matrix">
        <p>âš ï¸ <strong>Zone critique</strong> â€” Ces taux impactent directement le calcul de prix de vente. Toute modification s'applique immÃ©diatement. Justification obligatoire.</p>
        <table>
          <thead><tr>
            <th>CatÃ©gorie</th><th>Douane</th><th>TVA</th><th>Taxe add.</th><th>DerniÃ¨re modif</th><th style="text-align:right">Action</th>
          </tr></thead>
          <tbody>
            ${_data.taxes.map(t => `
              <tr data-cat="${t.category}" data-type="taxes">
                <td><strong>${_esc(t.label_fr)}</strong><br><small style="color:var(--text-secondary)">${t.category}</small></td>
                <td><input type="number" step="0.0001" min="0" max="1" value="${t.douane_pct}" data-field="douane_pct"></td>
                <td><input type="number" step="0.0001" min="0" max="1" value="${t.tva_pct}" data-field="tva_pct"></td>
                <td><input type="number" step="0.0001" min="0" max="1" value="${t.taxe_add_pct}" data-field="taxe_add_pct"></td>
                <td style="font-size:11px;color:var(--text-secondary)">${t.updated_at ? _fmtDate(t.updated_at) : 'â€”'}<br>${t.updated_by_name||''}</td>
                <td style="text-align:right"><button class="sv-matrix-save" disabled>ðŸ’¾ Enregistrer</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    _attachMatrixListeners(container);
  }

  /* â”€â”€ Tab Dims â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  function _renderDimsTab(container) {
    container.innerHTML = `
      <div class="sv-matrix">
        <p>ðŸ“ Dimensions standard par catÃ©gorie (L Ã— l Ã— H en cm). UtilisÃ©es pour calculer le volume et le fret.</p>
        <table>
          <thead><tr>
            <th>CatÃ©gorie</th><th>Longueur (cm)</th><th>Largeur (cm)</th><th>Hauteur (cm)</th><th>Volume (cmÂ³)</th><th>DerniÃ¨re modif</th><th style="text-align:right">Action</th>
          </tr></thead>
          <tbody>
            ${_data.dims.map(d => `
              <tr data-cat="${d.category}" data-type="dims">
                <td><strong>${_esc(d.label_fr)}</strong><br><small style="color:var(--text-secondary)">${d.category}</small></td>
                <td><input type="number" step="1" min="1" max="200" value="${d.length_cm}" data-field="length_cm"></td>
                <td><input type="number" step="1" min="1" max="200" value="${d.width_cm}" data-field="width_cm"></td>
                <td><input type="number" step="1" min="1" max="200" value="${d.height_cm}" data-field="height_cm"></td>
                <td style="color:var(--text-secondary)">${(d.length_cm*d.width_cm*d.height_cm).toLocaleString('fr-FR')}</td>
                <td style="font-size:11px;color:var(--text-secondary)">${d.updated_at ? _fmtDate(d.updated_at) : 'â€”'}<br>${d.updated_by_name||''}</td>
                <td style="text-align:right"><button class="sv-matrix-save" disabled>ðŸ’¾ Enregistrer</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    _attachMatrixListeners(container);
  }

  function _attachMatrixListeners(container) {
    container.querySelectorAll('tr[data-cat]').forEach(tr => {
      const inputs  = tr.querySelectorAll('input');
      const saveBtn = tr.querySelector('.sv-matrix-save');
      const originals = {};
      inputs.forEach(i => { originals[i.dataset.field] = i.value; });
      inputs.forEach(i => {
        i.addEventListener('input', () => {
          const dirty = Array.from(inputs).some(inp => inp.value !== originals[inp.dataset.field]);
          tr.classList.toggle('dirty', dirty);
          saveBtn.disabled = !dirty;
        });
      });
      saveBtn.addEventListener('click', () => _saveMatrixRow(tr));
    });
  }

  async function _saveMatrixRow(tr) {
    const type   = tr.dataset.type;
    const cat    = tr.dataset.cat;
    const reason = prompt(`Justification (min 10 car.) pour modifier ${type === 'taxes' ? 'les taxes' : 'les dimensions'} de "${cat}" :`);
    if (!reason || reason.trim().length < 10) { alert('Justification trop courte.'); return; }

    const body = { reason: reason.trim() };
    tr.querySelectorAll('input').forEach(i => { body[i.dataset.field] = Number(i.value); });

    try {
      if (type === 'taxes') {
        await global.KmcApi.putSettingsTaxes(cat, body);
      } else {
        await global.KmcApi.putSettingsDims(cat, body);
      }
      _toast(`âœ“ ${type} de "${cat}" mis Ã  jour.`);
      const fresh = await (type === 'taxes' ? global.KmcApi.getSettingsTaxes() : global.KmcApi.getSettingsDims());
      if (type === 'taxes') _data.taxes = fresh.taxes;
      else                  _data.dims  = fresh.dims;
      _render(document.getElementById('main-content'));
    } catch (err) { alert('Erreur : ' + err.message); }
  }

  /* â”€â”€ Tab Audit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  async function _renderAuditTab(container) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">Chargement de l\'historiqueâ€¦</div>';
    try {
      const data  = await global.KmcApi.getSettingsAudit();
      const items = data.history || [];
      if (!items.length) {
        container.innerHTML = '<div class="sv-empty-msg">Aucune modification enregistrÃ©e.</div>';
        return;
      }
      container.innerHTML = `
        <div style="overflow-x:auto">
          <table class="sv-audit-table">
            <thead><tr>
              <th>Date</th><th>RÃ¨gle</th><th>ModifiÃ© par</th><th>Ancienne</th><th>Nouvelle</th><th>Justification</th>
            </tr></thead>
            <tbody>
              ${items.map(h => `
                <tr>
                  <td style="white-space:nowrap;font-size:11px;color:var(--text-secondary)">${_fmtDate(h.created_at)}</td>
                  <td><strong>${_esc(h.rule_label||h.rule_key)}</strong><br><small style="color:var(--text-secondary)">${_esc(h.rule_key||'')}</small></td>
                  <td>${_esc(h.changed_by_name||'SystÃ¨me')}</td>
                  <td style="color:var(--text-secondary)">${_fmtVal(h.old_value?.value, 'auto')}</td>
                  <td><strong>${_fmtVal(h.new_value?.value, 'auto')}</strong></td>
                  <td style="font-style:italic;color:var(--text-secondary);max-width:240px">${_esc(h.change_reason||'â€”')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      container.innerHTML = `<div style="padding:20px;color:#dc2626">âŒ ${_esc(err.message)}</div>`;
    }
  }

  /* â”€â”€ Point d'entrÃ©e â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  global.SettingsView = async function render(root) {
    _injectStyles();
    root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">âš™ï¸ Chargement des paramÃ¨tresâ€¦</div>';
    try {
      const [rulesData, taxesData, dimsData] = await Promise.all([
        global.KmcApi.getSettings(),
        global.KmcApi.getSettingsTaxes(),
        global.KmcApi.getSettingsDims(),
      ]);
      _data = {
        rules: rulesData.categories,
        taxes: taxesData.taxes,
        dims:  dimsData.dims,
      };
      _render(root);
    } catch (err) {
      root.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626">âŒ ${_esc(err.message)}</div>`;
    }
  };

})(window);

