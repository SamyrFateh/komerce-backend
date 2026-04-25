/* ═══════════════════════════════════════════════════════════════════════════
   CT View — Historique Douane (Customs Shipments)
   Shell: CT · Section: finance / pilotage

   CONCEPT MÉTIER:
   ────────────────
   En groupage Dubai→Comores, tu payes UN montant total de douane pour une
   cargaison. Cette vue te permet :
     1. d'enregistrer chaque envoi dédouané (CIF, droits payés, poids, etc.)
     2. de ventiler automatiquement la douane sur les colis de l'envoi
        selon une MÉTHODE de ton choix (valeur, poids, volume, mixte, manuel)
     3. de voir le TAUX EFFECTIF TERRAIN (droits/CIF) qui remplace le taux
        officiel théorique dans les calculs de marge réelle
     4. d'activer/désactiver un envoi pour l'exclure des stats ET retirer
        sa ventilation des colis (marges recalculées) — utile quand les
        taux de douane changent

   L'interface documente elle-même chaque méthode (tooltips explicatifs)
   pour que le choix reste compréhensible dans 6 mois.
   ═══════════════════════════════════════════════════════════════════════════ */

window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.customs = function(main) {
  // ── Styles injectés une fois ──────────────────────────────────────────────
  (function injectStyles() {
    if (document.getElementById('ct-customs-styles')) return;
    var style = document.createElement('style');
    style.id = 'ct-customs-styles';
    style.textContent = [
      /* Form */
      '.cust-form { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; padding:16px; background:#f8fafc; border-radius:10px; margin-bottom:16px; border:1px solid #e2e8f0; }',
      '.cust-form label { display:block; font-size:11px; font-weight:700; color:#475569; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.3px; }',
      '.cust-form input, .cust-form select, .cust-form textarea { width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:14px; font-family:inherit; }',
      '.cust-form textarea { min-height:60px; resize:vertical; }',
      '.cust-form .cust-help { font-size:11px; color:#64748b; margin-top:2px; font-style:italic; line-height:1.3; }',
      '.cust-form-footer { grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px; padding-top:8px; border-top:1px dashed #cbd5e1; }',

      /* Method explainer */
      '.cust-method-box { grid-column:1/-1; padding:10px 14px; background:#fef9c3; border-left:4px solid #eab308; border-radius:6px; font-size:13px; color:#713f12; line-height:1.5; }',
      '.cust-method-box strong { color:#422006; }',

      /* History table */
      '.cust-history { overflow-x:auto; }',
      '.cust-history table { width:100%; border-collapse:collapse; font-size:13px; }',
      '.cust-history th { background:#1e293b; color:white; padding:10px 12px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; font-weight:700; }',
      '.cust-history td { padding:10px 12px; border-bottom:1px solid #e2e8f0; }',
      '.cust-history tr:hover td { background:#f8fafc; cursor:pointer; }',
      '.cust-history tr.inactive td { opacity:0.5; background:#fafafa; }',
      '.cust-history tr.selected td { background:#dbeafe !important; }',

      /* Rate badges */
      '.cust-rate-badge { display:inline-block; padding:2px 8px; border-radius:12px; font-weight:700; font-size:12px; }',
      '.cust-rate-low  { background:#dcfce7; color:#166534; }',  /* < 15% */
      '.cust-rate-mid  { background:#fef3c7; color:#92400e; }',  /* 15-25% */
      '.cust-rate-high { background:#fee2e2; color:#991b1b; }',  /* > 25% */

      /* Toggle button */
      '.cust-toggle { padding:4px 10px; border-radius:14px; border:none; font-size:11px; font-weight:700; cursor:pointer; }',
      '.cust-toggle-on  { background:#10b981; color:white; }',
      '.cust-toggle-off { background:#e2e8f0; color:#475569; }',

      /* Allocation panel */
      '.cust-alloc-panel { margin-top:16px; padding:16px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:10px; }',
      '.cust-alloc-panel h4 { margin:0 0 12px; font-size:14px; color:#0c4a6e; }',
      '.cust-alloc-panel table { width:100%; border-collapse:collapse; font-size:12px; }',
      '.cust-alloc-panel th { background:#0c4a6e; color:white; padding:6px 10px; text-align:left; }',
      '.cust-alloc-panel td { padding:6px 10px; border-bottom:1px solid #e0f2fe; }',
    ].join('\n');
    document.head.appendChild(style);
  })();

  // ── Auto-documentation des méthodes de ventilation ────────────────────────
  var METHOD_HELP = {
    by_cif_value: {
      label: 'Par valeur CIF',
      hint:  'Par défaut. La douane est répartie proportionnellement à la valeur déclarée de chaque colis. Adapté quand les droits sont ad valorem (en % de la valeur).',
    },
    by_weight: {
      label: 'Par poids',
      hint:  'La douane est répartie au prorata du poids de chaque colis. Adapté au fret aérien facturé au kilogramme, ou quand les droits dépendent du poids plutôt que de la valeur.',
    },
    by_volume: {
      label: 'Par volume',
      hint:  'Ventilation au prorata du volume (m³) de chaque colis. Utile en fret mer où le tarif dépend du volume occupé dans le conteneur.',
    },
    mixed: {
      label: 'Mixte (CIF + poids)',
      hint:  'Pondération 50/50 CIF+poids par défaut, ajustable. Pour les cas complexes où ni la valeur ni le poids seul ne reflètent la réalité.',
    },
    manual: {
      label: 'Manuel',
      hint:  'Aucune ventilation automatique. Tu saisis la part de douane colis par colis. À utiliser uniquement pour les cas exceptionnels.',
    },
  };

  function fmt(n) { return (Number(n) || 0).toLocaleString('fr-FR'); }
  function fmtPct(n) { return (Number(n) || 0).toFixed(1) + '%'; }

  function rateClass(pct) {
    var n = Number(pct) || 0;
    if (n < 15) return 'cust-rate-low';
    if (n <= 25) return 'cust-rate-mid';
    return 'cust-rate-high';
  }

  // ── State local ───────────────────────────────────────────────────────────
  var state = {
    shipments: [],
    rates: null,
    transitaires: [],  // partners partner_type='logistique'
    selected: null,
    selectedParcels: [],
  };

  // ── Render principal ──────────────────────────────────────────────────────
  render();

  function render() {
    main.innerHTML = '<div class="ct-loading">📦 Chargement historique douane…</div>';

    Promise.all([
      CT.api.get('/api/admin/customs-shipments'),
      CT.api.get('/api/admin/customs-shipments/rates/effective'),
      CT.api.get('/api/admin/partners?type=logistique&active=true').catch(function() { return []; }),
    ]).then(function(results) {
      state.shipments = results[0].shipments || [];
      state.rates = results[1].rates || {};
      state.transitaires = Array.isArray(results[2]) ? results[2] : [];
      buildUI();
    }).catch(function(err) {
      main.innerHTML = '<div class="ct-error">Erreur : ' + (err.message || err) + '</div>';
    });
  }

  function buildUI() {
    var html = '';

    /* ═══ Header ═══ */
    html += '<div class="ct-view-header">';
    html += '<h2>📦 Historique Douane</h2>';
    html += '<div class="ct-subtitle">Envois Dubai→Comores · ventilation automatique · taux terrain réel</div>';
    html += '</div>';

    /* ═══ KPI : taux terrain moyens ═══ */
    var r30  = state.rates.last_30d  || {};
    var r90  = state.rates.last_90d  || {};
    var r365 = state.rates.last_365d || {};
    var activeCount = state.shipments.filter(function(s) { return s.is_active; }).length;

    html += '<div class="ct-kpi-grid">';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">📊</div><div>';
    html += '<div class="ct-kpi-value">' + fmtPct(r30.rate_pct) + '</div>';
    html += '<div class="ct-kpi-label">Taux terrain 30j <span data-nature="calculated"></span></div>';
    html += '</div></div>';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">📈</div><div>';
    html += '<div class="ct-kpi-value">' + fmtPct(r90.rate_pct) + '</div>';
    html += '<div class="ct-kpi-label">Taux terrain 90j <span data-nature="calculated"></span></div>';
    html += '</div></div>';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">✅</div><div>';
    html += '<div class="ct-kpi-value">' + activeCount + ' / ' + state.shipments.length + '</div>';
    html += '<div class="ct-kpi-label">Envois actifs</div>';
    html += '</div></div>';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">💰</div><div>';
    html += '<div class="ct-kpi-value">' + fmt(r30.total_customs_kmf) + '</div>';
    html += '<div class="ct-kpi-label">Douane payée 30j (KMF)</div>';
    html += '</div></div>';

    html += '</div>';

    /* ═══ Formulaire Nouvel envoi ═══ */
    html += '<div class="ct-section-block">';
    html += '<h3>➕ Nouvel envoi</h3>';
    html += renderForm();
    html += '</div>';

    /* ═══ Tableau historique ═══ */
    html += '<div class="ct-section-block">';
    html += '<h3>📋 Historique des envois</h3>';
    html += renderHistoryTable();
    html += '</div>';

    /* ═══ Panel ventilation (si sélection) ═══ */
    if (state.selected) {
      html += renderAllocationPanel();
    }

    main.innerHTML = html;
    wireEvents();
  }

  function renderForm() {
    var today = new Date().toISOString().slice(0, 10);
    var autoRef = 'CUST-' + today.replace(/-/g, '') + '-' + String(state.shipments.length + 1).padStart(3, '0');

    var html = '<div class="cust-form">';

    html += '<div><label>Référence</label>';
    html += '<input id="cust-ref" type="text" value="' + autoRef + '">';
    html += '<div class="cust-help">Identifiant unique de cet envoi</div></div>';

    html += '<div><label>Date d\'envoi</label>';
    html += '<input id="cust-date" type="date" value="' + today + '"></div>';

    html += '<div><label>Transitaire</label>';
    if (state.transitaires.length > 0) {
      html += '<select id="cust-transit-select">';
      html += '<option value="">— Aucun —</option>';
      state.transitaires.forEach(function(t) {
        html += '<option value="' + t.id + '" data-name="' + (t.name || '').replace(/"/g, '&quot;') + '">';
        html += (t.name || '?');
        if (t.country_label) html += ' (' + t.country_label + ')';
        html += '</option>';
      });
      html += '<option value="__custom__">+ Autre (saisie libre)…</option>';
      html += '</select>';
      html += '<input id="cust-transit" type="text" placeholder="ex: Ahmed Dubai" style="display:none;margin-top:6px">';
      html += '<div class="cust-help">Choisis dans la liste des transitaires logistiques. <strong>Pour gérer la liste : Fournisseurs → Logistique</strong></div>';
    } else {
      html += '<input id="cust-transit" type="text" placeholder="ex: Ahmed Dubai">';
      html += '<div class="cust-help">Aucun transitaire enregistré. <strong>Tu peux créer une fiche dans Fournisseurs → Logistique</strong> pour réutiliser le contact ensuite.</div>';
    }
    html += '</div>';

    html += '<div><label>Mode transport</label>';
    html += '<select id="cust-mode">';
    html += '<option value="">—</option>';
    html += '<option value="sea">🚢 Mer (groupage)</option>';
    html += '<option value="air">✈️ Air</option>';
    html += '<option value="land">🚚 Route</option>';
    html += '</select></div>';

    html += '<div><label>Valeur CIF totale (KMF)</label>';
    html += '<input id="cust-cif" type="number" min="0" step="1" placeholder="ex: 2500000">';
    html += '<div class="cust-help">Somme déclarée en douane (Cost + Insurance + Freight)</div></div>';

    html += '<div><label>Droits payés (KMF)</label>';
    html += '<input id="cust-paid" type="number" min="0" step="1" placeholder="ex: 400000">';
    html += '<div class="cust-help">Montant total effectivement payé à la douane</div></div>';

    html += '<div><label>Fret (KMF, optionnel)</label>';
    html += '<input id="cust-freight" type="number" min="0" step="1" placeholder="ex: 150000"></div>';

    html += '<div><label>Poids total (kg)</label>';
    html += '<input id="cust-weight" type="number" min="0" step="0.1" placeholder="ex: 60"></div>';

    html += '<div><label>Nombre de colis</label>';
    html += '<input id="cust-nb" type="number" min="1" step="1" placeholder="ex: 12"></div>';

    /* Méthode de ventilation avec auto-doc */
    html += '<div style="grid-column:1/-1"><label>Méthode de ventilation</label>';
    html += '<select id="cust-method">';
    Object.keys(METHOD_HELP).forEach(function(k) {
      var m = METHOD_HELP[k];
      var sel = k === 'by_cif_value' ? ' selected' : '';
      html += '<option value="' + k + '"' + sel + '>' + m.label + '</option>';
    });
    html += '</select>';
    html += '<div class="cust-method-box" id="cust-method-box">';
    html += '<strong>' + METHOD_HELP.by_cif_value.label + '</strong> — ' + METHOD_HELP.by_cif_value.hint;
    html += '</div>';
    html += '</div>';

    html += '<div style="grid-column:1/-1"><label>Notes</label>';
    html += '<textarea id="cust-notes" placeholder="ex: Inspection OK, délai douane 4j, taux plus bas que d\'habitude grâce à nouveau transitaire"></textarea>';
    html += '<div class="cust-help">Contexte utile (anomalies, négociations, circonstances particulières…)</div></div>';

    html += '<div class="cust-form-footer">';
    html += '<button class="ct-btn ct-btn-secondary" id="cust-reset">Réinitialiser</button>';
    html += '<button class="ct-btn ct-btn-primary" id="cust-submit">Enregistrer l\'envoi</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderHistoryTable() {
    if (!state.shipments.length) {
      return '<div class="ct-empty">Aucun envoi enregistré. Crée le premier ci-dessus ☝️</div>';
    }

    var html = '<div class="cust-history"><table><thead><tr>';
    html += '<th>Date</th><th>Référence</th><th>Transitaire</th>';
    html += '<th>CIF (KMF)</th><th>Douane (KMF)</th><th>Taux</th>';
    html += '<th>Méthode</th><th>Colis</th><th>État</th><th></th>';
    html += '</tr></thead><tbody>';

    state.shipments.forEach(function(s) {
      var cls = (!s.is_active ? 'inactive' : '') + (state.selected && state.selected.id === s.id ? ' selected' : '');
      var method = (METHOD_HELP[s.allocation_method] || {}).label || s.allocation_method;
      var dateShort = s.shipment_date ? String(s.shipment_date).slice(0, 10) : '—';

      html += '<tr class="' + cls + '" data-sid="' + s.id + '">';
      html += '<td>' + dateShort + '</td>';
      html += '<td><strong>' + (s.reference || '—') + '</strong></td>';
      html += '<td>' + (s.transitaire_name || '—') + '</td>';
      html += '<td>' + fmt(s.cif_value_kmf) + '</td>';
      html += '<td>' + fmt(s.customs_paid_kmf) + '</td>';
      html += '<td><span class="cust-rate-badge ' + rateClass(s.effective_rate_pct) + '">' + fmtPct(s.effective_rate_pct) + '</span></td>';
      html += '<td style="font-size:11px;color:#64748b">' + method + '</td>';
      html += '<td>' + (s.nb_parcels_linked || 0) + '/' + (s.nb_parcels || '?') + '</td>';
      html += '<td>';
      if (s.is_active) {
        html += '<button class="cust-toggle cust-toggle-on" data-action="deactivate" data-sid="' + s.id + '" title="Envoi actif — cliquer pour retirer du calcul">● Actif</button>';
      } else {
        html += '<button class="cust-toggle cust-toggle-off" data-action="activate" data-sid="' + s.id + '" title="Envoi désactivé — cliquer pour réintégrer">○ Inactif</button>';
      }
      html += '</td>';
      html += '<td><button class="ct-btn ct-btn-secondary" data-action="view" data-sid="' + s.id + '" style="font-size:11px;padding:4px 8px">👁 Détails</button></td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  function renderAllocationPanel() {
    var s = state.selected;
    var parcels = state.selectedParcels;

    var html = '<div class="cust-alloc-panel">';
    html += '<h4>🧮 Ventilation de l\'envoi ' + (s.reference || '') + '</h4>';

    html += '<div style="margin-bottom:10px;font-size:13px;color:#0c4a6e">';
    html += 'Méthode: <strong>' + ((METHOD_HELP[s.allocation_method] || {}).label || s.allocation_method) + '</strong> · ';
    html += 'Total à ventiler: <strong>' + fmt(s.customs_paid_kmf) + ' KMF</strong>';
    if (!s.is_active) {
      html += ' · <span style="color:#dc2626;font-weight:700">⚠️ Envoi désactivé — ventilation retirée</span>';
    }
    html += '</div>';

    if (!parcels.length) {
      html += '<div class="ct-empty" style="padding:24px">Aucun colis ventilé pour cet envoi.</div>';
    } else {
      html += '<table><thead><tr>';
      html += '<th>Colis</th><th>Commande</th><th>CIF colis</th><th>Poids</th>';
      html += '<th>Part douane (KMF)</th><th>Méthode</th>';
      html += '</tr></thead><tbody>';
      parcels.forEach(function(p) {
        html += '<tr>';
        html += '<td><strong>' + (p.parcel_ref || p.parcel_id.slice(0, 8)) + '</strong></td>';
        html += '<td>' + (p.order_ref || '—') + (p.client_name ? ' · ' + p.client_name : '') + '</td>';
        html += '<td>' + fmt(p.parcel_cif_kmf) + '</td>';
        html += '<td>' + (p.parcel_weight_kg ? Number(p.parcel_weight_kg).toFixed(2) + ' kg' : '—') + '</td>';
        html += '<td><strong>' + fmt(p.customs_share_kmf) + '</strong></td>';
        html += '<td style="font-size:11px;color:#64748b">' + (p.allocation_basis || '—') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div style="margin-top:12px;display:flex;justify-content:flex-end">';
    html += '<button class="ct-btn ct-btn-secondary" data-action="close-detail">Fermer</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function wireEvents() {
    // Méthode select : update du bloc d'aide
    var methodSel = document.getElementById('cust-method');
    var methodBox = document.getElementById('cust-method-box');
    if (methodSel && methodBox) {
      methodSel.addEventListener('change', function() {
        var m = METHOD_HELP[methodSel.value] || METHOD_HELP.by_cif_value;
        methodBox.innerHTML = '<strong>' + m.label + '</strong> — ' + m.hint;
      });
    }

    // Transitaire select : afficher input de saisie libre si "Autre"
    var transitSel = document.getElementById('cust-transit-select');
    var transitInput = document.getElementById('cust-transit');
    if (transitSel && transitInput) {
      transitSel.addEventListener('change', function() {
        if (transitSel.value === '__custom__') {
          transitInput.style.display = 'block';
          transitInput.focus();
        } else {
          transitInput.style.display = 'none';
          transitInput.value = '';
        }
      });
    }

    // Reset
    var resetBtn = document.getElementById('cust-reset');
    if (resetBtn) resetBtn.addEventListener('click', function() { render(); });

    // Submit nouvel envoi
    var submitBtn = document.getElementById('cust-submit');
    if (submitBtn) submitBtn.addEventListener('click', submitNewShipment);

    // Actions sur les lignes
    main.querySelectorAll('[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var action = btn.dataset.action;
        var sid = btn.dataset.sid;
        if (action === 'deactivate') handleDeactivate(sid);
        else if (action === 'activate') handleActivate(sid);
        else if (action === 'view') handleView(sid);
        else if (action === 'close-detail') { state.selected = null; state.selectedParcels = []; buildUI(); }
      });
    });

    // Clic sur ligne → détails
    main.querySelectorAll('.cust-history tbody tr').forEach(function(tr) {
      tr.addEventListener('click', function() {
        var sid = tr.dataset.sid;
        handleView(sid);
      });
    });
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  function submitNewShipment() {
    // Résoudre le transitaire : soit un partner_id (select), soit du texte libre
    var supplierId = null;
    var transitaireName = '';
    var sel = document.getElementById('cust-transit-select');
    if (sel) {
      var v = sel.value;
      if (v && v !== '__custom__') {
        supplierId = v;
        var opt = sel.options[sel.selectedIndex];
        transitaireName = opt.dataset.name || '';
      } else if (v === '__custom__') {
        var freeInput = document.getElementById('cust-transit');
        transitaireName = freeInput ? freeInput.value.trim() : '';
      }
    } else {
      var directInput = document.getElementById('cust-transit');
      transitaireName = directInput ? directInput.value.trim() : '';
    }

    var body = {
      reference:         document.getElementById('cust-ref').value.trim(),
      shipment_date:     document.getElementById('cust-date').value,
      supplier_id:       supplierId,
      transitaire_name:  transitaireName,
      transport_mode:    document.getElementById('cust-mode').value || null,
      cif_value_kmf:     parseFloat(document.getElementById('cust-cif').value) || 0,
      customs_paid_kmf:  parseFloat(document.getElementById('cust-paid').value) || 0,
      freight_kmf:       parseFloat(document.getElementById('cust-freight').value) || null,
      total_weight_kg:   parseFloat(document.getElementById('cust-weight').value) || null,
      nb_parcels:        parseInt(document.getElementById('cust-nb').value, 10) || null,
      allocation_method: document.getElementById('cust-method').value,
      notes:             document.getElementById('cust-notes').value.trim(),
      parcel_ids:        [],  // TODO: sélecteur de colis dans v1.1
    };

    if (!body.reference || !body.shipment_date || !body.cif_value_kmf || !body.customs_paid_kmf) {
      alert('❌ Champs requis manquants : référence, date, CIF, droits payés');
      return;
    }

    CT.api.post('/api/admin/customs-shipments', body).then(function() {
      render();
    }).catch(function(err) {
      alert('❌ Erreur : ' + (err.message || err));
    });
  }

  function handleDeactivate(sid) {
    var reason = prompt('Raison de la désactivation (optionnel) :\n\nLa ventilation sera retirée des colis liés et les marges recalculées.');
    if (reason === null) return;  // cancel
    CT.api.post('/api/admin/customs-shipments/' + sid + '/deactivate', { reason: reason || null })
      .then(function(r) {
        alert('✅ ' + (r.message || 'Envoi désactivé'));
        render();
      })
      .catch(function(err) { alert('❌ ' + (err.message || err)); });
  }

  function handleActivate(sid) {
    if (!confirm('Réactiver cet envoi ?\n\nLa ventilation sera recalculée pour les colis liés.')) return;
    CT.api.post('/api/admin/customs-shipments/' + sid + '/activate', { parcel_ids: [] })
      .then(function(r) {
        alert('✅ ' + (r.message || 'Envoi réactivé'));
        render();
      })
      .catch(function(err) { alert('❌ ' + (err.message || err)); });
  }

  function handleView(sid) {
    CT.api.get('/api/admin/customs-shipments/' + sid).then(function(r) {
      state.selected = r.shipment;
      state.selectedParcels = r.parcels || [];
      buildUI();
      // Scroll vers le panel
      setTimeout(function() {
        var panel = main.querySelector('.cust-alloc-panel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }).catch(function(err) { alert('❌ ' + (err.message || err)); });
  }
};
