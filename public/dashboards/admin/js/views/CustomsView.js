/**
 * KOMERCE Dashboard — Vue Douane /admin/customs
 * ═══════════════════════════════════════════════════════════════════════════
 * Migration de CT.views.customs (ct-views-customs.js — 504 lignes)
 *
 * CONCEPT MÉTIER :
 *   En groupage Dubai→Comores, on paye UN montant total de douane pour une
 *   cargaison. Cette vue permet :
 *     1. d'enregistrer chaque envoi dédouané (CIF, droits payés, poids…)
 *     2. de ventiler automatiquement la douane sur les colis de l'envoi
 *        selon la MÉTHODE choisie (valeur, poids, volume, mixte, manuel)
 *     3. de voir le TAUX EFFECTIF TERRAIN (droits/CIF) qui remplace le taux
 *        théorique dans les calculs de marge réelle
 *     4. d'activer/désactiver un envoi pour exclure sa ventilation
 *
 * API :
 *   KmcApi.getCustomsShipments()          → liste des envois
 *   KmcApi.getCustomsRatesEffective()     → taux terrain moyens
 *   KmcApi.getPartnersLogistique()        → transitaires liés
 *   KmcApi.getCustomsShipment(id)         → détail + colis ventilés
 *   KmcApi.createCustomsShipment(body)    → créer un envoi
 *   KmcApi.updateCustomsShipment(id, b)   → mettre à jour
 *   + fetch local pour /deactivate et /activate
 */

(function (global) {
  'use strict';

  /* ── Styles ──────────────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('cv-styles')) return;
    const s = document.createElement('style');
    s.id = 'cv-styles';
    s.textContent = `
      /* Form */
      .cv-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;padding:16px;background:var(--bg-secondary);border-radius:10px;margin-bottom:16px;border:1px solid var(--border)}
      .cv-form label{display:block;font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px}
      .cv-form input,.cv-form select,.cv-form textarea{width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:14px;font-family:inherit;background:var(--bg-card);color:var(--text-primary);box-sizing:border-box}
      .cv-form textarea{min-height:60px;resize:vertical}
      .cv-help{font-size:11px;color:var(--text-secondary);margin-top:2px;font-style:italic;line-height:1.3}
      .cv-form-footer{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px dashed var(--border)}
      /* Method explainer */
      .cv-method-box{grid-column:1/-1;padding:10px 14px;background:#fef9c3;border-left:4px solid #eab308;border-radius:6px;font-size:13px;color:#713f12;line-height:1.5}
      .cv-method-box strong{color:#422006}
      /* Table */
      .cv-table-wrap{overflow-x:auto}
      .cv-table{width:100%;border-collapse:collapse;font-size:13px}
      .cv-table th{background:#1e293b;color:white;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:700}
      .cv-table td{padding:10px 12px;border-bottom:1px solid var(--border)}
      .cv-table tbody tr:hover td{background:var(--bg-secondary);cursor:pointer}
      .cv-table tr.inactive td{opacity:.5;background:var(--bg-secondary)}
      .cv-table tr.selected td{background:#dbeafe!important}
      /* Rate badges */
      .cv-rate{display:inline-block;padding:2px 8px;border-radius:12px;font-weight:700;font-size:12px}
      .cv-rate-low{background:#dcfce7;color:#166534}
      .cv-rate-mid{background:#fef3c7;color:#92400e}
      .cv-rate-high{background:#fee2e2;color:#991b1b}
      /* Toggle */
      .cv-toggle{padding:4px 10px;border-radius:14px;border:none;font-size:11px;font-weight:700;cursor:pointer}
      .cv-toggle-on{background:#10b981;color:white}
      .cv-toggle-off{background:var(--border);color:var(--text-secondary)}
      /* Allocation panel */
      .cv-alloc{margin-top:16px;padding:16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px}
      .cv-alloc h4{margin:0 0 12px;font-size:14px;color:#0c4a6e}
      .cv-alloc table{width:100%;border-collapse:collapse;font-size:12px}
      .cv-alloc th{background:#0c4a6e;color:white;padding:6px 10px;text-align:left}
      .cv-alloc td{padding:6px 10px;border-bottom:1px solid #e0f2fe}
    `;
    document.head.appendChild(s);
  }

  /* ── Méthodes de ventilation (auto-doc) ─────────────────────────────── */
  const METHOD_HELP = {
    by_cif_value: { label: 'Par valeur CIF', hint: 'Par défaut. Douane répartie proportionnellement à la valeur déclarée. Adapté quand les droits sont ad valorem (en % de la valeur).' },
    by_weight:    { label: 'Par poids',      hint: 'Ventilation au prorata du poids de chaque colis. Adapté au fret aérien facturé au kilogramme.' },
    by_volume:    { label: 'Par volume',     hint: 'Prorata du volume (m³). Utile en fret mer où le tarif dépend du volume occupé dans le conteneur.' },
    mixed:        { label: 'Mixte (CIF+poids)', hint: 'Pondération 50/50 CIF+poids par défaut. Pour les cas où ni la valeur ni le poids seul ne reflètent la réalité.' },
    manual:       { label: 'Manuel',         hint: 'Aucune ventilation automatique. Tu saisis la part de douane colis par colis.' },
  };

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function fmt(n)    { return (Number(n) || 0).toLocaleString('fr-FR'); }
  function fmtPct(n) { return (Number(n) || 0).toFixed(1) + '%'; }
  function rateClass(pct) {
    const n = Number(pct) || 0;
    if (n < 15) return 'cv-rate-low';
    if (n <= 25) return 'cv-rate-mid';
    return 'cv-rate-high';
  }

  /* ── Fetch local pour les routes non couvertes par KmcApi ───────────── */
  function _apiPost(path, body) {
    return fetch('/api' + path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => {
      if (!r.ok) return r.text().then(t => { throw new Error(t.slice(0, 200)); });
      return r.json();
    });
  }

  /* ── State ───────────────────────────────────────────────────────────── */
  const state = { shipments: [], rates: null, transitaires: [], selected: null, selectedParcels: [] };

  /* ── Render principal ────────────────────────────────────────────────── */
  function render(container) {
    _injectStyles();
    container.innerHTML = '<div class="kmc-loading">📦 Chargement historique douane…</div>';

    Promise.all([
      global.KmcApi.getCustomsShipments(),
      global.KmcApi.getCustomsRatesEffective(),
      global.KmcApi.getPartnersLogistique().catch(() => []),
    ]).then(([shipmentsResp, ratesResp, transitairesResp]) => {
      state.shipments    = shipmentsResp.shipments || shipmentsResp || [];
      state.rates        = ratesResp.rates || ratesResp || {};
      state.transitaires = Array.isArray(transitairesResp) ? transitairesResp : (transitairesResp.partners || []);
      buildUI(container);
    }).catch(err => {
      container.innerHTML = `<div class="kmc-error">Erreur chargement douane : ${err.message || err}</div>`;
    });
  }

  /* ── UI principale ───────────────────────────────────────────────────── */
  function buildUI(container) {
    const r30  = state.rates.last_30d  || {};
    const r90  = state.rates.last_90d  || {};
    const activeCount = state.shipments.filter(s => s.is_active).length;

    let html = `
      <div class="kmc-view-header">
        <h2>📦 Historique Douane</h2>
        <div class="kmc-subtitle">Envois Dubai→Comores · ventilation automatique · taux terrain réel</div>
      </div>
      <div class="kmc-kpi-grid">
        <div class="kmc-kpi"><div class="kmc-kpi-value">${fmtPct(r30.rate_pct)}</div><div class="kmc-kpi-label">Taux terrain 30j</div></div>
        <div class="kmc-kpi"><div class="kmc-kpi-value">${fmtPct(r90.rate_pct)}</div><div class="kmc-kpi-label">Taux terrain 90j</div></div>
        <div class="kmc-kpi"><div class="kmc-kpi-value">${activeCount} / ${state.shipments.length}</div><div class="kmc-kpi-label">Envois actifs</div></div>
        <div class="kmc-kpi"><div class="kmc-kpi-value">${fmt(r30.total_customs_kmf)}</div><div class="kmc-kpi-label">Douane payée 30j (KMF)</div></div>
      </div>
      <div class="kmc-section-block"><h3>➕ Nouvel envoi</h3>${renderForm()}</div>
      <div class="kmc-section-block"><h3>📋 Historique des envois</h3>${renderTable()}</div>
    `;
    if (state.selected) html += renderAllocPanel();

    container.innerHTML = html;
    wireEvents(container);
  }

  /* ── Formulaire ──────────────────────────────────────────────────────── */
  function renderForm() {
    const today   = new Date().toISOString().slice(0, 10);
    const autoRef = 'CUST-' + today.replace(/-/g, '') + '-' + String(state.shipments.length + 1).padStart(3, '0');

    let html = '<div class="cv-form">';

    html += `<div><label>Référence</label><input id="cv-ref" type="text" value="${autoRef}">
      <div class="cv-help">Identifiant unique de cet envoi</div></div>`;

    html += `<div><label>Date d'envoi</label><input id="cv-date" type="date" value="${today}"></div>`;

    html += '<div><label>Transitaire</label>';
    if (state.transitaires.length) {
      html += '<select id="cv-transit-sel"><option value="">— Aucun —</option>';
      state.transitaires.forEach(t => {
        html += `<option value="${t.id}" data-name="${(t.name || '').replace(/"/g, '&quot;')}">${t.name || '?'}${t.country_label ? ' (' + t.country_label + ')' : ''}</option>`;
      });
      html += '<option value="__custom__">+ Autre (saisie libre)…</option></select>';
      html += '<input id="cv-transit" type="text" placeholder="ex: Ahmed Dubai" style="display:none;margin-top:6px">';
      html += '<div class="cv-help">Pour gérer la liste : <strong>Fournisseurs → Logistique</strong></div>';
    } else {
      html += '<input id="cv-transit" type="text" placeholder="ex: Ahmed Dubai">';
      html += '<div class="cv-help">Aucun transitaire enregistré. Créer dans <strong>Fournisseurs → Logistique</strong></div>';
    }
    html += '</div>';

    html += `<div><label>Mode transport</label>
      <select id="cv-mode"><option value="">—</option>
        <option value="sea">🚢 Mer (groupage)</option>
        <option value="air">✈️ Air</option>
        <option value="land">🚚 Route</option>
      </select></div>`;

    html += `<div><label>Valeur CIF totale (KMF)</label>
      <input id="cv-cif" type="number" min="0" step="1" placeholder="ex: 2500000">
      <div class="cv-help">Somme déclarée en douane (Cost + Insurance + Freight)</div></div>`;

    html += `<div><label>Droits payés (KMF)</label>
      <input id="cv-paid" type="number" min="0" step="1" placeholder="ex: 400000">
      <div class="cv-help">Montant total effectivement payé à la douane</div></div>`;

    html += `<div><label>Fret (KMF, optionnel)</label>
      <input id="cv-freight" type="number" min="0" step="1" placeholder="ex: 150000"></div>`;

    html += `<div><label>Poids total (kg)</label>
      <input id="cv-weight" type="number" min="0" step="0.1" placeholder="ex: 60"></div>`;

    html += `<div><label>Nombre de colis</label>
      <input id="cv-nb" type="number" min="1" step="1" placeholder="ex: 12"></div>`;

    html += '<div style="grid-column:1/-1"><label>Méthode de ventilation</label><select id="cv-method">';
    Object.keys(METHOD_HELP).forEach(k => {
      html += `<option value="${k}"${k === 'by_cif_value' ? ' selected' : ''}>${METHOD_HELP[k].label}</option>`;
    });
    html += '</select>';
    html += `<div class="cv-method-box" id="cv-method-box"><strong>${METHOD_HELP.by_cif_value.label}</strong> — ${METHOD_HELP.by_cif_value.hint}</div></div>`;

    html += `<div style="grid-column:1/-1"><label>Notes</label>
      <textarea id="cv-notes" placeholder="ex: Inspection OK, délai douane 4j…"></textarea></div>`;

    html += `<div class="cv-form-footer">
      <button class="kmc-btn kmc-btn-secondary" id="cv-reset">Réinitialiser</button>
      <button class="kmc-btn kmc-btn-primary" id="cv-submit">Enregistrer l'envoi</button>
    </div></div>`;

    return html;
  }

  /* ── Table historique ────────────────────────────────────────────────── */
  function renderTable() {
    if (!state.shipments.length) {
      return '<div class="kmc-empty">Aucun envoi enregistré. Crée le premier ci-dessus ☝️</div>';
    }
    let html = '<div class="cv-table-wrap"><table class="cv-table"><thead><tr>';
    html += '<th>Date</th><th>Référence</th><th>Transitaire</th>';
    html += '<th>CIF (KMF)</th><th>Douane (KMF)</th><th>Taux</th>';
    html += '<th>Méthode</th><th>Colis</th><th>État</th><th></th>';
    html += '</tr></thead><tbody>';

    state.shipments.forEach(s => {
      const cls = (!s.is_active ? 'inactive' : '') + (state.selected && state.selected.id === s.id ? ' selected' : '');
      const method = (METHOD_HELP[s.allocation_method] || {}).label || s.allocation_method || '—';
      const date   = s.shipment_date ? String(s.shipment_date).slice(0, 10) : '—';
      html += `<tr class="${cls}" data-sid="${s.id}">
        <td>${date}</td>
        <td><strong>${s.reference || '—'}</strong></td>
        <td>${s.transitaire_name || '—'}</td>
        <td>${fmt(s.cif_value_kmf)}</td>
        <td>${fmt(s.customs_paid_kmf)}</td>
        <td><span class="cv-rate ${rateClass(s.effective_rate_pct)}">${fmtPct(s.effective_rate_pct)}</span></td>
        <td style="font-size:11px;color:var(--text-secondary)">${method}</td>
        <td>${s.nb_parcels_linked || 0}/${s.nb_parcels || '?'}</td>
        <td>${s.is_active
          ? `<button class="cv-toggle cv-toggle-on" data-action="deactivate" data-sid="${s.id}">● Actif</button>`
          : `<button class="cv-toggle cv-toggle-off" data-action="activate" data-sid="${s.id}">○ Inactif</button>`
        }</td>
        <td><button class="kmc-btn kmc-btn-secondary" data-action="view" data-sid="${s.id}" style="font-size:11px;padding:4px 8px">👁 Détails</button></td>
      </tr>`;
    });

    html += '</tbody></table></div>';
    return html;
  }

  /* ── Panel ventilation ───────────────────────────────────────────────── */
  function renderAllocPanel() {
    const s = state.selected;
    const parcels = state.selectedParcels;

    let html = `<div class="cv-alloc">
      <h4>🧮 Ventilation de l'envoi ${s.reference || ''}</h4>
      <div style="margin-bottom:10px;font-size:13px;color:#0c4a6e">
        Méthode : <strong>${(METHOD_HELP[s.allocation_method] || {}).label || s.allocation_method}</strong> ·
        Total : <strong>${fmt(s.customs_paid_kmf)} KMF</strong>
        ${!s.is_active ? ' · <span style="color:#dc2626;font-weight:700">⚠️ Envoi désactivé</span>' : ''}
      </div>`;

    if (!parcels.length) {
      html += '<div class="kmc-empty" style="padding:24px">Aucun colis ventilé pour cet envoi.</div>';
    } else {
      html += '<table><thead><tr><th>Colis</th><th>Commande</th><th>CIF colis</th><th>Poids</th><th>Part douane (KMF)</th><th>Méthode</th></tr></thead><tbody>';
      parcels.forEach(p => {
        html += `<tr>
          <td><strong>${p.parcel_ref || String(p.parcel_id).slice(0, 8)}</strong></td>
          <td>${p.order_ref || '—'}${p.client_name ? ' · ' + p.client_name : ''}</td>
          <td>${fmt(p.parcel_cif_kmf)}</td>
          <td>${p.parcel_weight_kg ? Number(p.parcel_weight_kg).toFixed(2) + ' kg' : '—'}</td>
          <td><strong>${fmt(p.customs_share_kmf)}</strong></td>
          <td style="font-size:11px;color:var(--text-secondary)">${p.allocation_basis || '—'}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }

    html += `<div style="margin-top:12px;display:flex;justify-content:flex-end">
      <button class="kmc-btn kmc-btn-secondary" data-action="close-detail">Fermer</button>
    </div></div>`;
    return html;
  }

  /* ── Événements ──────────────────────────────────────────────────────── */
  function wireEvents(container) {
    const methodSel = container.querySelector('#cv-method');
    const methodBox = container.querySelector('#cv-method-box');
    if (methodSel && methodBox) {
      methodSel.addEventListener('change', () => {
        const m = METHOD_HELP[methodSel.value] || METHOD_HELP.by_cif_value;
        methodBox.innerHTML = `<strong>${m.label}</strong> — ${m.hint}`;
      });
    }

    const transitSel = container.querySelector('#cv-transit-sel');
    const transitInput = container.querySelector('#cv-transit');
    if (transitSel && transitInput) {
      transitSel.addEventListener('change', () => {
        transitInput.style.display = transitSel.value === '__custom__' ? 'block' : 'none';
        if (transitSel.value !== '__custom__') transitInput.value = '';
        else transitInput.focus();
      });
    }

    const resetBtn = container.querySelector('#cv-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => render(container));

    const submitBtn = container.querySelector('#cv-submit');
    if (submitBtn) submitBtn.addEventListener('click', () => submitNewShipment(container));

    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const { action, sid } = btn.dataset;
        if (action === 'deactivate') handleDeactivate(sid, container);
        else if (action === 'activate') handleActivate(sid, container);
        else if (action === 'view') handleView(sid, container);
        else if (action === 'close-detail') { state.selected = null; state.selectedParcels = []; buildUI(container); }
      });
    });

    container.querySelectorAll('.cv-table tbody tr').forEach(tr => {
      tr.addEventListener('click', () => handleView(tr.dataset.sid, container));
    });
  }

  /* ── Handlers ────────────────────────────────────────────────────────── */
  function submitNewShipment(container) {
    const g = id => container.querySelector('#' + id);
    let supplierId = null, transitaireName = '';
    const sel = g('cv-transit-sel');
    if (sel) {
      if (sel.value && sel.value !== '__custom__') {
        supplierId = sel.value;
        transitaireName = sel.options[sel.selectedIndex].dataset.name || '';
      } else if (sel.value === '__custom__') {
        transitaireName = (g('cv-transit') || {}).value?.trim() || '';
      }
    } else {
      transitaireName = (g('cv-transit') || {}).value?.trim() || '';
    }

    const body = {
      reference:         g('cv-ref').value.trim(),
      shipment_date:     g('cv-date').value,
      supplier_id:       supplierId,
      transitaire_name:  transitaireName,
      transport_mode:    g('cv-mode').value || null,
      cif_value_kmf:     parseFloat(g('cv-cif').value) || 0,
      customs_paid_kmf:  parseFloat(g('cv-paid').value) || 0,
      freight_kmf:       parseFloat(g('cv-freight').value) || null,
      total_weight_kg:   parseFloat(g('cv-weight').value) || null,
      nb_parcels:        parseInt(g('cv-nb').value, 10) || null,
      allocation_method: g('cv-method').value,
      notes:             g('cv-notes').value.trim(),
      parcel_ids: [],
    };

    if (!body.reference || !body.shipment_date || !body.cif_value_kmf || !body.customs_paid_kmf) {
      alert('❌ Champs requis : référence, date, CIF, droits payés');
      return;
    }

    global.KmcApi.createCustomsShipment(body)
      .then(() => render(container))
      .catch(err => alert('❌ Erreur : ' + (err.message || err)));
  }

  function handleDeactivate(sid, container) {
    const reason = prompt('Raison de la désactivation (optionnel) :\n\nLa ventilation sera retirée des colis liés.');
    if (reason === null) return;
    _apiPost('/admin/customs-shipments/' + sid + '/deactivate', { reason: reason || null })
      .then(r => { alert('✅ ' + (r.message || 'Envoi désactivé')); render(container); })
      .catch(err => alert('❌ ' + (err.message || err)));
  }

  function handleActivate(sid, container) {
    if (!confirm('Réactiver cet envoi ?\n\nLa ventilation sera recalculée pour les colis liés.')) return;
    _apiPost('/admin/customs-shipments/' + sid + '/activate', { parcel_ids: [] })
      .then(r => { alert('✅ ' + (r.message || 'Envoi réactivé')); render(container); })
      .catch(err => alert('❌ ' + (err.message || err)));
  }

  function handleView(sid, container) {
    global.KmcApi.getCustomsShipment(sid)
      .then(r => {
        state.selected      = r.shipment || r;
        state.selectedParcels = r.parcels || [];
        buildUI(container);
        setTimeout(() => {
          const panel = container.querySelector('.cv-alloc');
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      })
      .catch(err => alert('❌ ' + (err.message || err)));
  }

  /* ── Enregistrement ──────────────────────────────────────────────────── */
  function CustomsView() {
    this.render = function (container) { render(container); };
  }

  global.CustomsView = CustomsView;

})(window);
