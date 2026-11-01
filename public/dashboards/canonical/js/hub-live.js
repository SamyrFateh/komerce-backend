/**
 * @komerce-arch
 * @role          canonical-hub-live-cockpit
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        /api/hub-dash/dashboard, /api/hub-dash/queue, /api/hub-dash/orders/:id
 * @outputs       hub_live_cockpit_read_only
 * @depends       public/dashboards/canonical/js/live-kit.js
 * @used-by       public/dashboards/canonical/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      exclusive_views, single_parent_navigation, read_only_live_cockpit, dashboard_never_recomputes_business_truth
 * @impact-areas  admin-dashboard, hub
 * @version       2026-10-hub-live-v1
 */
'use strict';

// Cockpit Live du Hub : lecture seule sur les API hub-dash existantes (scopées rôle + marché).
// Suivi (flux + chiffres cliquables) / Commandes (file complète). Une vue = une question.
(function initHubLive(global) {
  const kit = global.KomerceLiveKit;
  if (!kit) throw new Error('live_kit_missing');
  const { order360Link, esc, num, fmtDate, fmtKmf, ageLabel, queryString, processBoard, tiles, table, pager } = kit;

  const BASE = '/admin/hub-live';
  const PAGE_SIZE = 25;
  const QUEUE_TABS = Object.freeze({
    to_prepare:'Commandes à préparer',
    preparation:'En préparation',
    ready:'Expédiées',
    blocked:'Commandes bloquées',
    all:'Toutes les commandes',
  });
  const QUEUE_COPY = Object.freeze({
    to_prepare:'Commandes confirmées en attente de préparation, les plus anciennes d’abord.',
    preparation:'Commandes en cours de préparation au Hub.',
    ready:'Commandes expédiées depuis le Hub.',
    blocked:'Commandes encore au Hub avec au moins un incident ouvert.',
    all:'Toutes les commandes actives du Hub, de la confirmation à l’expédition.',
  });
  const STATUS = Object.freeze({
    confirmed:'Confirmée', ordered:'Commandée', preparation:'En préparation', shipped:'Expédiée', in_transit:'En transit',
  });
  const STOCK = Object.freeze({ ok:'En stock', partial:'Stock partiel', out_of_stock:'Rupture', unknown:'Stock inconnu' });
  const INCIDENT = Object.freeze({
    retard:'Retard', blocage:'Blocage', paiement:'Paiement', stock:'Stock', colis_endommage:'Colis endommagé',
    colis_perdu:'Colis perdu', client_absent:'Client absent', autre:'Autre',
  });
  const COMPLETENESS = Object.freeze({ complete:'Complète', partial:'Partielle', unassigned:'Non affectée', empty:'Vide' });

  const queueUrl = (tab, page = 1) => `${BASE}${queryString({ view:'queue', tab, page:page > 1 ? page : '' })}`;
  const orderUrl = (id, from) => `${BASE}${queryString({ view:'order', order:id, from })}`;
  const tabOf = p => (QUEUE_TABS[p.tab] ? p.tab : 'to_prepare');
  const fromOf = p => (QUEUE_TABS[p.from] ? p.from : '');
  const paymentLabel = o => (o.payment_mode === 'cash_relais'
    ? (o.payment_status === 'paid' ? 'Cash encaissé' : 'Cash à encaisser')
    : (o.payment_status === 'paid' ? 'Payée' : 'Paiement en attente'));

  // L9a : la liste des commandes n'est plus un onglet Hub live ; elle vit dans Commandes.
  const ORDERS_URL = '/admin/orders';
  // L9b : une commande livrée n'a plus rien à exécuter au Hub ; sa fiche vit dans Order 360 (retour vers Hub live).
  let viewerUser = null;
  function deliveredOrder360Url(order) {
    if (!order || order.status !== 'collected' || !order.reference) return null;
    const nav = global.KomerceCanonicalNavigation;
    const path = `/admin/orders/${encodeURIComponent(order.reference)}`;
    if (!nav || typeof nav.canOpenEntity360 !== 'function' || !nav.canOpenEntity360(viewerUser)) return null;
    return nav.withEntityReturnTo(path, '/admin/hub-live', 'Retour au Hub live');
  }

  function legacyOrdersRedirect(search) {
    const q = new URLSearchParams(String(search || ''));
    return q.get('view') === 'queue' && q.get('tab') === 'all' ? ORDERS_URL : null;
  }

  const fluxUrl = () => BASE;
  const suiviUrl = () => `${BASE}${queryString({ view:'overview' })}`;

  function hubTabs() {
    return [
      { key:'flux', label:'Flux Hub', href:fluxUrl() },
      { key:'suivi', label:'Suivi', href:suiviUrl() },
    ];
  }

  function orderRow(order, from) {
    return `<tr>
      <td><a href="${orderUrl(order.id, from)}" data-cockpit-nav>${esc(order.reference)}</a>${order360Link(order.reference, 'Retour au Hub live')}</td>
      <td>${esc(order.client_name || '—')}</td>
      <td>${esc(order.relais_name || order.destination_island || '—')}</td>
      <td>${esc(STATUS[order.status] || order.status)}</td>
      <td>${esc(ageLabel(order.age_hours))}${order.is_urgent ? ' <b class="lk-late">en retard</b>' : ''}</td>
      <td>${num(order.items_assigned)}/${num(order.items_count)} <small>${esc(COMPLETENESS[order.completeness] || '')}</small></td>
      <td>${num(order.parcels_count)}</td>
      <td>${esc(paymentLabel(order))}</td>
      <td>${num(order.open_incidents) > 0 ? `<b class="lk-late">${num(order.open_incidents)}</b>` : '—'}</td>
    </tr>`;
  }

  const ORDER_COLUMNS = ['Commande', 'Client', 'Relais', 'Statut', 'Âge', 'Articles affectés', 'Colis', 'Paiement', 'Incidents'];

  // ── Suivi : flux + chiffres cliquables + à traiter en premier ───────────────
  function renderOverview(p, data) {
    const dash = data?.dash || {};
    const o = dash.orders || {};
    const parcels = dash.parcels || {};
    const incidents = dash.incidents || {};
    const blockedTotal = num(data?.blocked?.pagination?.total);
    const urgent = num(o.urgent);
    const asCards = (list, tab) => (Array.isArray(list?.data) ? list.data : []).map(order => ({
      label:order.reference,
      sub:order.client_name || order.relais_name || '',
      href:orderUrl(order.id, tab),
      tone:num(order.open_incidents) > 0 ? 'blocked' : order.is_urgent ? 'attention' : 'ok',
    }));
    const more = (n, shown, tab) => (n > shown ? { href:queueUrl(tab), label:`Voir les ${n} commandes →` } : null);
    const stages = [
      { label:'À préparer', icon:'▤', hue:'blue', count:num(o.to_prepare), tone:urgent > 0 ? 'attention' : 'ok', href:queueUrl('to_prepare'),
        cards:asCards(data?.first, 'to_prepare'), more:more(num(o.to_prepare), asCards(data?.first).length, 'to_prepare'), countLabel:'Aucune commande à préparer' },
      { label:'En préparation', icon:'▣', hue:'violet', count:num(o.in_preparation), href:queueUrl('preparation'),
        cards:asCards(data?.inPrep, 'preparation'), more:more(num(o.in_preparation), asCards(data?.inPrep).length, 'preparation'), countLabel:'Aucune commande en préparation' },
      { label:'Expédiées', icon:'➤', hue:'teal', count:num(o.shipped_total), href:queueUrl('ready'),
        cards:asCards(data?.shipped, 'ready'), more:more(num(o.shipped_total), asCards(data?.shipped).length, 'ready'), countLabel:'Aucune expédition' },
      { label:'Disponibles au relais', icon:'⌂', hue:'green', count:num(parcels.at_relay),
        cards:[], countLabel:`${num(parcels.at_relay)} colis au relais` },
    ];
    const title = urgent > 0
      ? `${urgent} commande${urgent > 1 ? 's' : ''} en attente depuis plus de 48 h`
      : num(o.to_prepare) + num(o.in_preparation) > 0 ? 'Le Hub prépare les commandes' : 'Aucune commande à traiter';
    const helper = 'Commandes → préparation → expédition → relais. Les chiffres ouvrent la liste exacte.';
    const signals = [
      `<span><strong>${urgent}</strong> urgente${urgent > 1 ? 's' : ''} (+48 h)</span>`,
      `<span><strong>${num(o.cash_pending)}</strong> cash à sécuriser</span>`,
      `<span><strong>${num(incidents.open)}</strong> incident${num(incidents.open) > 1 ? 's' : ''} ouvert${num(incidents.open) > 1 ? 's' : ''}${num(incidents.critical) ? ` · ${num(incidents.critical)} critique${num(incidents.critical) > 1 ? 's' : ''}` : ''}</span>`,
    ].join('');
    const first = Array.isArray(data?.first?.data) ? data.first.data : [];
    const attention = blockedTotal > 0;
    return {
      hero: `<header class="kir-hero kir-live-hero">
        <div>
          <div class="kir-live-titleline"><span class="kir-eyebrow">OPÉRATIONS · HUB</span></div>
          <div class="kir-live-titlerow"><h1>Suivi du Hub — Commandes → Relais</h1><span class="kir-live-badge is-live">LIVE</span></div>
          <p>Lecture en direct · mis à jour ${esc(fmtDate(data?.fetched_at))}</p>
        </div>
      </header>`,
      body: `<section class="kir-run-flow is-live" aria-label="Flux du Hub">
          <div class="kir-run-flow-head"><div><span class="kir-section-kicker">FLUX DU HUB</span><strong>${esc(title)}</strong><small>${esc(helper)}</small></div></div>
          ${processBoard(stages)}
        </section>
        ${tiles('RÉSULTAT DU HUB', [
          { label:'À préparer', value:num(o.to_prepare), sub:urgent > 0 ? `dont ${urgent} urgente${urgent > 1 ? 's' : ''}` : 'commandes', href:queueUrl('to_prepare'), cls:'is-received' },
          { label:'En préparation', value:num(o.in_preparation), sub:'commandes', href:queueUrl('preparation'), cls:'is-delivered' },
          { label:'Expédiées', value:num(o.shipped_total), sub:`dont ${num(o.shipped_today)} aujourd’hui`, href:queueUrl('ready'), cls:'is-discarded' },
          { label:'Commandes bloquées', value:blockedTotal, sub:attention ? 'Intervenir →' : 'rien à faire', href:queueUrl('blocked'), cls:attention ? 'is-review is-attention' : 'is-review' },
        ])}
        <p class="kir-run-proof lk-signals">${signals}</p>
        <section class="lk-block" aria-label="À traiter en premier">
          <div class="lk-block-head"><span class="kir-section-kicker">À TRAITER EN PREMIER</span><a href="${queueUrl('to_prepare')}" data-cockpit-nav class="kir-subtle-link">Voir toutes les commandes à préparer →</a></div>
          ${table(ORDER_COLUMNS, first.map(order => orderRow(order, 'to_prepare')), { empty:'Aucune commande en attente de préparation.' })}
        </section>`,
    };
  }

  // ── Population : une file, jamais de grille technique ──────────────────────
  function renderQueue(p, data) {
    const tab = tabOf(p);
    const rows = Array.isArray(data?.data) ? data.data : [];
    const pagination = data?.pagination || { page:1, pages:1, total:rows.length };
    return {
      title:QUEUE_TABS[tab],
      copy:`${QUEUE_COPY[tab]} ${num(pagination.total)} au total.`,
      body:`${table(ORDER_COLUMNS, rows.map(order => orderRow(order, tab)), { empty:'Aucune commande dans cette file.' })}
        ${pager(num(pagination.page) || 1, num(pagination.pages) || 1, page => queueUrl(tab, page))}`,
    };
  }

  function navQueue(p) {
    const tab = tabOf(p);
    if (tab === 'all') return { crumbs:[{ label:'Hub', plain:true }, { label:'Commandes' }], back:null };
    return {
      crumbs:[{ label:'Hub', plain:true }, { label:'Suivi', href:suiviUrl() }, { label:QUEUE_TABS[tab] }],
      back:{ href:suiviUrl(), label:'← Retour au suivi' },
    };
  }

  // ── Objet : une commande, en lecture ───────────────────────────────────────
  function renderOrder(p, data) {
    const o = data || {};
    const meta = o.meta || {};
    const items = Array.isArray(o.items) ? o.items : [];
    const parcels = Array.isArray(o.parcels) ? o.parcels : [];
    const timeline = Array.isArray(o.timeline) ? o.timeline : [];
    const incidents = Array.isArray(o.incidents) ? o.incidents : [];
    const card = (label, value) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    return {
      title:o.reference || 'Commande',
      copy:`${STATUS[o.status] || o.status || ''} · ${o.client_name || 'client'} · ${o.relais_name || o.destination_island || 'relais non défini'}`,
      body:`<p class="lk-360-line">${order360Link(o.reference, 'Retour au Hub live')}</p><div class="lk-facts">
          ${card('Âge', ageLabel(meta.age_hours))}
          ${card('Articles affectés', `${num(meta.items_assigned)}/${num(meta.items_count)}`)}
          ${card('Colis', num(meta.parcels_count))}
          ${card('Paiement', `${paymentLabel(o)} · ${fmtKmf(o.total_kmf)}`)}
        </div>
        <section class="lk-block"><span class="kir-section-kicker">ARTICLES</span>
          ${table(['Produit', 'Quantité', 'Stock'], items.map(item => `<tr><td>${esc(item.product_name || '—')}</td><td>${num(item.quantity)}</td><td>${esc(STOCK[item.stock_status] || '—')}</td></tr>`), { empty:'Aucun article.' })}
        </section>
        <section class="lk-block"><span class="kir-section-kicker">COLIS</span>
          ${table(['Référence', 'Statut', 'Articles', 'Expédié le'], parcels.map(parcel => `<tr><td>${esc(parcel.reference)}</td><td>${esc(parcel.status)}</td><td>${Array.isArray(parcel.items) ? parcel.items.length : 0}</td><td>${esc(fmtDate(parcel.shipped_at))}</td></tr>`), { empty:'Aucun colis créé.' })}
        </section>
        <section class="lk-block"><span class="kir-section-kicker">INCIDENTS</span>
          ${table(['Type', 'Priorité', 'Statut', 'Signalé le'], incidents.map(i => `<tr><td>${esc(INCIDENT[i.type] || i.type)}</td><td>${esc(i.priority)}</td><td>${esc(i.status)}</td><td>${esc(fmtDate(i.created_at))}</td></tr>`), { empty:'Aucun incident.' })}
        </section>
        <section class="lk-block"><span class="kir-section-kicker">CHRONOLOGIE</span>
          ${table(['Étape', 'Par', 'Date'], timeline.map(t => `<tr><td>${esc(t.step)}</td><td>${esc(t.scanned_by_name || '—')}</td><td>${esc(fmtDate(t.created_at))}</td></tr>`), { empty:'Aucun scan enregistré.' })}
        </section>`,
    };
  }

  function navOrder(p, data) {
    const from = fromOf(p);
    const ref = data?.reference || 'Commande';
    if (!from) return { crumbs:[{ label:'Hub', plain:true }, { label:'Suivi', href:suiviUrl() }, { label:ref }], back:{ href:suiviUrl(), label:'← Retour au suivi' } };
    if (from === 'all') {
      return { crumbs:[{ label:'Hub', plain:true }, { label:'Commandes', href:ORDERS_URL }, { label:ref }], back:{ href:ORDERS_URL, label:'← Retour à Commandes' } };
    }
    return {
      crumbs:[{ label:'Hub', plain:true }, { label:'Suivi', href:suiviUrl() }, { label:QUEUE_TABS[from], href:queueUrl(from) }, { label:ref }],
      back:{ href:queueUrl(from), label:`← Retour à ${QUEUE_TABS[from]}` },
    };
  }


  // ── Flux Hub : réceptions fournisseur, unités par marché, groupages (lecture seule, /api/hub-dash/dubai) ──
  const NA = 'Non disponible';
  const dash = v => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? num(v) : NA);

  function renderFlux(p, data) {
    const d = data || {};
    const rec = d.receptions || {};
    const units = d.units || {};
    const gaps = Array.isArray(d.gaps) ? d.gaps : [];
        const recOk = rec.available === true;
    const markets = Array.isArray(units.by_market) ? units.by_market : [];
    const pos = Array.isArray(rec.purchase_orders) ? rec.purchase_orders : [];
    const trace = d.trace || {};
    const traceRows = Array.isArray(trace.rows) ? trace.rows : [];
    const traceState = { RECEIVED:'Reçu', IDENTIFIED:'Identifié', QUALITY_CHECKED:'Contrôlé',
      LOCATED:'Localisé', ALLOCATED:'Affecté', PICKED:'Préparé',
      PACKED:'Fermé', DISPATCHED:'Expédié', QUARANTINED:'Quarantaine' };
    const traceTable = trace.available === true
      ? table(['Marché', 'PO', 'Carton / contenant', 'Quantité', 'État'], traceRows.map(r => {
        const isBox = r.unit_type === 'MARKET_PARCEL';
        const po = String(r.purchase_order_id || '');
        return `<tr><td>${esc(r.market_code || '—')}</td><td title="${esc(po)}">${esc(po.slice(0,8))}</td>
          <td>${isBox ? esc(r.physical_reference) : `À emballer · ${esc(r.physical_reference)}`}</td>
          <td>${num(r.quantity)}</td><td>${esc(traceState[r.state] || r.state || '—')}</td></tr>`;
      }), { empty:'Aucun placement physique lié à une PO.' })
      : `<p>Rapprochement physique non disponible.</p>`;
    return {
      hero: `<header class="kir-hero kir-live-hero">
        <div>
          <div class="kir-live-titleline"><span class="kir-eyebrow">OPÉRATIONS · HUB DUBAÏ</span></div>
          <div class="kir-live-titlerow"><h1>Flux du Hub — Réceptions, groupages, expéditions</h1><span class="kir-live-badge is-live">LIVE</span></div>
          <p>Lecture en direct · mis à jour ${esc(fmtDate(d.generated_at))}</p>
        </div>
      </header>`,
      body: `${tiles('FLUX MUTUALISÉ DU HUB', [
          { label:'Réceptions attendues', value:recOk ? dash(rec.expected_purchase_orders) : NA, sub:recOk ? `dont ${num(rec.partial_purchase_orders)} partielle(s)` : 'source non disponible' },
          { label:'Unités reçues aujourd’hui', value:dash(units.received_today), sub:'unités physiques' },
          { label:'Unités contrôlées', value:dash(units.controlled), sub:'contrôle qualité fait' },
          { label:'Groupages en cours', value:recOk ? dash(rec.grouped_purchase_orders) : NA, sub:recOk ? 'achats groupés à réceptionner' : 'source non disponible' },
        ])}
        ${tiles('SORTIES', [
          { label:'Unités expédiées', value:dash(units.dispatched), sub:'état Expédiée' },
          { label:'Unités en quarantaine', value:dash(units.quarantined), sub:'à traiter' },
          { label:'Expéditions prêtes', value:NA, sub:'source absente' },
          { label:'Groupage transport', value:NA, sub:'source absente' },
        ])}
        <section class="lk-block" aria-label="Sources non disponibles"><span class="kir-section-kicker">SOURCES NON DISPONIBLES</span>
          ${table(['Indicateur', 'Raison'], [
            ...gaps.map(g => `<tr><td>${esc(g.key === 'expeditions_ready' ? 'Expéditions prêtes' : g.key === 'groupage_en_cours' ? 'Groupage transport' : g.key)}</td><td>${esc(g.reason)}</td></tr>`),
            ...(recOk ? [] : [`<tr><td>Réceptions fournisseur</td><td>${esc(rec.reason || NA)}</td></tr>`]),
          ], { empty:'Toutes les sources sont disponibles.' })}
        </section>
        <section class="lk-block" aria-label="Unités par marché"><span class="kir-section-kicker">PAR MARCHÉ</span>
          ${table(['Marché', 'Reçues aujourd’hui', 'Contrôlées', 'Expédiées', 'Quarantaine'], markets.map(m => `<tr><td>${esc(m.market_name || m.market_code)}</td><td>${num(m.received_today)}</td><td>${num(m.controlled)}</td><td>${num(m.dispatched)}</td><td>${num(m.quarantined)}</td></tr>`), { empty:'Aucune unité physique enregistrée.' })}
        </section>
        <section class="lk-block" aria-label="Rapprochement PO cartons"><span class="kir-section-kicker">PO → CARTONS · PAR MARCHÉ</span>
          <p>Quantités physiquement retrouvées dans chaque contenant. Les unités reçues non emballées restent visibles ; aucune destination n'est ressaisie.</p>
          ${traceTable}
        </section>
        <section class="lk-block" aria-label="Réceptions fournisseur"><span class="kir-section-kicker">RÉCEPTIONS FOURNISSEUR ATTENDUES</span>
          ${recOk
            ? table(['Fournisseur', 'Référence', 'Type', 'Attendu', 'Reçu'], pos.map(po => `<tr><td>${esc(po.supplier_name || '—')}</td><td>${esc(po.supplier_order_ref || po.purchase_order_id)}</td><td>${po.shape === 'grouped' ? 'Achat groupé' : 'Commande'}</td><td>${num(po.expected_quantity)}</td><td>${num(po.received_quantity)}</td></tr>`), { empty:'Aucune réception attendue.' })
            : `<div class="kir-empty">${esc(rec.reason || NA)}</div>`}
        </section>`,
    };
  }

  const views = {
    flux:{
      tab:() => 'flux',
      load:(p, api) => api('/api/hub-dash/dubai'),
      render:renderFlux,
      nav:() => ({ crumbs:[], back:null }),
    },
    overview:{
      tab:() => 'suivi',
      async load(p, api) {
        const [dash, first, blocked, inPrep, shipped] = await Promise.all([
          api('/api/hub-dash/dashboard'),
          api('/api/hub-dash/queue?tab=to_prepare&limit=5&projection=live'),
          api('/api/hub-dash/queue?tab=blocked&limit=1&projection=live'),
          api('/api/hub-dash/queue?tab=preparation&limit=5&projection=live'),
          api('/api/hub-dash/queue?tab=ready&limit=5&projection=live'),
        ]);
        return { dash, first, blocked, inPrep, shipped, fetched_at:dash?.generated_at || new Date().toISOString() };
      },
      render:renderOverview,
      nav:() => ({ crumbs:[], back:null }),
    },
    queue:{
      tab:() => 'suivi',
      load:(p, api) => api(`/api/hub-dash/queue${queryString({ tab:tabOf(p), page:Math.max(1, num(p.page) || 1), limit:PAGE_SIZE, projection:'live' })}`),
      render:renderQueue,
      nav:navQueue,
    },
    order:{
      tab:() => 'suivi',
      load:(p, api) => api(`/api/hub-dash/orders/${encodeURIComponent(p.order || '')}?projection=live`).then(data => {
        const target = deliveredOrder360Url(data);
        if (target && global.location && typeof global.location.replace === 'function') global.location.replace(target);
        return data;
      }),
      render:renderOrder,
      nav:navOrder,
    },
  };

  const cockpit = kit.createCockpit({ basePath:BASE, domainLabel:'Hub', tabs:hubTabs(), views, defaultView:'flux' });

  global.KomerceCanonicalHubLive = Object.freeze({
    mount:options => {
      viewerUser = (options && options.user) || null;
      const target = legacyOrdersRedirect(global.location && global.location.search);
      if (target && global.location && typeof global.location.replace === 'function') {
        global.location.replace(target);
        return Promise.resolve(null);
      }
      return cockpit.mount(options);
    },
    legacyOrdersRedirect,
    deliveredOrder360Url,
    renderHtml:cockpit.renderHtml,
    queueUrl,
    orderUrl,
  });
})(typeof window !== 'undefined' ? window : globalThis);
