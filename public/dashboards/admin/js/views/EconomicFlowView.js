/* ═══════════════════════════════════════════════════════════════════════════
 *  EconomicFlowView.js — Komerce Control Tower  (v2 — boîtes éditables)
 *  🔭 Carte économique : chaque boîte édite ses variables, les flèches montrent
 *     le calcul qui passe d'une boîte à la suivante. Source de vérité unique :
 *     POST /api/pricing/flow → pricing-engine.recommend().
 *
 *  Objet → N1 → N2 → Coût variable complet → Contribution → N3 → CDR → Décision
 * ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const _s = {
    products: [], productId: null,
    flow: null, prev: null,
    overrides: {},          // cost_kmf, weight_kg, current_price_kmf, monthly_fixed_costs_kmf,
                            // objectif_commandes_mois, avg_articles_per_order,
                            // pricing_strategy, final_price_kmf, competitor_price_kmf
    selectedBox: 'prix',
    debounce: null,
  };

  const _nf = new Intl.NumberFormat('fr-FR');
  const _fmt = n => _nf.format(Math.round(Number(n) || 0));
  const _signed = n => (n > 0 ? '+' : '') + _fmt(n);
  const _esc = s => (s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));

  const FAMILY = { objet:'#5F5E5A', n1:'#185FA5', n2:'#0F6E56', cvc:'#A32D2D', contrib:'#534AB7', n3:'#854F0B', cdr:'#993C1D', prix:'#3B6D11' };

  /* ─── lecture sûre des champs moteur ─────────────────────────────────────── */
  const g = (f, k) => (f && f[k] != null ? Number(f[k]) : 0);

  /* ─── STATUTS ─────────────────────────────────────────────────────────────── */
  function _conf(f) { const c = (f.data_quality && f.data_quality.confidence) || 'low'; return c === 'high' ? 'ok' : (c === 'medium' ? 'warn' : 'low'); }
  function _boxStatus(id, f) {
    switch (id) {
      case 'cvc':     return (f.current_price_kmf > 0 && f.current_price_kmf < f.variable_cost_complete_kmf) ? 'danger' : 'ok';
      case 'contrib': if (f.contribution_kmf == null) return 'neutral';
                      return f.contribution_kmf < 0 ? 'danger' : (f.contribution_kmf < f.n3_fixed_overhead_allocation_kmf ? 'warn' : 'ok');
      case 'cdr':     if (!f.current_price_kmf) return 'ok';
                      return f.current_price_kmf < f.variable_cost_complete_kmf ? 'danger' : (f.current_price_kmf < f.cdr_complete_kmf ? 'warn' : 'ok');
      case 'prix':    return ({ destructive:'danger', undercovered:'warn', covered:'ok' }[f.strategy_risk] || 'neutral');
      case 'objet':   return 'neutral';
      default:        return _conf(f);
    }
  }
  const STATUS = {
    ok:{lab:'aligné',cls:'efv-ok'}, warn:{lab:'attention',cls:'efv-warn'},
    low:{lab:'confiance faible',cls:'efv-low'}, danger:{lab:'destructif',cls:'efv-danger'}, neutral:{lab:'',cls:'efv-neutral'},
  };

  /* ─── INPUT inline ───────────────────────────────────────────────────────── */
  // ov = clé d'override ; cur = valeur affichée par défaut (depuis le flow)
  function _inp(ov, cur, opts) {
    opts = opts || {};
    const v = (_s.overrides[ov] != null && _s.overrides[ov] !== '') ? _s.overrides[ov] : (cur != null ? cur : '');
    return `<input class="efv-edit" data-ov="${ov}" type="${opts.type || 'number'}"${opts.step ? ` step="${opts.step}"` : ''} value="${v === 0 && opts.zeroBlank ? '' : v}" placeholder="${opts.ph || ''}" ${opts.title ? `title="${opts.title}"` : ''}>`;
  }
  function _select(ov, cur, options) {
    return `<select class="efv-edit" data-ov="${ov}">` +
      options.map(o => `<option value="${o}"${o === cur ? ' selected' : ''}>${o}</option>`).join('') + `</select>`;
  }

  /* ─── CORPS DE CHAQUE BOÎTE (formule + variables éditables) ──────────────── */
  function _body(id, f) {
    const lr = (f.cost_breakdown && f.cost_breakdown.landed_relay) || {};
    const bz = (f.cost_breakdown && f.cost_breakdown.business) || {};
    const a  = f.allocation_averages || {};
    switch (id) {
      case 'objet':
        return `<div class="efv-edits">
          <label>Achat fournisseur ${_inp('cost_kmf', lr.product_purchase)}<span class="u">KMF</span></label>
          <label>Poids ${_inp('weight_kg', null, { step:'0.1', ph:'auto' })}<span class="u">kg</span></label>
          <label>Prix de vente ${_inp('current_price_kmf', f.current_price_kmf)}<span class="u">KMF</span></label>
        </div>`;
      case 'n1':
        return `<div class="efv-formula">9 lignes (achat→relais) = <b id="res-n1">${_fmt(f.n1_landed_relay_cost_kmf)}</b> KMF</div>`;
      case 'n2':
        return `<div class="efv-formula">paiement <b>${_fmt(bz.payment)}</b> + risque <b>${_fmt(bz.risk_provision)}</b> = <b id="res-n2">${_fmt(f.n2_business_variable_cost_kmf)}</b> KMF</div>`;
      case 'cvc':
        return `<div class="efv-formula">N1 <b id="res-cvc-n1">${_fmt(f.n1_landed_relay_cost_kmf)}</b> + N2 <b id="res-cvc-n2">${_fmt(f.n2_business_variable_cost_kmf)}</b> = <b id="res-cvc">${_fmt(f.variable_cost_complete_kmf)}</b> KMF</div>`;
      case 'contrib':
        return `<div class="efv-formula">prix <b id="res-c-p">${_fmt(f.current_price_kmf)}</b> − coût variable <b id="res-c-v">${_fmt(f.variable_cost_complete_kmf)}</b> = <b id="res-contrib">${f.contribution_kmf == null ? '—' : _fmt(f.contribution_kmf)}</b> KMF</div>`;
      case 'n3':
        return `<div class="efv-edits">
          <label>Charges fixes / mois ${_inp('monthly_fixed_costs_kmf', f.monthly_fixed_costs_kmf)}<span class="u">KMF</span></label>
          <label>Commandes cibles / mois ${_inp('objectif_commandes_mois', f.target_orders_per_month)}</label>
          <label>Articles / commande ${_inp('avg_articles_per_order', a.articles_per_order, { step:'0.1' })}</label>
          <div class="efv-formula" style="margin-top:6px">/ = <b id="res-n3">${_fmt(f.n3_fixed_overhead_allocation_kmf)}</b> KMF par article</div>
        </div>`;
      case 'cdr':
        return `<div class="efv-formula">coût variable <b id="res-cdr-v">${_fmt(f.variable_cost_complete_kmf)}</b> + N3 <b id="res-cdr-n3">${_fmt(f.n3_fixed_overhead_allocation_kmf)}</b> = <b id="res-cdr">${_fmt(f.cdr_complete_kmf)}</b> KMF</div>`;
      case 'prix':
        return `<div class="efv-prices">
            <span>plancher <b id="res-floor">${_fmt(f.minimum_safe_price_kmf)}</b></span>
            <span>conseillé <b id="res-reco">${_fmt(f.recommended_price_kmf)}</b></span>
          </div>
          <div class="efv-edits">
            <label>Stratégie ${_select('pricing_strategy', f.pricing_strategy || 'mechanical', ['mechanical','competition_aligned','premium','loss_leader','conquest','manual'])}</label>
            <label>Prix final ${_inp('final_price_kmf', f.final_price_kmf, { ph:'conseillé', zeroBlank:true })}<span class="u">KMF</span></label>
            <label>Prix concurrent ${_inp('competitor_price_kmf', null, { ph:'—' })}<span class="u">KMF</span></label>
          </div>`;
    }
    return '';
  }

  // Valeur transmise par chaque boîte vers la suivante (affichée sur la flèche)
  function _transmit(id, f) {
    switch (id) {
      case 'objet':   return { lab: 'achat + dimensions', val: g(f,'cost_breakdown') ? null : null, raw: null };
      case 'n1':      return { lab: 'N1', val: f.n1_landed_relay_cost_kmf, key: 'n1_landed_relay_cost_kmf' };
      case 'n2':      return { lab: 'coût variable', val: f.variable_cost_complete_kmf, key: 'variable_cost_complete_kmf' };
      case 'cvc':     return { lab: 'coût variable', val: f.variable_cost_complete_kmf, key: 'variable_cost_complete_kmf' };
      case 'contrib': return { lab: 'contribution', val: f.contribution_kmf, key: 'contribution_kmf' };
      case 'n3':      return { lab: 'CDR', val: f.cdr_complete_kmf, key: 'cdr_complete_kmf' };
      case 'cdr':     return { lab: 'CDR', val: f.cdr_complete_kmf, key: 'cdr_complete_kmf' };
      default:        return null;
    }
  }

  const BOXES = [
    { id:'objet',   name:'Objet',                     form:"ce qu'on achète et à quel prix on le vend" },
    { id:'n1',      name:'N1 · Coût rendu relais',    form:"tout pour amener l'objet au relais" },
    { id:'n2',      name:'N2 · Business variable',    form:"paiement + provision risque" },
    { id:'cvc',     name:'Coût variable complet',     form:"N1 + N2", frontier:true,
      hint:"Sous cette ligne, chaque vente détruit de l'argent." },
    { id:'contrib', name:'Contribution',              form:"prix − coût variable complet" },
    { id:'n3',      name:'N3 · Charges fixes imputées', form:"part de structure par article" },
    { id:'cdr',     name:'CDR complet',               form:"N1 + N2 + N3", frontier:true,
      hint:"Le coût complet, structure comprise." },
    { id:'prix',    name:'Décision prix',             form:"stratégie → prix final + verdict" },
  ];

  /* ─── STYLES ─────────────────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('efv-styles')) return;
    const s = document.createElement('style'); s.id = 'efv-styles';
    s.textContent = `
      .efv-wrap{max-width:1320px;margin:0 auto;padding:18px 22px;color:var(--text-primary);}
      .efv-toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px;}
      .efv-select,.efv-input{padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:.85rem;font-family:inherit;background:var(--bg-card);color:var(--text-primary);}
      .efv-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text-secondary);margin-bottom:12px;}
      .efv-legend span{display:inline-flex;align-items:center;gap:5px;}
      .efv-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
      .efv-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,380px);gap:18px;align-items:start;}
      .efv-chain{display:flex;flex-direction:column;gap:0;}
      .efv-box{background:var(--bg-card);border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;cursor:pointer;transition:border-color .15s;}
      .efv-box:hover{border-color:#94a3b8;}
      .efv-box.active{border-color:#64748b;box-shadow:0 0 0 1px #cbd5e1;}
      .efv-box.frontier{border-width:2px;}
      .efv-box-top{display:flex;align-items:center;gap:8px;}
      .efv-box-name{font-size:13px;font-weight:700;flex:1;}
      .efv-box-amt{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;}
      .efv-box-form{font-size:11px;color:var(--text-tertiary);margin:2px 0 0 17px;}
      .efv-box-hint{font-size:11px;color:#b45309;margin:4px 0 0 17px;font-style:italic;}
      .efv-chip{font-size:10px;font-weight:600;padding:1px 7px;border-radius:6px;white-space:nowrap;}
      .efv-ok{background:#dcfce7;color:#166534;}.efv-warn{background:#fef9c3;color:#854d0e;}
      .efv-low{background:#fee2e2;color:#991b1b;}.efv-danger{background:#fee2e2;color:#991b1b;}.efv-neutral{background:#f1f5f9;color:#475569;}
      .efv-formula{font-size:12px;color:var(--text-secondary);margin:6px 0 0 17px;font-variant-numeric:tabular-nums;}
      .efv-formula b{color:var(--text-primary);}
      .efv-prices{display:flex;gap:16px;font-size:12px;color:var(--text-secondary);margin:6px 0 0 17px;}
      .efv-edits{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0 0 17px;}
      .efv-edits label{font-size:11px;color:var(--text-secondary);display:flex;align-items:center;gap:4px;}
      .efv-edit{width:90px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:5px;font-size:12px;font-family:inherit;background:var(--bg-page);color:var(--text-primary);}
      .efv-edit:focus{outline:2px solid #2563eb;outline-offset:-1px;}
      .efv-edits .u{color:var(--text-tertiary);font-size:10px;}
      .efv-arrow{display:flex;align-items:center;justify-content:center;gap:8px;color:var(--text-tertiary);font-size:11px;padding:3px 0;}
      .efv-arrow .v{font-variant-numeric:tabular-nums;}
      .efv-delta{font-weight:700;font-size:11px;}
      .efv-delta.up{color:#dc2626;}.efv-delta.down{color:#16a34a;}.efv-delta.flat{color:var(--text-tertiary);}
      .efv-detail{background:var(--bg-page);border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;min-height:320px;}
      .efv-d-name{font-size:15px;font-weight:700;}
      .efv-d-role{font-size:12.5px;color:var(--text-secondary);font-style:italic;margin:4px 0 12px;line-height:1.5;}
      .efv-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);margin:12px 0 7px;}
      .efv-alloc{font-size:12px;color:var(--text-secondary);padding:3px 0;border-bottom:1px dashed #e2e8f0;}
      .efv-strat-table{width:100%;border-collapse:collapse;font-size:11.5px;}
      .efv-strat-table th{text-align:right;font-weight:600;color:var(--text-secondary);padding:5px 6px;border-bottom:1px solid #e2e8f0;white-space:nowrap;}
      .efv-strat-table th:first-child{text-align:left;}
      .efv-strat-table td{padding:5px 6px;border-bottom:1px solid #f1f5f9;font-variant-numeric:tabular-nums;text-align:right;}
      .efv-strat-table td:first-child{text-align:left;}
      @media(max-width:820px){.efv-grid{grid-template-columns:1fr;}}
    `;
    document.head.appendChild(s);
  }

  /* ─── RENDER ─────────────────────────────────────────────────────────────── */
  async function render(rootEl) {
    _injectStyles();
    rootEl.innerHTML = `
      <div class="efv-wrap">
        <h1 class="page-title">Carte économique</h1>
        <p class="page-subtitle">Modifie une valeur dans une boîte : le calcul se propage le long des flèches jusqu'au prix. Source unique : le moteur.</p>
        <div class="efv-toolbar">
          <select id="efv-product" class="efv-select" style="min-width:260px"><option>Chargement…</option></select>
          <span id="efv-meta" style="font-size:12px;color:var(--text-secondary)"></span>
        </div>
        <div class="efv-legend">
          <span><span class="efv-dot" style="background:#16a34a"></span>aligné</span>
          <span><span class="efv-dot" style="background:#eab308"></span>attention / sous-couverture</span>
          <span><span class="efv-dot" style="background:#dc2626"></span>destructif / confiance faible</span>
          <span><span class="efv-delta up">+rouge</span> coût en hausse · <span class="efv-delta down">−vert</span> en baisse</span>
        </div>
        <div class="efv-grid">
          <div class="efv-chain" id="efv-chain"></div>
          <div class="efv-detail" id="efv-detail"></div>
        </div>
      </div>`;

    try {
      const resp = await KmcApi.getProducts({ limit: 500 });
      _s.products = (resp && (resp.products || resp.items || resp.data || resp)) || [];
      if (!Array.isArray(_s.products)) _s.products = [];
    } catch (e) { _s.products = []; }

    const sel = document.getElementById('efv-product');
    if (!_s.products.length) { sel.innerHTML = '<option>Aucun produit</option>'; return; }
    sel.innerHTML = _s.products.map(p => `<option value="${_esc(p.id)}">${_esc(p.name || p.id)}</option>`).join('');
    sel.addEventListener('change', () => { _s.productId = sel.value; _s.overrides = {}; _s.prev = null; loadFlow(true); });
    _s.productId = _s.products[0].id; sel.value = _s.productId;
    loadFlow(true);
  }

  function _buildBody() {
    const o = _s.overrides, body = { product_id: _s.productId };
    ['cost_kmf','weight_kg','current_price_kmf','monthly_fixed_costs_kmf','final_price_kmf','competitor_price_kmf'].forEach(k => {
      if (o[k] != null && o[k] !== '') body[k] = Number(o[k]);
    });
    if (o.pricing_strategy) body.pricing_strategy = o.pricing_strategy;
    const fo = {};
    if (o.objectif_commandes_mois != null && o.objectif_commandes_mois !== '') fo.objectif_commandes_mois = Number(o.objectif_commandes_mois);
    if (o.avg_articles_per_order != null && o.avg_articles_per_order !== '')   fo.avg_articles_per_order = Number(o.avg_articles_per_order);
    if (Object.keys(fo).length) body.finance_overrides = fo;
    return body;
  }

  async function loadFlow(rebuild) {
    const det = document.getElementById('efv-detail');
    try {
      const next = await KmcApi.getPricingFlow(_buildBody());
      _s.prev = _s.flow; _s.flow = next;
      if (rebuild || !document.getElementById('efv-box-objet')) renderChainStructure();
      updateDisplays();
      renderDetail();
      const m = document.getElementById('efv-meta');
      if (m) m.textContent = `${next.category || ''} · confiance données : ${(next.data_quality && next.data_quality.confidence) || '—'}`;
    } catch (e) {
      if (det) det.innerHTML = `<div class="error-state">Erreur moteur : ${_esc(e.message || e)}</div>`;
    }
  }

  // Construit la structure UNE fois (les inputs ne sont pas re-rendus au recalcul → pas de perte de focus)
  function renderChainStructure() {
    const f = _s.flow, chain = document.getElementById('efv-chain');
    let h = '';
    BOXES.forEach((b, i) => {
      const accent = FAMILY[b.id];
      h += `<div class="efv-box${b.frontier ? ' frontier' : ''}" id="efv-box-${b.id}" data-box="${b.id}"${b.frontier ? ` style="border-color:${accent}"` : ''}>
        <div class="efv-box-top">
          <span class="efv-dot" style="background:${accent}"></span>
          <span class="efv-box-name">${_esc(b.name)}</span>
          <span class="efv-box-amt" id="amt-${b.id}"></span>
          <span class="efv-chip" id="chip-${b.id}"></span>
        </div>
        <div class="efv-box-form">${_esc(b.form)}</div>
        ${b.hint ? `<div class="efv-box-hint">${_esc(b.hint)}</div>` : ''}
        ${_body(b.id, f)}
      </div>`;
      if (i < BOXES.length - 1) {
        h += `<div class="efv-arrow" id="flow-${i}">
          <span>▼</span><span class="v" id="flowval-${i}"></span><span class="efv-delta" id="flowdelta-${i}"></span>
        </div>`;
      }
    });
    chain.innerHTML = h;

    // clic boîte → détail
    chain.querySelectorAll('.efv-box').forEach(el => {
      el.addEventListener('click', ev => {
        if (ev.target.classList.contains('efv-edit')) return; // ne pas changer de détail en éditant
        _s.selectedBox = el.getAttribute('data-box'); renderDetail(); _highlightActive();
      });
    });
    // édition inline (délégation)
    chain.querySelectorAll('.efv-edit').forEach(el => {
      const ev = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const k = el.getAttribute('data-ov');
        _s.overrides[k] = el.value;
        clearTimeout(_s.debounce);
        _s.debounce = setTimeout(() => loadFlow(false), 350);
      });
    });
    _highlightActive();
  }

  function _highlightActive() {
    document.querySelectorAll('.efv-box').forEach(el => el.classList.toggle('active', el.getAttribute('data-box') === _s.selectedBox));
  }

  // Met à jour UNIQUEMENT les valeurs calculées (jamais les inputs) → pas de perte de focus
  function updateDisplays() {
    const f = _s.flow, p = _s.prev;
    const amt = {
      objet: f.current_price_kmf, n1: f.n1_landed_relay_cost_kmf, n2: f.n2_business_variable_cost_kmf,
      cvc: f.variable_cost_complete_kmf, contrib: f.contribution_kmf, n3: f.n3_fixed_overhead_allocation_kmf,
      cdr: f.cdr_complete_kmf, prix: (f.final_price_kmf != null ? f.final_price_kmf : f.recommended_price_kmf),
    };
    BOXES.forEach(b => {
      const el = document.getElementById('amt-' + b.id);
      if (el) el.textContent = (amt[b.id] == null ? '—' : _fmt(amt[b.id]) + ' KMF');
      const chip = document.getElementById('chip-' + b.id);
      if (chip) { const st = STATUS[_boxStatus(b.id, f)] || STATUS.neutral; chip.className = 'efv-chip ' + st.cls; chip.textContent = st.lab; if (!st.lab) chip.style.display = 'none'; else chip.style.display = ''; }
    });

    // valeurs intermédiaires dans les formules
    const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setT('res-n1', _fmt(f.n1_landed_relay_cost_kmf));
    setT('res-n2', _fmt(f.n2_business_variable_cost_kmf));
    setT('res-cvc-n1', _fmt(f.n1_landed_relay_cost_kmf)); setT('res-cvc-n2', _fmt(f.n2_business_variable_cost_kmf)); setT('res-cvc', _fmt(f.variable_cost_complete_kmf));
    setT('res-c-p', _fmt(f.current_price_kmf)); setT('res-c-v', _fmt(f.variable_cost_complete_kmf)); setT('res-contrib', f.contribution_kmf == null ? '—' : _fmt(f.contribution_kmf));
    setT('res-n3', _fmt(f.n3_fixed_overhead_allocation_kmf));
    setT('res-cdr-v', _fmt(f.variable_cost_complete_kmf)); setT('res-cdr-n3', _fmt(f.n3_fixed_overhead_allocation_kmf)); setT('res-cdr', _fmt(f.cdr_complete_kmf));
    setT('res-floor', _fmt(f.minimum_safe_price_kmf)); setT('res-reco', _fmt(f.recommended_price_kmf));

    // flèches : valeur transmise + delta vs précédent
    BOXES.forEach((b, i) => {
      if (i >= BOXES.length - 1) return;
      const t = _transmit(b.id, f);
      const vEl = document.getElementById('flowval-' + i);
      const dEl = document.getElementById('flowdelta-' + i);
      if (!vEl) return;
      if (!t || t.val == null) { vEl.textContent = t ? t.lab : ''; if (dEl) dEl.textContent = ''; return; }
      vEl.textContent = `${t.lab} = ${_fmt(t.val)} KMF`;
      if (dEl && p && t.key) {
        const d = g(f, t.key) - g(p, t.key);
        if (d === 0) { dEl.textContent = ''; }
        else { dEl.textContent = _signed(d); dEl.className = 'efv-delta ' + (d > 0 ? 'up' : 'down'); }
      } else if (dEl) dEl.textContent = '';
    });
  }

  /* ─── DÉTAIL (clic boîte) : rôle + imputation + stratégies ───────────────── */
  function renderDetail() {
    const f = _s.flow, det = document.getElementById('efv-detail');
    if (!f || !det) return;
    const b = BOXES.filter(x => x.id === _s.selectedBox)[0];
    const accent = FAMILY[b.id];
    const ROLE = {
      objet:"Le produit et ses hypothèses d'entrée. Tout part d'ici.",
      n1:"Tout ce qui amène l'objet disponible au point relais.",
      n2:"Le coût variable de l'encaissement et du risque.",
      cvc:"Frontière rouge : sous cette ligne, chaque vente détruit de l'argent.",
      contrib:"Ce que la vente laisse pour couvrir les charges fixes.",
      n3:"La quote-part de structure portée par cet article.",
      cdr:"Le coût complet imputé, structure comprise.",
      prix:"Le choix humain assumé, montré avec ses conséquences.",
    };
    let extra = '';
    if (b.id === 'n1' || b.id === 'n2') extra = _allocPanel(f);
    if (b.id === 'cvc' || b.id === 'cdr' || b.id === 'contrib') extra = _propPanel(f);
    if (b.id === 'n3') extra = `<div class="efv-section-title">Formule N3 (par ${_esc(f.n3_allocation_unit || 'article')})</div>
      <div class="efv-alloc">${_esc(f.n3_formula || '')}</div>` + _propPanel(f);
    if (b.id === 'prix') extra = _stratPanel(f);
    det.innerHTML = `
      <div style="display:flex;align-items:center;gap:9px;">
        <span class="efv-dot" style="width:11px;height:11px;background:${accent}"></span>
        <span class="efv-d-name">${_esc(b.name)}</span>
      </div>
      <p class="efv-d-role">${_esc(ROLE[b.id] || '')}</p>
      ${extra || '<p style="font-size:12px;color:var(--text-tertiary)">Modifie les variables dans la boîte à gauche pour voir l\'impact se propager.</p>'}`;
  }

  function _pct(part, whole) {
    if (!whole) return '—';
    return Math.round((Number(part) / Number(whole)) * 100) + '%';
  }

  function _allocPanel(f) {
    const allocs = f.allocations || [];
    if (!allocs.length) return '<p style="font-size:12px;color:var(--text-tertiary)">Aucune imputation détaillée.</p>';
    const n1 = f.n1_landed_relay_cost_kmf, cdr = f.cdr_complete_kmf;
    const items = allocs.map(a => {
      const im = a.allocated_cost_kmf != null ? a.allocated_cost_kmf : a.imputed_amount_kmf;
      const eng = a.engaged_cost_kmf != null ? a.engaged_cost_kmf : a.engaged_amount_kmf;
      const lvl = a.allocation_level || a.engaged_level;
      return `<div class="efv-alloc">${_esc(a.component_label)} : ${_fmt(eng)} /${_esc(lvl)} / ${a.allocation_divisor} = <b>${_fmt(im)}</b>
        <span style="color:var(--text-tertiary)"> · ${_pct(im, n1)} de N1 · ${_pct(im, cdr)} du CDR · base ${_esc(a.allocation_basis || 'quantity')}</span></div>`;
    }).join('');
    return `<div class="efv-section-title">Imputation + proportions (ce qui pèse)</div>${items}`;
  }

  function _propPanel(f) {
    const price = f.current_price_kmf, cdr = f.cdr_complete_kmf;
    const rows = [
      ['N1 · coût rendu relais', f.n1_landed_relay_cost_kmf, `${_pct(f.n1_landed_relay_cost_kmf, cdr)} du CDR · ${_pct(f.n1_landed_relay_cost_kmf, price)} du prix`],
      ['N2 · business variable', f.n2_business_variable_cost_kmf, `${_pct(f.n2_business_variable_cost_kmf, cdr)} du CDR · ${_pct(f.n2_business_variable_cost_kmf, price)} du prix`],
      ['N3 · charges fixes', f.n3_fixed_overhead_allocation_kmf, `${_pct(f.n3_fixed_overhead_allocation_kmf, cdr)} du CDR · ${_pct(f.n3_fixed_overhead_allocation_kmf, price)} du prix`],
      ['Contribution', f.contribution_kmf, f.contribution_kmf == null ? '—' : `${_pct(f.contribution_kmf, price)} du prix`],
      ['Marge complète', price ? price - cdr : null, price ? `${_pct(price - cdr, price)} du prix` : '—'],
    ];
    const body = rows.map(([k, v, p]) => `<div class="efv-alloc">${k} : <b>${v == null ? '—' : _fmt(v)}</b> <span style="color:var(--text-tertiary)">· ${p}</span></div>`).join('');
    return `<div class="efv-section-title">Proportions — où part chaque franc</div>${body}`;
  }

  function _stratPanel(f) {
    const strat = f.strategies || [];
    if (!strat.length) return '';
    const rows = strat.map(s => {
      const vClass = ({ LOSS:'efv-danger', WATCH:'efv-warn', TEST:'efv-neutral', PRIORITY:'efv-ok' }[s.verdict]) || 'efv-neutral';
      return `<tr>
        <td>${_esc(s.label)}${s.needs_input ? ' <span style="color:#b45309" title="requiert '+_esc(s.needs_input)+'">⚠</span>' : ''}</td>
        <td>${_fmt(s.final_price_kmf)}</td>
        <td>${_signed(s.contribution_kmf)}</td>
        <td>${_signed(s.gap_to_cdr_kmf)}</td>
        <td>${s.uncovered_fixed_kmf > 0 ? _fmt(s.uncovered_fixed_kmf) : '—'}</td>
        <td>${s.volume_to_compensate != null ? _fmt(s.volume_to_compensate) : '—'}</td>
        <td style="text-align:center"><span class="efv-chip ${vClass}">${_esc(s.verdict)}</span></td>
      </tr>`;
    }).join('');
    return `<div class="efv-section-title">6 stratégies — prix, contribution, écart CDR, verdict</div>
      <div style="overflow-x:auto"><table class="efv-strat-table">
        <thead><tr><th>Stratégie</th><th>Prix</th><th>Contrib.</th><th>Écart CDR</th><th>Fixe n.c.</th><th>Vol.comp</th><th>Verdict</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:6px">Fixe n.c. = charges fixes non couvertes si prix sous CDR. Vol.comp = articles/mois pour couvrir les charges fixes.</div>`;
  }

  global.EconomicFlowView = { render };

})(window);
