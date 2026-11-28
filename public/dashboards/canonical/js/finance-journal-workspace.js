/**
 * @komerce-arch
 * @role          canonical-finance-journal-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_accounting_operator, server_admin_context, financial_journal_projection
 * @outputs       canonical_accounting_journal_dom
 * @depends       /api/admin/workspaces/accounting/market/:marketCode/journal/*, finance-accounting-workspace
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_scope_is_authority, projection_only_no_business_recompute, eur_never_invented, not_double_entry
 * @impact-areas  admin-dashboard, accounting, finance
 * @version       2026-11
 *
 * Comptabilité : Synthèse | Journal | Rapprochements | Pièces justificatives.
 * Tout vient de la projection serveur du journal ; aucune règle financière n'est recalculée ici.
 */
'use strict';

(function initFinanceJournalWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalFinanceJournalWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createFinanceJournalWorkspace() {
  const PREFIX = '/api/admin/workspaces/accounting/market/';
  const MARKET_CODE = /^[A-Z]{2}$/;
  const TABS = Object.freeze([
    { id: 'summary', label: 'Synthèse' },
    { id: 'movements', label: 'Journal' },
    { id: 'reconciliation', label: 'Rapprochements' },
    { id: 'documents', label: 'Pièces justificatives' },
    // Point d'entrée réel du responsable marché vers la réception des dépôts de caisse (garde des espèces).
    { id: 'custody', label: 'Garde des espèces & dépôts' },
  ]);

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function endpointFor(marketCode, view, filters = {}) {
    const code = String(marketCode || '').trim().toUpperCase();
    if (!MARKET_CODE.test(code)) throw new Error('canonical_accounting_journal_market_required');
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
    const suffix = query.toString();
    return `${PREFIX}${encodeURIComponent(code)}/journal/${view}${suffix ? `?${suffix}` : ''}`;
  }

  async function getJson(fetchFn, url) {
    const response = await fetchFn(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  }

  const money = (value, currency) => `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)} ${currency}`;
  const day = value => (value ? String(value).slice(0, 10) : '—');

  function table(doc, headers, rows, emptyMessage) {
    if (!rows.length) return text(doc, 'p', 'kmc-workspace-empty', emptyMessage);
    const wrap = doc.createElement('div');
    wrap.style.overflowX = 'auto';
    wrap.style.maxWidth = '100%';
    wrap.style.minWidth = '0';
    const node = doc.createElement('table');
    node.className = 'kmc-com-table';
    const head = doc.createElement('tr');
    headers.forEach(label => head.appendChild(text(doc, 'th', '', label)));
    const thead = doc.createElement('thead');
    thead.appendChild(head);
    node.appendChild(thead);
    const body = doc.createElement('tbody');
    rows.forEach(cells => {
      const tr = doc.createElement('tr');
      cells.forEach(cell => tr.appendChild(text(doc, 'td', '', cell)));
      body.appendChild(tr);
    });
    node.appendChild(body);
    wrap.appendChild(node);
    return wrap;
  }

  const nativeText = list => (list || []).map(item => money(item.total != null ? item.total : item.remaining_native, item.currency)).join(' · ');
  const eurBanner = (doc, eurComplete, count) => (eurComplete ? null : text(doc, 'p', 'kmc-workspace-note kmc-journal-eur-warning',
    `${count} mouvement(s) sans conversion EUR (taux indisponible) : totaux EUR partiels, jamais estimés.`));

  const RENDERERS = {
    summary(doc, host, data) {
      if (data.journal_empty) { host.appendChild(text(doc, 'p', 'kmc-workspace-empty', 'Le journal est vide : la projection est périodique, aucune donnée inventée.')); return; }
      const warning = eurBanner(doc, data.eur_complete, data.eur_unavailable_movements);
      if (warning) host.appendChild(warning);
      host.appendChild(table(doc, ['Mouvement', 'État', 'Nb', 'Montant EUR', 'Montants natifs'],
        data.lines.map(line => [line.label, line.state_label, line.movements,
          line.eur_unavailable > 0 && line.eur_total === 0 ? '—' : money(line.eur_total, '€'), nativeText(line.native)]),
        'Aucun mouvement sur la période.'));
      const nf = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      host.appendChild(table(doc, ['Niveau de coût', 'État', 'Nb', 'Montant EUR', 'Montants natifs'],
        (data.cost_levels || []).flatMap(level => (level.source_missing
          ? [[level.label, 'Non alimenté', '—', '—', 'Aucune source journalisée (jamais affiché comme 0)']]
          : level.states.map(item => [level.label, item.state_label, item.movements,
            item.eur_unavailable > 0 && item.eur_total === 0 ? '—' : `${nf.format(item.eur_total)} €${item.eur_unavailable > 0 ? ' (partiel)' : ''}`, nativeText(item.native)]))),
        'Aucun coût sur la période.'));
      const remaining = data.supplier_remaining_native || [];
      host.appendChild(text(doc, 'p', 'kmc-workspace-note', remaining.length
        ? `Restant à décaisser fournisseurs (natif, jamais additionné entre devises) : ${nativeText(remaining)}.`
        : 'Aucun restant à décaisser fournisseur sur la période.'));
      host.appendChild(text(doc, 'p', 'kmc-workspace-note', 'Journal de mouvements, pas une comptabilité en partie double.'));
    },
    movements(doc, host, data) {
      host.appendChild(table(doc, ['Date', 'Mouvement', 'Réf.', 'État', 'Natif', 'EUR', 'Pièces'],
        data.rows.map(row => [day(row.occurred_at), row.label, row.reference || '—', row.state_label,
          money(row.amount_native, row.currency), row.amount_eur == null ? '—' : money(row.amount_eur, '€'), row.documents]),
        'Aucun mouvement sur la période.'));
      host.appendChild(text(doc, 'p', 'kmc-workspace-note', `${data.rows.length} sur ${data.total} mouvement(s).`));
    },
    reconciliation(doc, host, data) {
      host.appendChild(text(doc, 'p', `kmc-workspace-note ${data.ok ? 'is-ok' : 'is-ko'}`,
        data.ok ? 'Journal réconcilié avec les sources métier.' : 'Écarts détectés entre le journal et les sources : à traiter avant toute validation.'));
      host.appendChild(table(doc, ['Contrôle', 'Journal', 'Source', 'Résultat'],
        data.checks.map(check => [check.label, check.journal, check.source, check.ok ? 'Conforme' : 'ÉCART']), 'Aucun contrôle.'));
    },
    documents(doc, host, data) {
      host.appendChild(table(doc, ['Date', 'Mouvement', 'Pièce', 'Référence', 'Montant natif'],
        data.documents.map(row => [day(row.occurred_at), row.label, row.doc_kind, row.doc_ref, money(row.amount_native, row.currency)]),
        'Aucune pièce rattachée sur la période.'));
      host.appendChild(text(doc, 'h3', 'kmc-workspace-subtitle', `Décaissements réglés sans pièce (${data.missing_documents.length})`));
      host.appendChild(table(doc, ['Date', 'Mouvement', 'Réf.', 'Montant natif'],
        data.missing_documents.map(row => [day(row.occurred_at), row.label, row.reference || '—', money(row.amount_native, row.currency)]),
        'Aucun décaissement réglé sans pièce.'));
    },
  };

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') throw new Error('canonical_accounting_journal_dependencies_missing');
    const resolved = options.contextContract.resolveMarketView(options.adminContext, options.requestedMarket);
    if (!resolved.marketCode) throw new Error('canonical_accounting_journal_market_required');
    const marketCode = resolved.marketCode;
    const now = new Date();
    const state = { tab: 'summary', from: new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };

    rootNode.className = 'kmc-operations-workspace';
    rootNode.setAttribute('data-workspace-kind', 'accounting-journal');
    rootNode.replaceChildren();
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';
    header.setAttribute('data-dashboard-role', 'hero');
    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'COMPTABILITÉ'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Journal financier'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', `${marketCode} · mouvements, rapprochements et pièces — natif conservé, pivot EUR`));
    header.appendChild(copy);
    rootNode.appendChild(header);

    const tabs = doc.createElement('div');
    tabs.className = 'kmc-workspace-tabs';
    tabs.setAttribute('role', 'tablist');
    rootNode.appendChild(tabs);
    const content = doc.createElement('div');
    content.setAttribute('data-journal-content', '');
    content.style.minWidth = '0';
    content.style.maxWidth = '100%';
    rootNode.appendChild(content);

    function drawTabs() {
      tabs.replaceChildren();
      TABS.forEach(item => {
        const button = text(doc, 'button', `kmc-workspace-tab${item.id === state.tab ? ' is-active' : ''}`, item.label);
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', item.id === state.tab ? 'true' : 'false');
        button.setAttribute('data-journal-tab', item.id);
        button.addEventListener('click', () => { state.tab = item.id; load(); });
        tabs.appendChild(button);
      });
    }

    async function load() {
      drawTabs();
      content.replaceChildren();
      ui.UIState.render(content, 'loading', 'Chargement…');
      try {
        if (state.tab === 'custody') {
          const custodyView = options.accountingWorkspace
            || (typeof globalThis !== 'undefined' ? globalThis.KomerceCanonicalFinanceAccountingWorkspace : null);
          if (!custodyView) throw new Error('canonical_accounting_custody_module_missing');
          content.replaceChildren();
          await custodyView.mount({ ...options, root: content });
          return;
        }
        const data = await getJson(fetchFn, endpointFor(marketCode, state.tab, { from: state.from, to: state.to }));
        content.replaceChildren();
        RENDERERS[state.tab](doc, content, data);
      } catch (error) {
        ui.UIState.render(content, 'error', error.message);
      }
    }
    await load();
    return { reload: load };
  }

  // Central B4 workstation, separate from the market journal. No provider
  // request is initiated here; the existing supplier settlement writer records
  // a debit/refund already attested by its evidence.
  async function mountSupplierPayments({root,document:doc,fetch:fetchFn,user}={}) {
    if(user?.role!=='finance')return;
    const prefix='/api/purchasing/supplier-payments';
    let offset=0,pending=false,seq=0;
    async function request(url,body) {
      const r=await fetchFn(url,{method:body?'POST':'GET',credentials:'include',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.error||'HTTP '+r.status);
      return data;
    }
    const identity={};root.__supplierFinanceIdentity=identity;
    const current=()=>root.__supplierFinanceIdentity===identity&&root.isConnected!==false;
    async function load(message='') {
      const n=++seq;
      const data=await request(prefix+'/finance-queue?limit=50&offset='+offset);
      if(!current()||n!==seq)return;
      root.replaceChildren();
      root.appendChild(text(doc,'h2','kmc-workspace-title','Règlements fournisseurs — Finance centrale'));
      root.appendChild(text(doc,'p','kmc-workspace-note','Constater un débit déjà vérifié, après engagement et autorisation Hub. Aucun paiement externe déclenché.'));
      const feedback=text(doc,'p','kmc-workspace-note',message);feedback.setAttribute('role','status');root.appendChild(feedback);
      for(const row of data.payments||[]) {
        const card=doc.createElement('section');card.className='kmc-workspace-section';
        card.appendChild(text(doc,'h3','kmc-workspace-subtitle',row.supplier_name+' · '+(row.payment_ref||row.id)));
        card.appendChild(text(doc,'p','', 'Attendu : '+row.expected_amount+' '+row.currency+' · Consigné : '+row.recorded_amount+' '+row.currency));
        const po=text(doc,'a','kmc-workspace-action','Dossier PO / preuves');
        po.href='/admin/workspaces/purchasing?po='+encodeURIComponent(row.purchase_order_id);card.appendChild(po);
        card.appendChild(text(doc,'p','kmc-workspace-note','Engagement : '+(row.commitment_proof||'absent')+' · Autorisation : '+(row.authorization_proof||'absente')));
        if(row.can_record===true){
          const form=doc.createElement('form');
          const fields={};
          const add=(name,label,opts={})=>{
            const wrap=text(doc,'label','',label);
            const el=doc.createElement(opts.choices?'select':'input');el.name=name;el.required=opts.required!==false;
            if(opts.choices)for(const [v,l] of opts.choices){const option=text(doc,'option','',l);option.value=v;el.appendChild(option);}
            else {el.type='text';if(opts.decimal)el.inputMode='decimal';}
            wrap.appendChild(el);form.appendChild(wrap);fields[name]=el;
          };
          add('kind','Nature',{choices:[['payment','Débit'],['goods_refund','Remboursement marchandise'],['fee_refund','Remboursement frais'],['other_refund','Autre remboursement']]});
          add('amount_currency','Montant '+row.currency,{decimal:true});
          const currencies=['EUR','USD','AED','CNY','KMF','XAF','DJF'].map(c=>[c,c]);
          add('debit_currency','Devise réellement débitée',{choices:currencies});
          add('debit_amount','Montant réellement débité hors frais',{decimal:true});
          add('fee_currency','Devise des frais',{choices:currencies});
          add('fee_amount','Frais réels',{decimal:true,required:false});
          add('debit_at','Date de valeur (ISO avec fuseau, ex. 2026-01-01T10:00:00Z)');
          add('proof_ref','Référence unique du relevé / reçu');
          const submit=text(doc,'button','kmc-workspace-action','Consigner le règlement');submit.type='submit';form.appendChild(submit);
          form.addEventListener('submit',async e=>{
            e.preventDefault();if(pending||!current())return;
            const proof=fields.proof_ref.value.trim();if(!proof)return;
            pending=true;submit.disabled=true;
            const body={kind:fields.kind.value,currency:row.currency,amount_currency:fields.amount_currency.value,debit_currency:fields.debit_currency.value,debit_amount:fields.debit_amount.value,fee_currency:fields.fee_currency.value,fee_amount:fields.fee_amount.value||'0',debit_at:fields.debit_at.value,proof_ref:proof,idempotency_key:'finance-ui:'+proof};
            try{await request(prefix+'/'+encodeURIComponent(row.id)+'/finance-settlements',body);
              try{await load('Règlement enregistré.');}catch(_){feedback.textContent='Règlement enregistré ; actualisation indisponible.';}
            }catch(err){feedback.textContent=err.message;}finally{pending=false;submit.disabled=false;}
          });
          card.appendChild(form);
        }else card.appendChild(text(doc,'p','kmc-workspace-note','Action indisponible : autorisation, séparation des acteurs ou preuve de débit non établie.'));
        root.appendChild(card);
      }
      const p=data.pagination||{};const count=(data.payments||[]).length;
      const nav=doc.createElement('nav');
      for(const [label,start,disabled] of [['Précédent',Math.max(0,offset-50),offset===0],['Suivant',offset+50,count<50||(p.total!=null&&offset+count>=p.total)]]) {
        const b=text(doc,'button','kmc-workspace-action',label);b.type='button';b.disabled=disabled;
        b.addEventListener('click',()=>{if(!pending){offset=start;load().catch(err=>{feedback.textContent=err.message;});}});nav.appendChild(b);
      }
      root.appendChild(nav);
    }
    try{await load();}catch(err){if(current()){root.replaceChildren();root.appendChild(text(doc,'p','kmc-workspace-note',err.message));}}
    return {reload:load};
  }

  return Object.freeze({ endpointFor, mount, mountSupplierPayments, TABS });
});
