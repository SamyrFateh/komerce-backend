/**
 * KOMERCE Dashboard — Santé économique /admin/economic  (v2 — alignée doctrine)
 * ════════════════════════════════════════════════════════════════════════════
 * Deux lectures, jamais mélangées (doctrine §3 « toujours comparer la même unité ») :
 *   • Vue CATALOGUE (par article) — vérité moteur, via /api/pricing/dashboard
 *       → lecture par les deux frontières : coût variable complet & CDR complet.
 *   • Vue MOIS (agrégat) — l'exécutif, via /api/admin/economic/executive.
 *
 * Sources :
 *   KmcApi.getPricingDashboard()   → /api/pricing/dashboard   (relaie le moteur)
 *   KmcApi.getEconomicExecutive()  → /api/admin/economic/executive
 *   KmcApi.getEconomicCharges()    → /api/admin/economic/charges
 *   KmcApi.getEconomicCoherence()  → /api/admin/economic/coherence
 */

(function (global) {
  'use strict';

  const _nf = new Intl.NumberFormat('fr-FR');
  const fmt  = n => _nf.format(Math.round(Number(n) || 0)) + ' KMF';
  const fmti = n => _nf.format(Math.round(Number(n) || 0));
  const fmtp = n => (Number(n) || 0).toFixed(1) + '%';

  async function render(rootEl) {
    rootEl.innerHTML = `
      <h1 class="page-title">Santé économique</h1>
      <p class="page-subtitle">Deux lectures distinctes : le <strong>catalogue par article</strong> (vérité moteur) et le <strong>mois en agrégat</strong>.</p>

      <section class="page-section">
        <div class="card-header"><h3 class="card-title">🧭 Vue catalogue · par article</h3>
          <span id="eco-sot" style="font-size:var(--fs-xs);color:var(--text-tertiary);"></span></div>
        <div id="eco-frontiers" class="card" style="padding:18px;margin-bottom:12px;">
          <div class="loading-state"><span class="loader"></span> Chargement du moteur…</div>
        </div>
        <div id="eco-cat-kpis" class="kpi-bar"></div>
        <div id="eco-action" style="margin-top:10px;"></div>
      </section>

      <section class="page-section">
        <div class="card-header"><h3 class="card-title">📅 Vue mois · agrégat</h3></div>
        <div id="eco-verdict" class="card" style="padding:18px;">
          <div class="loading-state"><span class="loader"></span> Chargement…</div>
        </div>
        <div id="eco-month-kpis" class="kpi-bar" style="margin-top:12px;"></div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header"><h3 class="card-title">⚠️ Alertes</h3></div>
          <div id="eco-alerts"></div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">📋 Charges fixes du mois</h3></div>
          <div id="eco-charges"></div>
        </div>
      </section>

      <p style="margin-top:8px;font-size:var(--fs-xs);color:var(--text-tertiary);line-height:1.6;">
        <strong>Deux frontières</strong> — sous le <em>coût variable complet</em> (N1+N2) chaque vente détruit de l'argent ;
        entre le coût variable et le <em>CDR complet</em> (N1+N2+N3) la vente contribue mais ne couvre pas toute la structure ;
        au-dessus du CDR, tout est couvert.
      </p>
      <p id="eco-meta" style="margin-top:4px;font-size:var(--fs-xs);color:var(--text-tertiary);"></p>
    `;

    const [dash, exec, charges, coherence] = await Promise.all([
      KmcApi.getPricingDashboard().catch(() => null),
      KmcApi.getEconomicExecutive().catch(() => null),
      KmcApi.getEconomicCharges().catch(() => null),
      KmcApi.getEconomicCoherence().catch(() => null),
    ]);

    // Guard : navigation entre-temps → rootEl détaché du DOM
    if (!rootEl || !document.contains(rootEl)) return;

    _renderFrontiers(document.getElementById('eco-frontiers'), dash);
    _renderCatKpis(document.getElementById('eco-cat-kpis'), dash);
    _renderAction(document.getElementById('eco-action'), dash);
    _renderSot(document.getElementById('eco-sot'), dash);

    _renderVerdict(document.getElementById('eco-verdict'), exec);
    _renderMonthKpis(document.getElementById('eco-month-kpis'), exec);

    _renderAlerts(document.getElementById('eco-alerts'), dash, coherence);
    _renderCharges(document.getElementById('eco-charges'), charges);

    document.getElementById('eco-meta').textContent =
      `Catalogue : vérité moteur (par article) · Mois : agrégat · ${new Date().toLocaleTimeString('fr-FR')}`;
  }

  /* ─── VUE CATALOGUE — les deux frontières ───────────────────────────────── */
  function _renderFrontiers(el, dash) {
    if (!dash || !dash.frontiers) { el.innerHTML = '<div class="empty-state">Catalogue moteur indisponible</div>'; return; }
    const fr = dash.frontiers, total = (fr.destructive + fr.undercovered + fr.covered + fr.unpriced) || 0;
    const cells = [
      { k: 'destructive', label: 'À perte', sub: 'sous le coût variable', bg: '#fee2e2', color: '#b91c1c' },
      { k: 'undercovered', label: 'Sous-couvert', sub: 'sous le CDR', bg: '#fef9c3', color: '#a16207' },
      { k: 'covered', label: 'Couvert', sub: 'structure incluse', bg: '#dcfce7', color: '#166534' },
      { k: 'unpriced', label: 'Sans prix', sub: 'à fixer', bg: '#f1f5f9', color: '#64748b' },
    ];
    const grid = cells.map(c => {
      const n = fr[c.k] || 0, pct = total ? Math.round((n / total) * 100) : 0;
      return `<div style="padding:14px 10px;text-align:center;border-radius:8px;background:${c.bg};color:${c.color};">
        <div style="font-size:1.6rem;font-weight:800;font-family:ui-monospace,monospace;">${n}</div>
        <div style="font-size:0.82rem;font-weight:700;margin-top:2px;">${c.label} · ${pct}%</div>
        <div style="font-size:0.7rem;opacity:.8;margin-top:1px;">${c.sub}</div>
      </div>`;
    }).join('');
    el.innerHTML = `
      <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:10px;">${total} produits — où tombe le prix actuel par rapport aux deux frontières</p>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">${grid}</div>`;
  }

  function _renderCatKpis(el, dash) {
    if (!dash || !dash.kpis) { el.innerHTML = ''; return; }
    const k = dash.kpis;
    KpiCard.renderBar(el, [
      { key: 'marge_eff', label: 'Marge complète moyenne', value: fmtp(k.marge_moyenne_pct) },
      { key: 'marge_cible', label: 'Marge cible',           value: fmtp(k.marge_cible_pct) },
      { key: 'ecart',      label: 'Écart à la cible',        value: (k.ecart_cible_pct >= 0 ? '+' : '') + fmtp(k.ecart_cible_pct) },
      { key: 'couverture', label: 'Couverture du coût',      value: fmtp(k.couverture_cost_pct) },
      { key: 'n3',         label: 'N3 imputé / article',     value: fmt(k.n3_fixed_overhead_allocation_kmf) },
      { key: 'total',      label: 'Produits actifs',         value: fmti(k.nb_total) },
    ]);
  }

  function _renderAction(el, dash) {
    if (!dash || !dash.frontiers) { el.innerHTML = ''; return; }
    const fr = dash.frontiers;
    let msg, klass;
    if (fr.destructive > 0) {
      klass = 'is-red';
      msg = `🔴 <strong>${fr.destructive} produit(s) vendus à perte</strong> — priorité absolue : remonter leur prix <em>au-dessus du coût variable complet</em>, ou arrêter la vente. Chaque vente détruit de l'argent.`;
    } else if (fr.undercovered > 0) {
      klass = 'is-amber';
      msg = `🟡 <strong>${fr.undercovered} produit(s) sous le CDR</strong> — la vente contribue mais ne couvre pas toute la structure. Acceptable pour un produit d'appel, à condition d'avoir le volume. Sinon, viser le prix conseillé.`;
    } else if (fr.unpriced > 0) {
      klass = '';
      msg = `⚪ <strong>${fr.unpriced} produit(s) sans prix</strong> — appliquer le prix conseillé du moteur dans la carte économique.`;
    } else {
      klass = 'is-green';
      msg = `🟢 Tout le catalogue couvre au moins son CDR. Pour gagner plus : négocier l'achat fournisseur (le levier N1, le plus efficace).`;
    }
    el.innerHTML = `<div class="card ${klass}" style="padding:12px 14px;font-size:0.9rem;line-height:1.5;">${msg}</div>`;
  }

  function _renderSot(el, dash) {
    if (!el) return;
    const sot = dash && dash.kpis && dash.kpis.source_of_truth;
    el.textContent = sot === 'pricing-engine' ? '✓ vérité unique : moteur' : '';
  }

  /* ─── VUE MOIS — agrégat ────────────────────────────────────────────────── */
  function _renderVerdict(el, exec) {
    if (!exec) { el.innerHTML = '<div class="empty-state">Données mensuelles indisponibles</div>'; return; }
    const k = exec.kpis || exec;
    const ordered = Number(k.orders_this_month || k.commandes_collectees || 0);
    const seuil   = Number(k.breakeven_orders  || k.seuil_rentabilite   || 0);
    let klass, emoji, title, detail;
    if (!seuil || !ordered) { klass=''; emoji='❔'; title='Rentabilité du mois indéterminée'; detail='Pas assez de données pour conclure.'; }
    else if (ordered >= seuil * 1.1) { klass='is-green'; emoji='✅'; title='Mois rentable'; detail=`${ordered} commandes — seuil de ${seuil} dépassé.`; }
    else if (ordered >= seuil * 0.9) { klass='is-amber'; emoji='⚖️'; title='Proche du seuil'; detail=`${ordered} / ${seuil} commandes. Marge de manœuvre faible.`; }
    else { klass='is-red'; emoji='⚠️'; title='Mois non rentable'; detail=`Il manque ${seuil - ordered} commande(s) pour couvrir les charges fixes (${ordered} / ${seuil}).`; }
    el.className = 'card ' + klass; el.style.padding = '18px';
    el.innerHTML = `<div style="display:flex;align-items:center;gap:16px;">
        <div style="font-size:2.2rem;">${emoji}</div>
        <div><div style="font-size:1.05rem;font-weight:800;">${title}</div>
        <div style="font-size:0.9rem;color:var(--text-secondary);margin-top:2px;">${detail}</div>
        <div style="font-size:0.72rem;color:var(--text-tertiary);margin-top:4px;">Lecture mensuelle agrégée — distincte du CDR par article ci-dessus.</div></div></div>`;
  }

  function _renderMonthKpis(el, exec) {
    if (!exec) { el.innerHTML = ''; return; }
    const k = exec.kpis || exec;
    KpiCard.renderBar(el, [
      { key: 'ca',           label: 'CA mensuel',           value: fmt(k.ca_mensuel_kmf || k.revenue_kmf) },
      { key: 'commandes',    label: 'Commandes collectées', value: fmti(k.orders_this_month || k.commandes_collectees) },
      { key: 'panier',       label: 'Panier moyen',         value: fmt(k.avg_order_kmf || k.panier_moyen_kmf) },
      { key: 'contribution', label: 'Contribution moyenne', value: fmt(k.avg_contribution_kmf || k.contribution_moyenne_kmf) },
      { key: 'charges',      label: 'Charges fixes/mois',   value: fmt(k.fixed_charges_kmf || k.charges_fixes_mensuelles_kmf) },
      { key: 'seuil',        label: 'Seuil rentabilité',    value: fmti(k.breakeven_orders || k.seuil_rentabilite) + ' cmds' },
    ]);
  }

  /* ─── ALERTES & CHARGES ─────────────────────────────────────────────────── */
  function _renderAlerts(el, dash, coherence) {
    const alerts = [].concat((dash && dash.alerts) || [], (coherence && coherence.alerts) || []);
    if (global.AlertList && AlertList.renderList) AlertList.renderList(el, alerts, { limit: 12, emptyText: '✓ Aucune anomalie détectée' });
    else el.innerHTML = alerts.length ? alerts.map(a => `<div style="padding:6px 0;font-size:0.85rem;">${a.title || a.message || ''}</div>`).join('') : '<div class="empty-state">✓ Aucune anomalie</div>';
  }

  function _renderCharges(el, charges) {
    if (!charges) { el.innerHTML = '<div class="empty-state" style="padding:14px;">Données charges indisponibles</div>'; return; }
    const rows = charges.items || charges.charges || charges || [];
    const list = Array.isArray(rows) ? rows : [];
    if (global.DataTable && DataTable.render) {
      DataTable.render(el, {
        emptyText: 'Aucune charge enregistrée',
        columns: [
          { key: 'family', label: 'Famille', render: r => r.family || r.category || '—' },
          { key: 'label',  label: 'Libellé', render: r => r.label || r.name || '—' },
          { key: 'amount_kmf', label: 'Montant', align: 'right', render: r => fmt(r.amount_kmf || r.amount || 0) },
          { key: 'period', label: 'Période', render: r => r.period || r.month || '—' },
        ],
        rows: list,
      });
    } else {
      el.innerHTML = list.length ? list.map(r => `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem;"><span>${r.label || r.name || '—'}</span><span>${fmt(r.amount_kmf || r.amount || 0)}</span></div>`).join('') : '<div class="empty-state">Aucune charge</div>';
    }
  }

  global.EconomicView = { render };
})(window);
