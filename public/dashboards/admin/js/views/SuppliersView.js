/**
 * KOMERCE Dashboard — Vue Fournisseurs /admin/suppliers
 * ═══════════════════════════════════════════════════════════════════════════
 * Migration de CT.views.suppliers (ct-views-suppliers.js — 581 lignes)
 *
 * CONCEPT MÉTIER :
 *   Un seul module unifié pour gérer 5 types de partenaires :
 *     🏭 Sourcing    → fournisseurs Dubai/Chine
 *     🎨 Personnalisé → artisans sur-mesure (mariage, cérémonie)
 *     🚚 Logistique  → transitaires, transporteurs
 *     📍 Relais      → agents relais (îles)
 *     🏢 Hub         → équipe opérationnelle Dubai
 *
 * API :
 *   KmcApi.getPartners(params)        → liste
 *   KmcApi.getPartnersStats()         → stats par partenaire
 *   KmcApi.createPartner(body)        → créer
 *   KmcApi.updatePartner(id, body)    → mettre à jour
 *   KmcApi.deletePartner(id)          → supprimer
 */

(function (global) {
  'use strict';

  /* ── Styles ──────────────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('suppliers-view-styles')) return;
    const s = document.createElement('style');
    s.id = 'suppliers-view-styles';
    s.textContent = `
      .sv-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;border-bottom:2px solid var(--border);padding-bottom:0}
      .sv-tab{padding:8px 14px;border:none;background:none;color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .15s;display:flex;align-items:center;gap:6px}
      .sv-tab:hover{color:var(--text-primary)}
      .sv-tab.active{color:#3b82f6;border-bottom-color:#3b82f6}
      .sv-count{background:var(--border);color:var(--text-secondary);padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700}
      .sv-tab.active .sv-count{background:#3b82f6;color:white}
      .sv-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;flex-wrap:wrap}
      .sv-search{flex:1;min-width:200px;max-width:400px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--bg-card);color:var(--text-primary)}
      .sv-hint{font-size:12px;color:var(--text-secondary);font-style:italic;padding:8px 12px;background:var(--bg-secondary);border-left:3px solid #3b82f6;border-radius:4px;margin-bottom:12px}
      .sv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
      .sv-card{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px;transition:all .15s;cursor:pointer}
      .sv-card:hover{border-color:#3b82f6;box-shadow:0 4px 12px rgba(59,130,246,.1)}
      .sv-card.inactive{opacity:.6;background:var(--bg-secondary)}
      .sv-card-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px}
      .sv-card-name{font-weight:700;font-size:15px;color:var(--text-primary);line-height:1.3}
      .sv-card-rating{font-size:12px;color:#f59e0b;white-space:nowrap}
      .sv-card-meta{font-size:12px;color:var(--text-secondary);margin-bottom:10px;line-height:1.5}
      .sv-card-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
      .sv-tag{font-size:10px;background:var(--bg-secondary);color:var(--text-secondary);padding:2px 7px;border-radius:10px;text-transform:uppercase;letter-spacing:.3px}
      .sv-tag-active{background:#dcfce7;color:#166534}
      .sv-tag-inactive{background:var(--bg-secondary);color:#94a3b8}
      .sv-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 0;margin-top:8px;border-top:1px dashed var(--border);font-size:11px}
      .sv-stat-label{color:var(--text-secondary)}
      .sv-stat-value{font-weight:700;color:var(--text-primary)}
      .sv-actions{display:flex;gap:4px;margin-top:10px}
      .sv-actions button{padding:5px 10px;font-size:11px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);cursor:pointer;flex:1;color:var(--text-primary)}
      .sv-actions button:hover{background:var(--bg-secondary)}
      .sv-actions .btn-edit{color:#1e40af}
      .sv-actions .btn-delete{color:#b91c1c}
      .sv-actions a{display:flex;align-items:center;justify-content:center;padding:5px 10px;font-size:11px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);text-decoration:none;color:#16a34a}
      .sv-modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}
      .sv-modal{background:var(--bg-card);border-radius:14px;max-width:680px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)}
      .sv-modal-head{padding:18px 24px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg-card);z-index:1}
      .sv-modal-head h3{margin:0;font-size:18px;color:var(--text-primary)}
      .sv-modal-close{background:none;border:none;font-size:24px;cursor:pointer;color:#94a3b8;padding:0;line-height:1}
      .sv-modal-body{padding:20px 24px}
      .sv-modal-foot{padding:14px 24px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;position:sticky;bottom:0;background:var(--bg-card)}
      .sv-fgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
      .sv-fgroup{display:flex;flex-direction:column;gap:4px}
      .sv-fgroup.full{grid-column:1/-1}
      .sv-fgroup label{font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.3px}
      .sv-fgroup input,.sv-fgroup select,.sv-fgroup textarea{padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:14px;font-family:inherit;background:var(--bg-card);color:var(--text-primary)}
      .sv-fgroup textarea{min-height:60px;resize:vertical}
      .sv-fgroup .fhelp{font-size:11px;color:#94a3b8;font-style:italic;margin-top:2px;line-height:1.3}
      .sv-section-title{grid-column:1/-1;font-size:12px;font-weight:700;color:var(--text-primary);text-transform:uppercase;letter-spacing:.5px;padding:8px 0 4px;border-bottom:1px solid var(--border);margin-top:8px}
      .sv-empty{text-align:center;padding:40px 20px;color:#94a3b8;font-style:italic;background:var(--bg-secondary);border-radius:10px}
    `;
    document.head.appendChild(s);
  }

  /* ── Meta types ──────────────────────────────────────────────────────── */
  const TYPE_META = {
    sourcing:     { label: 'Sourcing',      emoji: '🏭', hint: 'Fournisseurs récurrents Dubai/Chine pour le stock standard. Délais 5-15 jours, transport groupage.' },
    personnalise: { label: 'Personnalisé',  emoji: '🎨', hint: 'Artisans pour commandes sur-mesure (robes mariage, wax, bijoux, fleurs cérémonie). Production à la commande.' },
    logistique:   { label: 'Logistique',    emoji: '🚚', hint: 'Transitaires et transporteurs (Dubai → Comores). Sélectionnables lors de la création d\'un envoi douane.' },
    relais:       { label: 'Relais',        emoji: '📍', hint: 'Agents relais qui réceptionnent les colis sur les îles (Mohéli, Anjouan, Grande Comore, Mayotte).' },
    agent_hub:    { label: 'Hub',           emoji: '🏢', hint: 'Équipe opérationnelle au hub Dubai. Réception, contrôle qualité, préparation des colis.' },
  };
  const TYPES_ORDER  = ['sourcing', 'personnalise', 'logistique', 'relais', 'agent_hub'];
  const ISLANDS      = ['Grande Comore', 'Anjouan', 'Mohéli', 'Mayotte'];
  const CURRENCIES   = ['KMF', 'EUR', 'USD', 'AED', 'CNY'];
  const COUNTRIES    = [
    { code: 'KM', label: 'Comores' }, { code: 'AE', label: 'Émirats Arabes Unis' },
    { code: 'CN', label: 'Chine' }, { code: 'FR', label: 'France' },
    { code: 'YT', label: 'Mayotte' }, { code: 'MG', label: 'Madagascar' }, { code: 'TZ', label: 'Tanzanie' },
  ];

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function fmtPct(n) { return (Number(n) || 0).toFixed(1) + '%'; }
  function rating(n) { let s = ''; for (let i = 1; i <= 5; i++) s += i <= n ? '★' : '☆'; return s; }

  /* ── State ───────────────────────────────────────────────────────────── */
  const state = { activeType: 'sourcing', search: '', partners: [], stats: {}, counts: {} };
  let _container = null;

  /* ── Render ──────────────────────────────────────────────────────────── */
  function render(container) {
    _injectStyles();
    _container = container;
    container.innerHTML = '<div class="kmc-loading">🏭 Chargement fournisseurs…</div>';

    Promise.all([
      global.KmcApi.getPartners(),
      global.KmcApi.getPartnersStats().catch(() => []),
    ]).then(([partnersResp, statsResp]) => {
      state.partners = Array.isArray(partnersResp) ? partnersResp : (partnersResp.partners || []);
      const statsArr = Array.isArray(statsResp) ? statsResp : (statsResp.stats || []);
      state.stats  = {};
      statsArr.forEach(s => { state.stats[s.partner_id] = s; });
      state.counts = {};
      TYPES_ORDER.forEach(t => { state.counts[t] = 0; });
      state.partners.forEach(p => { state.counts[p.partner_type] = (state.counts[p.partner_type] || 0) + 1; });
      buildUI();
    }).catch(err => {
      container.innerHTML = `<div class="kmc-error">Erreur chargement fournisseurs : ${err.message || err}</div>`;
    });
  }

  function buildUI() {
    const activeMeta = TYPE_META[state.activeType];
    let html = `
      <div class="kmc-view-header">
        <h2>🏭 Fournisseurs & partenaires</h2>
        <div class="kmc-subtitle">Sourcing · Personnalisé · Logistique · Relais · Hub — annuaire unifié lié aux données métier</div>
      </div>
      <div class="sv-tabs">`;
    TYPES_ORDER.forEach(t => {
      const m = TYPE_META[t];
      html += `<button class="sv-tab${state.activeType === t ? ' active' : ''}" data-type="${t}" title="${esc(m.hint)}">
        <span>${m.emoji}</span> ${m.label} <span class="sv-count">${state.counts[t] || 0}</span>
      </button>`;
    });
    html += `</div>
      <div class="sv-hint">${activeMeta.emoji} <strong>${activeMeta.label} :</strong> ${esc(activeMeta.hint)}</div>
      <div class="sv-toolbar">
        <input type="search" class="sv-search" id="sv-search" placeholder="🔎 Rechercher par nom, contact, zone…" value="${esc(state.search)}">
        <button class="kmc-btn kmc-btn-primary" id="sv-add-btn">+ Ajouter ${activeMeta.label.toLowerCase()}</button>
      </div>`;

    const filtered = filterPartners();
    if (!filtered.length) {
      html += `<div class="sv-empty">Aucun ${activeMeta.label.toLowerCase()} enregistré${state.search ? ` correspondant à "${esc(state.search)}"` : '. Clique sur "+ Ajouter" pour créer le premier.'}.</div>`;
    } else {
      html += '<div class="sv-grid">' + filtered.map(renderCard).join('') + '</div>';
    }

    _container.innerHTML = html;
    wireEvents();
  }

  function filterPartners() {
    const q = state.search.toLowerCase().trim();
    return state.partners
      .filter(p => p.partner_type === state.activeType)
      .filter(p => {
        if (!q) return true;
        return [p.name, p.contact_name, p.contact_phone, p.zone, p.island, p.country_label]
          .some(f => f && f.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
  }

  function renderCard(p) {
    const stats = state.stats[p.id];
    const metaLines = [
      p.contact_name  ? '👤 ' + esc(p.contact_name) : null,
      p.contact_phone ? '📞 ' + esc(p.contact_phone) : null,
      p.country_label ? '🌍 ' + esc(p.country_label) + (p.zone ? ' · ' + esc(p.zone) : '') : (p.island ? '📍 ' + esc(p.island) + (p.zone ? ' · ' + esc(p.zone) : '') : null),
      p.lead_time_days ? '⏱ ' + p.lead_time_days + 'j de délai' : null,
    ].filter(Boolean);

    let html = `<div class="sv-card${p.is_active ? '' : ' inactive'}" data-id="${p.id}">
      <div class="sv-card-head">
        <div class="sv-card-name">${esc(p.name || '—')}</div>
        ${p.rating ? `<div class="sv-card-rating">${rating(p.rating)}</div>` : ''}
      </div>`;

    if (metaLines.length) html += `<div class="sv-card-meta">${metaLines.join('<br>')}</div>`;

    html += `<div class="sv-card-tags">
      <span class="sv-tag ${p.is_active ? 'sv-tag-active' : 'sv-tag-inactive'}">${p.is_active ? 'actif' : 'inactif'}</span>
      ${(p.product_categories || []).slice(0, 3).map(c => `<span class="sv-tag">${esc(c)}</span>`).join('')}
    </div>`;

    if (stats && ['sourcing','personnalise','logistique'].includes(state.activeType)) {
      html += '<div class="sv-stats">';
      if (state.activeType === 'logistique') {
        html += `<div class="sv-stat-label">Envois 90j</div><div class="sv-stat-value" style="text-align:right">${stats.shipments_count || 0}</div>
                 <div class="sv-stat-label">Taux moy.</div><div class="sv-stat-value" style="text-align:right">${fmtPct(stats.avg_customs_rate_90d)}</div>`;
      } else {
        html += `<div class="sv-stat-label">Cmd 30j</div><div class="sv-stat-value" style="text-align:right">${stats.orders_count_30d || 0}</div>
                 <div class="sv-stat-label">Marge 90j</div><div class="sv-stat-value" style="text-align:right">${fmtPct(stats.avg_margin_pct_90d)}</div>`;
      }
      html += '</div>';
    }

    html += `<div class="sv-actions">
      ${p.whatsapp_url ? `<a href="${esc(p.whatsapp_url)}" target="_blank" rel="noopener" title="WhatsApp">💬</a>` : ''}
      <button class="btn-edit" data-action="edit" data-id="${p.id}">✏️ Éditer</button>
      <button class="btn-toggle" data-action="toggle" data-id="${p.id}">${p.is_active ? '⏸' : '▶'}</button>
      <button class="btn-delete" data-action="delete" data-id="${p.id}">🗑</button>
    </div></div>`;
    return html;
  }

  /* ── Modal CRUD ──────────────────────────────────────────────────────── */
  function openModal(partner) {
    const isEdit = !!partner;
    const p = partner || { partner_type: state.activeType, is_active: true };
    const typeMeta = TYPE_META[p.partner_type] || TYPE_META.sourcing;

    let html = `<div class="sv-modal-bg" id="sv-modal">
      <div class="sv-modal">
        <div class="sv-modal-head">
          <h3>${isEdit ? '✏️ Modifier' : '+ Ajouter'} fournisseur · ${typeMeta.label}</h3>
          <button class="sv-modal-close" data-modal-close>&times;</button>
        </div>
        <div class="sv-modal-body"><div class="sv-fgrid">
          <div class="sv-section-title">Identification</div>
          <div class="sv-fgroup full"><label>Nom *</label><input id="f-name" value="${esc(p.name || '')}"></div>
          <div class="sv-fgroup"><label>Type *</label><select id="f-type">
            ${TYPES_ORDER.map(t => `<option value="${t}"${p.partner_type === t ? ' selected' : ''}>${TYPE_META[t].emoji} ${TYPE_META[t].label}</option>`).join('')}
          </select></div>
          <div class="sv-fgroup"><label>Note qualité (1-5)</label><select id="f-rating">
            <option value="">—</option>
            ${[1,2,3,4,5].map(r => `<option value="${r}"${p.rating === r ? ' selected' : ''}>${rating(r)}</option>`).join('')}
          </select></div>
          <div class="sv-section-title">Contact</div>
          <div class="sv-fgroup"><label>Personne contact</label><input id="f-contact-name" value="${esc(p.contact_name || '')}"></div>
          <div class="sv-fgroup"><label>Téléphone</label><input id="f-contact-phone" value="${esc(p.contact_phone || '')}" placeholder="+971 50 …"></div>
          <div class="sv-fgroup"><label>Email</label><input type="email" id="f-contact-email" value="${esc(p.contact_email || '')}"></div>
          <div class="sv-fgroup"><label>WhatsApp (URL)</label><input type="url" id="f-whatsapp" value="${esc(p.whatsapp_url || '')}" placeholder="https://wa.me/…"><div class="fhelp">Lien direct cliquable</div></div>
          <div class="sv-fgroup full"><label>Site web / Catalogue</label><input type="url" id="f-website" value="${esc(p.website_url || '')}" placeholder="https://…"></div>
          <div class="sv-section-title">Localisation</div>
          <div class="sv-fgroup"><label>Pays</label><select id="f-country">
            <option value="">—</option>
            ${COUNTRIES.map(c => `<option value="${c.code}" data-label="${esc(c.label)}"${p.country_code === c.code ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select></div>
          <div class="sv-fgroup"><label>Île (Comores)</label><select id="f-island">
            <option value="">—</option>
            ${ISLANDS.map(i => `<option value="${i}"${p.island === i ? ' selected' : ''}>${i}</option>`).join('')}
          </select></div>
          <div class="sv-fgroup"><label>Ville / zone</label><input id="f-zone" value="${esc(p.zone || '')}"></div>
          <div class="sv-fgroup full"><label>Adresse</label><input id="f-address" value="${esc(p.address || '')}"></div>
          <div class="sv-section-title">Conditions commerciales</div>
          <div class="sv-fgroup"><label>Devise</label><select id="f-currency">
            <option value="">—</option>
            ${CURRENCIES.map(c => `<option value="${c}"${p.currency === c ? ' selected' : ''}>${c}</option>`).join('')}
          </select></div>
          <div class="sv-fgroup"><label>Délai (jours)</label><input type="number" id="f-lead-time" min="0" max="365" value="${p.lead_time_days || ''}"></div>
          <div class="sv-fgroup"><label>Commission (KMF)</label><input type="number" id="f-commission" min="0" value="${p.commission_kmf || 0}"><div class="fhelp">Pour relais &amp; artisans</div></div>
          <div class="sv-fgroup full"><label>Conditions de paiement</label><input id="f-payment-terms" value="${esc(p.payment_terms || '')}" placeholder="ex: Acompte 30% + solde livraison"></div>
          <div class="sv-section-title">Catalogue</div>
          <div class="sv-fgroup full"><label>Catégories produits (virgule)</label>
            <input id="f-categories" value="${esc((p.product_categories || []).join(', '))}" placeholder="ex: phones, electromenager">
            <div class="fhelp">Filtre les fournisseurs par produit cherché</div></div>
          <div class="sv-fgroup full"><label>Notes tarification (logistique)</label>
            <textarea id="f-pricing-notes">${esc(p.pricing_notes || '')}</textarea>
            <div class="fhelp">Tarifs habituels, conditions spéciales…</div></div>
          <div class="sv-section-title">Autres</div>
          <div class="sv-fgroup full"><label>Notes</label><textarea id="f-notes">${esc(p.notes || '')}</textarea></div>
        </div></div>
        <div class="sv-modal-foot">
          ${isEdit
            ? `<button style="color:#b91c1c;border:1px solid #fca5a5;background:var(--bg-card);padding:8px 14px;border-radius:6px;cursor:pointer" id="sv-modal-delete" data-id="${p.id}">🗑 Supprimer</button>`
            : '<span></span>'
          }
          <div style="display:flex;gap:8px">
            <button class="kmc-btn kmc-btn-secondary" data-modal-close>Annuler</button>
            <button class="kmc-btn kmc-btn-primary" id="sv-modal-save"${isEdit ? ` data-edit-id="${p.id}"` : ''}>Enregistrer</button>
          </div>
        </div>
      </div></div>`;

    document.getElementById('sv-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);

    document.querySelectorAll('#sv-modal [data-modal-close], #sv-modal').forEach(el => {
      el.addEventListener('click', e => { if (e.target === el) closeModal(); });
    });

    document.getElementById('sv-modal-save').addEventListener('click', function () {
      saveFromModal(this.dataset.editId);
    });

    document.getElementById('sv-modal-delete')?.addEventListener('click', function () {
      handleDelete(this.dataset.id);
    });
  }

  function closeModal() { document.getElementById('sv-modal')?.remove(); }

  function saveFromModal(editId) {
    const g = id => document.getElementById(id);
    const countrySel = g('f-country');
    const countryCode = countrySel.value;
    const countryLabel = countryCode ? countrySel.options[countrySel.selectedIndex].dataset.label : null;
    const categories = (g('f-categories').value.trim() || '').split(',').map(s => s.trim()).filter(Boolean);

    const body = {
      name:               g('f-name').value.trim(),
      partner_type:       g('f-type').value,
      contact_name:       g('f-contact-name').value.trim() || null,
      contact_phone:      g('f-contact-phone').value.trim() || null,
      contact_email:      g('f-contact-email').value.trim() || null,
      whatsapp_url:       g('f-whatsapp').value.trim() || null,
      website_url:        g('f-website').value.trim() || null,
      country_code:       countryCode || null,
      country_label:      countryLabel || null,
      island:             g('f-island').value || null,
      zone:               g('f-zone').value.trim() || null,
      address:            g('f-address').value.trim() || null,
      currency:           g('f-currency').value || null,
      lead_time_days:     parseInt(g('f-lead-time').value, 10) || null,
      commission_kmf:     parseInt(g('f-commission').value, 10) || 0,
      payment_terms:      g('f-payment-terms').value.trim() || null,
      product_categories: categories.length ? categories : null,
      pricing_notes:      g('f-pricing-notes').value.trim() || null,
      rating:             parseInt(g('f-rating').value, 10) || null,
      notes:              g('f-notes').value.trim() || null,
    };

    if (!body.name) { alert('❌ Le nom est obligatoire'); return; }

    const promise = editId
      ? global.KmcApi.updatePartner(editId, body)
      : global.KmcApi.createPartner(body);

    promise.then(() => { closeModal(); render(_container); })
           .catch(err => alert('❌ ' + (err.message || err)));
  }

  function handleDelete(id) {
    const p = state.partners.find(x => x.id === id);
    if (!p || !confirm(`Supprimer définitivement « ${p.name} » ?\n\nLes commandes et envois liés ne seront pas supprimés.`)) return;
    global.KmcApi.deletePartner(id)
      .then(res => { closeModal(); if (res?.message) alert('✅ ' + res.message); render(_container); })
      .catch(err => alert('❌ ' + (err.message || err)));
  }

  function handleToggle(id) {
    const p = state.partners.find(x => x.id === id);
    if (!p) return;
    global.KmcApi.updatePartner(id, { is_active: !p.is_active })
      .then(() => render(_container))
      .catch(err => alert('❌ ' + (err.message || err)));
  }

  /* ── Événements ──────────────────────────────────────────────────────── */
  function wireEvents() {
    _container.querySelectorAll('.sv-tab[data-type]').forEach(t => {
      t.addEventListener('click', () => {
        state.activeType = t.dataset.type;
        state.search = '';
        buildUI();
      });
    });

    const searchInput = _container.querySelector('#sv-search');
    if (searchInput) {
      let timer;
      searchInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.search = searchInput.value; buildUI(); }, 200);
      });
    }

    _container.querySelector('#sv-add-btn')?.addEventListener('click', () => openModal(null));

    _container.querySelectorAll('.sv-card [data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const { action, id } = btn.dataset;
        if (action === 'edit')   openModal(state.partners.find(p => p.id === id));
        if (action === 'toggle') handleToggle(id);
        if (action === 'delete') handleDelete(id);
      });
    });

    _container.querySelectorAll('.sv-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('[data-action]') || e.target.closest('a')) return;
        openModal(state.partners.find(p => p.id === card.dataset.id));
      });
    });
  }

  /* ── Enregistrement ──────────────────────────────────────────────────── */
  function SuppliersView() {
    this.render = function (container) { render(container); };
  }

  global.SuppliersView = SuppliersView;

})(window);
