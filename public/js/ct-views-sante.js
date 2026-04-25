/* ═══════════════════════════════════════════════════════════════════════════
   CT View — Santé Business
   Shell: CT · Section: cockpit (NEW — ADR-008)

   ROLE :
   ─────
   Vue exécutive synthétique qui répond à la question : "Est-ce que la
   machine tourne, et est-ce qu'elle ne va pas casser ?"

   PHILOSOPHIE :
   ─────────────
   Au lieu de chiffres juxtaposés, des chiffres qui s'expliquent entre eux.
   Pour chaque indicateur critique, on donne :
     1. La valeur actuelle + son seuil santé (vert/jaune/rouge)
     2. La tendance (↗ ↘) sur 7-30j
     3. Le POURQUOI quand c'est rouge/jaune (décomposition corrélée)
     4. L'action suggérée

   QUATRE PILIERS :
   ────────────────
     🩸 Cash         — collecte du cash relais, retards, dépôts
     📈 Marge        — marge réelle vs cible, douane, mix
     ⚙️ Pipeline     — pipeline opérationnel (commandes en cours, blocages)
     👥 Clients      — segments à risque, acquisition, rétention

   CORRÉLATIONS DÉTECTÉES (chiffres qui se parlent) :
   ─────────────────────────────────────────────────
     • Marge ↘ + Douane ↗ → "C'est la douane qui ronge"
     • Marge ↘ + Panier ↘ → "Tu vends moins cher / promos trop fortes"
     • Marge ↘ + Mix défavorable → "Catégorie X (faible marge) progresse trop"
     • Cash retard ↗ + Relais X → "Relais X concentre les retards"
     • Invendus ↗ + Catégorie X → "Stock dormant en X"
     • Clients à risque ↗ → LTV à reconquérir = montant
   ═══════════════════════════════════════════════════════════════════════════ */

window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.sante = function(main) {
  /* ── Styles ─────────────────────────────────────────────────────────── */
  (function injectStyles() {
    if (document.getElementById('ct-sante-styles')) return;
    var style = document.createElement('style');
    style.id = 'ct-sante-styles';
    style.textContent = [
      /* Pulsation 4 piliers */
      '.sante-pulse { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin-bottom:20px; }',
      '.sante-pillar { background:white; border-radius:12px; padding:14px 16px; border-left:5px solid #94a3b8; box-shadow:0 1px 3px rgba(0,0,0,0.05); }',
      '.sante-pillar.health-green  { border-left-color:#16a34a; background:linear-gradient(to right, #f0fdf4 0%, white 50%); }',
      '.sante-pillar.health-yellow { border-left-color:#f59e0b; background:linear-gradient(to right, #fffbeb 0%, white 50%); }',
      '.sante-pillar.health-red    { border-left-color:#dc2626; background:linear-gradient(to right, #fef2f2 0%, white 50%); }',
      '.sante-pillar.health-grey   { border-left-color:#94a3b8; background:#f8fafc; }',
      '.sante-pillar .head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; }',
      '.sante-pillar .head h4 { margin:0; font-size:13px; color:#1e293b; text-transform:uppercase; letter-spacing:0.5px; font-weight:700; }',
      '.sante-pillar .head .pulse { font-size:18px; }',
      '.sante-pillar .value { font-size:28px; font-weight:700; color:#0f172a; line-height:1.1; }',
      '.sante-pillar .unit { font-size:13px; color:#64748b; font-weight:500; margin-left:3px; }',
      '.sante-pillar .trend { font-size:12px; margin-top:4px; }',
      '.sante-pillar .trend.up   { color:#16a34a; }',
      '.sante-pillar .trend.down { color:#dc2626; }',
      '.sante-pillar .trend.flat { color:#64748b; }',
      '.sante-pillar .why { margin-top:10px; padding-top:10px; border-top:1px dashed #e2e8f0; font-size:12px; color:#475569; line-height:1.4; }',
      '.sante-pillar .why strong { color:#0f172a; }',
      '.sante-pillar .why .badge { display:inline-block; padding:1px 7px; border-radius:8px; font-size:11px; font-weight:700; margin-right:4px; }',
      '.sante-pillar .why .badge.up   { background:#dcfce7; color:#166534; }',
      '.sante-pillar .why .badge.down { background:#fee2e2; color:#991b1b; }',

      /* Header / score global */
      '.sante-hero { background:linear-gradient(135deg,#1e293b 0%,#334155 100%); color:white; border-radius:14px; padding:18px 22px; margin-bottom:20px; }',
      '.sante-hero h2 { margin:0 0 4px; font-size:22px; }',
      '.sante-hero .sub { font-size:13px; color:#cbd5e1; margin-bottom:14px; }',
      '.sante-score { display:flex; align-items:center; gap:18px; }',
      '.sante-score .num { font-size:48px; font-weight:800; line-height:1; }',
      '.sante-score .num.s-green  { color:#86efac; }',
      '.sante-score .num.s-yellow { color:#fcd34d; }',
      '.sante-score .num.s-red    { color:#fca5a5; }',
      '.sante-score .label { font-size:14px; color:#cbd5e1; font-weight:500; }',
      '.sante-score .label strong { display:block; font-size:18px; color:white; margin-bottom:3px; }',

      /* Sections de corrélations */
      '.sante-section { background:white; border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-bottom:14px; }',
      '.sante-section h3 { margin:0 0 4px; font-size:15px; color:#0f172a; }',
      '.sante-section .desc { font-size:12px; color:#64748b; font-style:italic; margin-bottom:12px; }',

      '.sante-correl-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:10px; }',
      '.sante-correl { background:#f8fafc; border-radius:8px; padding:12px; border-left:3px solid #94a3b8; }',
      '.sante-correl.attention { border-left-color:#f59e0b; background:#fffbeb; }',
      '.sante-correl.alert     { border-left-color:#dc2626; background:#fef2f2; }',
      '.sante-correl .lbl { font-size:11px; color:#64748b; text-transform:uppercase; font-weight:700; letter-spacing:0.4px; }',
      '.sante-correl .v { font-size:18px; font-weight:700; color:#0f172a; margin:3px 0; }',
      '.sante-correl .insight { font-size:12px; color:#475569; line-height:1.4; margin-top:6px; }',
      '.sante-correl .action { display:inline-block; background:#1e40af; color:white; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; margin-top:8px; cursor:pointer; text-decoration:none; }',
      '.sante-correl .action:hover { background:#1e3a8a; }',

      /* Tableau ranking */
      '.sante-rank { width:100%; border-collapse:collapse; font-size:12px; }',
      '.sante-rank th { background:#f1f5f9; padding:8px 10px; text-align:left; font-size:11px; text-transform:uppercase; color:#64748b; }',
      '.sante-rank td { padding:8px 10px; border-bottom:1px solid #f1f5f9; }',
      '.sante-rank td.num { text-align:right; font-weight:700; }',
      '.sante-rank tr.bad td { background:#fef2f2; }',

      /* Loading */
      '.sante-loading { padding:60px 20px; text-align:center; color:#64748b; font-style:italic; }',
    ].join('\n');
    document.head.appendChild(style);
  })();

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function fmt(n) { return (Number(n) || 0).toLocaleString('fr-FR'); }
  function fmtShort(n) {
    var v = Number(n) || 0;
    if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (Math.abs(v) >= 1000)    return (v / 1000).toFixed(0) + 'k';
    return String(Math.round(v));
  }
  function fmtPct(n, decimals) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return (+n).toFixed(decimals == null ? 1 : decimals) + '%';
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* ── Render initial ─────────────────────────────────────────────────── */
  main.innerHTML = '<div class="sante-loading">🏥 Diagnostic en cours…</div>';

  // Charger toutes les sources nécessaires en parallèle
  Promise.all([
    CT.api.get('/api/dashboard/ops').catch(function() { return null; }),
    CT.api.get('/api/dashboard/finance').catch(function() { return null; }),
    CT.api.get('/api/dashboard/clients').catch(function() { return null; }),
    CT.api.get('/api/dashboard/sales?period=30').catch(function() { return null; }),
    CT.api.get('/api/cash/reconciliation?from=' + new Date(Date.now() - 30*86400000).toISOString().slice(0,10) + '&to=' + new Date().toISOString().slice(0,10)).catch(function() { return null; }),
    CT.api.get('/api/cash/uncollected').catch(function() { return null; }),
    CT.api.get('/api/admin/customs-shipments/rates/effective').catch(function() { return null; }),
  ]).then(function(results) {
    var data = {
      ops:        results[0],
      finance:    results[1],
      clients:    results[2],
      sales:      results[3],
      reconciliation: results[4],
      uncollected: results[5],
      customs:    results[6],
    };
    buildUI(data);
  }).catch(function(err) {
    main.innerHTML = '<div class="ct-error">Erreur diagnostic : ' + (err.message || err) + '</div>';
  });

  /* ── Construction principale ────────────────────────────────────────── */
  function buildUI(data) {
    /* 1. Calculer la santé des 4 piliers (vert/jaune/rouge) */
    var pillars = computePillars(data);

    /* 2. Score global = somme pondérée */
    var score = computeGlobalScore(pillars);

    /* 3. Détecter les corrélations entre indicateurs */
    var correlations = detectCorrelations(data, pillars);

    /* ─── HTML ─── */
    var html = '';

    /* Hero — score global */
    html += renderHero(score);

    /* 4 piliers */
    html += renderPillars(pillars);

    /* Corrélations détectées */
    html += renderCorrelations(correlations);

    /* Détail par pilier (drill-down) */
    html += renderDetails(data, pillars);

    main.innerHTML = html;
    wireEvents();
  }

  /* ─── Calcul santé des piliers ──────────────────────────────────────── */
  function computePillars(d) {
    var pillars = {
      cash: { health: 'grey', value: 0, why: '', detail: null },
      marge: { health: 'grey', value: 0, why: '', detail: null },
      pipeline: { health: 'grey', value: 0, why: '', detail: null },
      clients: { health: 'grey', value: 0, why: '', detail: null },
    };

    /* PILIER 1 — Cash */
    if (d.uncollected) {
      var bucketsKmf = d.uncollected.buckets || {};
      // Considère les buckets > 48h ou > 7j comme problématiques
      var b48 = (bucketsKmf['48h_72h'] && bucketsKmf['48h_72h'].kmf) || 0;
      var b72 = (bucketsKmf['72h_7d']  && bucketsKmf['72h_7d'].kmf)  || 0;
      var bOld = (bucketsKmf['7d_plus'] && bucketsKmf['7d_plus'].kmf) || 0;
      var totalRetard = b48 + b72 + bOld;
      var totalPending = d.uncollected.total_pending_kmf || 0;
      var pctRetard = totalPending > 0 ? (totalRetard / totalPending * 100) : 0;

      pillars.cash.value = totalRetard;
      pillars.cash.detail = {
        total_pending: totalPending,
        retard_48_72h: b48,
        retard_72h_7j: b72,
        retard_7j_plus: bOld,
        pct_retard: pctRetard,
      };

      if (totalRetard === 0) {
        pillars.cash.health = 'green';
        pillars.cash.why = 'Aucun cash en retard';
      } else if (bOld > 0 && pctRetard > 30) {
        pillars.cash.health = 'red';
        pillars.cash.why = fmt(bOld) + ' KMF en retard <strong>> 7 jours</strong>';
      } else if (pctRetard > 15) {
        pillars.cash.health = 'yellow';
        pillars.cash.why = fmtPct(pctRetard, 0) + ' du cash en attente';
      } else {
        pillars.cash.health = 'green';
        pillars.cash.why = 'Retard mineur, sous contrôle';
      }
    }

    /* PILIER 2 — Marge */
    if (d.sales && d.sales.kpi) {
      var margePct = d.sales.kpi.marge_real_pct || d.sales.kpi.marge_pct || 0;
      var cibleMarge = 25;  // cible par défaut, sera affinée

      pillars.marge.value = margePct;
      pillars.marge.detail = {
        marge_pct: margePct,
        cible: cibleMarge,
        ecart: margePct - cibleMarge,
      };

      if (margePct >= cibleMarge) {
        pillars.marge.health = 'green';
        pillars.marge.why = 'Au-dessus de la cible (' + cibleMarge + '%)';
      } else if (margePct >= cibleMarge - 5) {
        pillars.marge.health = 'yellow';
        pillars.marge.why = fmtPct(cibleMarge - margePct, 1) + ' sous la cible';
      } else {
        pillars.marge.health = 'red';
        pillars.marge.why = '<strong>' + fmtPct(cibleMarge - margePct, 1) + ' sous la cible</strong>';
      }
    }

    /* PILIER 3 — Pipeline */
    if (d.ops && d.ops.kpi) {
      var blockedCount = (d.ops.kpi.blocages || 0) + (d.ops.kpi.retards || 0);
      var totalActif = d.ops.kpi.total_actifs || 1;
      var pctBlocked = (blockedCount / totalActif * 100);

      pillars.pipeline.value = blockedCount;
      pillars.pipeline.detail = {
        total_actifs: totalActif,
        blocages: d.ops.kpi.blocages || 0,
        retards: d.ops.kpi.retards || 0,
        pct_blocked: pctBlocked,
      };

      if (blockedCount === 0) {
        pillars.pipeline.health = 'green';
        pillars.pipeline.why = 'Pipeline fluide, aucun blocage';
      } else if (pctBlocked > 15) {
        pillars.pipeline.health = 'red';
        pillars.pipeline.why = '<strong>' + blockedCount + ' colis bloqués</strong> sur ' + totalActif;
      } else if (pctBlocked > 5) {
        pillars.pipeline.health = 'yellow';
        pillars.pipeline.why = blockedCount + ' colis à débloquer';
      } else {
        pillars.pipeline.health = 'green';
        pillars.pipeline.why = blockedCount + ' colis sous surveillance';
      }
    }

    /* PILIER 4 — Clients */
    if (d.clients && d.clients.segments) {
      var seg = d.clients.segments;
      var atRiskLtv = (d.clients.at_risk_clients || []).reduce(function(s, c) {
        return s + (c.ltv_kmf || 0);
      }, 0);

      pillars.clients.value = seg.at_risk;
      pillars.clients.detail = {
        nb_total: seg.nb_total,
        new: seg.new,
        recurrent: seg.recurrent,
        vip: seg.vip,
        at_risk: seg.at_risk,
        dormant: seg.dormant,
        at_risk_ltv: atRiskLtv,
      };

      if (seg.at_risk === 0) {
        pillars.clients.health = 'green';
        pillars.clients.why = 'Aucun client VIP à risque';
      } else if (atRiskLtv > 500000 || seg.at_risk > 10) {
        pillars.clients.health = 'red';
        pillars.clients.why = '<strong>' + fmt(atRiskLtv) + ' KMF</strong> de LTV à reconquérir';
      } else {
        pillars.clients.health = 'yellow';
        pillars.clients.why = seg.at_risk + ' clients à relancer (' + fmtShort(atRiskLtv) + ' KMF)';
      }
    }

    return pillars;
  }

  /* ─── Score global pondéré ──────────────────────────────────────────── */
  function computeGlobalScore(pillars) {
    var weights = { cash: 30, marge: 30, pipeline: 25, clients: 15 };
    var healthValue = { green: 100, yellow: 60, red: 20, grey: 50 };

    var totalWeight = 0;
    var totalScore = 0;
    Object.keys(weights).forEach(function(k) {
      var p = pillars[k];
      if (p.health !== 'grey') {
        totalScore += healthValue[p.health] * weights[k];
        totalWeight += weights[k];
      }
    });

    var score = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;
    var statut, color, emoji, message;
    if (score >= 80)      { statut = 'green';  color = 's-green';  emoji = '💚'; message = 'La machine tourne bien'; }
    else if (score >= 60) { statut = 'yellow'; color = 's-yellow'; emoji = '⚠️'; message = 'Attention requise'; }
    else                  { statut = 'red';    color = 's-red';    emoji = '🚨'; message = 'Action urgente'; }

    return { score: score, statut: statut, color: color, emoji: emoji, message: message };
  }

  /* ─── Détection des corrélations (chiffres qui se parlent) ──────────── */
  function detectCorrelations(d, pillars) {
    var correlations = [];

    /* CORR 1 — Marge ↘ + Douane ↗ */
    if (pillars.marge.health !== 'green' && d.customs && d.customs.rates) {
      var rate90 = (d.customs.rates.last_90d && d.customs.rates.last_90d.rate_pct) || 0;
      var rate30 = (d.customs.rates.last_30d && d.customs.rates.last_30d.rate_pct) || 0;
      if (rate30 > rate90 + 1.5) {
        correlations.push({
          severity: 'alert',
          icon: '🔥',
          title: 'Marge en baisse + Douane en hausse',
          insight: 'Le taux douane terrain est passé de <strong>' + fmtPct(rate90) +
                   '</strong> (90j) à <strong>' + fmtPct(rate30) + '</strong> (30j). ' +
                   'C\'est probablement la principale cause de l\'érosion de marge.',
          action: 'customs',
          action_label: '→ Voir Historique Douane',
        });
      }
    }

    /* CORR 2 — Marge ↘ + Panier moyen ↘ */
    if (pillars.marge.health !== 'green' && d.sales && d.sales.kpi) {
      var panier = d.sales.kpi.panier_moyen_kmf || 0;
      var panierPrev = d.sales.kpi.panier_moyen_previous_kmf || panier;
      if (panierPrev > 0 && panier < panierPrev * 0.92) {
        correlations.push({
          severity: 'attention',
          icon: '🛒',
          title: 'Marge ↘ + Panier moyen ↘',
          insight: 'Le panier moyen est tombé de <strong>' + fmt(panierPrev) + '</strong> à <strong>' +
                   fmt(panier) + '</strong> KMF (-' + fmtPct((1 - panier / panierPrev) * 100, 0) + '). ' +
                   'Promotions trop agressives ou mix de gamme dégradé ?',
          action: 'sales',
          action_label: '→ Voir analyse Ventes',
        });
      }
    }

    /* CORR 3 — Cash retard concentré sur certains relais */
    if (pillars.cash.health !== 'green' && d.reconciliation && d.reconciliation.par_relais) {
      var byRelais = d.reconciliation.par_relais || [];
      var bad = byRelais.filter(function(r) {
        return (r.ecart_kmf || 0) > 50000;
      }).sort(function(a, b) { return (b.ecart_kmf || 0) - (a.ecart_kmf || 0); });

      if (bad.length) {
        correlations.push({
          severity: 'alert',
          icon: '📍',
          title: 'Cash retard concentré sur ' + bad.length + ' relais',
          insight: 'Top relais en écart : <strong>' + escHtml(bad[0].relais || '?') + '</strong> (' +
                   fmt(bad[0].ecart_kmf || 0) + ' KMF d\'écart)' +
                   (bad.length > 1 ? ', puis <strong>' + escHtml(bad[1].relais || '?') + '</strong>' : '') +
                   '. Ces relais à contacter en priorité.',
          action: 'accounting',
          action_label: '→ Voir Comptabilité',
        });
      }
    }

    /* CORR 4 — Clients à risque = revenus futurs en jeu */
    if (pillars.clients.detail && pillars.clients.detail.at_risk > 0) {
      var ltv = pillars.clients.detail.at_risk_ltv;
      var nbAtRisk = pillars.clients.detail.at_risk;
      var avgLtv = nbAtRisk > 0 ? ltv / nbAtRisk : 0;
      correlations.push({
        severity: ltv > 500000 ? 'alert' : 'attention',
        icon: '👥',
        title: nbAtRisk + ' clients à risque (perdus en cours)',
        insight: '<strong>' + fmt(ltv) + ' KMF</strong> de LTV cumulée silencieuse depuis 60–180j. ' +
                 'Soit en moyenne <strong>' + fmt(Math.round(avgLtv)) + ' KMF/client</strong>. ' +
                 'Une simple relance peut récupérer un % significatif.',
        action: 'clients',
        action_label: '→ Voir Clients à risque',
      });
    }

    /* CORR 5 — Pipeline bloqué + commandes payées en attente */
    if (pillars.pipeline.detail && pillars.pipeline.detail.blocages > 0 && d.finance && d.finance.kpi) {
      correlations.push({
        severity: 'attention',
        icon: '⚙️',
        title: pillars.pipeline.detail.blocages + ' commandes bloquées',
        insight: 'Ces commandes ne génèrent ni revenu (pas livrées) ni satisfaction client. ' +
                 'À traiter en priorité pour libérer le pipeline.',
        action: 'pilotage_op',
        action_label: '→ Voir Pipeline Ops',
      });
    }

    /* CORR 6 — Mix catégories défavorable (si données dispo) */
    if (d.sales && d.sales.by_category && d.sales.by_category.length) {
      var lowMargin = d.sales.by_category
        .filter(function(c) { return (c.marge_real_pct || 0) < 15 && (c.ca_kmf || 0) > 100000; })
        .sort(function(a, b) { return (b.ca_kmf || 0) - (a.ca_kmf || 0); });

      if (lowMargin.length && pillars.marge.health !== 'green') {
        correlations.push({
          severity: 'attention',
          icon: '🗂️',
          title: 'Catégorie à faible marge en croissance',
          insight: '<strong>' + escHtml(lowMargin[0].category || '?') + '</strong> représente ' +
                   fmt(lowMargin[0].ca_kmf) + ' KMF de CA mais seulement ' +
                   fmtPct(lowMargin[0].marge_real_pct, 1) + ' de marge. ' +
                   'Revoir le pricing ou réduire la promotion.',
          action: 'pricing',
          action_label: '→ Ajuster Pricing',
        });
      }
    }

    return correlations;
  }

  /* ─── Renders HTML ──────────────────────────────────────────────────── */
  function renderHero(score) {
    var html = '<div class="sante-hero">';
    html += '<h2>🏥 Santé Business</h2>';
    html += '<div class="sub">Vue agrégée temps réel — chiffres corrélés qui s\'expliquent entre eux</div>';
    html += '<div class="sante-score">';
    html += '<div class="num ' + score.color + '">' + score.score + '</div>';
    html += '<div class="label">';
    html += '<strong>' + score.emoji + ' ' + score.message + '</strong>';
    html += 'Score sur 100, pondéré par criticité métier';
    html += '</div>';
    html += '</div></div>';
    return html;
  }

  function renderPillars(pillars) {
    var html = '<div class="sante-pulse">';

    /* Pilier Cash */
    var p = pillars.cash;
    var pulse = p.health === 'red' ? '🔴' : (p.health === 'yellow' ? '🟡' : (p.health === 'green' ? '🟢' : '⚪'));
    html += '<div class="sante-pillar health-' + p.health + '">';
    html += '<div class="head"><h4>🩸 Cash</h4><span class="pulse">' + pulse + '</span></div>';
    if (p.detail) {
      html += '<div class="value">' + fmtShort(p.detail.total_pending) + '<span class="unit"> KMF en attente</span></div>';
      if (p.detail.pct_retard > 0) {
        html += '<div class="trend ' + (p.detail.pct_retard > 15 ? 'down' : 'flat') + '">';
        html += fmtPct(p.detail.pct_retard, 0) + ' en retard</div>';
      }
    }
    html += '<div class="why">' + p.why + '</div>';
    html += '</div>';

    /* Pilier Marge */
    p = pillars.marge;
    pulse = p.health === 'red' ? '🔴' : (p.health === 'yellow' ? '🟡' : (p.health === 'green' ? '🟢' : '⚪'));
    html += '<div class="sante-pillar health-' + p.health + '">';
    html += '<div class="head"><h4>📈 Marge réelle</h4><span class="pulse">' + pulse + '</span></div>';
    if (p.detail) {
      html += '<div class="value">' + fmtPct(p.detail.marge_pct) + '</div>';
      html += '<div class="trend ' + (p.detail.ecart >= 0 ? 'up' : 'down') + '">';
      html += (p.detail.ecart >= 0 ? '↗' : '↘') + ' Cible : ' + p.detail.cible + '%</div>';
    }
    html += '<div class="why">' + p.why + '</div>';
    html += '</div>';

    /* Pilier Pipeline */
    p = pillars.pipeline;
    pulse = p.health === 'red' ? '🔴' : (p.health === 'yellow' ? '🟡' : (p.health === 'green' ? '🟢' : '⚪'));
    html += '<div class="sante-pillar health-' + p.health + '">';
    html += '<div class="head"><h4>⚙️ Pipeline</h4><span class="pulse">' + pulse + '</span></div>';
    if (p.detail) {
      html += '<div class="value">' + p.detail.total_actifs + '<span class="unit"> commandes</span></div>';
      if (p.detail.blocages > 0) {
        html += '<div class="trend down">' + p.detail.blocages + ' bloquées</div>';
      } else {
        html += '<div class="trend flat">Aucun blocage</div>';
      }
    }
    html += '<div class="why">' + p.why + '</div>';
    html += '</div>';

    /* Pilier Clients */
    p = pillars.clients;
    pulse = p.health === 'red' ? '🔴' : (p.health === 'yellow' ? '🟡' : (p.health === 'green' ? '🟢' : '⚪'));
    html += '<div class="sante-pillar health-' + p.health + '">';
    html += '<div class="head"><h4>👥 Clients</h4><span class="pulse">' + pulse + '</span></div>';
    if (p.detail) {
      html += '<div class="value">' + p.detail.nb_total + '<span class="unit"> clients</span></div>';
      if (p.detail.at_risk > 0) {
        html += '<div class="trend down">' + p.detail.at_risk + ' à risque (' + fmtShort(p.detail.at_risk_ltv) + ' KMF)</div>';
      } else {
        html += '<div class="trend up">Aucun à risque</div>';
      }
    }
    html += '<div class="why">' + p.why + '</div>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderCorrelations(correlations) {
    if (!correlations.length) {
      return '<div class="sante-section">' +
        '<h3>🔗 Corrélations détectées</h3>' +
        '<div class="desc">Les chiffres qui se parlent entre eux pour expliquer la situation.</div>' +
        '<div style="text-align:center;padding:30px;color:#16a34a;font-weight:600">' +
        '✅ Aucune corrélation négative détectée. La machine tourne sans incohérence.' +
        '</div></div>';
    }

    var html = '<div class="sante-section">';
    html += '<h3>🔗 Corrélations détectées (' + correlations.length + ')</h3>';
    html += '<div class="desc">Les chiffres qui s\'expliquent les uns les autres — diagnostic des causes profondes.</div>';
    html += '<div class="sante-correl-grid">';

    correlations.forEach(function(c) {
      html += '<div class="sante-correl ' + c.severity + '">';
      html += '<div class="lbl">' + c.icon + ' ' + escHtml(c.title) + '</div>';
      html += '<div class="insight">' + c.insight + '</div>';
      if (c.action) {
        html += '<a class="action" data-goto="' + escHtml(c.action) + '">' + escHtml(c.action_label) + '</a>';
      }
      html += '</div>';
    });

    html += '</div></div>';
    return html;
  }

  function renderDetails(d, pillars) {
    var html = '';

    /* Détail Clients : top à risque */
    if (d.clients && d.clients.at_risk_clients && d.clients.at_risk_clients.length) {
      html += '<div class="sante-section">';
      html += '<h3>⚠️ Top clients à risque (à relancer)</h3>';
      html += '<div class="desc">Clients qui ont commandé ≥ 2 fois mais silencieux 60–180j. Une relance peut les récupérer.</div>';
      html += '<table class="sante-rank"><thead><tr>';
      html += '<th>Client</th><th>Téléphone</th><th>Cmd</th><th>LTV</th><th>Silence</th>';
      html += '</tr></thead><tbody>';
      d.clients.at_risk_clients.slice(0, 5).forEach(function(c) {
        html += '<tr class="bad">';
        html += '<td><strong>' + escHtml(c.name || '—') + '</strong></td>';
        html += '<td>' + escHtml(c.phone || '—') + '</td>';
        html += '<td class="num">' + c.nb_commandes + '</td>';
        html += '<td class="num">' + fmt(c.ltv_kmf) + ' KMF</td>';
        html += '<td class="num">' + c.jours_silence + 'j</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
    }

    /* Détail Cash : par bucket */
    if (d.uncollected && d.uncollected.buckets) {
      var b = d.uncollected.buckets;
      var hasBuckets = Object.keys(b).some(function(k) { return (b[k] && b[k].count) > 0; });
      if (hasBuckets) {
        html += '<div class="sante-section">';
        html += '<h3>🩸 Détail Cash en attente</h3>';
        html += '<div class="desc">Décomposition par âge — les buckets > 7j sont les plus critiques.</div>';
        html += '<table class="sante-rank"><thead><tr>';
        html += '<th>Bucket</th><th>Nb commandes</th><th>Montant</th><th>État</th>';
        html += '</tr></thead><tbody>';
        var buckets = [
          { k: '0_24h',    label: '< 24h',     class: 'good' },
          { k: '24h_48h',  label: '24-48h',    class: '' },
          { k: '48h_72h',  label: '48-72h',    class: 'warn' },
          { k: '72h_7d',   label: '3-7 jours', class: 'warn' },
          { k: '7d_plus',  label: '> 7 jours', class: 'bad' },
        ];
        buckets.forEach(function(bk) {
          var data = b[bk.k] || {};
          if (data.count) {
            html += '<tr' + (bk.class === 'bad' ? ' class="bad"' : '') + '>';
            html += '<td><strong>' + bk.label + '</strong></td>';
            html += '<td class="num">' + data.count + '</td>';
            html += '<td class="num">' + fmt(data.kmf) + ' KMF</td>';
            html += '<td>' + (bk.class === 'bad' ? '🔴 Critique' : (bk.class === 'warn' ? '🟡 Surveiller' : '🟢 Normal')) + '</td>';
            html += '</tr>';
          }
        });
        html += '</tbody></table>';
        html += '</div>';
      }
    }

    return html;
  }

  /* ─── Wire events ───────────────────────────────────────────────────── */
  function wireEvents() {
    main.querySelectorAll('[data-goto]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.preventDefault();
        var view = el.dataset.goto;
        if (window.location && window.location.hash !== undefined) {
          window.location.hash = view;
        }
      });
    });
  }
};
