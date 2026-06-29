/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-suppliers
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/* ═══════════════════════════════════════════════════════════════════════════
   BO View — Fournisseurs (Partners) — v2
   Shell: BO · Section: config

   CONCEPT MÉTIER:
   ─────────────────
   Un seul module unifié pour gérer 5 types de fournisseurs/partenaires :
     • 🏭 Sourcing       → fournisseurs Dubai/Chine (stock standard)
     • 🎨 Personnalisé    → artisans pour commandes sur-mesure (mariage, cérémonie)
     • 🚚 Logistique     → transitaires, transporteurs (lien customs_shipments)
     • 📍 Relais         → agents relais (existant)
     • 🏢 Hub            → équipe Dubai (existant)

   Ce module remplace la version localStorage (qui n'était pas partagée entre
   utilisateurs et n'était liée à aucune donnée métier).

   API: /api/admin/partners (CRUD complet)
   STATS: /api/admin/partners/stats (vue suppliers_stats)

   AUTO-DOC: chaque type a une description qui apparaît au survol.
   ═══════════════════════════════════════════════════════════════════════════ */

window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.suppliers = function(main) {
  // ── Styles injectés une fois ──────────────────────────────────────────────
  (function injectStyles() {
    if (document.getElementById('ct-suppliers-styles')) return;
    var style = document.createElement('style');
    style.id = 'ct-suppliers-styles';
    style.textContent = [
      /* Type tabs */
      '.sup-tabs { display:flex; gap:6px; margin-bottom:16px; flex-wrap:wrap; border-bottom:2px solid #e2e8f0; padding-bottom:0; }',
      '.sup-tab { padding:8px 14px; border:none; background:none; color:#64748b; font-size:13px; font-weight:600; cursor:pointer; border-bottom:3px solid transparent; margin-bottom:-2px; transition:all 0.15s; display:flex; align-items:center; gap:6px; }',
      '.sup-tab:hover { color:#1e293b; }',
      '.sup-tab.active { color:#3b82f6; border-bottom-color:#3b82f6; }',
      '.sup-tab-count { background:#e2e8f0; color:#475569; padding:1px 8px; border-radius:10px; font-size:11px; font-weight:700; }',
      '.sup-tab.active .sup-tab-count { background:#3b82f6; color:white; }',

      /* Search bar */
      '.sup-toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; gap:12px; flex-wrap:wrap; }',
      '.sup-search { flex:1; min-width:200px; max-width:400px; padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; }',
      '.sup-type-hint { font-size:12px; color:#64748b; font-style:italic; padding:8px 12px; background:#f8fafc; border-left:3px solid #3b82f6; border-radius:4px; margin-bottom:12px; }',

      /* Cards grid */
      '.sup-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }',
      '.sup-card { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:14px; transition:all 0.15s; cursor:pointer; }',
      '.sup-card:hover { border-color:#3b82f6; box-shadow:0 4px 12px rgba(59,130,246,0.1); }',
      '.sup-card.inactive { opacity:0.6; background:#fafafa; }',
      '.sup-card-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; gap:8px; }',
      '.sup-card-name { font-weight:700; font-size:15px; color:#0f172a; line-height:1.3; }',
      '.sup-card-rating { font-size:12px; color:#f59e0b; white-space:nowrap; }',
      '.sup-card-meta { font-size:12px; color:#64748b; margin-bottom:10px; line-height:1.5; }',
      '.sup-card-meta strong { color:#334155; }',
      '.sup-card-tags { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; }',
      '.sup-tag { font-size:10px; background:#f1f5f9; color:#475569; padding:2px 7px; border-radius:10px; text-transform:uppercase; letter-spacing:0.3px; }',
      '.sup-tag.tag-active { background:#dcfce7; color:#166534; }',
      '.sup-tag.tag-inactive { background:#f1f5f9; color:#94a3b8; }',
      '.sup-card-stats { display:grid; grid-template-columns:1fr 1fr; gap:6px; padding:8px 0; margin-top:8px; border-top:1px dashed #e2e8f0; font-size:11px; }',
      '.sup-card-stat-label { color:#64748b; }',
      '.sup-card-stat-value { font-weight:700; color:#0f172a; }',
      '.sup-card-actions { display:flex; gap:4px; margin-top:10px; }',
      '.sup-card-actions button { padding:5px 10px; font-size:11px; border-radius:6px; border:1px solid #cbd5e1; background:white; cursor:pointer; flex:1; }',
      '.sup-card-actions button:hover { background:#f1f5f9; }',
      '.sup-card-actions .btn-edit { color:#1e40af; }',
      '.sup-card-actions .btn-toggle { color:#475569; }',
      '.sup-card-actions .btn-delete { color:#b91c1c; }',
      '.sup-card-actions a.btn-link { display:flex; align-items:center; justify-content:center; padding:5px 10px; font-size:11px; border-radius:6px; border:1px solid #cbd5e1; background:white; text-decoration:none; color:#16a34a; }',

      /* Modal */
      '.sup-modal-overlay { position:fixed; inset:0; background:rgba(15,23,42,0.6); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; }',
      '.sup-modal { background:white; border-radius:14px; max-width:680px; width:100%; max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,0.3); }',
      '.sup-modal-head { padding:18px 24px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; background:white; z-index:1; }',
      '.sup-modal-head h3 { margin:0; font-size:18px; }',
      '.sup-modal-close { background:none; border:none; font-size:24px; cursor:pointer; color:#94a3b8; padding:0; line-height:1; }',
      '.sup-modal-close:hover { color:#0f172a; }',
      '.sup-modal-body { padding:20px 24px; }',
      '.sup-modal-foot { padding:14px 24px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; gap:8px; position:sticky; bottom:0; background:white; }',

      /* Form */
      '.sup-form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }',
      '.sup-form-group { display:flex; flex-direction:column; gap:4px; }',
      '.sup-form-group.full { grid-column:1/-1; }',
      '.sup-form-group label { font-size:11px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.3px; }',
      '.sup-form-group input, .sup-form-group select, .sup-form-group textarea { padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:14px; font-family:inherit; }',
      '.sup-form-group textarea { min-height:60px; resize:vertical; }',
      '.sup-form-group .help { font-size:11px; color:#94a3b8; font-style:italic; margin-top:2px; line-height:1.3; }',
      '.sup-section-title { grid-column:1/-1; font-size:12px; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:0.5px; padding:8px 0 4px; border-bottom:1px solid #e2e8f0; margin-top:8px; }',
      '.sup-section-title:first-child { margin-top:0; }',

      '.sup-empty { text-align:center; padding:40px 20px; color:#94a3b8; font-style:italic; background:#f8fafc; border-radius:10px; }',
    ].join('\n');
    document.head.appendChild(style);
  })();

  // ── Auto-doc des types de partenaires ─────────────────────────────────────
  var TYPE_META = {
    sourcing: {
      label: 'Sourcing',
      emoji: '🏭',
      hint: 'Fournisseurs récurrents Dubai/Chine pour le stock standard (téléphones, électroménager, cosmétiques, mode). Délais 5-15 jours, transport groupage.',
    },
    personnalise: {
      label: 'Personnalisé',
      emoji: '🎨',
      hint: 'Artisans pour les commandes sur-mesure (robes mariage, wax, dentelles, bijoux, fleurs cérémonie). Production à la commande, délais variables. À assigner aux commandes catégorie cérémonie/mariage.',
    },
    logistique: {
      label: 'Logistique',
      emoji: '🚚',
      hint: 'Transitaires et transporteurs (Dubai → Comores, Comores ↔ îles). Sélectionnables comme "Transitaire" lors de la création d\'un envoi customs.',
    },
    relais: {
      label: 'Relais',
      emoji: '📍',
      hint: 'Agents relais qui réceptionnent les colis sur les îles (Mohéli, Anjouan, Grande Comore, Mayotte). Touchent une commission par colis livré.',
    },
    agent_hub: {
      label: 'Hub',
      emoji: '🏢',
      hint: 'Équipe opérationnelle au hub Dubai. Réception, contrôle qualité, préparation des colis sortants.',
    },
  };

  var TYPES_ORDER = ['sourcing', 'personnalise', 'logistique', 'relais', 'agent_hub'];

  var ISLANDS = ['Grande Comore', 'Anjouan', 'Mohéli', 'Mayotte'];
  var CURRENCIES = ['KMF', 'EUR', 'USD', 'AED', 'CNY'];
  var COUNTRIES = [
    { code: 'KM', label: 'Comores' },
    { code: 'AE', label: 'Émirats Arabes Unis' },
    { code: 'CN', label: 'Chine' },
    { code: 'FR', label: 'France' },
    { code: 'YT', label: 'Mayotte' },
    { code: 'MG', label: 'Madagascar' },
    { code: 'TZ', label: 'Tanzanie' },
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmt(n) { return (Number(n) || 0).toLocaleString('fr-FR'); }
  function fmtPct(n) { return (Number(n) || 0).toFixed(1) + '%'; }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function rating(n) {
    if (!n) return '';
    var s = '';
    for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆';
    return s;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  var state = {
    activeType: 'sourcing',
    search: '',
    partners: [],
    stats: {},  // map partner_id → stats
    counts: {}, // map partner_type → count
  };

  // ── Render ────────────────────────────────────────────────────────────────
  render();

  function render() {
    main.innerHTML = '<div class="ct-loading">🏭 Chargement fournisseurs…</div>';

    Promise.all([
      CT.api.get('/api/admin/partners'),
      CT.api.get('/api/admin/partners/stats').catch(function() { return []; }),
    ]).then(function(results) {
      state.partners = Array.isArray(results[0]) ? results[0] : [];
      var statsArr = Array.isArray(results[1]) ? results[1] : [];
      state.stats = {};
      statsArr.forEach(function(s) { state.stats[s.partner_id] = s; });

      // Compter par type
      state.counts = {};
      TYPES_ORDER.forEach(function(t) { state.counts[t] = 0; });
      state.partners.forEach(function(p) {
        state.counts[p.partner_type] = (state.counts[p.partner_type] || 0) + 1;
      });

      buildUI();
    }).catch(function(err) {
      main.innerHTML = '<div class="ct-error">Erreur : ' + (err.message || err) + '</div>';
    });
  }

  function buildUI() {
    var html = '';

    /* ═══ Header ═══ */
    html += '<div class="ct-view-header">';
    html += '<h2>🏭 Fournisseurs & partenaires</h2>';
    html += '<div class="ct-subtitle">Sourcing · Personnalisé · Logistique · Relais · Hub — annuaire unifié et lié aux données métier</div>';
    html += '</div>';

    /* ═══ Type tabs ═══ */
    html += '<div class="sup-tabs">';
    TYPES_ORDER.forEach(function(t) {
      var meta = TYPE_META[t];
      var count = state.counts[t] || 0;
      var activeCls = state.activeType === t ? ' active' : '';
      html += '<button class="sup-tab' + activeCls + '" data-type="' + t + '" title="' + escHtml(meta.hint) + '">';
      html += '<span>' + meta.emoji + '</span> ' + meta.label;
      html += ' <span class="sup-tab-count">' + count + '</span>';
      html += '</button>';
    });
    html += '</div>';

    /* ═══ Hint pour le type actif ═══ */
    var activeMeta = TYPE_META[state.activeType];
    html += '<div class="sup-type-hint">' + activeMeta.emoji + ' <strong>' + activeMeta.label + ' :</strong> ' + escHtml(activeMeta.hint) + '</div>';

    /* ═══ Toolbar : recherche + bouton ajouter ═══ */
    html += '<div class="sup-toolbar">';
    html += '<input type="search" class="sup-search" id="sup-search" placeholder="🔎 Rechercher par nom, contact, zone..." value="' + escHtml(state.search) + '">';
    html += '<button class="ct-btn ct-btn-primary" id="sup-add-btn">+ Ajouter ' + activeMeta.label.toLowerCase() + '</button>';
    html += '</div>';

    /* ═══ Grid des cards ═══ */
    var filtered = filterPartners();
    if (!filtered.length) {
      html += '<div class="sup-empty">Aucun ' + activeMeta.label.toLowerCase() + ' enregistré' + (state.search ? ' correspondant à "' + escHtml(state.search) + '"' : '') + '. ' + (state.search ? '' : 'Clique sur "+ Ajouter" pour créer le premier.') + '</div>';
    } else {
      html += '<div class="sup-grid">';
      filtered.forEach(function(p) { html += renderCard(p); });
      html += '</div>';
    }

    main.innerHTML = html;
    wireEvents();
  }

  function filterPartners() {
    var q = state.search.toLowerCase().trim();
    return state.partners
      .filter(function(p) { return p.partner_type === state.activeType; })
      .filter(function(p) {
        if (!q) return true;
        return (p.name || '').toLowerCase().indexOf(q) >= 0
            || (p.contact_name || '').toLowerCase().indexOf(q) >= 0
            || (p.contact_phone || '').toLowerCase().indexOf(q) >= 0
            || (p.zone || '').toLowerCase().indexOf(q) >= 0
            || (p.island || '').toLowerCase().indexOf(q) >= 0
            || (p.country_label || '').toLowerCase().indexOf(q) >= 0;
      })
      .sort(function(a, b) {
        // actifs d'abord, puis par nom
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
  }

  function renderCard(p) {
    var inactiveCls = p.is_active ? '' : ' inactive';
    var stats = state.stats[p.id];

    var html = '<div class="sup-card' + inactiveCls + '" data-id="' + p.id + '">';

    /* Head : nom + rating */
    html += '<div class="sup-card-head">';
    html += '<div class="sup-card-name">' + escHtml(p.name || '—') + '</div>';
    if (p.rating) html += '<div class="sup-card-rating">' + rating(p.rating) + '</div>';
    html += '</div>';

    /* Meta lines */
    var metaLines = [];
    if (p.contact_name)  metaLines.push('👤 ' + escHtml(p.contact_name));
    if (p.contact_phone) metaLines.push('📞 ' + escHtml(p.contact_phone));
    if (p.country_label) metaLines.push('🌍 ' + escHtml(p.country_label) + (p.zone ? ' · ' + escHtml(p.zone) : ''));
    else if (p.island)   metaLines.push('📍 ' + escHtml(p.island) + (p.zone ? ' · ' + escHtml(p.zone) : ''));
    if (p.lead_time_days) metaLines.push('⏱ ' + p.lead_time_days + 'j de délai');
    if (p.currency)      metaLines.push('💱 ' + escHtml(p.currency));

    if (metaLines.length) {
      html += '<div class="sup-card-meta">' + metaLines.join('<br>') + '</div>';
    }

    /* Tags */
    var tags = [];
    if (p.is_active) tags.push('<span class="sup-tag tag-active">actif</span>');
    else             tags.push('<span class="sup-tag tag-inactive">inactif</span>');
    (p.product_categories || []).slice(0, 3).forEach(function(c) {
      tags.push('<span class="sup-tag">' + escHtml(c) + '</span>');
    });
    html += '<div class="sup-card-tags">' + tags.join('') + '</div>';

    /* Stats inline */
    if (stats && (state.activeType === 'personnalise' || state.activeType === 'logistique' || state.activeType === 'sourcing')) {
      html += '<div class="sup-card-stats">';
      if (state.activeType === 'logistique') {
        html += '<div class="sup-card-stat-label">Envois 90j</div>';
        html += '<div class="sup-card-stat-value" style="text-align:right">' + (stats.shipments_count || 0) + '</div>';
        html += '<div class="sup-card-stat-label">Taux moy.</div>';
        html += '<div class="sup-card-stat-value" style="text-align:right">' + fmtPct(stats.avg_customs_rate_90d) + '</div>';
      } else {
        html += '<div class="sup-card-stat-label">Cmd 30j</div>';
        html += '<div class="sup-card-stat-value" style="text-align:right">' + (stats.orders_count_30d || 0) + '</div>';
        html += '<div class="sup-card-stat-label">Marge 90j</div>';
        html += '<div class="sup-card-stat-value" style="text-align:right">' + fmtPct(stats.avg_margin_pct_90d) + '</div>';
      }
      html += '</div>';
    }

    /* Actions */
    html += '<div class="sup-card-actions">';
    if (p.whatsapp_url) {
      html += '<a class="btn-link" href="' + escHtml(p.whatsapp_url) + '" target="_blank" rel="noopener" title="WhatsApp">💬</a>';
    }
    html += '<button class="btn-edit" data-action="edit" data-id="' + p.id + '">✏️ Éditer</button>';
    html += '<button class="btn-toggle" data-action="toggle" data-id="' + p.id + '">' + (p.is_active ? '⏸' : '▶') + '</button>';
    html += '<button class="btn-delete" data-action="delete" data-id="' + p.id + '">🗑</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ── Modal CRUD ────────────────────────────────────────────────────────────
  function openModal(partner) {
    var isEdit = !!partner;
    var p = partner || { partner_type: state.activeType, is_active: true };

    var modalHtml = '<div class="sup-modal-overlay" id="sup-modal">';
    modalHtml += '<div class="sup-modal">';
    modalHtml += '<div class="sup-modal-head">';
    modalHtml += '<h3>' + (isEdit ? '✏️ Modifier' : '+ Ajouter') + ' fournisseur · ' + (TYPE_META[p.partner_type] || {}).label + '</h3>';
    modalHtml += '<button class="sup-modal-close" data-modal-close>&times;</button>';
    modalHtml += '</div>';
    modalHtml += '<div class="sup-modal-body">';
    modalHtml += '<div class="sup-form-grid">';

    // Section Identification
    modalHtml += '<div class="sup-section-title">Identification</div>';
    modalHtml += '<div class="sup-form-group full"><label>Nom du fournisseur *</label>';
    modalHtml += '<input id="f-name" type="text" value="' + escHtml(p.name || '') + '" required></div>';

    modalHtml += '<div class="sup-form-group"><label>Type *</label>';
    modalHtml += '<select id="f-type">';
    TYPES_ORDER.forEach(function(t) {
      var sel = p.partner_type === t ? ' selected' : '';
      modalHtml += '<option value="' + t + '"' + sel + '>' + TYPE_META[t].emoji + ' ' + TYPE_META[t].label + '</option>';
    });
    modalHtml += '</select></div>';

    modalHtml += '<div class="sup-form-group"><label>Note qualité (1-5)</label>';
    modalHtml += '<select id="f-rating">';
    modalHtml += '<option value="">—</option>';
    [1,2,3,4,5].forEach(function(r) {
      var sel = p.rating === r ? ' selected' : '';
      modalHtml += '<option value="' + r + '"' + sel + '>' + rating(r) + '</option>';
    });
    modalHtml += '</select></div>';

    // Section Contact
    modalHtml += '<div class="sup-section-title">Contact</div>';
    modalHtml += '<div class="sup-form-group"><label>Personne contact</label><input id="f-contact-name" type="text" value="' + escHtml(p.contact_name || '') + '"></div>';
    modalHtml += '<div class="sup-form-group"><label>Téléphone</label><input id="f-contact-phone" type="text" value="' + escHtml(p.contact_phone || '') + '" placeholder="+971 50 ..."></div>';
    modalHtml += '<div class="sup-form-group"><label>Email</label><input id="f-contact-email" type="email" value="' + escHtml(p.contact_email || '') + '"></div>';
    modalHtml += '<div class="sup-form-group"><label>WhatsApp (URL)</label><input id="f-whatsapp" type="url" value="' + escHtml(p.whatsapp_url || '') + '" placeholder="https://wa.me/..."><div class="help">Lien direct cliquable vers WhatsApp</div></div>';
    modalHtml += '<div class="sup-form-group full"><label>Site web / Catalogue</label><input id="f-website" type="url" value="' + escHtml(p.website_url || '') + '" placeholder="https://..."></div>';

    // Section Localisation
    modalHtml += '<div class="sup-section-title">Localisation</div>';
    modalHtml += '<div class="sup-form-group"><label>Pays</label>';
    modalHtml += '<select id="f-country">';
    modalHtml += '<option value="">—</option>';
    COUNTRIES.forEach(function(c) {
      var sel = p.country_code === c.code ? ' selected' : '';
      modalHtml += '<option value="' + c.code + '" data-label="' + escHtml(c.label) + '"' + sel + '>' + escHtml(c.label) + '</option>';
    });
    modalHtml += '</select></div>';

    modalHtml += '<div class="sup-form-group"><label>Île (si Comores)</label>';
    modalHtml += '<select id="f-island">';
    modalHtml += '<option value="">—</option>';
    ISLANDS.forEach(function(i) {
      var sel = p.island === i ? ' selected' : '';
      modalHtml += '<option value="' + i + '"' + sel + '>' + i + '</option>';
    });
    modalHtml += '</select></div>';

    modalHtml += '<div class="sup-form-group"><label>Ville / zone</label><input id="f-zone" type="text" value="' + escHtml(p.zone || '') + '"></div>';
    modalHtml += '<div class="sup-form-group full"><label>Adresse</label><input id="f-address" type="text" value="' + escHtml(p.address || '') + '"></div>';

    // Section Conditions commerciales
    modalHtml += '<div class="sup-section-title">Conditions commerciales</div>';
    modalHtml += '<div class="sup-form-group"><label>Devise</label>';
    modalHtml += '<select id="f-currency">';
    modalHtml += '<option value="">—</option>';
    CURRENCIES.forEach(function(c) {
      var sel = p.currency === c ? ' selected' : '';
      modalHtml += '<option value="' + c + '"' + sel + '>' + c + '</option>';
    });
    modalHtml += '</select></div>';

    modalHtml += '<div class="sup-form-group"><label>Délai (jours)</label><input id="f-lead-time" type="number" min="0" max="365" value="' + (p.lead_time_days || '') + '"></div>';
    modalHtml += '<div class="sup-form-group"><label>Commission (KMF)</label><input id="f-commission" type="number" min="0" value="' + (p.commission_kmf || 0) + '"><div class="help">Pour relais & artisans</div></div>';
    modalHtml += '<div class="sup-form-group full"><label>Conditions de paiement</label><input id="f-payment-terms" type="text" value="' + escHtml(p.payment_terms || '') + '" placeholder="ex: Acompte 30% + solde livraison · 30j fin de mois"></div>';

    // Section Catalogue (sourcing & personnalisé surtout)
    modalHtml += '<div class="sup-section-title">Catalogue</div>';
    modalHtml += '<div class="sup-form-group full"><label>Catégories produits (séparées par virgule)</label>';
    modalHtml += '<input id="f-categories" type="text" value="' + escHtml((p.product_categories || []).join(', ')) + '" placeholder="ex: phones, electromenager, robes_mariage">';
    modalHtml += '<div class="help">Permet de filtrer les fournisseurs par produit cherché</div></div>';
    modalHtml += '<div class="sup-form-group full"><label>Notes tarification (logistique)</label>';
    modalHtml += '<textarea id="f-pricing-notes">' + escHtml(p.pricing_notes || '') + '</textarea>';
    modalHtml += '<div class="help">Tarifs habituels, conditions spéciales, capacité maximum...</div></div>';

    // Section Notes générales
    modalHtml += '<div class="sup-section-title">Autres</div>';
    modalHtml += '<div class="sup-form-group full"><label>Notes</label><textarea id="f-notes">' + escHtml(p.notes || '') + '</textarea></div>';

    modalHtml += '</div>';  // form-grid
    modalHtml += '</div>';  // body

    modalHtml += '<div class="sup-modal-foot">';
    if (isEdit) {
      modalHtml += '<button class="ct-btn" style="color:#b91c1c;border:1px solid #fca5a5;background:white;padding:8px 14px;border-radius:6px;cursor:pointer" id="sup-modal-delete" data-id="' + p.id + '">🗑 Supprimer</button>';
    } else {
      modalHtml += '<span></span>';
    }
    modalHtml += '<div style="display:flex;gap:8px">';
    modalHtml += '<button class="ct-btn ct-btn-secondary" data-modal-close>Annuler</button>';
    modalHtml += '<button class="ct-btn ct-btn-primary" id="sup-modal-save"' + (isEdit ? ' data-edit-id="' + p.id + '"' : '') + '>Enregistrer</button>';
    modalHtml += '</div>';
    modalHtml += '</div>';

    modalHtml += '</div></div>';

    // Insérer le modal dans le DOM
    var existing = document.getElementById('sup-modal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Wire close
    document.querySelectorAll('#sup-modal [data-modal-close], #sup-modal').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target === el) closeModal();
      });
    });

    // Wire save
    document.getElementById('sup-modal-save').addEventListener('click', function() {
      saveFromModal(this.dataset.editId);
    });

    // Wire delete (in modal)
    var delBtn = document.getElementById('sup-modal-delete');
    if (delBtn) {
      delBtn.addEventListener('click', function() {
        handleDelete(this.dataset.id);
      });
    }
  }

  function closeModal() {
    var el = document.getElementById('sup-modal');
    if (el) el.remove();
  }

  function saveFromModal(editId) {
    var $ = function(id) { return document.getElementById(id); };
    var countrySel = $('f-country');
    var countryCode = countrySel.value;
    var countryLabel = countryCode ? countrySel.options[countrySel.selectedIndex].dataset.label : null;
    var categoriesStr = $('f-categories').value.trim();
    var categories = categoriesStr ? categoriesStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : null;

    var body = {
      name:                $('f-name').value.trim(),
      partner_type:        $('f-type').value,
      contact_name:        $('f-contact-name').value.trim() || null,
      contact_phone:       $('f-contact-phone').value.trim() || null,
      contact_email:       $('f-contact-email').value.trim() || null,
      whatsapp_url:        $('f-whatsapp').value.trim() || null,
      website_url:         $('f-website').value.trim() || null,
      country_code:        countryCode || null,
      country_label:       countryLabel || null,
      island:              $('f-island').value || null,
      zone:                $('f-zone').value.trim() || null,
      address:             $('f-address').value.trim() || null,
      currency:            $('f-currency').value || null,
      lead_time_days:      parseInt($('f-lead-time').value, 10) || null,
      commission_kmf:      parseInt($('f-commission').value, 10) || 0,
      payment_terms:       $('f-payment-terms').value.trim() || null,
      product_categories:  categories,
      pricing_notes:       $('f-pricing-notes').value.trim() || null,
      rating:              parseInt($('f-rating').value, 10) || null,
      notes:               $('f-notes').value.trim() || null,
    };

    if (!body.name) { alert('❌ Le nom est obligatoire'); return; }
    if (!body.partner_type) { alert('❌ Le type est obligatoire'); return; }

    var promise = editId
      ? CT.api.put('/api/admin/partners/' + editId, body)
      : CT.api.post('/api/admin/partners', body);

    promise.then(function() {
      closeModal();
      render();
    }).catch(function(err) {
      alert('❌ ' + (err.message || err));
    });
  }

  function handleDelete(id) {
    var p = state.partners.find(function(x) { return x.id === id; });
    if (!p) return;
    if (!confirm('Supprimer définitivement « ' + p.name + ' » ?\n\nLes commandes et envois liés ne seront pas supprimés mais perdront le lien vers ce fournisseur.')) return;

    CT.api.del('/api/admin/partners/' + id).then(function(res) {
      closeModal();
      if (res && res.message) alert('✅ ' + res.message);
      render();
    }).catch(function(err) { alert('❌ ' + (err.message || err)); });
  }

  function handleToggle(id) {
    var p = state.partners.find(function(x) { return x.id === id; });
    if (!p) return;
    CT.api.put('/api/admin/partners/' + id, { is_active: !p.is_active })
      .then(function() { render(); })
      .catch(function(err) { alert('❌ ' + (err.message || err)); });
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function wireEvents() {
    // Tabs
    main.querySelectorAll('.sup-tab[data-type]').forEach(function(t) {
      t.addEventListener('click', function() {
        state.activeType = t.dataset.type;
        state.search = '';
        buildUI();
      });
    });

    // Search
    var searchInput = document.getElementById('sup-search');
    if (searchInput) {
      var timer;
      searchInput.addEventListener('input', function() {
        clearTimeout(timer);
        timer = setTimeout(function() {
          state.search = searchInput.value;
          buildUI();
        }, 200);
      });
    }

    // Add button
    var addBtn = document.getElementById('sup-add-btn');
    if (addBtn) addBtn.addEventListener('click', function() { openModal(null); });

    // Card actions
    main.querySelectorAll('.sup-card [data-action]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var action = btn.dataset.action;
        var id = btn.dataset.id;
        if (action === 'edit')   openModal(state.partners.find(function(p) { return p.id === id; }));
        if (action === 'toggle') handleToggle(id);
        if (action === 'delete') handleDelete(id);
      });
    });

    // Card click → edit (sauf bouton)
    main.querySelectorAll('.sup-card').forEach(function(card) {
      card.addEventListener('click', function(e) {
        if (e.target.closest('[data-action]') || e.target.closest('a')) return;
        var id = card.dataset.id;
        openModal(state.partners.find(function(p) { return p.id === id; }));
      });
    });
  }
};
