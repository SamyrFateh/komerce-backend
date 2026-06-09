/**
 * KOMERCE Dashboard — Vue Clients /admin/clients
 * ════════════════════════════════════════════════════════════════════════
 * Question : "Comment se porte notre base clients ? Qui est à risque ?"
 *
 * Sections :
 *   - KPI bar : total clients, commandes, panier moyen, taux récurrence
 *   - Banner at-risk : alerte si des clients à risque existent
 *   - Segments : cards filtrantes (tous / nouveaux / récurrents / VIP / à risque / dormants)
 *   - Top VIP actifs : table des clients premium (< 180j silence)
 *   - Liste paginée : recherche + filtre île + filtre segment actif
 *   - Évolution mensuelle : table synthétique
 *   - Par relais : activité par point de livraison
 *   - Modal fiche client : historique complet + top produits
 *
 * Identité client :
 *   Les commandes n'ont pas toutes un user_id (clients invités).
 *   On regroupe par (téléphone, nom) via COALESCE users + recipients.
 *   Basculer sur user_id le jour où les comptes deviennent systématiques.
 *
 * API : KmcApi.getClients / getClientsList / getClientDetail
 */

(function (global) {
  'use strict';

  // ── Constantes ────────────────────────────────────────────────────────────

  const SEGMENT_META = {
    all:       { label: 'Tous',       emoji: '👥', hint: 'Tous les clients ayant commandé au moins une fois' },
    new:       { label: 'Nouveaux',   emoji: '🆕', hint: '1 commande, < 30 j depuis la première' },
    recurrent: { label: 'Récurrents', emoji: '🔁', hint: '≥ 2 commandes, dernière < 90 j' },
    vip:       { label: 'VIP actifs', emoji: '⭐', hint: 'LTV ≥ seuil VIP ou ≥ 5 commandes (actifs < 180 j)' },
    at_risk:   { label: 'À risque',   emoji: '⚠️', hint: '≥ 2 commandes mais silencieux depuis 60–180 j' },
    dormant:   { label: 'Dormants',   emoji: '💤', hint: 'Silencieux > 180 j (probablement perdus)' },
  };

  const DEFAULT_VIP_THRESHOLD = 200000; // KMF

  // ── Styles (injectés une seule fois) ─────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('kmc-clients-styles')) return;
    const css = `
      /* Segments */
      .cli-segments { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; margin-bottom:16px; }
      .cli-seg-card { background:white; border:1px solid var(--border); border-radius:10px; padding:12px; cursor:pointer; transition:all 0.15s; border-left:4px solid var(--text-tertiary); }
      .cli-seg-card:hover { border-color:var(--accent); }
      .cli-seg-card.is-active { border-color:var(--accent); background:var(--bg-accent-soft); border-left-color:var(--accent); }
      .cli-seg-card .seg-label { font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:.4px; }
      .cli-seg-card .seg-value { font-size:24px; font-weight:700; color:var(--text-primary); margin:4px 0; }
      .cli-seg-card .seg-pct   { font-size:11px; color:var(--text-secondary); }
      .cli-seg-card.seg-at_risk  { border-left-color:#ef4444; background:#fef2f2; }
      .cli-seg-card.seg-vip      { border-left-color:#f59e0b; }
      .cli-seg-card.seg-recurrent{ border-left-color:#10b981; }
      .cli-seg-card.seg-new      { border-left-color:#3b82f6; }

      /* Risk banner */
      .cli-risk-banner { background:#fef2f2; border-left:4px solid #ef4444; border-radius:6px; padding:12px 14px; margin-bottom:14px; }
      .cli-risk-banner h4 { margin:0 0 4px; font-size:14px; color:#991b1b; }
      .cli-risk-banner p  { margin:0; font-size:12px; color:#7f1d1d; }

      /* Toolbar */
      .cli-toolbar { display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
      .cli-search  { flex:1; min-width:220px; max-width:380px; padding:8px 12px; border:1px solid var(--border); border-radius:8px; font-size:14px; }
      .cli-select  { padding:7px 10px; border:1px solid var(--border); border-radius:8px; font-size:13px; background:white; }

      /* Silence badge */
      .silence-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700; }
      .silence-low  { background:#dcfce7; color:#166534; }
      .silence-mid  { background:#fef3c7; color:#92400e; }
      .silence-high { background:#fee2e2; color:#991b1b; }

      /* Pagination */
      .cli-pagination { display:flex; gap:6px; justify-content:center; margin-top:12px; }
      .cli-pagination button { padding:6px 12px; border:1px solid var(--border); background:white; border-radius:6px; font-size:13px; cursor:pointer; }
      .cli-pagination button:hover:not(:disabled) { background:var(--bg-secondary); }
      .cli-pagination button:disabled { opacity:.4; cursor:not-allowed; }
      .cli-pagination .pag-info { padding:6px 12px; color:var(--text-secondary); font-size:13px; }

      /* Modal */
      .cli-modal-overlay { position:fixed; inset:0; background:rgba(15,23,42,.6); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; }
      .cli-modal { background:white; border-radius:14px; max-width:800px; width:100%; max-height:90vh; overflow-y:auto; }
      .cli-modal-head { padding:18px 24px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:flex-start; position:sticky; top:0; background:white; z-index:1; }
      .cli-modal-head h3 { margin:0; font-size:18px; }
      .cli-modal-head .sub { font-size:13px; color:var(--text-secondary); margin-top:2px; }
      .cli-modal-close { background:none; border:none; font-size:26px; cursor:pointer; color:var(--text-tertiary); padding:0; line-height:1; }
      .cli-modal-body { padding:20px 24px; }
      .cli-profile-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin-bottom:18px; }
      .cli-profile-stat .lbl { font-size:11px; color:var(--text-secondary); text-transform:uppercase; font-weight:700; }
      .cli-profile-stat .val { font-size:18px; font-weight:700; color:var(--text-primary); margin-top:3px; }
      .cli-section-title { font-size:12px; font-weight:700; color:var(--text-primary); text-transform:uppercase; letter-spacing:.5px; margin:18px 0 8px; padding-bottom:6px; border-bottom:1px solid var(--border); }
    `;
    const el = document.createElement('style');
    el.id = 'kmc-clients-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fmt(n)      { return (Number(n) || 0).toLocaleString('fr-FR'); }
  function fmtK(n)     { const v = Number(n) || 0; return Math.abs(v) >= 1e6 ? (v/1e6).toFixed(2)+'M' : Math.abs(v) >= 1e3 ? (v/1e3).toFixed(0)+'k' : String(Math.round(v)); }
  function esc(s)      { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtDate(d)  { return d ? new Date(d).toLocaleDateString('fr-FR') : '—'; }
  function silenceCls(d) { const v = Number(d)||0; return v <= 30 ? 'silence-low' : v <= 90 ? 'silence-mid' : 'silence-high'; }
  function silenceLbl(d) { const v = Number(d)||0; return v <= 31 ? v+'j' : v <= 365 ? Math.floor(v/30)+' mois' : Math.floor(v/365)+'an'+(v>730?'s':''); }

  // ── Render principal ──────────────────────────────────────────────────────

  async function render(rootEl) {
    injectStyles();

    rootEl.innerHTML = `
      <h1 class="page-title">👥 Clients</h1>
      <p class="page-subtitle">Segmentation, fidélisation et détection des perdus en cours</p>

      <section class="page-section">
        <div id="cli-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span> Chargement…</div>
        </div>
      </section>

      <section class="page-section" id="cli-body">
        <div class="loading-state"><span class="loader"></span> Chargement des clients…</div>
      </section>
    `;

    const filters = KmcFilters.get();

    try {
      // Chargements parallèles : résumé + 1ère page liste
      const [summary, list] = await Promise.all([
        KmcApi.getClients(filters, { vip_threshold: DEFAULT_VIP_THRESHOLD }),
        KmcApi.getClientsList(filters, { page: 1, page_size: 25, segment: 'all', vip_threshold: DEFAULT_VIP_THRESHOLD }),
      ]);

      renderKpis(document.getElementById('cli-kpis'), summary.kpi);
      renderBody(document.getElementById('cli-body'), summary, list);
    } catch (err) {
      rootEl.querySelector('#cli-body').innerHTML = `<div class="error-state">Erreur : ${esc(err.message)}</div>`;
    }
  }

  // ── KPI bar ───────────────────────────────────────────────────────────────

  function renderKpis(el, kpi = {}) {
    const items = [
      { icon: '👥', value: fmt(kpi.nb_clients),           label: 'Clients période' },
      { icon: '📦', value: fmt(kpi.commandes_valides),    label: 'Commandes valides' },
      { icon: '🛒', value: fmtK(kpi.panier_moyen_kmf) + ' KMF', label: 'Panier moyen' },
      { icon: '🔁', value: (kpi.taux_recurrence_pct ?? 0) + '%', label: 'Taux récurrence' },
    ];
    el.innerHTML = items.map(i => `
      <div class="kpi-card">
        <div class="kpi-icon">${i.icon}</div>
        <div class="kpi-value">${i.value}</div>
        <div class="kpi-label">${i.label}</div>
      </div>
    `).join('');
  }

  // ── Corps principal (avec état local) ────────────────────────────────────

  function renderBody(container, summary, initialList) {
    // État local à cette instance de vue
    const state = {
      summary,
      list: initialList,
      page: 1,
      pageSize: 25,
      search: '',
      segment: 'all',
      island: '',
      loading: false,
    };

    function rerender() {
      container.innerHTML = buildBodyHTML(state);
      wireEvents(container, state, rerender, loadList);
    }

    async function loadList() {
      if (state.loading) return;
      state.loading = true;
      const filters = KmcFilters.get();
      try {
        state.list = await KmcApi.getClientsList(filters, {
          page:          state.page,
          page_size:     state.pageSize,
          segment:       state.segment,
          search:        state.search || undefined,
          island:        state.island || undefined,
          vip_threshold: DEFAULT_VIP_THRESHOLD,
        });
      } catch (err) {
        console.error('[ClientsView] loadList error:', err);
      } finally {
        state.loading = false;
        rerender();
      }
    }

    rerender();
  }

  function buildBodyHTML(state) {
    const { summary, list, segment, page } = state;
    const seg = summary.segments || {};
    const total = seg.nb_total || 0;
    const listData = list || { clients: [], total: 0, total_pages: 1 };

    let html = '';

    // ── Banner at-risk ────────────────────────────────────────────────────
    const atRisk = summary.at_risk_clients || [];
    if (atRisk.length) {
      const totalLtv = atRisk.reduce((s, c) => s + (c.ltv_kmf || 0), 0);
      html += `
        <div class="cli-risk-banner">
          <h4>⚠️ ${atRisk.length} clients à risque détectés</h4>
          <p>Ont commandé ≥ 2 fois, silencieux depuis 60–180 j.
             LTV en jeu : <strong>${fmt(totalLtv)} KMF</strong>.
             Filtrer sur "À risque" ci-dessous pour relancer.</p>
        </div>`;
    }

    // ── Segment cards ─────────────────────────────────────────────────────
    html += '<div class="cli-segments">';
    const segDef = [
      { k: 'all',       count: total,               },
      { k: 'new',       count: seg.new || 0,        },
      { k: 'recurrent', count: seg.recurrent || 0,  },
      { k: 'vip',       count: seg.vip || 0,        },
      { k: 'at_risk',   count: seg.at_risk || 0,    },
      { k: 'dormant',   count: seg.dormant || 0,    },
    ];
    segDef.forEach(({ k, count }) => {
      const m = SEGMENT_META[k];
      const pct = k === 'all' ? 100 : (total > 0 ? Math.round(count / total * 100) : 0);
      const active = segment === k ? ' is-active' : '';
      html += `
        <div class="cli-seg-card seg-${k}${active}" data-segment="${k}" title="${esc(m.hint)}">
          <div class="seg-label">${m.emoji} ${m.label}</div>
          <div class="seg-value">${count}</div>
          <div class="seg-pct">${pct}%</div>
        </div>`;
    });
    html += '</div>';

    // ── VIP (affiché uniquement sur segment 'all' ou 'vip') ───────────────
    const vips = summary.vip_clients || [];
    if (vips.length && (segment === 'all' || segment === 'vip')) {
      html += `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header"><h3 class="card-title">⭐ Top VIP actifs</h3></div>
          <table class="data-table">
            <thead><tr>
              <th>Client</th><th>Téléphone</th><th>Cmd</th>
              <th>LTV</th><th>Dernière</th><th>Silence</th>
            </tr></thead>
            <tbody>
              ${vips.slice(0, 8).map(c => `
                <tr class="row-link" data-phone="${esc(c.phone)}">
                  <td><strong>${esc(c.name || '—')}</strong></td>
                  <td>${esc(c.phone || '—')}</td>
                  <td>${c.nb_commandes}</td>
                  <td><strong>${fmt(c.ltv_kmf)} KMF</strong></td>
                  <td>${fmtDate(c.derniere_commande)}</td>
                  <td><span class="silence-badge ${silenceCls(c.jours_silence)}">${silenceLbl(c.jours_silence)}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }

    // ── Liste paginée ─────────────────────────────────────────────────────
    const m = SEGMENT_META[segment] || SEGMENT_META.all;
    html += `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">${m.emoji} ${m.label}
            <span style="font-size:13px;color:var(--text-secondary);font-weight:400"> — ${listData.total} client${listData.total > 1 ? 's' : ''}</span>
          </h3>
        </div>
        <div class="cli-toolbar">
          <input type="search" class="cli-search" id="cli-search"
            placeholder="🔎 Nom ou téléphone…" value="${esc(state.search)}">
          <select class="cli-select" id="cli-island">
            <option value="">Toutes îles</option>
            ${['Grande Comore','Anjouan','Mohéli','Mayotte'].map(i =>
              `<option value="${esc(i)}"${state.island === i ? ' selected' : ''}>${esc(i)}</option>`
            ).join('')}
          </select>
        </div>`;

    if (!listData.clients?.length) {
      html += '<div class="empty-state">Aucun client pour ces filtres.</div>';
    } else {
      html += `
        <table class="data-table">
          <thead><tr>
            <th>Client</th><th>Téléphone</th><th>Cmd</th>
            <th>LTV</th><th>Panier moy.</th><th>1ère cmd</th>
            <th>Dernière</th><th>Silence</th>
          </tr></thead>
          <tbody>
            ${listData.clients.map(c => `
              <tr class="row-link" data-phone="${esc(c.phone)}">
                <td><strong>${esc(c.name || '—')}</strong></td>
                <td>${esc(c.phone || '—')}</td>
                <td>${c.nb_commandes}</td>
                <td><strong>${fmt(c.ltv_kmf)} KMF</strong></td>
                <td>${fmt(c.panier_moyen_kmf)} KMF</td>
                <td>${fmtDate(c.premiere_commande)}</td>
                <td>${fmtDate(c.derniere_commande)}</td>
                <td><span class="silence-badge ${silenceCls(c.jours_silence)}">${silenceLbl(c.jours_silence)}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>`;

      if (listData.total_pages > 1) {
        html += `
          <div class="cli-pagination">
            <button id="cli-prev" ${page <= 1 ? 'disabled' : ''}>‹ Précédent</button>
            <span class="pag-info">Page ${page} / ${listData.total_pages}</span>
            <button id="cli-next" ${page >= listData.total_pages ? 'disabled' : ''}>Suivant ›</button>
          </div>`;
      }
    }
    html += '</div>'; // card

    // ── Évolution mensuelle ───────────────────────────────────────────────
    const evolution = summary.evolution || [];
    if (evolution.length) {
      html += `
        <div class="card" style="margin-top:16px">
          <div class="card-header"><h3 class="card-title">📈 Évolution mensuelle</h3></div>
          <table class="data-table">
            <thead><tr><th>Mois</th><th>Clients</th><th>Commandes</th><th>CA</th></tr></thead>
            <tbody>
              ${evolution.map(e => `
                <tr>
                  <td><strong>${esc(e.mois)}</strong></td>
                  <td>${e.nb_clients || 0}</td>
                  <td>${e.nb_commandes || 0}</td>
                  <td><strong>${fmt(e.ca_kmf)} KMF</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }

    // ── Par relais ────────────────────────────────────────────────────────
    const parRelais = summary.par_relais || [];
    if (parRelais.length) {
      html += `
        <div class="card" style="margin-top:16px">
          <div class="card-header"><h3 class="card-title">📍 Activité par relais</h3></div>
          <table class="data-table">
            <thead><tr><th>Relais</th><th>Île</th><th>Cmd</th><th>Livrées</th><th>CA</th></tr></thead>
            <tbody>
              ${parRelais.map(r => `
                <tr>
                  <td><strong>${esc(r.relais || '—')}</strong></td>
                  <td>${esc(r.ile || '—')}</td>
                  <td>${r.nb_commandes}</td>
                  <td>${r.livrees}</td>
                  <td><strong>${fmt(r.ca_kmf)} KMF</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }

    return html;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function wireEvents(container, state, rerender, loadList) {
    // Segments
    container.querySelectorAll('[data-segment]').forEach(el => {
      el.addEventListener('click', () => {
        state.segment = el.dataset.segment;
        state.page = 1;
        loadList();
      });
    });

    // Recherche (debounce 250ms)
    const searchEl = document.getElementById('cli-search');
    if (searchEl) {
      let timer;
      searchEl.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          state.search = searchEl.value;
          state.page = 1;
          loadList();
        }, 250);
      });
    }

    // Filtre île
    const islandEl = document.getElementById('cli-island');
    if (islandEl) {
      islandEl.addEventListener('change', () => {
        state.island = islandEl.value;
        state.page = 1;
        loadList();
      });
    }

    // Pagination
    document.getElementById('cli-prev')?.addEventListener('click', () => {
      if (state.page > 1) { state.page--; loadList(); }
    });
    document.getElementById('cli-next')?.addEventListener('click', () => {
      if (state.list && state.page < state.list.total_pages) { state.page++; loadList(); }
    });

    // Lignes cliquables → modal fiche client
    container.querySelectorAll('.row-link[data-phone]').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => openClientModal(tr.dataset.phone));
    });
  }

  // ── Modal fiche client ────────────────────────────────────────────────────

  async function openClientModal(phone) {
    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'cli-modal-overlay';
    overlay.id = 'cli-modal';
    overlay.innerHTML = `
      <div class="cli-modal">
        <div class="cli-modal-head">
          <div><h3>Chargement…</h3><div class="sub">${esc(phone)}</div></div>
          <button class="cli-modal-close">&times;</button>
        </div>
        <div class="cli-modal-body" id="cli-modal-body">
          <div class="loading-state"><span class="loader"></span> Chargement de la fiche…</div>
        </div>
      </div>`;

    document.getElementById('cli-modal')?.remove();
    document.body.appendChild(overlay);

    overlay.querySelector('.cli-modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    try {
      const data = await KmcApi.getClientDetail(phone);
      renderClientDetail(data, overlay);
    } catch (err) {
      document.getElementById('cli-modal-body').innerHTML =
        `<div class="error-state">Erreur : ${esc(err.message)}</div>`;
    }
  }

  function renderClientDetail(data, overlay) {
    const p = data.profile || {};
    const orders = data.orders || [];
    const prods  = data.top_products || [];

    // Mettre à jour le header
    overlay.querySelector('.cli-modal-head > div:first-child').innerHTML = `
      <h3>${esc(p.name || '—')}</h3>
      <div class="sub">${esc(p.phone || '')}${p.email ? ' · ' + esc(p.email) : ''}</div>`;

    const bodyEl = document.getElementById('cli-modal-body');

    bodyEl.innerHTML = `
      <div class="cli-profile-stats">
        <div class="cli-profile-stat"><div class="lbl">LTV</div><div class="val">${fmt(p.ltv_kmf)} KMF</div></div>
        <div class="cli-profile-stat"><div class="lbl">Commandes</div><div class="val">${p.nb_orders_valid ?? 0}</div></div>
        <div class="cli-profile-stat"><div class="lbl">Panier moyen</div><div class="val">${fmt(p.panier_moyen_kmf)} KMF</div></div>
        <div class="cli-profile-stat">
          <div class="lbl">Silence</div>
          <div class="val">
            <span class="silence-badge ${silenceCls(p.jours_silence)}">${silenceLbl(p.jours_silence)}</span>
          </div>
        </div>
        ${p.nb_orders_cancelled > 0 ? `<div class="cli-profile-stat"><div class="lbl">Annulées</div><div class="val" style="color:#dc2626">${p.nb_orders_cancelled}</div></div>` : ''}
      </div>

      <p style="font-size:13px;color:var(--text-secondary)">
        🟢 1ère commande : <strong>${fmtDate(p.premiere_commande)}</strong> ·
        ⏱ Dernière : <strong>${fmtDate(p.derniere_commande)}</strong>
        ${p.country ? ' · 🌍 ' + esc(p.country) : ''}
      </p>

      <div class="cli-section-title">📦 Historique des commandes (${orders.length})</div>
      ${!orders.length
        ? '<div class="empty-state" style="padding:20px">Aucune commande.</div>'
        : `<table class="data-table">
            <thead><tr><th>Date</th><th>Réf</th><th>Statut</th><th>Paiement</th><th>Relais</th><th>Total</th></tr></thead>
            <tbody>
              ${orders.map(o => `
                <tr>
                  <td>${fmtDate(o.created_at)}</td>
                  <td><strong>${esc(o.reference || '—')}</strong></td>
                  <td>${esc(o.status || '')}</td>
                  <td>${o.payment_mode === 'cash_relais' ? '💵' : '💳'} ${esc(o.payment_mode || '')}</td>
                  <td>${esc(o.relais || '—')}${o.ile ? ' (' + esc(o.ile) + ')' : ''}</td>
                  <td><strong>${fmt(o.total_kmf)} KMF</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>`}

      ${prods.length ? `
        <div class="cli-section-title">🏆 Produits préférés</div>
        <table class="data-table">
          <thead><tr><th>Produit</th><th>Catégorie</th><th>Qté</th><th>Cmd</th><th>Total</th></tr></thead>
          <tbody>
            ${prods.map(pr => `
              <tr>
                <td><strong>${esc(pr.name || '—')}</strong></td>
                <td style="color:var(--text-secondary)">${esc(pr.categorie || '—')}</td>
                <td>${pr.qty}</td><td>${pr.nb_orders}</td>
                <td><strong>${fmt(pr.total_kmf)} KMF</strong></td>
              </tr>`).join('')}
          </tbody>
        </table>` : ''}
    `;
  }

  // ── Export ────────────────────────────────────────────────────────────────

  global.ClientsView = { render };

})(window);
