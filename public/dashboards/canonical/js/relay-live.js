/**
 * @komerce-arch
 * @role          canonical-relay-live-cockpit
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        /api/relay/dashboard, /api/relay/orders, /api/relay/orders/:id
 * @outputs       relay_live_cockpit_read_only
 * @depends       public/dashboards/canonical/js/live-kit.js
 * @used-by       public/dashboards/canonical/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      exclusive_views, single_parent_navigation, read_only_live_cockpit, dashboard_never_recomputes_business_truth
 * @impact-areas  admin-dashboard, relais
 * @version       2026-10-relay-live-v1
 */
'use strict';

// Cockpit Live des Relais : lecture seule sur les API relay existantes (scopées rôle + marché).
// Suivi (flux + chiffres) / Colis (liste). Même moteur et même grammaire que le cockpit Hub.
(function initRelayLive(global) {
  const kit = global.KomerceLiveKit;
  if (!kit) throw new Error('live_kit_missing');
  const { order360Link, setViewer, simParams, simToggle, simBadge, esc, num, fmtDate, ageLabel, queryString, processBoard, tiles, table } = kit;

  // Montant à encaisser dans la devise du MARCHÉ (API a_encaisser) — jamais le pivot interne KMF.
  const fmtCollect = a => (a && a.available) ? `${Math.round(Number(a.amount)).toLocaleString('fr-FR')} ${a.currency}` : 'montant local indisponible';
  const fmtCollectTotals = (list, missing) => {
    const parts = (list || []).map(c => `${Math.round(Number(c.amount)).toLocaleString('fr-FR')} ${c.currency}`);
    if (missing) parts.push(`${missing} sans montant local`);
    return parts.length ? parts.join(' + ') : '0';
  };

  const BASE = '/admin/relais-live';
  const PAGE_SIZE = 25;
  const LISTS = Object.freeze({
    in_transit:'Colis en transit',
    available:'Disponibles au retrait',
    collected:'Colis retirés',
    all:'Tous les colis',
  });
  const LIST_COPY = Object.freeze({
    in_transit:'Commandes en acheminement vers leur relais, selon leur circuit. La réception physique se constate au relais.',
    available:'Colis arrivés au relais, en attente de retrait par le client. Les plus anciens d’abord.',
    collected:'Colis retirés par leur destinataire.',
    all:'Tous les colis suivis par les relais : expédiés, disponibles et retirés.',
  });
  const STATUS = Object.freeze({
    shipped:'Expédié', in_transit:'En transit', available:'Disponible au retrait', collected:'Retiré',
  });
  const INCIDENT = Object.freeze({
    retard:'Retard', blocage:'Blocage', paiement:'Paiement', stock:'Stock', colis_endommage:'Colis endommagé',
    colis_perdu:'Colis perdu', client_absent:'Client absent', autre:'Autre',
    content_mismatch:'Contenu différent', missing_item:'Article manquant', damaged_item:'Article endommagé',
    unexpected_item:'Article non attendu', quantity_mismatch:'Écart de quantité',
    delay:'Retard', blocked:'Blocage', payment_issue:'Problème de paiement',
    reconciliation_error:'Écart de réconciliation',
  });

  const listOf = p => (LISTS[p.list] ? p.list : 'available');
  const fromOf = p => (LISTS[p.from] ? p.from : '');
  const offsetOf = p => Math.max(0, num(p.offset));
  const listUrl = (list, offset = 0, search = '') => `${BASE}${queryString({ view:'orders', list, offset:offset > 0 ? offset : '', search:search||'', ...simParams() })}`;
  const orderUrl = (id, from) => `${BASE}${queryString({ view:'order', order:id, from, ...simParams() })}`;
  const previewUrl = id => `${BASE}${queryString({ sel:id, ...simParams() })}`;
  const paymentLabel = o => (o.cash_pending ? 'Cash à encaisser' : o.payment_status === 'paid' ? 'Payée' : 'Paiement en attente');


  const executionUrl=(market,focus='')=>{
    const code=String(market||'').trim().toUpperCase();
    return BASE+queryString({view:'execute',market:/^[A-Z]{2}$/.test(code)?code:'',focus:/^(shipments|cash|receive|collect)$/.test(focus)?focus:''});
  };
  // Flux de préparation et comptoir sont indépendants. Les statuts des commandes
  // n'attestent PAS un scan physique. Le rangement ne produit pas de statut métier.
  const WORK_STAGES=Object.freeze([
    {key:'transit',label:'Annoncés'},
    {key:'receive',label:'Réception'},
    {key:'organize',label:'Organisation'},
    {key:'available',label:'Disponibles'},
  ]);
  const remisesUrl=market=>BASE+queryString({view:'remises',market:/^[A-Z]{2}$/.test(String(market||''))?market:''});
  const relaySimToggle=()=>simToggle().replace('☑ Afficher la recette','Recette incluse')
    .replace('☐ Afficher la recette','Inclure la recette');
  function relayMainNav(active) {
    const items=[
      {id:'flux',name:'Flux Relais',url:BASE},
      {id:'remises',name:'Remises',url:remisesUrl('')},
      {id:'incidents',name:'Incidents & SAV',url:BASE+queryString({view:'incidents',...simParams()})},
      {id:'history',name:'Historique',url:listUrl('collected')},
    ];
    return `<nav class="kmc-relay-main-nav" aria-label="Espaces de travail du Relais">
      ${items.map(item=>`<a class="kmc-relay-main-tab${active===item.id?' is-active':''}"
        href="${esc(item.url)}" ${item.id==='remises'?'':'data-cockpit-nav'}
        ${active===item.id?'aria-current="page"':''}>${esc(item.name)}</a>`).join('')}
    </nav>`;
  }
  function relayWorkboard(p,data){
    const k=data?.dash?.kpi||{};
    const orders=(Array.isArray(data?.queue?.orders)?data.queue.orders:[]).filter(o=>o.status!=='collected');
    const selected=String(p.sel||'');
    function stage(o,key){
      const ready=o.status==='available',market=o.market_code;
      const ref=`data-relay-stage="${key}"`;
      if(key==='transit'){
        return ready?`<td><div class="kmc-relay-work-stage is-complete" ${ref} data-relay-stage-signal="complete"><strong>✓ Acheminement déclaré</strong></div></td>`:
          `<td><a class="kmc-relay-work-stage is-waiting is-current" ${ref}
            data-relay-stage-signal="waiting" href="${esc(previewUrl(o.id))}" data-cockpit-nav
            aria-current="step"><strong>En route</strong><small>Voir la commande →</small></a></td>`;
      }
      if(key==='receive'){
        return ready?`<td><div class="kmc-relay-work-stage is-neutral" ${ref} data-relay-stage-signal="reference">
          <strong>À vérifier sur preuve</strong><small>Disponibilité déclarée</small></div></td>`:
          `<td><a href="${esc(executionUrl(market,'shipments'))}" class="kmc-relay-work-stage is-action"
             ${ref} data-relay-stage-action="shipments" data-relay-stage-signal="action">
             <strong>Contrôler l'arrivage</strong><small>Réception importée / locale →</small></a></td>`;
      }
      if(key==='organize')return `<td><div class="kmc-relay-work-stage is-optional"
        ${ref} data-relay-stage-signal="optional"><strong>${ready?'Rangement libre':'Après réception'}</strong>
        <small>Emplacement facultatif · non attesté</small></div></td>`;
      return ready?`<td><a href="${esc(remisesUrl(market))}" class="kmc-relay-work-stage is-ready is-current"
        ${ref} data-relay-stage-signal="${o.cash_pending?'warning':'ready'}"
        data-relay-stage-action="collect" aria-current="step"><strong>${o.cash_pending?'Paiement à vérifier':'Prêt au retrait'}</strong>
        <small>Ouvrir le comptoir Remises →</small></a></td>`:
        `<td><div class="kmc-relay-work-stage is-future" ${ref} data-relay-stage-signal="waiting">
          <strong>À venir</strong><small>Après contrôle au relais</small></div></td>`;
    }
    const rows=orders.slice(0,20).map(o=>`<tr data-relay-workboard-order="${esc(o.id)}"
      class="${String(o.id)===selected?'is-selected':''}">
      <td class="kmc-relay-work-identity"><a class="kmc-relay-work-reference"
        data-cockpit-nav href="${esc(previewUrl(o.id))}">${esc(o.reference)}</a>
        <small>${esc(o.client_nom||o.user_name||'Client')} · ${esc(o.relais_nom||'Relais')}</small>
        ${o.simulation_scope?'<span class="kmc-relay-work-simulation">RECETTE</span>':''}</td>
      ${WORK_STAGES.map(st=>stage(o,st.key)).join('')}
      <td class="kmc-relay-work-followup"><span>${num(o.incidents_ouverts)>0?'<b class="is-incident">'+num(o.incidents_ouverts)+' incident(s)</b>':'Aucun incident'}</span>
        <span>${esc(o.cash_pending?'Cash à vérifier':o.payment_status==='paid'?'Payé':'Paiement à consulter')}</span>
        <a href="${esc(previewUrl(o.id))}" data-cockpit-nav>Dossier →</a></td></tr>`).join('');
    const heads=WORK_STAGES.map(st=>`<th data-relay-lane="${st.key}" scope="col">
      <strong>${esc(st.label)}</strong><small>${esc(st.key==='transit'?num(k.en_transit)+' en route':
      st.key==='available'?num(k.disponibles)+' déclarés disponibles':
      st.key==='receive'?'Contrôle physique':'Libre au relais')}</small></th>`).join('');
    const empty=`<tr class="kmc-relay-kanban-empty-row">
      <td class="kmc-relay-kanban-empty-intro"><strong>Flux sans commande active</strong>
        <small>Les réceptions physiques se consultent indépendamment de cette file.</small></td>
      ${WORK_STAGES.map(st=>`<td><div class="kmc-relay-kanban-empty-stage" data-relay-empty-lane="${st.key}">
        ${st.key==='receive'?'<a href="'+esc(executionUrl('','shipments'))+'">Contrôler les arrivages →</a>':
          st.key==='available'?'<a href="'+esc(remisesUrl(''))+'">Ouvrir les remises →</a>':
          '<span>Aucune action dans cette file</span>'}</div></td>`).join('')}
      <td><a data-cockpit-nav href="${esc(listUrl('all'))}">Tous les dossiers →</a></td>
    </tr>`;
    return `<section class="kmc-relay-work kmc-relay-flow" aria-label="Kanban des opérations du Relais">
      <header class="kmc-relay-work-header"><div>
        <span class="kmc-relay-work-eyebrow">PRÉPARATION · SUIVI DES COMMANDES</span>
        <h2>Du colis annoncé à la disponibilité</h2>
        <p>Le comptoir Remises reste accessible indépendamment de ce flux.</p></div>
        <nav class="kmc-relay-work-filters" aria-label="Files opérationnelles">
          <a data-cockpit-nav href="${esc(listUrl('in_transit'))}">En route <b>${num(k.en_transit)}</b></a>
          <a data-cockpit-nav href="${esc(listUrl('available'))}">Disponibles <b>${num(k.disponibles)}</b></a>
          <a href="${esc(executionUrl('','shipments'))}">Atelier réception →</a>
        </nav>
      </header>
      <div class="kmc-relay-work-layout${selected?' has-inspector':''}">
        <div class="kmc-relay-work-list"><div class="kmc-relay-work-scroll">
          <table class="kmc-relay-work-table" aria-label="Kanban Relais · étapes et actions">
          <thead><tr><th scope="col">Commande · client</th>${heads}<th scope="col">Suivi</th></tr></thead>
          <tbody>${rows||empty}</tbody></table></div>
          ${orders.length>20?'<a class="kmc-relay-work-more" href="'+esc(listUrl('all'))+'" data-cockpit-nav>Voir les autres dossiers →</a>':''}
        </div>
        ${renderPreview(p.sel,data?.detail)}
      </div>
      <footer class="kmc-relay-flow-footnote">Une commande ne prouve pas la réception d'un colis.
        Le rangement est facultatif et ne bloque jamais la disponibilité.</footer>
    </section>`;
  }
  function relayTabs(){
    return [
      {key:'flux',label:'Flux Relais',href:BASE},
      {key:'remises',label:'Remises',href:remisesUrl('')},
      {key:'incidents',label:'Incidents & SAV',href:BASE+queryString({view:'incidents'})},
      {key:'history',label:'Historique',href:listUrl('collected')},
    ];
  }

  function orderRow(order, from, selectedId) {
    const waiting = order.status === 'available' ? ageLabel(order.heures_attente) : ageLabel(num(order.age_jours) * 24);
    const late = order.urgence === 'haute' || order.urgence === 'critique';
    return `<tr>
      <td><a href="${orderUrl(order.id, from)}" data-cockpit-nav>${esc(order.reference)}</a>${order360Link(order.reference, 'Retour au Relais live')}${simBadge(order.simulation_scope)}</td>
      <td>${esc(order.client_nom || order.user_name || '—')}</td>
      <td>${esc(order.relais_nom || '—')}${order.ile ? ` <small>${esc(order.ile)}</small>` : ''}</td>
      <td>${esc(STATUS[order.status] || order.status)}</td>
      <td>${esc(waiting)}${late ? ' <b class="lk-late">en retard</b>' : ''}</td>
      <td>${num(order.nb_items)}</td>
      <td>${esc(paymentLabel(order))}</td>
      <td>${num(order.incidents_ouverts) > 0 ? `<b class="lk-late">${num(order.incidents_ouverts)}</b>` : '—'}</td>
      ${selectedId !== undefined ? `<td><a href="${previewUrl(order.id)}" data-cockpit-nav data-relay-preview="${esc(order.id)}"${String(order.id) === String(selectedId) ? ' aria-current="true"' : ''}>Aperçu</a></td>` : ''}
    </tr>`;
  }
  const ORDER_COLUMNS = ['Commande', 'Client', 'Relais', 'Statut', 'Attente', 'Articles', 'Paiement', 'Incidents'];


  // Détail dans la même vue : lecture seule sur /api/relay/orders/:id (même endpoint, mêmes droits que la fiche).
  function renderPreview(sel, detail) {
    if (!sel) return '';
    if (!detail) {
      return `<aside class="lk-block lk-relay-detail kmc-relay-work-inspector" data-relay-detail aria-label="Dossier contextuel">
        <header class="kmc-relay-inspector-head"><strong>Dossier indisponible</strong><a href="${BASE+queryString(simParams())}" data-cockpit-nav>Fermer ×</a></header>
        <p>Ce dossier est indisponible ou hors de votre périmètre.</p></aside>`;
    }
    const o = detail.order || {};
    const relais = detail.relais || {};
    const pay = detail.paiement || {};
    const incidents = Array.isArray(detail.incidents) ? detail.incidents : [];
    const wait = o.status === 'available' ? ageLabel(o.heures_attente) : ageLabel(num(o.age_jours) * 24);
    const fact = (label, value) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    return `<aside class="lk-block lk-relay-detail kmc-relay-work-inspector" data-relay-detail aria-label="Dossier contextuel">
      <header class="kmc-relay-inspector-head"><span class="kmc-relay-work-eyebrow">DOSSIER CONTEXTUEL</span><a href="${BASE+queryString(simParams())}" data-cockpit-nav aria-label="Fermer le dossier">Fermer ×</a></header>
      <h3>${esc(o.reference || 'Colis')}</h3>
      <div class="lk-facts">
        ${fact('Statut', STATUS[o.status] || o.status || '—')}
        ${fact('Client', detail.client?.nom || '—')}
        ${fact('Relais', [relais.nom, relais.ile].filter(Boolean).join(' · ') || '—')}
        ${fact(o.status === 'available' ? 'Attente au relais' : 'Âge', wait)}
        ${fact('Paiement', `${pay.cash_pending ? 'Cash à encaisser' : pay.is_paid ? 'Payée' : 'En attente'} · ${fmtCollect(pay.a_encaisser)}`)}
        ${fact('Incidents ouverts', incidents.filter(i => i.status !== 'resolved').length)}
      </div>
      <p class="kmc-relay-inspector-truth">Le statut de la commande ne remplace pas la preuve physique. Les articles et colis réellement reçus sont contrôlés dans l’atelier.</p>
      <a class="kmc-relay-inspector-cta" href="${executionUrl(o.market_code, o.status==='available' ? (pay.cash_pending?'cash':'collect') : o.status==='collected' ? 'collect' : 'shipments')}" data-relay-action="execute">${esc(o.status==='available'?'Préparer la remise au client':o.status==='collected'?'Consulter les opérations du relais':'Contrôler la réception')} · Atelier Relais ↗</a>
      <a class="kmc-relay-inspector-detail-link" href="${orderUrl(detail.order?.id || sel, '')}" data-cockpit-nav>Articles, incidents et chronologie →</a>
      <p>${order360Link(o.reference, 'Retour au Relais live')}</p>
    </aside>`;
  }

  // ── Suivi ───────────────────────────────────────────────────────────────────
  function renderOverview(p, data) {
    const k=data?.dash?.kpi||{};
    const late=num(k.en_attente_72h);
    const first=Array.isArray(data?.first?.orders)?data.first.orders:[];
    const operational=Array.isArray(data?.operational?.incidents)?data.operational.incidents:[];
    const opRows=operational.slice(0,8).map(i=>
      `<tr><td><a href="${orderUrl(i.order_id,'')}" data-cockpit-nav>${esc(i.order_reference)}</a></td>
        <td>${esc(i.product_name||'Commande')}</td><td>${esc(i.title||INCIDENT[i.incident_type]||i.incident_type)}</td>
        <td>${esc(i.resolver_domain||'—')}</td></tr>`);
    const stages=[
      {label:'En transit',icon:'➤',hue:'blue',count:num(k.en_transit),href:listUrl('in_transit'),cards:[],countLabel:'Aucune commande en transit'},
      {label:'Disponibles au retrait',icon:'⌂',hue:'teal',count:num(k.disponibles),href:listUrl('available'),cards:[],countLabel:'Aucune commande disponible'},
      {label:'Retirés aujourd’hui',icon:'✓',hue:'green',count:num(k.collectes_aujourd_hui),href:listUrl('collected'),cards:[],countLabel:'Aucun retrait enregistré aujourd’hui'},
    ];
    return {
      hero:`<header class="kir-hero kir-live-hero kmc-relay-compact-hero" aria-label="Suivi opérationnel des Relais">
        <div class="kmc-relay-heading">
          <span class="kmc-relay-work-eyebrow">KOMERCE · EXPLOITATION</span>
          <h1>Suivi des Relais <small>Tous circuits</small></h1>
          <p>Actualisé ${esc(fmtDate(data?.fetched_at))} · Réception et retrait sur preuve</p>
        </div>
        <div class="kmc-relay-heading-controls">
          <span class="kmc-relay-live-state"><i aria-hidden="true"></i> LIVE</span>
          ${relaySimToggle()}
        </div>
      </header>`,
      body:`${relayWorkboard(p,data)}
        ${operational.length?`<section class="kmc-relay-operational-alerts" aria-label="Incidents opérationnels">
          <header><strong>${operational.length} incident(s) à examiner</strong><span>À vérifier avant toute remise.</span></header>
          ${table(['Commande','Article','Information','Responsable'],opRows,{empty:'Aucun incident.'})}
        </section>`:''}
        <details class="kmc-relay-secondary kmc-relay-secondary-unified" data-relay-supervision>
          <summary><span>Indicateurs et suivi détaillé</span><small>Supervision et historique · ouvrir</small></summary>
          <div class="kmc-relay-secondary-content">
            ${tiles('INDICATEURS RELAIS',[
              {label:'En transit',value:num(k.en_transit),sub:'à suivre',href:listUrl('in_transit'),cls:'is-received'},
              {label:'Disponibles',value:num(k.disponibles),sub:late>0?late+' depuis +72 h':'à retirer',href:listUrl('available'),cls:'is-delivered'},
              {label:'Cash à encaisser',value:num(k.cash_a_encaisser),sub:fmtCollectTotals(k.montant_cash_par_devise,k.cash_sans_montant_local),cls:'is-discarded'},
              {label:'Incidents ouverts',value:num(k.incidents_ouverts),sub:'à examiner',cls:'is-review'},
            ])}
            <div class="kmc-relay-secondary-flow">${processBoard(stages)}</div>
            <div class="kmc-relay-secondary-table">
              <header><strong>Retraits prioritaires</strong><a href="${listUrl('available')}" data-cockpit-nav>Consulter la file →</a></header>
              ${table([...ORDER_COLUMNS,'Détail'],first.map(order=>orderRow(order,'available',p.sel||'')),{empty:'Aucun retrait prioritaire.'})}
            </div>
          </div>
        </details>`,
    };
  }

  // ── Liste ───────────────────────────────────────────────────────────────────
  function renderOrders(p, data) {
    const list = listOf(p);
    const rows = Array.isArray(data?.orders) ? data.orders : [];
    const offset = offsetOf(p);
    const search=String(p.search||'').slice(0,120);
    const pager = (offset > 0 || rows.length >= PAGE_SIZE) ? `<nav class="kir-passage-pagination" aria-label="Pagination">
        ${offset > 0 ? `<a href="${listUrl(list, Math.max(0, offset - PAGE_SIZE),search)}" data-cockpit-nav>← Plus récents</a>` : '<span></span>'}
        <span>${offset + 1}–${offset + rows.length}</span>
        ${rows.length >= PAGE_SIZE ? `<a href="${listUrl(list, offset + PAGE_SIZE,search)}" data-cockpit-nav>Plus anciens →</a>` : '<span></span>'}
      </nav>` : '';
    return {
      title:LISTS[list],
      copy:LIST_COPY[list],
      body:`<div class="kmc-relay-list-toolbar">
          <form method="get" action="${BASE}" role="search" class="kmc-relay-list-search">
            <input type="hidden" name="view" value="orders"><input type="hidden" name="list" value="${esc(list)}">
            ${simParams().sim?'<input type="hidden" name="sim" value="1">':''}
            <label for="kmc-relay-search">Rechercher une commande ou un destinataire</label>
            <div><input id="kmc-relay-search" name="search" type="search" value="${esc(search)}" maxlength="120" placeholder="Référence, client, téléphone…">
            <button type="submit">Rechercher</button></div>
          </form>
          ${relaySimToggle()}
        </div>
        <div class="kmc-relay-list-results"><strong>${rows.length} résultat(s) affiché(s)</strong>
          <a href="${BASE+queryString(simParams())}" data-cockpit-nav>← Poste de travail</a></div>
        ${table(ORDER_COLUMNS,rows.map(order=>orderRow(order,list)),{empty:search?'Aucun résultat pour cette recherche.':'Aucun dossier dans cette file.'})}${pager}`,
    };
  }

  function navOrders(p) {
    const list = listOf(p);
    if (list === 'all') return { crumbs:[{ label:'Relais', plain:true }, { label:'Colis' }], back:null };
    return {
      crumbs:[{ label:'Relais', plain:true }, { label:'Suivi', href:BASE }, { label:LISTS[list] }],
      back:{ href:BASE, label:'← Retour au suivi' },
    };
  }

  // ── Objet ───────────────────────────────────────────────────────────────────
  function renderOrder(p, data) {
    // Une fiche en échec ne doit pas effacer le parcours Suivi/Colis.
    // Ne jamais afficher les données d'une commande précédente comme repli.
    if (data?.unavailable) {
      const from = fromOf(p);
      const backHref = from ? listUrl(from) : BASE;
      return {
        title:'Détail indisponible',
        copy:'Impossible de lire ce colis pour le moment.',
        body:`<div class="kir-error" role="alert">Le suivi Relais reste accessible. <a href="${backHref}" data-cockpit-nav>Revenir aux colis</a></div>`,
      };
    }
    const o = data?.order || {};
    const relais = data?.relais || {};
    const pay = data?.paiement || {};
    const items = Array.isArray(data?.items) ? data.items : [];
    const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
    const incidents = Array.isArray(data?.incidents) ? data.incidents : [];
    const card = (label, value) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    const wait = o.status === 'available' ? ageLabel(o.heures_attente) : ageLabel(num(o.age_jours) * 24);
    return {
      title:o.reference || 'Colis',
      copy:`${STATUS[o.status] || o.status || ''} · ${data?.client?.nom || 'client'} · ${relais.nom || 'relais non défini'}`,
      body:`<div class="kmc-relay-order-toolbar"><div><strong>Dossier de commande · ${esc(o.reference||'—')}</strong><small>La remise se valide colis par colis avec justificatif.</small></div><a href="${executionUrl(o.market_code)}">Ouvrir l’atelier Relais ↗</a></div><p class="lk-360-line">${order360Link(o.reference, 'Retour au Relais live')}</p><div class="lk-facts">
          ${card(o.status === 'available' ? 'Attente au relais' : 'Âge', wait)}
          ${card('Relais', [relais.nom, relais.ile].filter(Boolean).join(' · ') || '—')}
          ${card('Articles', items.length)}
          ${card('Paiement', `${pay.cash_pending ? 'Cash à encaisser' : pay.is_paid ? 'Payée' : 'En attente'} · ${fmtCollect(pay.a_encaisser)}`)}
        </div>
        <section class="lk-block"><span class="kir-section-kicker">ARTICLES</span>
          ${table(['Produit', 'Quantité'], items.map(item => `<tr><td>${esc(item.produit || '—')}</td><td>${num(item.quantity)}</td></tr>`), { empty:'Aucun article.' })}
        </section>
        <section class="lk-block"><span class="kir-section-kicker">INCIDENTS</span>
          ${table(['Type', 'Article', 'Priorité', 'Statut', 'Information'], incidents.map(i => `<tr><td>${esc(INCIDENT[i.type] || i.type)}</td><td>${esc(i.product_name || '—')}</td><td>${esc(i.priority)}</td><td>${esc(i.status)}</td><td>${esc(i.description || '—')}</td></tr>`), { empty:'Aucun incident.' })}
        </section>
        <section class="lk-block"><span class="kir-section-kicker">CHRONOLOGIE</span>
          ${table(['Statut', 'Par', 'Date'], timeline.map(t => `<tr><td>${esc(STATUS[t.status] || t.status)}</td><td>${esc(t.changed_by_name || '—')}</td><td>${esc(fmtDate(t.created_at))}</td></tr>`), { empty:'Aucun changement enregistré.' })}
        </section>`,
    };
  }

  function navOrder(p, data) {
    const from = fromOf(p);
    const ref = data?.order?.reference || 'Colis';
    const domain = { label:'Relais', plain:true };
    if (!from) return { crumbs:[domain, { label:'Suivi', href:BASE }, { label:ref }], back:{ href:BASE, label:'← Retour au suivi' } };
    if (from === 'all') return { crumbs:[domain, { label:'Colis', href:listUrl('all') }, { label:ref }], back:{ href:listUrl('all'), label:'← Retour à Colis' } };
    return {
      crumbs:[domain, { label:'Suivi', href:BASE }, { label:LISTS[from], href:listUrl(from) }, { label:ref }],
      back:{ href:listUrl(from), label:`← Retour à ${LISTS[from]}` },
    };
  }

  const views = {
    overview:{
      tab:() => 'suivi',
      async load(p, api) {
        const [dash, first, transit, detail, operational, queue, recentCollected] = await Promise.all([
          api('/api/relay/dashboard'),
          api('/api/relay/orders?status=available&limit=5&projection=live'),
          api('/api/relay/orders?status=in_transit&limit=5&projection=live'),
          p.sel ? api(`/api/relay/orders/${encodeURIComponent(p.sel)}?projection=live`).catch(() => null) : null,
          api('/api/relay/incidents').catch(() => ({ incidents:[] })),
          api('/api/relay/orders?status=shipped,in_transit,available&limit=12&projection=live'),
          api('/api/relay/orders?status=collected&limit=3&projection=live').catch(() => ({orders:[]})),
        ]);
        return { dash, first, transit, detail, operational, queue, recentCollected, fetched_at:dash?.generated_at || new Date().toISOString() };
      },
      render:renderOverview,
      nav:() => ({ crumbs:[], back:null }),
    },
    orders:{
      tab:p => (listOf(p) === 'all' ? 'colis' : 'suivi'),
      load:(p, api) => api(`/api/relay/orders${queryString({ status:listOf(p) === 'all' ? '' : listOf(p), search:String(p.search||'').slice(0,120), limit:PAGE_SIZE, offset:offsetOf(p), projection:'live' })}`),
      render:renderOrders,
      nav:navOrders,
    },
    order:{
      tab:p => (fromOf(p) === 'all' ? 'colis' : 'suivi'),
      async load(p, api) {
        try {
          return await api(`/api/relay/orders/${encodeURIComponent(p.order || '')}?projection=live`);
        } catch (_error) {
          return { unavailable:true };
        }
      },
      render:renderOrder,
      nav:navOrder,
    },
  };

  const cockpit = kit.createCockpit({ basePath:BASE, domainLabel:'Relais', tabs:relayTabs(), views, defaultView:'overview' });

  global.KomerceCanonicalRelayLive = Object.freeze({
    mount:options => { setViewer(options && options.user); return cockpit.mount(options); },
    renderHtml:cockpit.renderHtml,
    listUrl,
    orderUrl,
  });
})(typeof window !== 'undefined' ? window : globalThis);
