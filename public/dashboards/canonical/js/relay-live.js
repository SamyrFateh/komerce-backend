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
  const { esc, num, fmtDate, fmtKmf, ageLabel, queryString, flowTrack, tiles, table } = kit;

  const BASE = '/admin/relais-live';
  const PAGE_SIZE = 25;
  const LISTS = Object.freeze({
    in_transit:'Colis en transit',
    available:'Disponibles au retrait',
    collected:'Colis retirés',
    all:'Tous les colis',
  });
  const LIST_COPY = Object.freeze({
    in_transit:'Colis partis du Hub, en route vers leur relais.',
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
  });

  const listOf = p => (LISTS[p.list] ? p.list : 'available');
  const fromOf = p => (LISTS[p.from] ? p.from : '');
  const offsetOf = p => Math.max(0, num(p.offset));
  const listUrl = (list, offset = 0) => `${BASE}${queryString({ view:'orders', list, offset:offset > 0 ? offset : '' })}`;
  const orderUrl = (id, from) => `${BASE}${queryString({ view:'order', order:id, from })}`;
  const paymentLabel = o => (o.cash_pending ? 'Cash à encaisser' : o.payment_status === 'paid' ? 'Payée' : 'Paiement en attente');

  function relayTabs() {
    return [
      { key:'suivi', label:'Suivi', href:BASE },
      { key:'colis', label:'Colis', href:listUrl('all') },
    ];
  }

  function orderRow(order, from) {
    const waiting = order.status === 'available' ? ageLabel(order.heures_attente) : ageLabel(num(order.age_jours) * 24);
    const late = order.urgence === 'haute' || order.urgence === 'critique';
    return `<tr>
      <td><a href="${orderUrl(order.id, from)}" data-cockpit-nav>${esc(order.reference)}</a></td>
      <td>${esc(order.client_nom || order.user_name || '—')}</td>
      <td>${esc(order.relais_nom || '—')}${order.ile ? ` <small>${esc(order.ile)}</small>` : ''}</td>
      <td>${esc(STATUS[order.status] || order.status)}</td>
      <td>${esc(waiting)}${late ? ' <b class="lk-late">en retard</b>' : ''}</td>
      <td>${num(order.nb_items)}</td>
      <td>${esc(paymentLabel(order))}</td>
      <td>${num(order.incidents_ouverts) > 0 ? `<b class="lk-late">${num(order.incidents_ouverts)}</b>` : '—'}</td>
    </tr>`;
  }
  const ORDER_COLUMNS = ['Commande', 'Client', 'Relais', 'Statut', 'Attente', 'Articles', 'Paiement', 'Incidents'];

  // ── Suivi ───────────────────────────────────────────────────────────────────
  function renderOverview(p, data) {
    const k = data?.dash?.kpi || {};
    const late = num(k.en_attente_72h);
    const incidents = num(k.incidents_ouverts);
    const steps = [
      { label:'En transit', n:num(k.en_transit), count:`${num(k.en_transit)} colis`, href:listUrl('in_transit') },
      { label:'Disponibles au retrait', n:num(k.disponibles), count:`${num(k.disponibles)} colis`, href:listUrl('available') },
      { label:'Retirés aujourd’hui', n:num(k.collectes_aujourd_hui), count:`${num(k.collectes_aujourd_hui)} colis`, href:null },
    ];
    const firstWork = steps.findIndex(step => step.n > 0);
    steps.forEach((step, index) => {
      step.state = index === 1 && late > 0 ? 'attention' : index === firstWork ? 'running' : step.n > 0 ? 'done' : 'pending';
    });
    const title = late > 0
      ? `${late} colis en attente de retrait depuis plus de 72 h`
      : num(k.disponibles) > 0 ? 'Des colis attendent leur retrait' : 'Aucun colis à traiter';
    const signals = [
      `<span><strong>${late}</strong> en attente +72 h</span>`,
      `<span><strong>${num(k.collectes_7j)}</strong> retiré${num(k.collectes_7j) > 1 ? 's' : ''} sur 7 jours</span>`,
      `<span><strong>${num(k.total_actives)}</strong> colis actifs</span>`,
    ].join('');
    const first = Array.isArray(data?.first?.orders) ? data.first.orders : [];
    return {
      hero:`<header class="kir-hero kir-live-hero">
        <div>
          <div class="kir-live-titleline"><span class="kir-eyebrow">OPÉRATIONS · RELAIS</span></div>
          <div class="kir-live-titlerow"><h1>Suivi des Relais — Hub → Client</h1><span class="kir-live-badge is-live">LIVE</span></div>
          <p>Lecture en direct · mis à jour ${esc(fmtDate(data?.fetched_at))}</p>
        </div>
      </header>`,
      body:`<section class="kir-run-flow is-live" aria-label="Flux des relais">
          <div class="kir-run-flow-head"><div><span class="kir-section-kicker">FLUX DES RELAIS</span><strong>${esc(title)}</strong><small>Transit → disponible au retrait → retiré. Les chiffres ouvrent la liste exacte.</small></div></div>
          ${flowTrack(steps.map(step => ({ ...step })))}
        </section>
        ${tiles('RÉSULTAT DES RELAIS', [
          { label:'En transit', value:num(k.en_transit), sub:'en route vers les relais', href:listUrl('in_transit'), cls:'is-received' },
          { label:'Disponibles', value:num(k.disponibles), sub:late > 0 ? `dont ${late} depuis +72 h` : 'à retirer', href:listUrl('available'), cls:late > 0 ? 'is-delivered is-attention' : 'is-delivered' },
          { label:'Cash à encaisser', value:num(k.cash_a_encaisser), sub:fmtKmf(k.montant_cash_pending), cls:'is-discarded' },
          { label:'Incidents ouverts', value:incidents, sub:incidents > 0 ? 'à traiter' : 'rien à faire', cls:incidents > 0 ? 'is-review is-attention' : 'is-review' },
        ])}
        <p class="kir-run-proof lk-signals">${signals}</p>
        <section class="lk-block" aria-label="À retirer en premier">
          <div class="lk-block-head"><span class="kir-section-kicker">À RETIRER EN PREMIER</span><a href="${listUrl('available')}" data-cockpit-nav class="kir-subtle-link">Voir tous les colis disponibles →</a></div>
          ${table(ORDER_COLUMNS, first.map(order => orderRow(order, 'available')), { empty:'Aucun colis disponible au retrait.' })}
        </section>`,
    };
  }

  // ── Liste ───────────────────────────────────────────────────────────────────
  function renderOrders(p, data) {
    const list = listOf(p);
    const rows = Array.isArray(data?.orders) ? data.orders : [];
    const offset = offsetOf(p);
    const pager = (offset > 0 || rows.length >= PAGE_SIZE) ? `<nav class="kir-passage-pagination" aria-label="Pagination">
        ${offset > 0 ? `<a href="${listUrl(list, Math.max(0, offset - PAGE_SIZE))}" data-cockpit-nav>← Plus récents</a>` : '<span></span>'}
        <span>${offset + 1}–${offset + rows.length}</span>
        ${rows.length >= PAGE_SIZE ? `<a href="${listUrl(list, offset + PAGE_SIZE)}" data-cockpit-nav>Plus anciens →</a>` : '<span></span>'}
      </nav>` : '';
    return {
      title:LISTS[list],
      copy:LIST_COPY[list],
      body:`${table(ORDER_COLUMNS, rows.map(order => orderRow(order, list)), { empty:'Aucun colis dans cette liste.' })}${pager}`,
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
      body:`<div class="lk-facts">
          ${card(o.status === 'available' ? 'Attente au relais' : 'Âge', wait)}
          ${card('Relais', [relais.nom, relais.ile].filter(Boolean).join(' · ') || '—')}
          ${card('Articles', items.length)}
          ${card('Paiement', `${pay.cash_pending ? 'Cash à encaisser' : pay.is_paid ? 'Payée' : 'En attente'} · ${fmtKmf(pay.total_kmf)}`)}
        </div>
        <section class="lk-block"><span class="kir-section-kicker">ARTICLES</span>
          ${table(['Produit', 'Quantité', 'Prix'], items.map(item => `<tr><td>${esc(item.produit || '—')}</td><td>${num(item.quantity)}</td><td>${esc(fmtKmf(item.prix_kmf))}</td></tr>`), { empty:'Aucun article.' })}
        </section>
        <section class="lk-block"><span class="kir-section-kicker">INCIDENTS</span>
          ${table(['Type', 'Priorité', 'Statut', 'Signalé le'], incidents.map(i => `<tr><td>${esc(INCIDENT[i.type] || i.type)}</td><td>${esc(i.priority)}</td><td>${esc(i.status)}</td><td>${esc(fmtDate(i.created_at))}</td></tr>`), { empty:'Aucun incident.' })}
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
        const [dash, first] = await Promise.all([api('/api/relay/dashboard'), api('/api/relay/orders?status=available&limit=5&projection=live')]);
        return { dash, first, fetched_at:dash?.generated_at || new Date().toISOString() };
      },
      render:renderOverview,
      nav:() => ({ crumbs:[], back:null }),
    },
    orders:{
      tab:p => (listOf(p) === 'all' ? 'colis' : 'suivi'),
      load:(p, api) => api(`/api/relay/orders${queryString({ status:listOf(p) === 'all' ? '' : listOf(p), limit:PAGE_SIZE, offset:offsetOf(p), projection:'live' })}`),
      render:renderOrders,
      nav:navOrders,
    },
    order:{
      tab:p => (fromOf(p) === 'all' ? 'colis' : 'suivi'),
      load:(p, api) => api(`/api/relay/orders/${encodeURIComponent(p.order || '')}?projection=live`),
      render:renderOrder,
      nav:navOrder,
    },
  };

  const cockpit = kit.createCockpit({ basePath:BASE, domainLabel:'Relais', tabs:relayTabs(), views, defaultView:'overview' });

  global.KomerceCanonicalRelayLive = Object.freeze({
    mount:options => cockpit.mount(options),
    renderHtml:cockpit.renderHtml,
    listUrl,
    orderUrl,
  });
})(typeof window !== 'undefined' ? window : globalThis);
