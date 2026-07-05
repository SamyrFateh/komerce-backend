/**
 * @komerce-arch
 * @role          admin-sante-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        filters (from, to), business health KPIs
 * @outputs       sante_page_dom (santé business, KPIs critiques, signaux faibles)
 * @depends       api-client.js, filters-store.js, utils.js, components/KpiCard.js, components/Charts.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  health, kpi, admin-dashboard
 * @version       2026-06
 */

'use strict';
/**
 * KOMERCE Dashboard — Vue Santé Business /admin/sante
 * ════════════════════════════════════════════════════════════════════════
 * Question : "Est-ce que la machine tourne, et est-ce qu'elle ne va pas casser ?"
 *
 * QUATRE PILIERS (pondérés) :
 *   🩸 Cash      (30%) — collecte relais, retards, buckets
 *   📈 Marge     (30%) — marge réelle vs cible finance_config
 *   ⚙️ Pipeline  (25%) — commandes actives, blocages, retards
 *   👥 Clients   (15%) — segments, VIP à risque, LTV silencieuse
 *
 * CORRÉLATIONS DÉTECTÉES (6 règles) :
 *   1. Marge ↘ + Douane ↗     → coût douane ronge la marge
 *   2. Marge ↘ + Panier ↘     → promos trop agressives / mix dégradé
 *   3. Cash retard concentré   → relais(s) spécifique(s) à contacter
 *   4. Clients à risque ↗     → LTV silencieuse à reconquérir
 *   5. Pipeline bloqué         → commandes payées ne livrant pas
 *   6. Mix catégories défavorable → catégorie faible marge en croissance
 *
 * Sources API (toutes dans KmcApi, toutes exportées) :
 *   KmcApi.getOps(filters)               → /api/dashboard/ops
 *   KmcApi.getFinance(filters)           → /api/dashboard/finance
 *   KmcApi.getClients(filters)           → /api/dashboard/clients
 *   KmcApi.getSales(filters, {period:30})→ /api/dashboard/sales
 *   KmcApi.getCashReconciliation(params) → /api/cash/reconciliation
 *   KmcApi.getCashUncollected(params)    → /api/cash/uncollected
 *   KmcApi.getCustomsRatesEffective()    → /api/admin/customs-shipments/rates/effective
 *   KmcApi.getFinanceConfig()            → /api/admin/finance-config
 *
 * Migration depuis : ct-views-sante.js (644 lignes, ADR-008)
 * Lot 5 — statut cible : integrated_validated
 */

(function (global) {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
   * CSS — injecté une seule fois, namespaced sv-*
   * ══════════════════════════════════════════════════════════════════════ */
  (function injectStyles() {
    if (document.getElementById('sante-styles')) return;
    const s = document.createElement('style');
    s.id = 'sante-styles';
    s.textContent = `
      /* ── Hero score ─────────────────────────────────────────────────── */
      .sv-hero {
        background: linear-gradient(135deg, var(--kmc-navy) 0%, var(--kmc-navy-3) 100%);
        color: var(--text-on-dark);
        border-radius: var(--border-radius-lg);
        padding: var(--sp-6) var(--sp-8);
        margin-bottom: var(--sp-6);
        display: flex;
        align-items: center;
        gap: var(--sp-8);
      }
      .sv-hero-score {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--sp-1);
      }
      .sv-score-num {
        font-size: 3.5rem;
        font-weight: var(--fw-bold);
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .sv-score-num.is-green  { color: #86efac; }
      .sv-score-num.is-yellow { color: #fcd34d; }
      .sv-score-num.is-red    { color: #fca5a5; }
      .sv-score-label {
        font-size: var(--fs-xs);
        color: var(--text-on-dark-2);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: var(--fw-semibold);
      }
      .sv-hero-body { flex: 1; min-width: 0; }
      .sv-hero-title {
        font-size: var(--fs-2xl);
        font-weight: var(--fw-bold);
        margin-bottom: var(--sp-1);
      }
      .sv-hero-sub {
        font-size: var(--fs-sm);
        color: var(--text-on-dark-2);
        margin-bottom: var(--sp-4);
      }
      .sv-hero-verdict {
        font-size: var(--fs-lg);
        font-weight: var(--fw-semibold);
      }
      .sv-hero-verdict.is-green  { color: #86efac; }
      .sv-hero-verdict.is-yellow { color: #fcd34d; }
      .sv-hero-verdict.is-red    { color: #fca5a5; }

      /* ── 4 piliers ──────────────────────────────────────────────────── */
      .sv-pillars {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: var(--sp-4);
        margin-bottom: var(--sp-6);
      }
      .sv-pillar {
        background: var(--bg-card);
        border: 1px solid var(--border-color);
        border-left-width: 4px;
        border-radius: var(--border-radius-lg);
        padding: var(--sp-4) var(--sp-5);
        box-shadow: var(--shadow-sm);
        transition: box-shadow 0.15s;
      }
      .sv-pillar:hover { box-shadow: var(--shadow); }
      .sv-pillar.is-green  { border-left-color: var(--kmc-green);  background: linear-gradient(to right, #f0fdf4 0%, var(--bg-card) 55%); }
      .sv-pillar.is-yellow { border-left-color: var(--kmc-orange); background: linear-gradient(to right, #fffbeb 0%, var(--bg-card) 55%); }
      .sv-pillar.is-red    { border-left-color: var(--kmc-red);    background: linear-gradient(to right, #fef2f2 0%, var(--bg-card) 55%); }
      .sv-pillar.is-grey   { border-left-color: var(--border-color-2); }

      .sv-pillar-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--sp-2);
      }
      .sv-pillar-name {
        font-size: var(--fs-xs);
        font-weight: var(--fw-bold);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-secondary);
      }
      .sv-pillar-pulse { font-size: 1.1rem; }
      .sv-pillar-value {
        font-size: var(--fs-2xl);
        font-weight: var(--fw-bold);
        color: var(--text-primary);
        line-height: 1.15;
        margin-bottom: var(--sp-1);
      }
      .sv-pillar-unit {
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        color: var(--text-secondary);
        margin-left: 2px;
      }
      .sv-pillar-trend {
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        margin-bottom: var(--sp-3);
      }
      .sv-pillar-trend.is-up   { color: var(--kmc-green); }
      .sv-pillar-trend.is-down { color: var(--kmc-red); }
      .sv-pillar-trend.is-flat { color: var(--text-tertiary); }
      .sv-pillar-why {
        padding-top: var(--sp-3);
        border-top: 1px dashed var(--border-color);
        font-size: var(--fs-xs);
        color: var(--text-secondary);
        line-height: 1.5;
      }

      /* ── Corrélations ───────────────────────────────────────────────── */
      .sv-section {
        background: var(--bg-card);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-lg);
        padding: var(--sp-5);
        margin-bottom: var(--sp-4);
        box-shadow: var(--shadow-sm);
      }
      .sv-section-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: var(--sp-1);
      }
      .sv-section-title {
        font-size: var(--fs-base);
        font-weight: var(--fw-bold);
        color: var(--text-primary);
      }
      .sv-section-desc {
        font-size: var(--fs-xs);
        color: var(--text-tertiary);
        font-style: italic;
        margin-bottom: var(--sp-4);
      }

      .sv-correl-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: var(--sp-3);
      }
      .sv-correl {
        background: var(--bg-hover);
        border-radius: var(--border-radius);
        padding: var(--sp-3) var(--sp-4);
        border-left: 3px solid var(--border-color-2);
      }
      .sv-correl.is-alert     { border-left-color: var(--kmc-red);    background: #fef2f2; }
      .sv-correl.is-attention { border-left-color: var(--kmc-orange); background: #fffbeb; }
      .sv-correl-label {
        font-size: var(--fs-xs);
        font-weight: var(--fw-bold);
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: var(--sp-2);
      }
      .sv-correl-insight {
        font-size: var(--fs-xs);
        color: var(--text-secondary);
        line-height: 1.5;
        margin-bottom: var(--sp-3);
      }
      .sv-correl-action {
        display: inline-block;
        background: var(--kmc-navy);
        color: white;
        padding: 3px var(--sp-3);
        border-radius: var(--border-radius);
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        cursor: pointer;
        border: none;
        text-decoration: none;
        transition: background 0.15s;
      }
      .sv-correl-action:hover { background: var(--kmc-navy-3); }

      .sv-ok-state {
        display: flex;
        align-items: center;
        gap: var(--sp-3);
        padding: var(--sp-4);
        color: var(--kmc-green);
        font-weight: var(--fw-semibold);
        font-size: var(--fs-sm);
      }

      /* ── Tables détail ──────────────────────────────────────────────── */
      .sv-rank {
        width: 100%;
        font-size: var(--fs-sm);
      }
      .sv-rank th {
        background: var(--bg-hover);
        padding: var(--sp-2) var(--sp-3);
        text-align: left;
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-secondary);
        border-bottom: 1px solid var(--border-color);
      }
      .sv-rank td {
        padding: var(--sp-2) var(--sp-3);
        border-bottom: 1px solid var(--border-color);
        color: var(--text-primary);
      }
      .sv-rank td.num { text-align: right; font-weight: var(--fw-semibold); font-variant-numeric: tabular-nums; }
      .sv-rank tr:last-child td { border-bottom: none; }
      .sv-rank tr.sv-row-bad td { background: #fef2f2; }

      .sv-bucket-badge {
        display: inline-block;
        padding: 2px var(--sp-2);
        border-radius: 20px;
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
      }
      .sv-bucket-badge.is-ok  { background: var(--kmc-green-bg);  color: var(--kmc-green-text); }
      .sv-bucket-badge.is-warn { background: var(--kmc-orange-bg); color: var(--kmc-orange-text); }
      .sv-bucket-badge.is-crit { background: var(--kmc-red-bg);    color: var(--kmc-red-text); }

      /* ── Loader / erreur ────────────────────────────────────────────── */
      .sv-loading {
        padding: var(--sp-12) var(--sp-6);
        text-align: center;
        color: var(--text-tertiary);
        font-style: italic;
      }
      .sv-error {
        padding: var(--sp-4);
        color: var(--kmc-red);
        background: var(--kmc-red-bg);
        border-radius: var(--border-radius);
        font-size: var(--fs-sm);
      }

      /* ── Responsive ─────────────────────────────────────────────────── */
      @media (max-width: 640px) {
        .sv-hero { flex-direction: column; gap: var(--sp-4); padding: var(--sp-4); }
        .sv-hero-score { flex-direction: row; gap: var(--sp-4); }
        .sv-score-num { font-size: 2.5rem; }
      }
    `;
    document.head.appendChild(s);
  })();

  /* ══════════════════════════════════════════════════════════════════════
   * Helpers
   * ══════════════════════════════════════════════════════════════════════ */

  function fmt(n) {
    return (Number(n) || 0).toLocaleString('fr-FR');
  }

  function fmtShort(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
    if (Math.abs(v) >= 1_000)     return (v / 1_000).toFixed(0) + 'k';
    return String(Math.round(v));
  }

  function fmtPct(n, dec = 1) {
    if (n == null || isNaN(n)) return '—';
    return (+n).toFixed(dec) + '%';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pulseIcon(health) {
    return { green: '🟢', yellow: '🟡', red: '🔴', grey: '⚪' }[health] || '⚪';
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Calcul des piliers
   * ══════════════════════════════════════════════════════════════════════ */

  function computePillars(d) {
    const pillars = {
      cash:     { health: 'grey', value: null, trend: null, why: 'Données indisponibles', detail: null },
      marge:    { health: 'grey', value: null, trend: null, why: 'Données indisponibles', detail: null },
      pipeline: { health: 'grey', value: null, trend: null, why: 'Données indisponibles', detail: null },
      clients:  { health: 'grey', value: null, trend: null, why: 'Données indisponibles', detail: null },
    };

    /* ── PILIER 1 — Cash ─────────────────────────────────────────────── */
    if (d.uncollected) {
      const b = d.uncollected.buckets || {};
      const b48  = b['48h_72h']?.kmf  || 0;
      const b72  = b['72h_7d']?.kmf   || 0;
      const bOld = b['7d_plus']?.kmf  || 0;
      const totalRetard    = b48 + b72 + bOld;
      const totalPending   = d.uncollected.total_pending_kmf || 0;
      const pctRetard      = totalPending > 0 ? (totalRetard / totalPending * 100) : 0;

      pillars.cash.value  = totalPending;
      pillars.cash.detail = {
        total_pending: totalPending,
        retard_48_72h: b48,
        retard_72h_7j: b72,
        retard_7j_plus: bOld,
        pct_retard: pctRetard,
        buckets: b,
      };

      if (totalRetard === 0) {
        pillars.cash.health = 'green';
        pillars.cash.trend  = 'is-up';
        pillars.cash.why    = 'Aucun cash en retard';
      } else if (bOld > 0 && pctRetard > 30) {
        pillars.cash.health = 'red';
        pillars.cash.trend  = 'is-down';
        pillars.cash.why    = `<strong>${fmt(bOld)} KMF</strong> en retard > 7 jours`;
      } else if (pctRetard > 15) {
        pillars.cash.health = 'yellow';
        pillars.cash.trend  = 'is-down';
        pillars.cash.why    = `${fmtPct(pctRetard, 0)} du cash en attente dépasse 48h`;
      } else {
        pillars.cash.health = 'green';
        pillars.cash.trend  = 'is-flat';
        pillars.cash.why    = 'Retard mineur, sous contrôle';
      }
    }

    /* ── PILIER 2 — Marge ────────────────────────────────────────────── */
    if (d.sales?.kpi) {
      const margePct = d.sales.kpi.marge_real_pct ?? d.sales.kpi.marge_pct ?? 0;
      // ADR-009 : cible depuis finance_config, fallback 40 %
      const cibleMarge = d.financeConfig?.targets?.marge_brute_pct
        ? Number(d.financeConfig.targets.marge_brute_pct)
        : 40;
      const ecart = margePct - cibleMarge;

      pillars.marge.value  = margePct;
      pillars.marge.detail = { marge_pct: margePct, cible: cibleMarge, ecart, source: 'finance_config' };
      pillars.marge.trend  = ecart >= 0 ? 'is-up' : 'is-down';

      if (margePct >= cibleMarge) {
        pillars.marge.health = 'green';
        pillars.marge.why    = `Au-dessus de la cible (${cibleMarge}%)`;
      } else if (margePct >= cibleMarge - 10) {
        pillars.marge.health = 'yellow';
        pillars.marge.why    = `${fmtPct(Math.abs(ecart))} sous la cible de ${cibleMarge}%`;
      } else {
        pillars.marge.health = 'red';
        pillars.marge.why    = `<strong>${fmtPct(Math.abs(ecart))} sous la cible</strong> — impact direct sur la trésorerie`;
      }
    }

    /* ── PILIER 3 — Pipeline ─────────────────────────────────────────── */
    if (d.ops?.activite) {
      const blocages    = d.ops.activite.commandes_bloquees || 0;
      const retards     = d.ops.sla?.late                   || 0;
      const totalActifs = d.ops.activite.commandes_en_cours || 1;
      const blockedCount = blocages + retards;
      const pctBlocked   = (blockedCount / totalActifs * 100);

      pillars.pipeline.value  = totalActifs;
      pillars.pipeline.detail = { total_actifs: totalActifs, blocages, retards, pct_blocked: pctBlocked };
      pillars.pipeline.trend  = blockedCount === 0 ? 'is-up' : (pctBlocked > 10 ? 'is-down' : 'is-flat');

      if (blockedCount === 0) {
        pillars.pipeline.health = 'green';
        pillars.pipeline.why    = 'Pipeline fluide, aucun blocage';
      } else if (pctBlocked > 15) {
        pillars.pipeline.health = 'red';
        pillars.pipeline.why    = `<strong>${blockedCount} colis bloqués</strong> sur ${totalActifs} actifs`;
      } else if (pctBlocked > 5) {
        pillars.pipeline.health = 'yellow';
        pillars.pipeline.why    = `${blockedCount} commandes à débloquer (${fmtPct(pctBlocked, 0)})`;
      } else {
        pillars.pipeline.health = 'green';
        pillars.pipeline.why    = `${blockedCount} colis sous surveillance — flux normal`;
      }
    }

    /* ── PILIER 4 — Clients ──────────────────────────────────────────── */
    if (d.clients?.segments) {
      const seg       = d.clients.segments;
      const atRiskLtv = (d.clients.at_risk_clients || [])
        .reduce((s, c) => s + (c.ltv_kmf || 0), 0);

      pillars.clients.value  = seg.nb_total || 0;
      pillars.clients.detail = {
        nb_total:    seg.nb_total,
        new:         seg.new,
        recurrent:   seg.recurrent,
        vip:         seg.vip,
        at_risk:     seg.at_risk,
        dormant:     seg.dormant,
        at_risk_ltv: atRiskLtv,
      };
      pillars.clients.trend = (seg.at_risk || 0) === 0 ? 'is-up' : (atRiskLtv > 500_000 ? 'is-down' : 'is-flat');

      if ((seg.at_risk || 0) === 0) {
        pillars.clients.health = 'green';
        pillars.clients.why    = 'Aucun client VIP à risque';
      } else if (atRiskLtv > 500_000 || seg.at_risk > 10) {
        pillars.clients.health = 'red';
        pillars.clients.why    = `<strong>${fmt(atRiskLtv)} KMF</strong> de LTV silencieuse à reconquérir`;
      } else {
        pillars.clients.health = 'yellow';
        pillars.clients.why    = `${seg.at_risk} clients à relancer (${fmtShort(atRiskLtv)} KMF LTV)`;
      }
    }

    return pillars;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Score global pondéré
   * ══════════════════════════════════════════════════════════════════════ */

  const WEIGHTS    = { cash: 30, marge: 30, pipeline: 25, clients: 15 };
  const HEALTH_VAL = { green: 100, yellow: 60, red: 20, grey: 50 };

  function computeScore(pillars) {
    let totalWeight = 0, totalScore = 0;
    for (const [k, w] of Object.entries(WEIGHTS)) {
      const h = pillars[k].health;
      if (h !== 'grey') { totalScore += HEALTH_VAL[h] * w; totalWeight += w; }
    }
    const score = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;

    let cls, emoji, message;
    if (score >= 80)      { cls = 'is-green';  emoji = '💚'; message = 'La machine tourne bien'; }
    else if (score >= 60) { cls = 'is-yellow'; emoji = '⚠️'; message = 'Attention requise'; }
    else                  { cls = 'is-red';    emoji = '🚨'; message = 'Action urgente'; }

    return { score, cls, emoji, message };
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Détection des corrélations
   * ══════════════════════════════════════════════════════════════════════ */

  function detectCorrelations(d, pillars) {
    const correlations = [];

    /* CORR 1 — Marge ↘ + Douane ↗ */
    if (pillars.marge.health !== 'green' && d.customs?.rates) {
      const rate90 = d.customs.rates.last_90d?.rate_pct || 0;
      const rate30 = d.customs.rates.last_30d?.rate_pct || 0;
      if (rate30 > rate90 + 1.5) {
        correlations.push({
          severity: 'is-alert',
          icon: '🔥',
          title: 'Marge en baisse + Douane en hausse',
          insight: `Le taux douane terrain est passé de <strong>${fmtPct(rate90)}</strong> (90j) à <strong>${fmtPct(rate30)}</strong> (30j). C'est probablement la principale cause de l'érosion de marge.`,
          action: '/admin/customs',
          actionLabel: '→ Voir Historique Douane',
        });
      }
    }

    /* CORR 2 — Marge ↘ + Panier moyen ↘ */
    if (pillars.marge.health !== 'green' && d.sales?.kpi) {
      const panier     = d.sales.kpi.panier_moyen_kmf          || 0;
      const panierPrev = d.sales.kpi.panier_moyen_previous_kmf || panier;
      if (panierPrev > 0 && panier < panierPrev * 0.92) {
        const dropPct = (1 - panier / panierPrev) * 100;
        correlations.push({
          severity: 'is-attention',
          icon: '🛒',
          title: 'Marge ↘ + Panier moyen ↘',
          insight: `Le panier moyen est tombé de <strong>${fmt(panierPrev)}</strong> à <strong>${fmt(panier)}</strong> KMF (−${fmtPct(dropPct, 0)}). Promotions trop agressives ou mix de gamme dégradé ?`,
          action: '/admin/sales',
          actionLabel: '→ Voir analyse Ventes',
        });
      }
    }

    /* CORR 3 — Cash retard concentré sur certains relais */
    if (pillars.cash.health !== 'green' && d.reconciliation?.par_relais) {
      const bad = (d.reconciliation.par_relais || [])
        .filter(r => (r.ecart_kmf || 0) > 50_000)
        .sort((a, b) => (b.ecart_kmf || 0) - (a.ecart_kmf || 0));

      if (bad.length) {
        const top = bad[0];
        const second = bad[1] ? `, puis <strong>${esc(bad[1].relais || '?')}</strong>` : '';
        correlations.push({
          severity: 'is-alert',
          icon: '📍',
          title: `Cash retard concentré sur ${bad.length} relais`,
          insight: `Top relais en écart : <strong>${esc(top.relais || '?')}</strong> (${fmt(top.ecart_kmf || 0)} KMF d'écart)${second}. Ces relais à contacter en priorité.`,
          action: '/admin/costing',
          actionLabel: '→ Voir Comptabilité',
        });
      }
    }

    /* CORR 4 — Clients à risque = revenus futurs en jeu */
    if (pillars.clients.detail?.at_risk > 0) {
      const { at_risk, at_risk_ltv } = pillars.clients.detail;
      const avgLtv = at_risk > 0 ? Math.round(at_risk_ltv / at_risk) : 0;
      correlations.push({
        severity: at_risk_ltv > 500_000 ? 'is-alert' : 'is-attention',
        icon: '👥',
        title: `${at_risk} clients à risque (LTV silencieuse)`,
        insight: `<strong>${fmt(at_risk_ltv)} KMF</strong> de LTV cumulée inactive depuis 60–180j. Soit en moyenne <strong>${fmt(avgLtv)} KMF/client</strong>. Une relance peut récupérer un pourcentage significatif.`,
        action: '/admin/clients',
        actionLabel: '→ Voir Clients à risque',
      });
    }

    /* CORR 5 — Pipeline bloqué */
    if (pillars.pipeline.detail?.blocages > 0) {
      correlations.push({
        severity: 'is-attention',
        icon: '⚙️',
        title: `${pillars.pipeline.detail.blocages} commandes bloquées`,
        insight: `Ces commandes ne génèrent ni revenu (pas livrées) ni satisfaction client. À traiter en priorité pour libérer le pipeline.`,
        action: '/admin/orders-logistics?anomalie=stock_blocked',
        actionLabel: '→ Voir Pipeline Ops',
      });
    }

    /* CORR 6 — Mix catégories défavorable */
    if (d.sales?.by_category?.length && pillars.marge.health !== 'green') {
      const lowMargin = (d.sales.by_category)
        .filter(c => (c.marge_real_pct || 0) < 15 && (c.ca_kmf || 0) > 100_000)
        .sort((a, b) => (b.ca_kmf || 0) - (a.ca_kmf || 0));

      if (lowMargin.length) {
        const top = lowMargin[0];
        correlations.push({
          severity: 'is-attention',
          icon: '🗂️',
          title: 'Catégorie à faible marge en croissance',
          insight: `<strong>${esc(top.category || '?')}</strong> représente ${fmt(top.ca_kmf)} KMF de CA mais seulement ${fmtPct(top.marge_real_pct, 1)} de marge. Revoir le pricing ou réduire la promotion.`,
          action: '/admin/pricing',
          actionLabel: '→ Ajuster Pricing',
        });
      }
    }

    return correlations;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Rendu HTML
   * ══════════════════════════════════════════════════════════════════════ */

  function renderHero(score) {
    return `
      <div class="sv-hero">
        <div class="sv-hero-score">
          <span class="sv-score-num ${score.cls}">${score.score}</span>
          <span class="sv-score-label">/ 100</span>
        </div>
        <div class="sv-hero-body">
          <div class="sv-hero-title">🏥 Santé Business</div>
          <div class="sv-hero-sub">Vue agrégée temps réel — chiffres corrélés qui s'expliquent entre eux</div>
          <div class="sv-hero-verdict ${score.cls}">${score.emoji} ${esc(score.message)}</div>
        </div>
      </div>
    `;
  }

  function renderPillars(pillars) {
    const defs = [
      {
        key: 'cash',
        icon: '🩸',
        name: 'Cash',
        renderValue: (p) => p.detail
          ? `${fmtShort(p.detail.total_pending)}<span class="sv-pillar-unit"> KMF en attente</span>`
          : '—',
        renderTrend: (p) => p.detail?.pct_retard > 0
          ? `${fmtPct(p.detail.pct_retard, 0)} en retard`
          : 'Aucun retard',
      },
      {
        key: 'marge',
        icon: '📈',
        name: 'Marge réelle',
        renderValue: (p) => p.detail
          ? fmtPct(p.detail.marge_pct)
          : '—',
        renderTrend: (p) => p.detail
          ? `${p.detail.ecart >= 0 ? '↗' : '↘'} Cible : ${p.detail.cible}%`
          : '',
      },
      {
        key: 'pipeline',
        icon: '⚙️',
        name: 'Pipeline',
        renderValue: (p) => p.detail
          ? `${p.detail.total_actifs}<span class="sv-pillar-unit"> commandes</span>`
          : '—',
        renderTrend: (p) => p.detail
          ? (p.detail.blocages > 0 ? `${p.detail.blocages} bloquées` : 'Aucun blocage')
          : '',
      },
      {
        key: 'clients',
        icon: '👥',
        name: 'Clients',
        renderValue: (p) => p.detail
          ? `${fmt(p.detail.nb_total)}<span class="sv-pillar-unit"> clients</span>`
          : '—',
        renderTrend: (p) => p.detail
          ? (p.detail.at_risk > 0
              ? `${p.detail.at_risk} à risque (${fmtShort(p.detail.at_risk_ltv)} KMF)`
              : 'Aucun à risque')
          : '',
      },
    ];

    return `
      <div class="sv-pillars">
        ${defs.map(def => {
          const p = pillars[def.key];
          return `
            <div class="sv-pillar is-${p.health}">
              <div class="sv-pillar-head">
                <span class="sv-pillar-name">${def.icon} ${def.name}</span>
                <span class="sv-pillar-pulse">${pulseIcon(p.health)}</span>
              </div>
              <div class="sv-pillar-value">${def.renderValue(p)}</div>
              <div class="sv-pillar-trend ${p.trend || 'is-flat'}">${def.renderTrend(p)}</div>
              <div class="sv-pillar-why">${p.why}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderCorrelations(correlations) {
    if (!correlations.length) {
      return `
        <div class="sv-section">
          <div class="sv-section-head">
            <span class="sv-section-title">🔗 Corrélations détectées</span>
          </div>
          <div class="sv-section-desc">Les chiffres qui se parlent entre eux pour expliquer la situation.</div>
          <div class="sv-ok-state">✅ Aucune corrélation négative détectée. La machine tourne sans incohérence visible.</div>
        </div>
      `;
    }

    return `
      <div class="sv-section">
        <div class="sv-section-head">
          <span class="sv-section-title">🔗 Corrélations détectées (${correlations.length})</span>
        </div>
        <div class="sv-section-desc">Les chiffres qui s'expliquent les uns les autres — diagnostic des causes profondes.</div>
        <div class="sv-correl-grid">
          ${correlations.map(c => `
            <div class="sv-correl ${c.severity}">
              <div class="sv-correl-label">${c.icon} ${esc(c.title)}</div>
              <div class="sv-correl-insight">${c.insight}</div>
              ${c.action
                ? `<a class="sv-correl-action" href="${esc(c.action)}">${esc(c.actionLabel)}</a>`
                : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderClientDetail(clients) {
    if (!clients?.at_risk_clients?.length) return '';

    const rows = clients.at_risk_clients.slice(0, 5).map(c => `
      <tr class="sv-row-bad">
        <td><strong>${esc(c.name || '—')}</strong></td>
        <td>${esc(c.phone || '—')}</td>
        <td class="num">${c.nb_commandes || 0}</td>
        <td class="num">${fmt(c.ltv_kmf)} KMF</td>
        <td class="num">${c.jours_silence || '?'}j</td>
      </tr>
    `).join('');

    return `
      <div class="sv-section">
        <div class="sv-section-head">
          <span class="sv-section-title">⚠️ Top clients à risque (à relancer)</span>
        </div>
        <div class="sv-section-desc">Clients ayant commandé ≥ 2 fois mais silencieux 60–180j. Une relance peut les récupérer.</div>
        <table class="sv-rank">
          <thead><tr>
            <th>Client</th><th>Téléphone</th><th>Cmds</th><th>LTV</th><th>Silence</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderCashDetail(uncollected) {
    if (!uncollected?.buckets) return '';

    const bucketDefs = [
      { k: '0_24h',   label: '< 24h',     cls: 'is-ok' },
      { k: '24h_48h', label: '24–48h',    cls: 'is-ok' },
      { k: '48h_72h', label: '48–72h',    cls: 'is-warn' },
      { k: '72h_7d',  label: '3–7 jours', cls: 'is-warn' },
      { k: '7d_plus', label: '> 7 jours', cls: 'is-crit' },
    ];

    const rows = bucketDefs
      .filter(bd => (uncollected.buckets[bd.k]?.count || 0) > 0)
      .map(bd => {
        const bk = uncollected.buckets[bd.k];
        const labelMap = { 'is-ok': '🟢 Normal', 'is-warn': '🟡 Surveiller', 'is-crit': '🔴 Critique' };
        return `
          <tr${bd.cls === 'is-crit' ? ' class="sv-row-bad"' : ''}>
            <td><strong>${bd.label}</strong></td>
            <td class="num">${bk.count}</td>
            <td class="num">${fmt(bk.kmf)} KMF</td>
            <td><span class="sv-bucket-badge ${bd.cls}">${labelMap[bd.cls]}</span></td>
          </tr>
        `;
      }).join('');

    if (!rows) return '';

    return `
      <div class="sv-section">
        <div class="sv-section-head">
          <span class="sv-section-title">🩸 Détail cash en attente par âge</span>
        </div>
        <div class="sv-section-desc">Les buckets > 7j sont les plus critiques — relance immédiate requise.</div>
        <table class="sv-rank">
          <thead><tr>
            <th>Bucket</th><th>Nb commandes</th><th>Montant</th><th>État</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Render principal
   * ══════════════════════════════════════════════════════════════════════ */

  async function render(rootEl) {
    rootEl.innerHTML = `
      <h1 class="page-title">Santé Business</h1>
      <p class="page-subtitle">Vue agrégée des 4 piliers — Cash, Marge, Pipeline, Clients</p>
      <div class="sv-loading">🏥 Diagnostic en cours…</div>
    `;

    // Paramètres cash (30 derniers jours)
    const today  = new Date();
    const from30 = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to30   = today.toISOString().slice(0, 10);

    let data;
    try {
      const filters = KmcFilters.get();

      const [ops, finance, clients, sales, reconciliation, uncollected, customs, financeConfig] =
        await Promise.all([
          KmcApi.getOps(filters).catch(() => null),
          KmcApi.getFinance(filters).catch(() => null),
          KmcApi.getClients(filters).catch(() => null),
          KmcApi.getSales(filters, { period: 30 }).catch(() => null),
          KmcApi.getCashReconciliation({ from: from30, to: to30 }).catch(() => null),
          KmcApi.getCashUncollected({}).catch(() => null),
          KmcApi.getCustomsRatesEffective().catch(() => null),
          KmcApi.getFinanceConfig().catch(() => null),
        ]);

      data = { ops, finance, clients, sales, reconciliation, uncollected, customs, financeConfig };
    } catch (err) {
      console.error('[SanteView] fetch error:', err);
      rootEl.innerHTML = `
        <h1 class="page-title">Santé Business</h1>
        <div class="sv-error">❌ Erreur de chargement : ${esc(err.message || 'inconnue')}${err.status === 401 ? ' — connectez-vous comme admin' : ''}</div>
      `;
      return;
    }

    const pillars      = computePillars(data);
    const score        = computeScore(pillars);
    const correlations = detectCorrelations(data, pillars);

    rootEl.innerHTML = `
      <h1 class="page-title">Santé Business</h1>
      <p class="page-subtitle">Vue agrégée des 4 piliers — Cash, Marge, Pipeline, Clients</p>

      ${renderHero(score)}
      ${renderPillars(pillars)}
      ${renderCorrelations(correlations)}
      ${renderClientDetail(data.clients)}
      ${renderCashDetail(data.uncollected)}

      <p style="margin-top:var(--sp-4);font-size:var(--fs-xs);color:var(--text-tertiary);">
        Diagnostic généré le ${new Date().toLocaleTimeString('fr-FR')} — 8 sources agrégées
      </p>
    `;
  }

  global.SanteView = { render };

})(window);
