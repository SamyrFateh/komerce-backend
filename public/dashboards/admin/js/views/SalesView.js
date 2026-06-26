/**
 * @komerce-arch
 * @role          admin-sales-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   medium
 * @inputs        filters (from, to, island), sales data
 * @outputs       sales_page_dom (CA, volume, tendances par île et canal)
 * @depends       api-client.js, filters-store.js, utils.js, components/Charts.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  sales, revenue, admin-dashboard
 * @version       2026-06
 */

'use strict';
/**
 * KOMERCE Dashboard — Vue Ventes /admin/sales
 * ════════════════════════════════════════════════════════════════════════
 * Migration de ct-views-sales.js (v2, ADR-002) vers l'architecture moderne.
 *
 * Sections :
 *   - KPI bar : CA · Commandes · Panier moyen · Marge réelle
 *   - Évolution CA (bar chart CSS + tooltips hover)
 *   - Funnel commandes (5 étapes + drop % + alerte perdues)
 *   - CA & marge par catégorie (barres proportionnelles + code couleur)
 *   - Top 5 produits
 *   - CA par île · CA par mode de paiement (2 colonnes)
 *   - Cohortes de rétention (heatmap 6×6)
 *
 * Règles d'architecture :
 *   ✓ Appels API uniquement via KmcApi.getSales() — zéro fetch() brut
 *   ✓ Filtres lus depuis KmcFilters (période en jours = filtre `period`)
 *   ✓ KPIs rendus via KpiCard.render() (data_quality indicator inclus)
 *   ✓ Un seul fichier, zéro doublon -v6/-v7/-legacy
 *
 * Dépendances :
 *   - api-client.js  → KmcApi.getSales()      ← À AJOUTER (voir NOTE ci-dessous)
 *   - filters-store.js → KmcFilters
 *   - components/KpiCard.js → KpiCard
 *
 * NOTE api-client.js : ajouter avant l'export KmcApi :
 *   async function getSales(filters, options) {
 *     return fetchJSON('sales', { filters, ...options });
 *   }
 *   // + 'getSales' dans global.KmcApi = { … }
 * L'endpoint cible est /api/admin/dashboard/sales?period=N (BASE défini dans api-client.js).
 * L'endpoint legacy était /api/dashboard/sales?period=N — vérifier la route serveur au moment
 * de la bascule (Vague 1).
 *
 * Chantier : KOMERCE_CHANTIER_DASHBOARDS_ADMIN.md · Vague 1
 */

(function (global) {
  'use strict';

  // ── Styles (injectés une seule fois) ─────────────────────────────────────
  const STYLE_ID = 'kmc-sales-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      /* ── Period tabs ─────────────────────────────── */
      .sales-period-bar {
        display: flex;
        gap: 6px;
        margin-bottom: 20px;
        flex-wrap: wrap;
      }
      .sales-period-bar button {
        padding: 6px 16px;
        border: 1px solid var(--border-default, #cbd5e1);
        background: var(--surface-primary, white);
        border-radius: 20px;
        font-size: var(--fs-sm, 13px);
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        color: var(--text-secondary, #475569);
      }
      .sales-period-bar button:hover {
        border-color: var(--color-blue-500, #3b82f6);
        color: var(--color-blue-600, #2563eb);
      }
      .sales-period-bar button.active {
        background: var(--color-blue-500, #3b82f6);
        color: white;
        border-color: var(--color-blue-500, #3b82f6);
      }

      /* ── Evolution bar chart ─────────────────────── */
      .sales-evolution-bars {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 120px;
        padding-bottom: 4px;
        margin-top: 12px;
        border-bottom: 1px solid var(--border-subtle, #e2e8f0);
      }
      .sales-evo-bar {
        flex: 1;
        background: var(--color-blue-400, #60a5fa);
        border-radius: 2px 2px 0 0;
        min-height: 2px;
        position: relative;
        transition: opacity 0.15s;
      }
      .sales-evo-bar:hover { opacity: 0.75; }
      .sales-evo-bar:hover::after {
        content: attr(data-tip);
        position: absolute;
        bottom: calc(100% + 4px);
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-slate-900, #0f172a);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        z-index: 20;
        pointer-events: none;
      }
      .sales-evo-axis {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: var(--text-tertiary, #94a3b8);
        margin-top: 4px;
      }

      /* ── Funnel ──────────────────────────────────── */
      .sales-funnel-step {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 0;
      }
      .sales-funnel-label {
        flex: 0 0 160px;
        font-size: var(--fs-sm, 13px);
        font-weight: 600;
        color: var(--text-primary, #0f172a);
      }
      .sales-funnel-track {
        flex: 1;
        height: 28px;
        background: var(--surface-secondary, #f1f5f9);
        border-radius: 6px;
        overflow: hidden;
        position: relative;
      }
      .sales-funnel-fill {
        height: 100%;
        border-radius: 6px;
        display: flex;
        align-items: center;
        padding: 0 10px;
        color: white;
        font-size: 12px;
        font-weight: 700;
        transition: width 0.3s;
        white-space: nowrap;
      }
      .sales-funnel-count {
        flex: 0 0 60px;
        text-align: right;
        font-size: var(--fs-sm, 13px);
        font-weight: 700;
        color: var(--text-primary, #0f172a);
      }
      .sales-funnel-drop {
        flex: 0 0 55px;
        text-align: right;
        font-size: 12px;
        color: var(--text-tertiary, #94a3b8);
      }
      .sales-funnel-alert {
        margin-top: 10px;
        padding: 8px 12px;
        background: #fef2f2;
        border-left: 3px solid var(--color-red-500, #ef4444);
        border-radius: 4px;
        font-size: 12px;
        color: #991b1b;
      }

      /* ── Category table ──────────────────────────── */
      .sales-cat-row {
        display: grid;
        grid-template-columns: 130px 1fr 100px 90px 60px;
        gap: 8px;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid var(--border-subtle, #f1f5f9);
        font-size: var(--fs-sm, 13px);
      }
      .sales-cat-row:last-child { border-bottom: none; }
      .sales-cat-track {
        height: 14px;
        background: var(--surface-secondary, #f1f5f9);
        border-radius: 4px;
        overflow: hidden;
      }
      .sales-cat-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--color-blue-500, #3b82f6), var(--color-blue-300, #93c5fd));
        border-radius: 4px;
      }
      .sales-cat-marge { font-weight: 700; text-align: right; }
      .sales-cat-marge.low  { color: var(--color-red-600,  #dc2626); }
      .sales-cat-marge.mid  { color: var(--color-amber-600, #d97706); }
      .sales-cat-marge.high { color: var(--color-green-600, #16a34a); }

      /* ── Island grid ─────────────────────────────── */
      .sales-island-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 10px;
      }
      .sales-island-card {
        background: var(--surface-primary, white);
        border: 1px solid var(--border-default, #e2e8f0);
        border-radius: 8px;
        padding: 12px;
      }
      .sales-island-name  { font-weight: 700; margin-bottom: 4px; color: var(--text-primary, #0f172a); }
      .sales-island-ca    { font-size: 18px; font-weight: 700; color: var(--color-blue-600, #2563eb); }
      .sales-island-count { font-size: 12px; color: var(--text-tertiary, #94a3b8); margin-top: 2px; }

      /* ── Cohort table ────────────────────────────── */
      .sales-cohort { overflow-x: auto; }
      .sales-cohort table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .sales-cohort th {
        background: var(--color-slate-900, #1e293b);
        color: white;
        padding: 8px 10px;
        text-align: center;
        font-size: 11px;
      }
      .sales-cohort th:first-child { text-align: left; }
      .sales-cohort td {
        padding: 7px 10px;
        text-align: center;
        border-bottom: 1px solid var(--border-subtle, #e2e8f0);
        font-weight: 600;
      }
      .sales-cohort td:first-child {
        text-align: left;
        font-weight: 700;
        color: var(--text-secondary, #334155);
      }
      .coh-empty   { background: #f8fafc; color: var(--text-tertiary, #94a3b8); }
      .coh-low     { background: #fef2f2; color: #991b1b; }
      .coh-mid     { background: #fef3c7; color: #92400e; }
      .coh-high    { background: #dcfce7; color: #166534; }

      /* ── Section hint ────────────────────────────── */
      .sales-hint {
        font-size: 11px;
        color: var(--text-tertiary, #94a3b8);
        font-style: italic;
        margin-top: 2px;
        margin-bottom: 10px;
      }
    `;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── Helpers format ────────────────────────────────────────────────────────

  function fmt(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
    if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'k';
    return String(Math.round(v));
  }

  function fmtFull(n) {
    return (Number(n) || 0).toLocaleString('fr-FR');
  }

  function fmtPct(n, withSign = true) {
    if (n == null) return '—';
    const sign = (withSign && Number(n) > 0) ? '+' : '';
    return sign + Number(n).toFixed(1) + '%';
  }

  function fmtDate(dateStr, bucket) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (bucket === 'week') {
      const dayOfMonth = d.getDate();
      const firstDayDow = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
      const week = Math.ceil((dayOfMonth + firstDayDow) / 7);
      return `S${week} ${d.getMonth() + 1}/${String(d.getFullYear()).slice(-2)}`;
    }
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  function fmtMonth(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
  }

  function margeClass(pct) {
    const v = Number(pct) || 0;
    if (v >= 25) return 'high';
    if (v >= 15) return 'mid';
    return 'low';
  }

  function deltaDirection(pct) {
    const v = Number(pct);
    if (isNaN(v)) return null;
    return v >= 0 ? 'up' : 'down';
  }

  // ── KPI helpers ───────────────────────────────────────────────────────────
  // Convertit les données brutes legacy en format KpiCard attendu.

  function buildKpis(s) {
    const kpi  = s.kpi   || {};
    const evo  = kpi.evolution || {};
    const mrg  = s.marges || {};
    const cibleMarge  = mrg.cible_marge_pct || 40;
    const ecartCible  = mrg.ecart_cible_pct ?? 0;
    const couvPct     = mrg.couverture_pct  ?? 100;

    return [
      {
        key:   'ca_vendu',
        label: `CA période ${period}j`,
        value: kpi.ca_kmf,
        unit:  'KMF',
        delta: evo.ca_pct != null ? {
          is_comparable: true,
          direction: deltaDirection(evo.ca_pct),
          value: Math.abs(evo.ca_pct),
          unit: '%',
          vs_period: `période préc.`,
        } : null,
        data_quality: null,
      },
      {
        key:   'cmds_creees',
        label: 'Commandes',
        value: kpi.nb_commandes,
        unit:  'count',
        delta: evo.commandes_pct != null ? {
          is_comparable: true,
          direction: deltaDirection(evo.commandes_pct),
          value: Math.abs(evo.commandes_pct),
          unit: '%',
          vs_period: `période préc.`,
        } : null,
        data_quality: null,
      },
      {
        key:   'panier_moy_evenement',
        label: 'Panier moyen',
        value: kpi.panier_moyen,
        unit:  'KMF',
        delta: null,
        data_quality: null,
      },
      {
        key:   'marge_variable_reelle',
        label: `Marge réelle · cible ${cibleMarge}%`,
        value: mrg.marge_reelle_kmf,
        unit:  'KMF',
        delta: ecartCible != null ? {
          is_comparable: true,
          direction: ecartCible >= 0 ? 'up' : 'down',
          value: Math.abs(ecartCible),
          unit: '%',
          vs_period: `cible ${cibleMarge}%`,
        } : null,
        data_quality: couvPct < 100 ? {
          completeness: 'partial',
          items_with_data: Math.round(couvPct),
          items_total: 100,
          warning: `${couvPct}% des cmds avec coût réel`,
        } : null,
      },
    ];
  }

  // ── Section renderers ─────────────────────────────────────────────────────

  function renderEvolution(s) {
    const evo    = s.evolution || { points: [], bucket: 'day' };
    const points = evo.points  || [];
    const bucket = evo.bucket  || 'day';
    const label  = bucket === 'week' ? 'par semaine' : 'par jour';

    let html = `
      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">📈 Évolution du CA (${label})</h3>
          </div>`;

    if (!points.length) {
      html += `<div class="empty-state">Aucune donnée pour cette période</div>`;
    } else {
      const maxCA = Math.max(...points.map(p => Number(p.ca_kmf) || 0)) || 1;
      const bars  = points.map(p => {
        const h   = Math.max(2, Math.round((Number(p.ca_kmf) / maxCA) * 100));
        const tip = `${fmtDate(p.date, bucket)} · ${fmtFull(p.ca_kmf)} KMF · ${p.nb_commandes} cmd`;
        return `<div class="sales-evo-bar" style="height:${h}%" data-tip="${tip}"></div>`;
      }).join('');
      const axisL = fmtDate(points[0].date, bucket);
      const axisM = points.length > 2 ? fmtDate(points[Math.floor(points.length / 2)].date, bucket) : '';
      const axisR = fmtDate(points[points.length - 1].date, bucket);

      html += `
        <div class="sales-evolution-bars">${bars}</div>
        <div class="sales-evo-axis">
          <span>${axisL}</span>
          ${axisM ? `<span>${axisM}</span>` : ''}
          <span>${axisR}</span>
        </div>`;
    }

    html += `</div></section>`;
    return html;
  }

  function renderFunnel(s) {
    const funnel = s.funnel  || { etapes: [], perdues: 0 };
    const etapes = funnel.etapes || [];
    const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#10b981'];
    const nbMax  = etapes.length ? Math.max(...etapes.map(e => e.count)) : 1;

    let html = `
      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">🎯 Funnel commandes</h3>
          </div>
          <p class="sales-hint">Parcours du panier validé jusqu'au paiement — les chutes entre étapes révèlent les goulots.</p>`;

    if (!etapes.length) {
      html += `<div class="empty-state">Aucune commande sur la période</div>`;
    } else {
      etapes.forEach((e, i) => {
        const widthPct = nbMax > 0 ? (e.count / nbMax) * 100 : 0;
        const prev     = i > 0 ? etapes[i - 1] : null;
        const dropPct  = prev && prev.count > 0
          ? ((prev.count - e.count) / prev.count * 100).toFixed(1)
          : null;
        const color = COLORS[i % COLORS.length];
        const showLabel = widthPct > 15;

        html += `
          <div class="sales-funnel-step">
            <div class="sales-funnel-label">${e.label}</div>
            <div class="sales-funnel-track">
              <div class="sales-funnel-fill" style="width:${widthPct}%;background:${color}">
                ${showLabel ? fmtPct(e.pct, false) : ''}
              </div>
            </div>
            <div class="sales-funnel-count">${fmtFull(e.count)}</div>
            <div class="sales-funnel-drop">${dropPct !== null ? '−' + dropPct + '%' : '—'}</div>
          </div>`;
      });

      if (funnel.perdues > 0) {
        html += `<div class="sales-funnel-alert">⚠️ ${funnel.perdues} commandes annulées / expirées sur la période</div>`;
      }
    }

    html += `</div></section>`;
    return html;
  }

  function renderCategories(s) {
    const cats  = s.by_category || [];
    const maxCa = cats.length ? Math.max(...cats.map(c => c.ca_kmf)) : 1;

    let html = `
      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">🗂️ CA & marge par catégorie</h3>
          </div>`;

    if (!cats.length) {
      html += `<div class="empty-state">Aucune donnée</div>`;
    } else {
      html += `
        <div class="sales-cat-row" style="font-weight:700;font-size:11px;text-transform:uppercase;color:var(--text-tertiary,#94a3b8);border-bottom:2px solid var(--text-secondary,#334155)">
          <div>Catégorie</div><div>CA</div><div style="text-align:right">CA (KMF)</div>
          <div style="text-align:right">Marge KMF</div><div style="text-align:right">Taux</div>
        </div>`;
      cats.forEach(c => {
        const pct = ((c.ca_kmf / maxCa) * 100).toFixed(1);
        const cls = margeClass(c.taux_marge_pct);
        html += `
          <div class="sales-cat-row">
            <div style="font-weight:600;text-transform:capitalize">${c.categorie || '—'}</div>
            <div class="sales-cat-track"><div class="sales-cat-fill" style="width:${pct}%"></div></div>
            <div style="text-align:right">${fmtFull(c.ca_kmf)}</div>
            <div class="sales-cat-marge ${cls}">${fmtFull(c.marge_kmf)}</div>
            <div class="sales-cat-marge ${cls}">${Number(c.taux_marge_pct).toFixed(1)}%</div>
          </div>`;
      });
    }

    html += `</div></section>`;
    return html;
  }

  function renderTopProducts(s) {
    const prods = (s.top_products || []).slice(0, 5);

    let html = `
      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">🏆 Top 5 produits</h3>
          </div>`;

    if (!prods.length) {
      html += `<div class="empty-state">Aucune vente sur la période</div>`;
    } else {
      html += `
        <table class="data-table">
          <thead><tr>
            <th>#</th><th>Produit</th><th>Catégorie</th><th>Vendus</th><th>CA (KMF)</th>
          </tr></thead>
          <tbody>`;
      prods.forEach((p, i) => {
        html += `
          <tr>
            <td><strong>${i + 1}</strong></td>
            <td>${p.name || '—'}</td>
            <td style="text-transform:capitalize;color:var(--text-tertiary,#94a3b8)">${p.category || '—'}</td>
            <td>${p.nb_sold || 0}</td>
            <td><strong>${fmtFull(p.revenue)}</strong></td>
          </tr>`;
      });
      html += `</tbody></table>`;
    }

    html += `</div></section>`;
    return html;
  }

  function renderByIsland(s) {
    const islands = s.by_island || [];
    let html = `
      <div class="card">
        <div class="card-header"><h3 class="card-title">🏝️ CA par île</h3></div>`;

    if (!islands.length) {
      html += `<div class="empty-state">Aucune donnée</div>`;
    } else {
      html += `<div class="sales-island-grid">`;
      islands.forEach(isl => {
        html += `
          <div class="sales-island-card">
            <div class="sales-island-name">${isl.island || 'Inconnu'}</div>
            <div class="sales-island-ca">${fmtFull(isl.ca)}</div>
            <div class="sales-island-count">${isl.nb || 0} commandes</div>
          </div>`;
      });
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  function renderByPayment(s) {
    const pays = s.by_payment || [];
    const MODE_LABELS = {
      cash_relais: '💵 Cash relais',
      stripe_eur:  '💳 Stripe EUR',
    };

    let html = `
      <div class="card">
        <div class="card-header"><h3 class="card-title">💳 Par mode de paiement</h3></div>`;

    if (!pays.length) {
      html += `<div class="empty-state">Aucune donnée</div>`;
    } else {
      html += `
        <table class="data-table">
          <thead><tr><th>Mode</th><th>Commandes</th><th>CA (KMF)</th></tr></thead>
          <tbody>`;
      pays.forEach(p => {
        const label = MODE_LABELS[p.payment_mode] || p.payment_mode || '—';
        html += `
          <tr>
            <td>${label}</td>
            <td>${p.nb || 0}</td>
            <td><strong>${fmtFull(p.ca)}</strong></td>
          </tr>`;
      });
      html += `</tbody></table>`;
    }

    html += `</div>`;
    return html;
  }

  function renderIslandPaymentRow(s) {
    return `
      <section class="page-section grid grid-2">
        ${renderByIsland(s)}
        ${renderByPayment(s)}
      </section>`;
  }

  function renderCohorts(s) {
    const coh    = s.cohorts || { rows: [], limit_months: 6 };
    const rows   = coh.rows  || [];
    const maxOff = coh.limit_months || 6;

    let html = `
      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">👥 Cohortes — rétention clients</h3>
          </div>
          <p class="sales-hint">Chaque ligne = clients acquis ce mois. Les colonnes montrent combien sont revenus les mois suivants.</p>`;

    if (!rows.length) {
      html += `<div class="empty-state">Pas assez de données pour calculer les cohortes</div>`;
    } else {
      // Build matrix { cohort_month → { offset_months → nb_clients } }
      const matrix   = {};
      const cohorts  = [];
      rows.forEach(r => {
        if (!matrix[r.cohort_month]) {
          matrix[r.cohort_month] = {};
          cohorts.push(r.cohort_month);
        }
        matrix[r.cohort_month][r.offset_months] = r.nb_clients;
      });
      cohorts.sort();

      let thead = `<tr><th>Cohorte (1ère cmd)</th><th>Taille</th>`;
      for (let i = 1; i <= maxOff; i++) thead += `<th>+${i} mois</th>`;
      thead += `</tr>`;

      let tbody = cohorts.map(ch => {
        const taille = matrix[ch][0] || 0;
        let cells = `<td>${fmtMonth(ch)}</td><td class="coh-empty"><strong>${taille}</strong></td>`;
        for (let i = 1; i <= maxOff; i++) {
          const n   = matrix[ch][i] || 0;
          const pct = taille > 0 ? Math.round((n / taille) * 100) : 0;
          const cls = n === 0 ? 'coh-empty' : (pct < 15 ? 'coh-low' : (pct < 35 ? 'coh-mid' : 'coh-high'));
          cells += n > 0
            ? `<td class="${cls}">${n}<br><span style="font-size:10px;font-weight:400">${pct}%</span></td>`
            : `<td class="${cls}">—</td>`;
        }
        return `<tr>${cells}</tr>`;
      }).join('');

      html += `
        <div class="sales-cohort">
          <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
        </div>`;
    }

    html += `</div></section>`;
    return html;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let period     = 30;
  let unsubscribe = null;

  // ── Main render ───────────────────────────────────────────────────────────

  async function render(rootEl) {
    injectStyles();

    // Unsubscribe from any previous filter listener to avoid duplicates
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    rootEl.innerHTML = `
      <h1 class="page-title">Ventes</h1>
      <p class="page-subtitle">Analyse du chiffre d'affaires, funnel commandes et rétention clients</p>

      <div class="sales-period-bar" id="sales-period-bar">
        ${[7, 30, 90, 365].map(p =>
          `<button data-period="${p}"${p === period ? ' class="active"' : ''}>${p === 365 ? '1 an' : p + 'j'}</button>`
        ).join('')}
      </div>

      <section class="page-section">
        <div id="sales-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span> Chargement…</div>
        </div>
      </section>

      <div id="sales-sections">
        <div class="loading-state" style="padding:40px 0;text-align:center">
          <span class="loader"></span> Chargement des ventes…
        </div>
      </div>

      <p id="sales-meta" style="margin-top:16px;font-size:var(--fs-xs,11px);color:var(--text-tertiary,#94a3b8)"></p>
    `;

    // Wire period buttons
    rootEl.querySelector('#sales-period-bar').addEventListener('click', e => {
      const btn = e.target.closest('button[data-period]');
      if (!btn) return;
      period = parseInt(btn.dataset.period, 10);
      loadData(rootEl);
    });

    // Subscribe to global filter changes (e.g. date range from header)
    if (typeof KmcFilters !== 'undefined') {
      unsubscribe = KmcFilters.subscribe(() => loadData(rootEl));
    }

    await loadData(rootEl);
  }

  async function loadData(rootEl) {
    const sectionsEl = rootEl.querySelector('#sales-sections');
    const kpisEl     = rootEl.querySelector('#sales-kpis');
    const metaEl     = rootEl.querySelector('#sales-meta');

    // Sync active button
    rootEl.querySelectorAll('#sales-period-bar button').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.period, 10) === period);
    });

    sectionsEl.innerHTML = `<div class="loading-state" style="padding:32px 0;text-align:center"><span class="loader"></span> Chargement…</div>`;

    try {
      // KmcFilters fournit les filtres globaux (dates, île, etc.) ;
      // le sélecteur de période vient en paramètre dédié.
      const baseFilters = typeof KmcFilters !== 'undefined' ? KmcFilters.get() : {};
      const data = await KmcApi.getSales({ ...baseFilters, period });

      // KPI bar
      const kpis = buildKpis(data);
      KpiCard.renderBar(kpisEl, kpis);

      // Sections
      sectionsEl.innerHTML =
        renderEvolution(data)      +
        renderFunnel(data)         +
        renderCategories(data)     +
        renderTopProducts(data)    +
        renderIslandPaymentRow(data) +
        renderCohorts(data);

      // Méta
      if (data._meta) {
        metaEl.textContent =
          `Données au ${new Date(data._meta.generated_at || Date.now()).toLocaleString('fr-FR')}` +
          (data._meta.cached ? ' · cache' : '');
      }

    } catch (err) {
      const isApiError = typeof KmcApi !== 'undefined' && err instanceof KmcApi.ApiError;
      kpisEl.innerHTML = '';
      sectionsEl.innerHTML = `
        <div class="error-state">
          <strong>Erreur lors du chargement des ventes</strong><br>
          ${err.message || String(err)}
          ${isApiError && err.status === 401 ? '<br><em>Session expirée — rechargez la page.</em>' : ''}
        </div>`;
      console.error('[SalesView]', err);
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  global.SalesView = { render };

})(window);
