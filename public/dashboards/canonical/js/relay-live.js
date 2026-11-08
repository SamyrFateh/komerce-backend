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
  let relayViewer = null;
  const canReportIncident=()=>Boolean(relayViewer && ['agent_relais','admin','market_operator'].includes(relayViewer.role));
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
  const fromOf = p => p.from==='incidents'?'incidents':(LISTS[p.from]?p.from:'');
  const offsetOf = p => Math.max(0, num(p.offset));
  const listUrl = (list, offset = 0, search = '') => `${BASE}${queryString({ view:'orders', list, offset:offset > 0 ? offset : '', search:search||'', ...simParams() })}`;
  const orderUrl = (id, from) => `${BASE}${queryString({ view:'order', order:id, from, ...simParams() })}`;
  const previewUrl = id => `${BASE}${queryString({ sel:id, ...simParams() })}`;
  const paymentLabel = o => (o.cash_pending ? 'Cash à encaisser' : o.payment_status === 'paid' ? 'Payée' : 'Paiement en attente');


  const executionUrl=(market,focus='')=>{
    const code=String(market||'').trim().toUpperCase();
    return BASE+queryString({view:'execute',market:/^[A-Z]{2}$/.test(code)?code:'',focus:/^(shipments|cash|receive|collect|returns)$/.test(focus)?focus:''});
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
      <a class="kmc-relay-inspector-cta" href="${o.status==='available'?remisesUrl(o.market_code):executionUrl(o.market_code, o.status==='collected'?'collect':'shipments')}" data-relay-action="execute">${esc(o.status==='available'?'Préparer la remise au client':o.status==='collected'?'Consulter les opérations du relais':'Contrôler la réception')} · Atelier Relais ↗</a>
      <a class="kmc-relay-inspector-detail-link" href="${orderUrl(detail.order?.id || sel, '')}" data-cockpit-nav>Articles, incidents et chronologie →</a>
      <p>${order360Link(o.reference, 'Retour au Relais live')}</p>
    </aside>`;
  }

  // ── Suivi ───────────────────────────────────────────────────────────────────
  function renderOverview(p,data){
    const k=data?.dash?.kpi||{};
    return {
      hero:`<header class="kmc-relay-flow-heading" aria-label="Flux opérationnel du Relais">
        <div><span class="kmc-relay-work-eyebrow">KOMERCE · RELAIS</span><h1>Préparer les colis</h1>
          <p>Arrivages, contrôles et mise à disposition · dernière lecture ${esc(fmtDate(data?.fetched_at))}</p></div>
        <div class="kmc-relay-heading-controls"><span class="kmc-relay-live-state">LIVE</span>${relaySimToggle()}</div>
      </header>`,
      body:`${relayMainNav('flux')}
        ${relayWorkboard(p,data)}
        ${num(k.incidents_ouverts)>0?`<div class="kmc-relay-attention">
          <strong>${num(k.incidents_ouverts)} incident(s) ouvert(s)</strong>
          <a href="${BASE}?view=incidents" data-cockpit-nav>Consulter les anomalies →</a></div>`:''}
        <div class="kmc-relay-overview-tail"><a href="${esc(remisesUrl(''))}">Ouvrir le comptoir Remises →</a>
          <a href="${esc(listUrl('collected'))}" data-cockpit-nav>Historique des remises →</a></div>`,
    };
  }

  // Incidents opérationnels existants + signalements locaux du Relais. Les retours
  // produits n'ont pas encore de writer SAV certifié : aucun bouton ne promet
  // un remboursement ou une remise en stock sans cette autorité.
  function renderIncidents(p,data){
    const items=Array.isArray(data?.incidents)?data.incidents:[];
    const rows=items.slice(0,40).map(i=>`<tr data-relay-incident="${esc(i.id)}">
      <td><a href="${esc(orderUrl(i.order_id,'incidents'))}" data-cockpit-nav>${esc(i.order_reference||'Commande')}</a></td>
      <td><strong>${esc(INCIDENT[i.incident_type]||i.title||i.incident_type||'Incident')}</strong>
        <small>${esc(i.product_name||i.title||'—')}</small></td>
      <td>${esc(i.severity==='critical'?'Critique':i.severity==='high'?'Haute':'À examiner')}</td>
      <td>${esc(i.status==='in_progress'||i.status==='investigating'?'En traitement':'Ouvert')}</td>
      <td><a href="${esc(orderUrl(i.order_id,'incidents'))}" data-cockpit-nav>Ouvrir le dossier →</a></td>
    </tr>`).join('');
    return {
      hero:`<header class="kmc-relay-flow-heading"><div><span class="kmc-relay-work-eyebrow">RELAIS · EXCEPTIONS</span>
        <h1>Incidents & SAV</h1><p>Signaler, retrouver et suivre les anomalies sur une commande.</p></div></header>`,
      body:`${relayMainNav('incidents')}
        <section class="kmc-relay-case-file" aria-label="File des incidents ouverts">
          <header><strong>${items.length} signalement(s) en cours</strong>
            <a href="${esc(listUrl('all'))}" data-cockpit-nav>Rechercher une commande pour signaler un incident →</a></header>
          <div class="kmc-relay-work-scroll">${table(['Commande','Problème','Priorité','État','Dossier'],rows,
            {empty:'Aucun incident ouvert dans votre périmètre.'})}</div>
          <div class="kmc-relay-returns-action">
            <strong>Retour produit ou remarque qualité ?</strong>
            <p>Ouvrez une demande sur l'article réellement remis. Un dossier n'atteste pas la reprise physique ni le remboursement.</p>
            ${relayViewer && ['agent_relais','admin'].includes(relayViewer.role)
              ?`<a href="${esc(executionUrl('','returns'))}" data-relay-returns-link>Ouvrir les demandes de retour & SAV →</a>`
              :'<span>Demandes de retour réservées aux agents habilités du Relais.</span>'}
          </div>
        </section>`,
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
      body:`${relayMainNav(list==='collected'?'history':'flux')}<div class="kmc-relay-list-toolbar">
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
    if (list === 'all') return { crumbs:[{ label:'Relais', plain:true }, { label:'Toutes les commandes' }], back:null };
    if (list === 'collected') return { crumbs:[{ label:'Relais', plain:true }, { label:'Historique des remises' }], back:{href:BASE,label:'← Flux Relais'} };
    return {
      crumbs:[{ label:'Relais', plain:true }, { label:'Suivi', href:BASE }, { label:LISTS[list] }],
      back:{ href:BASE, label:'← Retour au flux' },
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
      body:`${relayMainNav(fromOf(p)==='incidents'?'incidents':fromOf(p)==='collected'?'history':'flux')}<div class="kmc-relay-order-toolbar"><div><strong>Dossier de commande · ${esc(o.reference||'—')}</strong><small>La remise se valide colis par colis avec justificatif.</small></div><a href="${o.status==='available'?remisesUrl(o.market_code):executionUrl(o.market_code)}">${o.status==='available'?'Ouvrir le comptoir Remises':'Ouvrir l’atelier Relais'} ↗</a></div><p class="lk-360-line">${order360Link(o.reference, 'Retour au Relais live')}</p><div class="lk-facts">
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
          ${canReportIncident()?`<details class="kmc-relay-report-disclosure"><summary>Signaler un incident sur cette commande</summary>
            <form data-relay-incident-form data-order-id="${esc(o.id)}">
              <label>Nature du problème <select name="type" required>
                <option value="">Choisir…</option>
                <option value="colis_endommage">Colis endommagé</option>
                <option value="colis_perdu">Colis perdu</option>
                <option value="stock">Écart de produit / quantité</option>
                <option value="paiement">Paiement</option>
                <option value="retard">Retard</option>
                <option value="blocage">Blocage</option>
                <option value="client_absent">Client absent</option>
                <option value="autre">Autre / retour produit à examiner</option>
              </select></label>
              <label>Description factuelle <textarea name="description" maxlength="2000" required
                placeholder="Produit, état constaté, demande client, référence du colis…"></textarea></label>
              <button type="submit">Enregistrer le signalement</button>
              <span role="status" data-relay-incident-feedback aria-live="polite"></span>
            </form>
            <p>Un signalement ne déclenche pas de remboursement, de retour en stock ou de dégel catalogue.</p>
          </details>`:''}
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
    if (!from) return { crumbs:[domain, { label:'Flux', href:BASE }, { label:ref }], back:{ href:BASE, label:'← Retour au flux' } };
    if (from==='incidents')return {crumbs:[domain,{label:'Incidents & SAV',href:BASE+'?view=incidents'},{label:ref}],
      back:{href:BASE+'?view=incidents',label:'← Retour aux incidents'}};
    if (from==='collected')return {crumbs:[domain,{label:'Historique',href:listUrl('collected')},{label:ref}],
      back:{href:listUrl('collected'),label:'← Retour à l’historique'}};
    if (from === 'all') return { crumbs:[domain, { label:'Toutes les commandes', href:listUrl('all') }, { label:ref }], back:{ href:listUrl('all'), label:'← Retour aux commandes' } };
    return {
      crumbs:[domain, { label:'Flux', href:BASE }, { label:LISTS[from], href:listUrl(from) }, { label:ref }],
      back:{ href:listUrl(from), label:`← Retour à ${LISTS[from]}` },
    };
  }

  const views = {
    overview:{
      tab:() => 'flux',
      async load(p, api) {
        const [dash, first, transit, detail, operational, queue] = await Promise.all([
          api('/api/relay/dashboard'),
          api('/api/relay/orders?status=available&limit=5&projection=live'),
          api('/api/relay/orders?status=in_transit&limit=5&projection=live'),
          p.sel ? api(`/api/relay/orders/${encodeURIComponent(p.sel)}?projection=live`).catch(() => null) : null,
          api('/api/relay/incidents').catch(() => ({ incidents:[] })),
          api('/api/relay/orders?status=shipped,in_transit,available&limit=12&projection=live'),
        ]);
        return { dash, first, transit, detail, operational, queue, fetched_at:dash?.generated_at || new Date().toISOString() };
      },
      render:renderOverview,
      nav:() => ({ crumbs:[], back:null }),
    },
    incidents:{
      tab:()=>'incidents',
      load:(_p,api)=>api('/api/relay/incidents'),
      render:renderIncidents,
      nav:()=>({crumbs:[],back:null}),
    },
    orders:{
      tab:p => listOf(p)==='collected'?'history':'flux',
      load:(p, api) => api(`/api/relay/orders${queryString({ status:listOf(p) === 'all' ? '' : listOf(p), search:String(p.search||'').slice(0,120), limit:PAGE_SIZE, offset:offsetOf(p), projection:'live' })}`),
      render:renderOrders,
      nav:navOrders,
    },
    order:{
      tab:p => fromOf(p)==='collected'?'history':'flux',
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

  const incidentListeners=new WeakSet();
  function attachIncidentReporting(options){
    const root=options?.root;
    if(!root || incidentListeners.has(root))return;
    incidentListeners.add(root);
    root.addEventListener('submit',async event=>{
      const form=event.target?.closest?.('[data-relay-incident-form]');
      if(!form || !root.contains(form))return;
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      const feedback=form.querySelector('[data-relay-incident-feedback]');
      const type=form.querySelector('select[name="type"]')?.value;
      const description=form.querySelector('textarea[name="description"]')?.value?.trim();
      const orderId=form.getAttribute('data-order-id');
      if(!type || !description || !orderId){if(feedback)feedback.textContent='Compléter le type et la description.';return;}
      if(button)button.disabled=true;
      if(feedback)feedback.textContent='Enregistrement…';
      try {
        const fetchFn=options.fetch || global.fetch.bind(global);
        const response=await fetchFn('/api/relay/orders/'+encodeURIComponent(orderId)+'/incident',{
          method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({type,description}),
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error||'Signalement refusé par les autorisations Relais.');
        form.reset();
        if(feedback)feedback.textContent='Signalement enregistré. Ouvrez Incidents & SAV pour le suivre.';
      } catch(error){
        if(feedback)feedback.textContent=error.message||'Enregistrement impossible.';
      } finally {
        if(button)button.disabled=false;
      }
    });
  }

  global.KomerceCanonicalRelayLive = Object.freeze({
    mount:options => {
      relayViewer=options?.user||null;
      setViewer(relayViewer);
      attachIncidentReporting(options);
      return cockpit.mount(options);
    },
    renderHtml:cockpit.renderHtml,
    listUrl,
    orderUrl,
  });
})(typeof window !== 'undefined' ? window : globalThis);
