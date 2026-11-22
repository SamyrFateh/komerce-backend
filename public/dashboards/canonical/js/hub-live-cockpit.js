/**
 * @komerce-arch
 * @role          canonical-hub-live-cockpit-flux-du-besoin
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        hub_procurement_dossier_cockpit (units, status, physical), viewer_rights, receivable_purchase_orders
 * @outputs       hub_live_cockpit_dom, authorized_action_requests
 * @depends       operations-workspace (runAction, reception card, sourcing form)
 * @used-by       public/dashboards/canonical/js/operations-workspace.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      une_seule_source_de_verite_serveur, aucun_calcul_metier_navigateur, action_impossible_masquee_ou_desactivee_avec_raison, idempotence_ui_desactivation_pendant_requete
 * @impact-areas  admin-dashboard, hub, purchasing, logistics
 * @version       2026-11-hub-live-cockpit-c-maquette
 */
'use strict';

// Hub Live concept C — « flux du besoin » : Commandes importées → Besoins & PO → Exécution physique.
// Le navigateur ne calcule aucune vérité métier : quantités, étapes, droits et « À faire maintenant »
// viennent de GET /market/:code/supply (section cockpit). Les gestes appellent les routes existantes
// (/api/purchasing/* et /api/admin/workspaces/operations/*) ; jamais /api/hub/*.
(function initHubLiveCockpit(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceHubLiveCockpit = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createHubLiveCockpit() {
  const PO_TRACK = Object.freeze(['Brouillon', 'Validation', 'Engagée', 'Expédiée', 'Reçue']);
  const STEP_LABELS = Object.freeze({ draft: 'Brouillon', validation: 'Validation', engaged: 'Engagée', sent: 'Expédiée', received: 'Reçue' });
  const OWNER_LABELS = Object.freeze({ agent_hub: 'Agent Hub', responsable_hub: 'Responsable Hub' });
  const CHANNELS = Object.freeze([['email', 'E-mail'], ['whatsapp', 'WhatsApp'], ['phone', 'Téléphone'], ['api', 'API'], ['other', 'Autre']]);
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const num = (v) => nf.format(Number(v) || 0);
  const short = (v) => String(v || '').slice(0, 8);
  // Traduction strictement visuelle : les états API et le Golden restent inchangés.
  const PHYSICAL_STATE_LABELS = Object.freeze({
    PICKED: 'Prélevé', PACKED: 'Emballé', DISPATCHED: 'Prêt au départ',
  });
  const humanPhysicalState = (value) => String(value ?? '').replace(
    /\b(PICKED|PACKED|DISPATCHED)\b/g, key => PHYSICAL_STATE_LABELS[key]
  );

  function el(doc, tag, cls, txt) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (txt !== undefined && txt !== null) node.textContent = String(txt);
    return node;
  }

  function button(doc, label, action, cls) {
    const b = el(doc, 'button', `hlc-btn${cls ? ' ' + cls : ''}`, label);
    b.type = 'button';
    b.setAttribute('data-hlc-action', action);
    return b;
  }

  // Action impossible : désactivée AVEC la raison visible (jamais un bouton muet).
  function gated(doc, host, btn, reason) {
    if (!reason) { host.appendChild(btn); return btn; }
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.title = reason;
    const wrap = el(doc, 'span', 'hlc-gated');
    wrap.appendChild(btn);
    wrap.appendChild(el(doc, 'small', 'hlc-reason', reason));
    host.appendChild(wrap);
    return btn;
  }

  function bar(doc, parts, total, label) {
    const track = el(doc, 'div', 'hlc-bar');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', label);
    parts.forEach(([cls, value]) => {
      if (!(value > 0) || !(total > 0)) return;
      const seg = el(doc, 'span', `hlc-seg ${cls}`);
      seg.style.width = `${Math.min(100, (value / total) * 100)}%`;
      track.appendChild(seg);
    });
    return track;
  }



  const STEP_HELP = Object.freeze({ draft: 'Brouillon : PO préparée, engagement non validé', validation: 'Validation : engagement validé par la responsable Hub', engaged: 'Engagée : soumise, envoi à enregistrer', sent: 'Expédiée : envoyée au fournisseur', received: 'Reçue : livraison enregistrée au Hub' });
  const WARN_KINDS = new Set(['SOURCING_REQUIRED', 'REVIEW_ANOMALY']);
  const MAX_PIPS = 12;

  function render(host, ctx) {
    const doc = ctx.document;
    const d = ctx.dossier;
    const cockpit = d.cockpit || {};
    const viewer = cockpit.viewer || null;
    const state = ctx.state;
    const orders = [...(d.orders || [])].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const pos = (d.purchase_orders || []).filter((p) => p.status !== 'cancelled');
    // UX2 : les PO partiellement reçus restent EN COURS ; seuls les PO achevés
    // passent en historique. Le dossier complet reste dans poById et sélectionnable.
    const isHistoricalPo = po => !po.step?.partial &&
      (['received','closed','completed'].includes(po.status) ||
       (po.step?.key === 'received' && Number(po.totals?.effective) > 0 &&
        Number(po.totals?.received) >= Number(po.totals?.effective)));
    const activePos = pos.filter(po => !isHistoricalPo(po));
    const historyPos = pos.filter(isHistoricalPo);
    const batches = cockpit.need_batches || [];
    const todo = cockpit.todo || [];
    const physical = cockpit.physical || [];
    const legend = cockpit.unit_legend || [];
    const readOnly = ctx.isReadOnly;
    const marketCode = (d.market && d.market.code) || ctx.marketCode;
    if (!state.picked) state.picked = new Set();
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const poById = new Map(pos.map((p) => [p.id, p]));
    const roleLabel = !viewer ? 'lecture' : (viewer.can_authorize_commitment || viewer.can_authorize_payment) ? 'responsable Hub' : viewer.role === 'admin' ? 'admin central' : 'agent Hub';
    const poRef = (po) => po.ref || `PO ${short(po.id)}`;

    // P1 FIAB : les saisies et le focus du formulaire en cours survivent au rendu (state.form.values).
    const activeEl = doc.activeElement;
    const oldForm = host.querySelector && host.querySelector('form[data-hlc-form]');
    if (oldForm && state.form && oldForm.getAttribute('data-hlc-form') === state.form.kind) {
      const fields = [...oldForm.querySelectorAll('input,select,textarea')];
      state.form.values = {
        kind: state.form.kind,
        items: fields.map((f) => (['hidden', 'button', 'submit'].includes(f.type) ? null : { v: f.value, c: f.checked })),
        focus: fields.indexOf(activeEl),
        sel: activeEl && typeof activeEl.selectionStart === 'number' ? [activeEl.selectionStart, activeEl.selectionEnd] : null,
      };
    }
    const oldHistory = host.querySelector && host.querySelector('[data-hlc-po-history]');
    if (oldHistory) state.poHistoryOpen = oldHistory.open;
    state.epoch = (state.epoch || 0) + 1;
    host.replaceChildren();
    const rootEl = el(doc, 'div', 'hlc');
    rootEl.setAttribute('data-hub-cockpit', '');
    // Zone d'actions unique : contient le CTA du cockpit ET les actions du fil.
    // Les sélecteurs du Golden restent valides sans dupliquer un seul bouton.
    rootEl.setAttribute('data-hlc-actions', '');
    const markReady = () => {
      const r = host.querySelector && host.querySelector('[data-hub-cockpit]');
      if (r) r.setAttribute('data-hlc-ready', state.pending > 0 ? 'false' : 'true');
    };
    rootEl.setAttribute('data-render-epoch', String(state.epoch));
    rootEl.setAttribute('data-hlc-ready', state.pending > 0 ? 'false' : 'true');
    host.appendChild(rootEl);

    // ── Actions : un seul point d'exécution, désactivé pendant la requête, état incertain → recharger et vérifier.
    async function execute(btn, options) {
      state.pending = (state.pending || 0) + 1;
      markReady();
      try {
        return await ctx.act(btn, options);
      } catch (error) {
        if (!error || !error.status) {
          ctx.feedback('Réponse réseau incertaine : l’opération a peut-être été appliquée. Rechargement de l’état, vérifiez avant de recommencer.', 'critical');
          ctx.reload().catch(() => {});
        }
        return null;
      } finally {
        state.pending = Math.max(0, (state.pending || 1) - 1);
        markReady();
      }
    }
    const purchasing = (path) => `/api/purchasing/${path}`;
    function paint() { render(host, ctx); }
    // UX3 — partage d'une sélection sans perdre marché, vue ni filtres dans l'URL.
    const win = doc.defaultView;
    const isHubRoute = () => win?.location?.pathname === '/admin/hub-live';
    function readUrlSelection() {
      if (!isHubRoute()) return null;
      const value = new win.URLSearchParams(win.location.search).get('sel') || '';
      const i = value.indexOf(':');
      if (i < 1) return null;
      const type = value.slice(0, i), id = value.slice(i + 1);
      return ['po','order','need','bag','box'].includes(type) && id.length > 0 && id.length < 160 ? {type,id} : null;
    }
    function putUrlSelection(type, id) {
      if (!isHubRoute() || !win.history?.pushState) return;
      const url = new win.URL(win.location.href);
      const key = type && id ? type + ':' + id : '';
      if (url.searchParams.get('sel') === key) return;
      if (key) url.searchParams.set('sel',key);
      else url.searchParams.delete('sel');
      win.history.pushState(win.history.state,'',url.pathname+url.search+url.hash);
    }
    if (!state.urlSelectionListener && isHubRoute() && win.addEventListener) {
      state.urlSelectionListener = true;
      win.addEventListener('popstate', () => {
        state.sel = readUrlSelection();
        state.selectionInitialized = true;
        state.form = null;
        render(host,ctx);
      });
    }
    function select(type, id) {
      state.sel = { type, id };
      putUrlSelection(type,id);
      if (state.form && !((type === 'po' && state.form.po === id) || (type === 'box' && state.form.box === id))) state.form = null;
      paint();
    }
    function selectKey(key) { const i = key.indexOf(':'); select(key.slice(0, i), key.slice(i + 1)); }
    function openForm(kind, poId) { state.form = { kind, po: poId }; state.sel = { type: 'po', id: poId }; paint(); }

    // ── Gestes (routes existantes) ──
    function prepareBatch(btn, batch, lineIds, draftPoId) {
      const n = lineIds.length;
      if (draftPoId) {
        return execute(btn, {
          url: purchasing(`po/${encodeURIComponent(draftPoId)}/attach`), body: { line_ids: lineIds },
          confirmMessage: `Rattacher ${n} ligne(s) au brouillon PO ${short(draftPoId)} (${batch.supplier_name}) ?`,
          runningMessage: 'Rattachement en cours…', successMessage: `${n} ligne(s) rattachée(s) au brouillon.`,
        });
      }
      return execute(btn, {
        url: purchasing('po/prepare'), body: { supplier_id: batch.supplier_id, procurement_hub_ref: batch.procurement_hub_ref, line_ids: lineIds },
        confirmMessage: `Préparer une PO ${batch.supplier_name} (${batch.procurement_hub_ref || 'Hub'}) avec ${n} ligne(s) ? Aucun envoi ni paiement.`,
        runningMessage: 'Préparation de la PO…', successMessage: 'PO préparée en brouillon : validation d’engagement attendue.',
      });
    }

    function bagPlanFor(order) {
      return order.items.map((i) => ({ order_item_id: i.id, quantity: Math.max(0, i.received - i.in_bags - i.in_boxes) })).filter((x) => x.quantity > 0);
    }
    function createBag(btn, order, partial) {
      const plan = bagPlanFor(order);
      const missing = (order.readiness.pending_items || []).map((p) => `${p.product || 'article'} (${p.missing})`).join(', ');
      return execute(btn, {
        url: ctx.endpoint('bags'), body: { order_id: order.id, bag_plan: plan, ...(partial ? { partial_preparation: true } : {}) },
        confirmMessage: partial
          ? `PRÉPARATION PARTIELLE de ${order.reference} : ${plan.reduce((t, x) => t + x.quantity, 0)} unité(s) reçue(s) seulement. Manque encore : ${missing}. Le reliquat reste suivi et ne part pas dans ce sac. Confirmer ?`
          : `Créer le sac client de ${order.reference} (commande complète) ?`,
        runningMessage: 'Ouverture du sac client…', successMessage: partial ? `Sac partiel ouvert pour ${order.reference} ; reliquat conservé.` : `Sac ouvert pour ${order.reference}.`,
      });
    }

    function submitPo(btn, poId) {
      return execute(btn, {
        url: purchasing(`po/${encodeURIComponent(poId)}/submit`), body: {},
        confirmMessage: `Soumettre la PO ${short(poId)} ? L’engagement validé est requis ; rien n’est envoyé au fournisseur.`,
        runningMessage: 'Soumission en cours…', successMessage: 'PO soumise : enregistrer maintenant son envoi réel.',
      });
    }
    function closeBag(btn, bagId) {
      return execute(btn, {
        url: ctx.endpoint(`bags/${encodeURIComponent(bagId)}/close`), body: {},
        runningMessage: 'Contrôle du contenu avant fermeture…', successMessage: 'Sac fermé, prêt pour une KOM-BOX.',
      });
    }

    // ── Sélection par défaut et lien « À faire maintenant » → objet ──
    function todoSel(item) {
      const s = item.subject || {};
      if (s.po_id) return { type: 'po', id: s.po_id };
      if (s.batch_key) { const b = batches.find((x) => x.key === s.batch_key); return b && b.groups[0] ? { type: 'need', id: b.groups[0].key } : null; }
      if (s.order_id) {
        const o = orderById.get(s.order_id);
        return o && o.totals.uncovered > 0 && item.kind === 'SOURCING_REQUIRED' ? { type: 'order', id: o.id } : { type: 'order', id: s.order_id };
      }
      if (s.bag_unit_id) return { type: 'bag', id: s.bag_unit_id };
      if (s.box_unit_id) return { type: 'box', id: s.box_unit_id };
      return null;
    }
    if (!state.selectionInitialized) {
      const linked = readUrlSelection();
      const actionable = todo.filter(item => item.viewer_can_act !== false).map(todoSel).find(Boolean);
      state.sel = linked || actionable || null;
      state.selectionInitialized = true;
    }
    if (state.sel) {
      const known = state.sel.type === 'po' ? poById.has(state.sel.id) :
        state.sel.type === 'order' ? orderById.has(state.sel.id) :
        state.sel.type === 'need' ? (batches.some(b => b.groups.some(g => g.key === state.sel.id)) ||
          orders.some(o => o.items.some(i => `src:${o.id}:${i.id}` === state.sel.id))) :
        state.sel.type === 'bag' ? [...(d.bags_open || []),...(d.bags_ready || [])].some(b => b.unit_id === state.sel.id) :
        state.sel.type === 'box' ? (d.boxes || []).some(b => b.unit_id === state.sel.id) : false;
      // La tâche serveur est une référence métier valide même si la liste
      // compacte n'inclut pas le dossier : conserver sa sélection au clic.
      const inTodo = todo.some(item => {
        const target = todoSel(item);
        return target && target.type === state.sel.type && target.id === state.sel.id;
      });
      if (!known && !inTodo) state.sel = null;
    }
    const sel = state.sel;
    const selKey = sel ? `${sel.type}:${sel.id}` : '';
    rootEl.setAttribute('data-hlc-selection', selKey);

    // ── Liens de navigation (références du dossier serveur, aucune quantité calculée) ──
    const allBags = [
      ...(d.bags_open || []).map((b) => ({ id: b.unit_id, ref: b.reference, order_id: b.order_id, order_ref: b.order_ref, state: 'ouvert' })),
      ...(d.bags_ready || []).map((b) => ({ id: b.unit_id, ref: b.reference, order_id: b.order_id, order_ref: b.order_ref, state: 'fermé' })),
    ];
    const boxOrders = (b) => [...new Set((b.contents || []).map((c) => c.order_id).filter(Boolean))];
    const needGroups = batches.flatMap((b) => b.groups.map((g) => ({ batch: b, group: g })));
    const sourcingNeeds = orders.flatMap((o) => o.items.filter((i) => i.uncovered > 0).map((i) => ({ order: o, item: i, key: `src:${o.id}:${i.id}` })));
    function related() {
      const r = { orders: new Set(), pos: new Set(), needs: new Set(), bags: new Set(), boxes: new Set() };
      if (!sel) return r;
      if (sel.type === 'order') {
        const o = orderById.get(sel.id);
        if (o) { r.orders.add(o.id); o.po_ids.forEach((id) => r.pos.add(id)); }
        allBags.filter((b) => b.order_id === sel.id).forEach((b) => r.bags.add(b.id));
        (d.boxes || []).filter((b) => boxOrders(b).includes(sel.id)).forEach((b) => r.boxes.add(b.unit_id));
        needGroups.filter(({ group }) => group.lines.some((l) => l.order_id === sel.id)).forEach(({ group }) => r.needs.add(group.key));
        sourcingNeeds.filter((n) => n.order.id === sel.id).forEach((n) => r.needs.add(n.key));
      } else if (sel.type === 'po') {
        const po = poById.get(sel.id);
        if (po) { r.pos.add(po.id); po.order_ids.forEach((id) => r.orders.add(id)); }
      } else if (sel.type === 'need') {
        const g = needGroups.find((x) => x.group.key === sel.id);
        if (g) g.group.lines.forEach((l) => r.orders.add(l.order_id));
        const s = sourcingNeeds.find((x) => x.key === sel.id);
        if (s) r.orders.add(s.order.id);
        r.needs.add(sel.id);
      } else if (sel.type === 'bag') {
        const b = allBags.find((x) => x.id === sel.id);
        if (b) r.orders.add(b.order_id);
        r.bags.add(sel.id);
      } else if (sel.type === 'box') {
        const b = (d.boxes || []).find((x) => x.unit_id === sel.id);
        if (b) boxOrders(b).forEach((id) => r.orders.add(id));
        r.boxes.add(sel.id);
      }
      return r;
    }
    const rel = related();
    function card(cls, attrs, selected, relatedHit, onPick) {
      const n = el(doc, 'div', `hlc-card ${cls}${selected ? ' is-selected' : ''}${!selected && relatedHit ? ' is-related' : ''}`);
      n.tabIndex = 0;
      n.setAttribute('role', 'button');
      Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
      n.addEventListener('click', onPick);
      n.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target === n) { event.preventDefault(); onPick(); } });
      return n;
    }
    const pill = (text, tone) => el(doc, 'span', `hlc-pill is-${tone || 'wait'}`, text);

    // ── 1. À faire maintenant : pastilles compactes, clic = sélection de l'objet ──
    const todoBar = el(doc, 'section', 'hlc-todo');
    todoBar.setAttribute('data-hlc-todo', '');
    todoBar.setAttribute('aria-label', 'À faire maintenant');
    todoBar.appendChild(el(doc, 'strong', 'hlc-todo-title', 'À faire maintenant'));
    if (!todo.length) todoBar.appendChild(el(doc, 'span', 'hlc-empty', 'Rien à traiter : toutes les commandes import suivent leur cours.'));
    const PILLS = 4;
    (state.todoAll ? todo : todo.slice(0, PILLS)).forEach((item) => {
      const target = todoSel(item);
      const tone = item.viewer_can_act === false ? 'wait' : item.severity === 'anomaly' ? 'bad' : WARN_KINDS.has(item.kind) ? 'warn' : 'act';
      const b = el(doc, 'button', `hlc-todo-pill is-${tone}${target && `${target.type}:${target.id}` === selKey ? ' is-on' : ''}`);
      b.type = 'button';
      b.setAttribute('data-hlc-todo-item', item.kind);
      b.setAttribute('data-owner', item.owner);
      b.title = `${item.missing} — ${item.why}${item.blocked_reason ? ` (${item.blocked_reason})` : ''}`;
      b.appendChild(el(doc, 'span', `hlc-dot is-${tone}`));
      b.appendChild(el(doc, 'span', 'hlc-todo-text', item.missing));
      if (item.age_hours != null) {
        // Ancienneté dérivée côté serveur (H4) ; alerte au-delà du seuil fixé par le serveur (48 h).
        const age = item.age_hours >= 48 ? `${Math.floor(item.age_hours / 24)} j` : `${item.age_hours} h`;
        const badge = el(doc, 'span', `hlc-todo-age${item.overdue ? ' is-overdue' : ''}`, item.overdue ? `⚠ ${age}` : age);
        badge.setAttribute('data-hlc-age', String(item.age_hours));
        b.appendChild(badge);
      }
      b.addEventListener('click', () => { if (target) select(target.type, target.id); });
      todoBar.appendChild(b);
    });
    if (todo.length > PILLS) {
      const more = button(doc, state.todoAll ? 'Réduire' : `+${todo.length - PILLS} autres`, 'todo-toggle', 'is-link');
      more.addEventListener('click', () => { state.todoAll = !state.todoAll; paint(); });
      todoBar.appendChild(more);
    }
    todoBar.appendChild(el(doc, 'span', 'hlc-spacer'));
    const lead = todo.find((t) => { const s = todoSel(t); return s && `${s.type}:${s.id}` === selKey; }) || todo[0];
    todoBar.appendChild(el(doc, 'span', 'hlc-narrative', lead ? lead.why : ''));
    rootEl.appendChild(todoBar);

    const cols = el(doc, 'div', 'hlc-cols');
    rootEl.appendChild(cols);

    function column(key, cls, title, sub) {
      const sec = el(doc, 'section', `hlc-col ${cls}`);
      sec.setAttribute('data-hlc-zone', key);
      sec.setAttribute('aria-label', title);
      const head = el(doc, 'div', 'hlc-col-head');
      head.appendChild(el(doc, 'h2', '', title));
      head.appendChild(el(doc, 'span', 'hlc-col-sub', sub));
      sec.appendChild(head);
      cols.appendChild(sec);
      return sec;
    }

    // ── Colonne 1 : commandes importées, pavés par unité ──
    const left = column('orders', 'hlc-col-orders', '1 · Commandes importées', `${orders.length} commande(s)`);
    if (!orders.length) left.appendChild(el(doc, 'p', 'hlc-empty', 'Aucune commande import à suivre sur ce marché.'));
    orders.forEach((order, index) => {
      const c = card('hlc-order', { 'data-hlc-order': order.id }, selKey === `order:${order.id}`, rel.orders.has(order.id), () => select('order', order.id));
      const head = el(doc, 'div', 'hlc-row');
      head.appendChild(el(doc, 'span', 'hlc-ref', order.reference));
      const relayMeta = el(doc, 'span', 'hlc-meta', `${marketCode} · ${order.relay_name || 'relais —'}`);
      if (order.relay_id) relayMeta.title = `Relais · identifiant technique : ${order.relay_id}`;
      head.appendChild(relayMeta);
      head.appendChild(el(doc, 'small', 'hlc-fifo', `Ordre d’arrivée n° ${index + 1}`));
      head.appendChild(el(doc, 'span', 'hlc-spacer'));
      const st = pill(order.status.label, order.status.tone);
      st.setAttribute('data-hlc-order-state', '');
      head.appendChild(st);
      c.appendChild(head);
      order.items.forEach((item) => {
        const row = el(doc, 'div', 'hlc-row hlc-line');
        row.setAttribute('data-hlc-item', item.id);
        row.appendChild(el(doc, 'span', 'hlc-line-label', `${item.product || 'Article'} ×${num(item.requested)}`));
        const pips = el(doc, 'span', 'hlc-pips');
        pips.setAttribute('role', 'img');
        pips.setAttribute('aria-label', `reçu ${num(item.received)} sur ${num(item.requested)} · ${legend.filter((g) => item.unit_counts[g.state]).map((g) => `${item.unit_counts[g.state]} ${g.label}`).join(', ')}`);
        if (item.units.length <= MAX_PIPS) {
          item.units.forEach((u) => { const p = el(doc, 'span', `hlc-pip is-${u.state}`); p.title = u.label; pips.appendChild(p); });
        } else {
          pips.classList.add('is-bar');
          legend.filter((g) => item.unit_counts[g.state]).forEach((g) => {
            const seg = el(doc, 'span', `hlc-seg is-${g.state}`);
            seg.style.flexGrow = String(item.unit_counts[g.state]);
            seg.title = `${item.unit_counts[g.state]} · ${g.label}`;
            pips.appendChild(seg);
          });
          pips.appendChild(el(doc, 'small', 'hlc-bar-count', `${num(item.units.length)} u`));
        }
        row.appendChild(pips);
        row.appendChild(el(doc, 'span', 'hlc-where', `${item.where}${item.anomaly ? ` · écart ${num(item.anomaly)}` : ''}`));
        c.appendChild(row);
      });
      left.appendChild(c);
    });
    const leg = el(doc, 'div', 'hlc-legend');
    leg.setAttribute('aria-label', 'Signification des états · légende non interactive');
    leg.appendChild(el(doc, 'strong', 'hlc-legend-title', 'Signification des états'));
    legend.forEach((g) => { const i = el(doc, 'span', 'hlc-legend-item'); i.appendChild(el(doc, 'span', `hlc-pip is-${g.state}`)); i.appendChild(doc.createTextNode(g.label)); leg.appendChild(i); });
    left.appendChild(leg);

    // ── Colonne 2 : besoins non couverts puis PO ──
    const center = column('purchases', 'hlc-col-purchases', '2 · Besoins & PO fournisseurs', 'regroupés par fournisseur × marché');
    if (needGroups.length || sourcingNeeds.length) center.appendChild(el(doc, 'span', 'hlc-label', 'Besoins non couverts'));
    needGroups.forEach(({ batch, group }) => {
      const c = card('hlc-need', { 'data-hlc-need': group.key }, selKey === `need:${group.key}`, rel.needs.has(group.key), () => select('need', group.key));
      const head = el(doc, 'div', 'hlc-row');
      const cb = doc.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-hlc-need-check', group.key);
      cb.setAttribute('aria-label', `Sélectionner ${group.product || 'besoin'}`);
      cb.checked = state.picked.has(group.key);
      cb.disabled = readOnly;
      cb.addEventListener('click', (event) => event.stopPropagation());
      cb.addEventListener('change', () => { if (cb.checked) state.picked.add(group.key); else state.picked.delete(group.key); paint(); });
      head.appendChild(cb);
      head.appendChild(el(doc, 'strong', 'hlc-need-title', `${group.product || group.supplier_sku || 'Article'} — ${batch.supplier_name} · ${marketCode}${batch.procurement_hub_ref ? ' · Hub ' + batch.procurement_hub_ref : ''}`));
      head.appendChild(el(doc, 'span', 'hlc-spacer'));
      head.appendChild(el(doc, 'span', 'hlc-ref', `${num(group.quantity)} u`));
      c.appendChild(head);
      const chips = el(doc, 'div', 'hlc-row hlc-chips');
      group.lines.forEach((l) => chips.appendChild(el(doc, 'span', 'hlc-chip', `${l.order_ref} ×${num(l.quantity)}`)));
      chips.appendChild(el(doc, 'span', 'hlc-spacer'));
      chips.appendChild(el(doc, 'small', 'hlc-meta', 'compatibles : même fournisseur, SKU, marché'));
      c.appendChild(chips);
      center.appendChild(c);
    });
    sourcingNeeds.forEach((n) => {
      const c = card('hlc-need is-dashed', { 'data-hlc-need': n.key }, selKey === `need:${n.key}`, rel.needs.has(n.key), () => select('need', n.key));
      const head = el(doc, 'div', 'hlc-row');
      head.appendChild(el(doc, 'strong', 'hlc-need-title', `Sourcing requis — aucun fournisseur admissible · ${n.item.product || 'Article'}`));
      head.appendChild(el(doc, 'span', 'hlc-spacer'));
      head.appendChild(el(doc, 'span', 'hlc-ref', `${num(n.item.uncovered)} u`));
      c.appendChild(head);
      const chips = el(doc, 'div', 'hlc-row hlc-chips');
      chips.appendChild(el(doc, 'span', 'hlc-chip', `${n.order.reference} ×${num(n.item.uncovered)}`));
      chips.appendChild(el(doc, 'span', 'hlc-spacer'));
      chips.appendChild(el(doc, 'small', 'hlc-meta', 'ni ligne d’achat ni fournisseur associé'));
      c.appendChild(chips);
      center.appendChild(c);
    });
    if (pos.length) {
      const counts = el(doc, 'div', 'hlc-po-counts');
      counts.setAttribute('data-hlc-po-counts', '');
      ['draft','validation','engaged','sent','received'].forEach(key => {
        const count = pos.filter(po => po.step?.key === key).length;
        const item = el(doc, 'span', 'hlc-po-count', `${STEP_LABELS[key] || key} : ${num(count)}`);
        item.setAttribute('data-hlc-po-count', key);
        counts.appendChild(item);
      });
      center.appendChild(counts);
    }
    if (activePos.length) center.appendChild(el(doc, 'span', 'hlc-label', `En cours (${activePos.length})`));
    const renderPoCard = (po, destination) => {
      const c = card('hlc-po', { 'data-hlc-po': po.id }, selKey === `po:${po.id}`, rel.pos.has(po.id), () => select('po', po.id));
      const head = el(doc, 'div', 'hlc-row');
      const refNode = el(doc, 'span', 'hlc-ref', poRef(po));
      refNode.title = `Identifiant technique : ${po.id}`;
      head.appendChild(refNode);
      head.appendChild(el(doc, 'span', 'hlc-supplier', po.supplier_name));
      if (po.simulation_scope === 'G6-BUYER') head.appendChild(el(doc, 'span', 'hlc-chip', 'SIMULATION STAGING · aucun fournisseur contacté'));

      const eff = po.totals.effective || po.lines.reduce((t, l) => t + l.ordered, 0);
      const auth = `${po.authorizations.commitment ? 'engagement validé' : 'engagement non validé'} · ${po.authorizations.payment ? 'paiement autorisé' : 'paiement non autorisé'}`;
      head.appendChild(el(doc, 'small', 'hlc-meta', `${marketCode} · ${num(eff)} u · ${auth}`));
      head.appendChild(el(doc, 'span', 'hlc-spacer'));
      const sp = pill(po.status_view.label, po.status_view.tone);
      sp.setAttribute('data-hlc-po-state', '');
      head.appendChild(sp);
      c.appendChild(head);
      const track = el(doc, 'ol', 'hlc-steps');
      track.setAttribute('data-hlc-steps', po.step.key);
      (cockpit.po_steps || []).forEach((key, i) => {
        const done = i + 1 <= po.step.index;
        const last = key === 'received';
        const partialHere = last && po.step.partial;
        const li = el(doc, 'li', `hlc-step${done ? ' is-done' : ''}${partialHere ? ' is-partial' : last && done ? ' is-complete' : ''}`);
        li.setAttribute('data-step', key);
        if (partialHere) li.setAttribute('data-partial', 'true');
        if (i + 1 === po.step.index) li.setAttribute('aria-current', 'step');
        li.title = partialHere ? `Reçue ${num(po.totals.received)} sur ${num(eff)} : reliquat attendu` : STEP_HELP[key];
        li.appendChild(el(doc, 'span', 'hlc-step-bar'));
        li.appendChild(el(doc, 'span', 'hlc-step-label', partialHere ? `Reçue ${num(po.totals.received)}/${num(eff)}` : (STEP_LABELS[key] || key)));
        track.appendChild(li);
      });
      c.appendChild(track);
      const feeds = el(doc, 'div', 'hlc-feeds');
      [...po.lines].sort((a, b) => (a.fifo_rank || 0) - (b.fifo_rank || 0)).forEach((l) => {
        const row = el(doc, 'div', `hlc-row hlc-feed${sel && ((sel.type === 'order' && sel.id === l.order_id) || (sel.type === 'po' && sel.id === po.id)) ? ' is-highlight' : ''}`);
        row.setAttribute('data-hlc-po-line', l.line_id);
        row.setAttribute('data-hlc-line-order', l.order_id);
        const who = el(doc, 'button', 'hlc-chip is-link', l.order_ref);
        who.type = 'button';
        who.setAttribute('data-hlc-goto-order', l.order_id);
        who.addEventListener('click', (event) => { event.stopPropagation(); select('order', l.order_id); });
        row.appendChild(who);
        row.appendChild(el(doc, 'span', 'hlc-feed-product', l.product || 'Article'));
        row.appendChild(el(doc, 'span', 'hlc-spacer'));
        const q = po.status === 'draft' ? `${num(l.ordered)} u` : `${num(l.received)}/${num(l.confirmed)} reçu${l.missing > 0 ? ` · reliquat ${num(l.missing)}` : ''}`;
        row.appendChild(el(doc, 'span', `hlc-feed-qty${l.missing > 0 && l.received > 0 || (po.step.partial && l.missing > 0) ? ' is-warn' : l.missing === 0 && po.status !== 'draft' ? ' is-ok' : ''}`, q));
        row.appendChild(el(doc, 'small', `hlc-fifo${l.fifo_next ? ' is-next' : ''}`, `FIFO n° ${l.fifo_rank || '—'}${l.fifo_next ? ' · prochaine servie' : ''}`));
        feeds.appendChild(row);
      });
      c.appendChild(feeds);
      destination.appendChild(c);
    };
    activePos.forEach(po => renderPoCard(po,center));
    if (historyPos.length) {
      const history=doc.createElement('details');
      history.className='hlc-po-history';
      history.setAttribute('data-hlc-po-history','');
      history.open=Boolean(state.poHistoryOpen);
      const summary=el(doc,'summary','hlc-po-history-summary',`Historique (${historyPos.length})`);
      history.appendChild(summary);
      historyPos.forEach(po => renderPoCard(po,history));
      center.appendChild(history);
    }
    if (!activePos.length && !needGroups.length && !sourcingNeeds.length && historyPos.length)
      center.appendChild(el(doc,'p','hlc-empty','Aucun PO en cours ; consulter l’historique.'));
    if (!pos.length && !needGroups.length && !sourcingNeeds.length) center.appendChild(el(doc, 'p', 'hlc-empty', 'Aucun besoin ouvert ni PO sur ce marché.'));

    // ── Colonne 3 : exécution physique ──
    const right = column('physical', 'hlc-col-physical', '3 · Exécution physique', 'Hub → relais');
    physical.forEach((section) => {
      const block = el(doc, 'div', 'hlc-phys');
      block.setAttribute('data-hlc-phys', section.key);
      const title = el(doc, 'span', 'hlc-phys-title');
      title.appendChild(el(doc, 'span', `hlc-dot is-${section.tone}`));
      title.appendChild(doc.createTextNode(section.title));
      title.appendChild(el(doc, 'span', 'hlc-spacer'));
      title.appendChild(el(doc, 'span', 'hlc-ref', String(section.items.length)));
      block.appendChild(title);
      section.items.forEach((it) => {
        const [type, id] = [it.key.slice(0, it.key.indexOf(':')), it.key.slice(it.key.indexOf(':') + 1)];
        const hit = (type === 'order' && rel.orders.has(id) && sel && sel.type !== 'order') || (type === 'bag' && rel.bags.has(id)) || (type === 'box' && rel.boxes.has(id));
        const c = card('hlc-phys-card', { 'data-hlc-phys-item': it.key }, selKey === it.key, hit, () => select(type, id));
        const r = el(doc, 'div', 'hlc-row');
        r.appendChild(el(doc, 'span', 'hlc-ref', it.ref));
        r.appendChild(el(doc, 'span', 'hlc-spacer'));
        r.appendChild(el(doc, 'small', 'hlc-meta', humanPhysicalState(it.meta)));
        c.appendChild(r);
        c.appendChild(el(doc, 'span', 'hlc-phys-text', humanPhysicalState(it.text)));
        block.appendChild(c);
      });
      if (!section.items.length) block.appendChild(el(doc, 'span', 'hlc-empty', section.empty_text));
      right.appendChild(block);
    });
    // Un accès direct par geste physique, toujours vers le writer existant.
    const shortcuts = el(doc, 'nav', 'hlc-physical-shortcuts');
    shortcuts.setAttribute('aria-label', 'Accès direct aux ateliers physiques');
    for (const [key, label] of [
      ['reception', 'Réception fournisseur'],
      ['bags', 'Préparer les sacs'],
      ['boxes', 'KOM-BOX'],
      ['shipments', 'Expéditions'],
    ]) {
      const shortcut = button(doc, label, 'physical-' + key, 'is-link');
      shortcut.setAttribute('data-hlc-physical-shortcut', key);
      shortcut.addEventListener('click', () => key === 'reception' ? ctx.openReception() : ctx.openPhysical(key));
      shortcuts.appendChild(shortcut);
    }
    right.appendChild(shortcuts);
    const details = button(doc, 'Voir tous les ateliers physiques', 'open-physical-details', 'is-link');
    details.addEventListener('click', () => ctx.openPhysical());
    right.appendChild(details);

    function field(form, label, input) {
      const wrap = el(doc, 'label', 'hlc-field');
      wrap.appendChild(el(doc, 'span', '', label));
      wrap.appendChild(input);
      form.appendChild(wrap);
      return input;
    }
    function textInput(placeholder, name) {
      const i = doc.createElement('input');
      i.type = 'text'; i.maxLength = 240; i.placeholder = placeholder || ''; i.name = name;
      return i;
    }
    function poForm(po, kind) {
      const form = el(doc, 'form', 'hlc-form');
      const simulated = po.simulation_scope === 'G6-BUYER';
      const simulationRef = 'SIM-STAGING-' + po.simulation_reference;
      if (simulated && (kind === 'sent' || kind === 'confirm')) {
        form.appendChild(el(doc, 'p', 'hlc-zone-hint', 'SIMULATION STAGING UNIQUEMENT — aucune commande, confirmation ou transmission vers un fournisseur extérieur. Les justificatifs et le vendeur sont fictifs.'));
      }
      form.setAttribute('data-hlc-form', kind);
      form.addEventListener('click', (event) => event.stopPropagation());
      const close = button(doc, 'Fermer', 'close-form', 'is-link');
      close.addEventListener('click', () => { state.form = null; paint(); });
      if (kind === 'receive') {
        const card = ctx.renderReception(po.id);
        form.appendChild(card || el(doc, 'p', 'hlc-empty', 'Rien à réceptionner pour cette PO (déjà reçue ou non réceptionnable).'));
        form.appendChild(close);
        return form;
      }
      const proof = (kind === 'commitment' || kind === 'payment')
        ? field(form, kind === 'commitment' ? 'Pièce justificative de l’engagement' : 'Justificatif du paiement', textInput('Référence de la pièce (obligatoire)', 'proof_ref'))
        : null;
      let amount; let currency;
      const needsAmount = kind === 'payment' || (kind === 'commitment' && !po.amount.derived);
      if (kind === 'commitment' && po.amount.derived) {
        form.appendChild(el(doc, 'p', 'hlc-zone-hint', `Montant dérivé des lignes : ${num(po.amount.amount)} ${po.amount.currency}.`));
      }
      if (needsAmount) {
        amount = field(form, 'Montant', Object.assign(doc.createElement('input'), { type: 'number', min: '0', step: '0.01', name: 'amount' }));
        currency = field(form, 'Devise', Object.assign(textInput('USD', 'currency'), { maxLength: 3 }));
        if (kind === 'payment' && po.amount.derived) { amount.placeholder = String(po.amount.amount); currency.value = po.amount.currency; }
      }
      let channel; let supplierOrder; let confirmProof; let confirmSeller; let confirmQty = [];
      const confirmMoney = new Map();
      const confirmExecutions = [];
      if (kind === 'sent') {
        channel = field(form, simulated ? 'Canal interne de simulation (aucun envoi)' : 'Canal d’envoi réel', doc.createElement('select'));
        (simulated ? [['other', 'Simulation interne — sans contact']] : CHANNELS).forEach(([v, l]) => channel.appendChild(Object.assign(doc.createElement('option'), { value: v, textContent: l })));
        supplierOrder = field(form, simulated ? 'Référence fictive de recette' : 'Référence de commande fournisseur (facultative)', textInput('', 'supplier_order_id'));
        if (simulated) { supplierOrder.value = simulationRef; supplierOrder.readOnly = true; }
      }
      if (kind === 'confirm') {
        form.appendChild(el(doc, 'p', 'hlc-zone-hint', 'Quantités confirmées par le fournisseur (déclaratif, pas une réception). Le reliquat éventuel redevient un besoin ouvert.'));
        po.lines.forEach((l) => {
          const q = field(form, `${l.order_ref} · ${l.product || 'Article'} (commandé ${l.ordered})`, Object.assign(doc.createElement('input'), { type: 'number', min: '0', max: String(l.ordered), step: '1', value: String(l.ordered) }));
          confirmQty.push([l, q]);
          // Le produit manuel central Hub peut ne pas avoir de devis fournisseur initial.
          // Prix constaté et devise saisis à la CONFIRMATION, jamais déduits du prix retail
          // ni préremplis à partir du budget indicatif du sourcing.
          if (!(Number(l.unit_price) > 0) || !l.currency) {
            const p = field(form, simulated ? 'Prix unitaire FICTIF confirmé — staging' : 'Prix unitaire constaté sur justificatif', Object.assign(doc.createElement('input'), {
              type: 'number', min: '0', step: '0.01', name: 'confirmed_unit_price',
            }));
            const c = field(form, 'Devise de confirmation (ISO 3 lettres)', Object.assign(textInput('EUR', 'confirmed_currency'), { maxLength: 3 }));
            p.setAttribute('data-hlc-confirmed-price', '');
            c.setAttribute('data-hlc-confirmed-currency', '');
            confirmMoney.set(l.line_id, { p, c });
          }
        });
        supplierOrder = field(form, 'Référence de commande fournisseur', textInput('', 'supplier_order_id'));
        confirmProof = field(form, 'Justificatif d’achat (obligatoire)', textInput('Facture, capture, reçu…', 'purchase_proof_ref'));
        confirmSeller = field(form, simulated ? 'Fournisseur fictif — recette uniquement' : 'Vendeur réel (obligatoire pour un achat manuel, pas le Hub central)', textInput('Magasin ou vendeur', 'seller_label'));
        if (simulated) {
          const ref = po.simulation_reference;
          supplierOrder.value = simulationRef; supplierOrder.readOnly = true;
          confirmProof.value = 'SIM-STAGING-ACHAT-' + ref; confirmProof.readOnly = true;
          confirmSeller.value = 'SIMULATED-STAGING-FOURNISSEUR-' + ref; confirmSeller.readOnly = true;
        }
        const allocationPanel = el(doc, 'section', 'hlc-manual-purchase-allocations');
        allocationPanel.appendChild(el(doc, 'p', 'hlc-zone-hint', 'Si plusieurs vendeurs ont participé, détaillez une allocation par vendeur. Les quantités doivent couvrir exactement les lignes confirmées.'));
        const allocationRows = el(doc, 'div', 'hlc-manual-purchase-allocation-rows');
        const addAllocation = button(doc, 'Ajouter une allocation vendeur', 'add-manual-purchase-allocation', 'is-link');
        addAllocation.setAttribute('data-hlc-add-execution', '');
        addAllocation.addEventListener('click', () => {
          const row = el(doc, 'fieldset', 'hlc-manual-purchase-allocation');
          const legend = el(doc, 'legend', '', `Allocation vendeur ${confirmExecutions.length + 1}`);
          row.appendChild(legend);
          const lineSelect = doc.createElement('select');
          lineSelect.setAttribute('aria-label', 'Ligne d’achat de cette allocation');
          lineSelect.setAttribute('data-hlc-execution-line', '');
          po.lines.forEach((line) => lineSelect.appendChild(Object.assign(doc.createElement('option'), {
            value: line.line_id, textContent: `${line.order_ref || poRef(po)} · ${line.product || 'Article'}`,
          })));
          field(row, 'Ligne', lineSelect);
          const sellerInput = textInput(simulated ? 'Vendeur fictif de recette' : 'Magasin ou vendeur (pas le Hub central)', 'execution_seller_label');
          sellerInput.setAttribute('aria-label', 'Vendeur de cette allocation');
          sellerInput.setAttribute('data-hlc-execution-seller', '');
          field(row, 'Vendeur', sellerInput);
          const quantityInput = Object.assign(doc.createElement('input'), { type: 'number', min: '1', step: '1', value: '1', name: 'execution_quantity' });
          quantityInput.setAttribute('aria-label', 'Quantité de cette allocation');
          quantityInput.setAttribute('data-hlc-execution-quantity', '');
          field(row, 'Quantité achetée', quantityInput);
          const amountInput = Object.assign(doc.createElement('input'), { type: 'number', min: '0', step: '0.01', name: 'execution_amount' });
          amountInput.setAttribute('aria-label', 'Montant total justifié de cette allocation');
          amountInput.setAttribute('data-hlc-execution-amount', '');
          field(row, 'Montant total', amountInput);
          const currencyInput = Object.assign(textInput('EUR', 'execution_currency'), { maxLength: 3 });
          currencyInput.setAttribute('aria-label', 'Devise de cette allocation');
          currencyInput.setAttribute('data-hlc-execution-currency', '');
          field(row, 'Devise', currencyInput);
          const proofInput = textInput('Référence du reçu ou justificatif', 'execution_proof_ref');
          proofInput.setAttribute('aria-label', 'Justificatif de cette allocation');
          proofInput.setAttribute('data-hlc-execution-proof', '');
          field(row, 'Justificatif', proofInput);
          const remove = button(doc, 'Supprimer cette allocation', 'remove-manual-purchase-allocation', 'is-link');
          remove.setAttribute('data-hlc-remove-execution', '');
          remove.addEventListener('click', () => {
            const index = confirmExecutions.indexOf(record);
            if (index >= 0) confirmExecutions.splice(index, 1);
            row.remove();
            [...allocationRows.querySelectorAll('legend')].forEach((item, i) => { item.textContent = `Allocation vendeur ${i + 1}`; });
          });
          row.appendChild(remove);
          allocationRows.appendChild(row);
          const record = { lineSelect, sellerInput, quantityInput, amountInput, currencyInput, proofInput };
          confirmExecutions.push(record);
        });
        allocationPanel.appendChild(allocationRows);
        allocationPanel.appendChild(addAllocation);
        form.appendChild(allocationPanel);
      }
      const submit = button(doc, { commitment: 'Valider l’engagement', payment: 'Autoriser le paiement', sent: 'Enregistrer l’envoi', confirm: 'Enregistrer la confirmation' }[kind], `submit-${kind}`, 'is-primary');
      submit.type = 'submit';
      const note = el(doc, 'small', 'hlc-reason', '');
      form.appendChild(submit); form.appendChild(close); form.appendChild(note);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        const id = encodeURIComponent(po.id);
        if (kind === 'commitment' || kind === 'payment') {
          const body = { proof_ref: proof.value.trim() };
          if (!body.proof_ref) { note.textContent = 'La pièce justificative est obligatoire.'; return; }
          if (needsAmount) {
            const a = Number(amount.value || (kind === 'payment' && po.amount.derived ? po.amount.amount : 0));
            const c = currency.value.trim().toUpperCase();
            if (!(a > 0) || !/^[A-Z]{3}$/.test(c)) { note.textContent = 'Montant positif et devise (3 lettres) obligatoires.'; return; }
            body.amount = a; body.currency = c;
          }
          execute(submit, {
            url: purchasing(`po/${id}/${kind === 'commitment' ? 'authorize-commitment' : 'authorize-payment'}`), body,
            runningMessage: 'Décision en cours d’enregistrement…',
            successMessage: kind === 'commitment' ? 'Engagement validé et tracé.' : 'Paiement fournisseur autorisé et tracé.',
            onSuccess: () => { state.form = null; },
          });
        } else if (kind === 'sent') {
          execute(submit, {
            url: purchasing(`po/${id}/sent`), body: { channel: channel.value, ...(supplierOrder.value.trim() ? { supplier_order_id: supplierOrder.value.trim() } : {}), ...(simulated ? { simulated: true } : {}) },
            runningMessage: simulated ? 'Enregistrement de la simulation interne…' : 'Enregistrement de l’envoi…', successMessage: simulated ? 'Étape fournisseur simulée enregistrée — aucun contact extérieur.' : 'Envoi enregistré (canal, auteur, heure).', onSuccess: () => { state.form = null; },
          });
        } else if (kind === 'confirm') {
          const lines = confirmQty.map(([l, q]) => {
            const row = { purchase_line_id: l.line_id, confirmed_quantity: Number(q.value) };
            const money = confirmMoney.get(l.line_id);
            if (money && row.confirmed_quantity > 0) {
              row.confirmed_unit_price = Number(money.p.value);
              row.confirmed_currency = money.c.value.trim().toUpperCase();
            }
            return row;
          });
          if (lines.some((x) => !Number.isInteger(x.confirmed_quantity) || x.confirmed_quantity < 0)) { note.textContent = 'Quantités confirmées : entiers positifs ou nuls.'; return; }
          if (lines.some((x) => x.confirmed_unit_price !== undefined &&
              (!(x.confirmed_unit_price > 0) || !/^[A-Z]{3}$/.test(x.confirmed_currency)))) {
            note.textContent = 'Prix confirmé positif et devise obligatoire pour les lignes sans devis fournisseur.'; return;
          }
          if (lines.some((x) => x.confirmed_quantity > 0) && confirmProof.value.trim().length < 4) { note.textContent = 'Justificatif d’achat obligatoire (4 caractères minimum).'; return; }
          let executions;
          if (confirmExecutions.length) {
            executions = [];
            const allocated = new Map();
            for (const entry of confirmExecutions) {
              const purchaseLineId = entry.lineSelect.value;
              const sellerLabel = entry.sellerInput.value.trim();
              const quantity = Number(entry.quantityInput.value);
              const amountValue = Number(entry.amountInput.value);
              const currencyValue = entry.currencyInput.value.trim().toUpperCase();
              const proofValue = entry.proofInput.value.trim();
              if (!lines.some((line) => line.purchase_line_id === purchaseLineId && line.confirmed_quantity > 0)) {
                note.textContent = 'Chaque allocation doit pointer vers une ligne confirmée.'; return;
              }
              if (!sellerLabel || sellerLabel.toLowerCase() === 'fournisseur central hub' ||
                  !Number.isInteger(quantity) || quantity < 1 || !(amountValue > 0) ||
                  !/^[A-Z]{3}$/.test(currencyValue) || proofValue.length < 4) {
                note.textContent = 'Chaque allocation exige un vendeur, une quantité, un montant, une devise et son justificatif.'; return;
              }
              allocated.set(purchaseLineId, (allocated.get(purchaseLineId) || 0) + quantity);
              executions.push({ purchase_line_id: purchaseLineId, seller_label: sellerLabel, channel: 'in_person', quantity, amount: amountValue, currency: currencyValue, proof_ref: proofValue });
            }
            for (const line of lines) {
              if ((allocated.get(line.purchase_line_id) || 0) !== line.confirmed_quantity) {
                note.textContent = 'Les allocations vendeurs doivent couvrir exactement la quantité confirmée de chaque ligne.'; return;
              }
            }
          } else if (lines.some((x) => x.confirmed_quantity > 0) && confirmSeller.value.trim().length < 2) {
            note.textContent = 'Indiquez le vendeur avant de confirmer l’achat manuel.'; return;
          }
          execute(submit, {
            url: purchasing(`po/${id}/confirm`),
            body: { lines, ...(supplierOrder.value.trim() ? { supplier_order_id: supplierOrder.value.trim() } : {}), ...(confirmProof.value.trim() ? { purchase_proof_ref: confirmProof.value.trim() } : {}), ...(executions ? { executions } : (confirmSeller.value.trim() ? { seller_label: confirmSeller.value.trim() } : {})), ...(simulated ? { simulated: true } : {}) },
            confirmMessage: simulated ? 'Confirmer les quantités et l’achat FICTIFS sur staging, sans fournisseur ni paiement réel ?' : 'Enregistrer la confirmation fournisseur ? Toute quantité non confirmée redevient un besoin ouvert.',
            runningMessage: 'Enregistrement de la confirmation…', successMessage: simulated ? 'Confirmation et achat fictifs tracés — aucun fournisseur contacté.' : 'Confirmation fournisseur enregistrée.', onSuccess: () => { state.form = null; },
          });
        }
      });
      return form;
    }

    // ── Panneau bas : fil de l'objet sélectionné + actions autorisées ──
    const node = (kind, ref, st, tone, title) => ({ kind, ref, state: st, tone: tone || '', title: title || '' });
    const TONE_NODE = { bad: 'bad', warn: 'warn', ok: 'ok', done: 'ok', act: 'on', amber: 'warn', wait: '' };
    function bagBoxNodes(orderIds) {
      const out = [];
      allBags.filter((b) => orderIds.includes(b.order_id)).forEach((b) => out.push(node('Sac', b.ref, b.state, 'ok')));
      (d.boxes || []).filter((b) => boxOrders(b).some((id) => orderIds.includes(id))).forEach((b) => out.push(node('KOM-BOX', b.reference, b.shipment_ref ? `expédition ${b.shipment_ref}` : 'à rattacher', 'ok')));
      return out;
    }
    function lineageFor() {
      let title = ''; let sub = ''; let nodes = []; let blocker = '';
      if (!sel) return { title: 'Sélectionnez un élément', sub: 'Choisissez un dossier, un besoin ou une PO dans les colonnes du Hub.', nodes, blocker };
      if (sel.type === 'order') {
        const o = orderById.get(sel.id);
        if (o) {
          title = o.reference; sub = `${marketCode} · ${o.relay_name || 'relais —'}`;
          nodes.push(node('Commande', o.reference, o.status.label, TONE_NODE[o.status.tone] || 'on'));
          o.items.forEach((i) => nodes.push(node('Ligne', `${i.product} ×${num(i.requested)}`, i.where, i.uncovered > 0 ? 'bad' : /reliquat/.test(i.where) ? 'warn' : i.complete ? 'ok' : '')));
          o.po_ids.forEach((id) => { const p = poById.get(id); if (p) nodes.push(node('PO', poRef(p), p.status_view.label, TONE_NODE[p.status_view.tone] || '')); });
          if (o.totals.received > 0) nodes.push(node('Réception', `${num(o.totals.received)}/${num(o.totals.requested)}`, cockpit.allocation_rule ? 'FIFO commande la plus ancienne' : '', o.totals.received >= o.totals.requested ? 'ok' : 'warn'));
          nodes = nodes.concat(bagBoxNodes([o.id]));
          nodes.push(node('Relais', o.relay_name || '—', 'à venir', '', o.relay_id ? `Relais · identifiant technique : ${o.relay_id}` : ''));
          blocker = (o.totals.uncovered > 0 ? 'Sourcing requis — aucun fournisseur admissible. ' : '') + (o.readiness.blockers || []).join(' · ');
        }
      } else if (sel.type === 'po') {
        const p = poById.get(sel.id);
        if (p) {
          title = poRef(p); sub = `${p.supplier_name} · ${marketCode}`;
          p.order_ids.forEach((id) => { const o = orderById.get(id); const ls = p.lines.filter((l) => l.order_id === id); if (o) nodes.push(node('Commande', o.reference, ls.map((l) => `${l.product} ×${num(l.ordered)}`).join(', '), 'on')); });
          nodes.push(node('PO', poRef(p), p.status_view.label, TONE_NODE[p.status_view.tone] || 'on'));
          const recvd = p.lines.filter((l) => l.received > 0);
          if (recvd.length) nodes.push(node('Réception', `${num(p.totals.received)}/${num(p.totals.effective)}`, `FIFO → ${recvd.map((l) => `${l.order_ref} ×${num(l.received)}`).join(', ')}`, p.totals.missing > 0 ? 'warn' : 'ok'));
          nodes = nodes.concat(bagBoxNodes(p.order_ids));
          const waiting = p.lines.filter((l) => l.missing > 0 && p.status !== 'draft');
          if (p.status === 'draft' && !p.authorizations.commitment) blocker = 'l’engagement d’achat doit être validé par la responsable Hub avant soumission.';
          else if (p.status === 'draft') blocker = 'engagement validé : la PO doit encore être soumise puis son envoi réel enregistré.';
          else if (waiting.length && p.totals.received > 0) blocker = `${num(p.totals.missing)} u manquante(s) : ${waiting.map((l) => `${l.order_ref} reste en reliquat (${num(l.missing)})`).join(', ')} tant que le fournisseur n’a pas livré.`;
          else if (p.status !== 'draft' && p.authorizations.commitment && !p.authorizations.payment) blocker = 'le paiement fournisseur reste une décision distincte de l’engagement (responsable Hub).';
        }
      } else if (sel.type === 'need') {
        const g = needGroups.find((x) => x.group.key === sel.id);
        const s = sourcingNeeds.find((x) => x.key === sel.id);
        if (g) {
          title = `Besoin ${g.group.product || 'article'}`; sub = `${g.batch.supplier_name} · ${marketCode} · ${num(g.group.quantity)} u`;
          g.group.lines.forEach((l) => nodes.push(node('Commande', l.order_ref, `×${num(l.quantity)}`, 'on')));
          nodes.push(node('Regroupement', `${num(g.group.quantity)} u`, 'même SKU · même marché', 'on'), node('PO', 'à constituer', 'brouillon', ''));
        } else if (s) {
          title = `Besoin ${s.item.product || 'article'}`; sub = `${s.order.reference} · ${marketCode} · ${num(s.item.uncovered)} u`;
          nodes = [node('Commande', s.order.reference, s.order.status.label, 'on'), node('Besoin', `${s.item.product} ×${num(s.item.uncovered)}`, 'sans ligne d’achat', 'warn'), node('Fournisseur', '—', 'aucun admissible', 'warn'), node('PO', '—', 'impossible', '')];
          blocker = 'Sourcing requis — aucun fournisseur admissible : aucune PO possible.';
        }
      } else if (sel.type === 'bag') {
        const b = allBags.find((x) => x.id === sel.id);
        if (b) {
          title = b.ref; sub = `sac client ${b.state} · ${b.order_ref}`;
          nodes = [node('Commande', b.order_ref, '', 'on'), node('Sac', b.ref, b.state, 'ok'), node('KOM-BOX', '—', 'à rattacher', ''), node('Expédition', '—', 'à rattacher', '')];
        }
      } else if (sel.type === 'box') {
        const b = (d.boxes || []).find((x) => x.unit_id === sel.id);
        if (b) {
          title = b.reference; sub = `KOM-BOX · ${b.state}`;
          nodes = [node('Sac', [...new Set((b.contents || []).map((c) => c.order_ref))].join(', ') || '—', 'dans la KOM-BOX', 'ok'), node('KOM-BOX', b.reference, humanPhysicalState(b.state), 'on'), node('Expédition', b.shipment_ref || '—', b.shipment_ref ? (b.shipment_stage || 'ouverte') : 'à rattacher', b.shipment_ref ? 'ok' : ''), node('Relais', '—', 'attestation à la réception', '')];
        }
      }
      return { title: title || selKey, sub, nodes, blocker };
    }

    // Actions : exécutent la route réelle ; impossibles → désactivées AVEC la raison (jamais masquées sans explication).
    function actionsFor() {
      const acts = [];
      const A = (key, label, o) => acts.push({ key, label, ...(o || {}) });
      const lock = readOnly ? 'lecture seule' : null;
      const grant = (flag, reason) => (viewer && flag ? null : reason);
      if (!sel) return acts;
      if (sel.type === 'need') {
        const g = needGroups.find((x) => x.group.key === sel.id);
        const s = sourcingNeeds.find((x) => x.key === sel.id);
        if (s) {
          A('resolve-sourcing', 'Résoudre le sourcing / créer un achat manuel', { primary: true, why: 'choisir fournisseur et ligne d’achat', disabled: lock, run: () => ctx.openSourcing(s.order.id) });
          A('prepare-po', 'Constituer un PO', { disabled: 'impossible sans fournisseur' });
        } else if (g) {
          const mine = g.batch.groups.filter((x) => state.picked.has(x.key));
          const crossBatch = [...state.picked].some((k) => !g.batch.groups.some((x) => x.key === k));
          const use = mine.length ? mine : [g.group];
          const lineIds = use.flatMap((x) => x.lines.map((l) => l.line_id));
          const qty = use.reduce((t, x) => t + x.quantity, 0);
          A('prepare-po', `Constituer une PO · ${num(qty)} u (${use.map((x) => x.product || 'article').join(' + ')})`, {
            primary: true, why: 'regroupe les besoins cochés', disabled: lock || (crossBatch ? 'un seul fournisseur et marché par PO' : null),
            run: (b) => prepareBatch(b, g.batch, lineIds, null),
          });
          // Une même référence fournisseur/SKU peut regrouper plusieurs commandes.
          // Le Hub doit aussi pouvoir constituer une PO pour UNE commande sans
          // rattacher silencieusement les lignes des autres commandes.
          const byOrder = new Map();
          for (const line of g.group.lines) {
            if (!line.order_id || !line.order_ref || !line.line_id) continue;
            if (!byOrder.has(line.order_id)) byOrder.set(line.order_id, { ref: line.order_ref, ids: [] });
            byOrder.get(line.order_id).ids.push(line.line_id);
          }
          if (byOrder.size > 1) {
            for (const [orderId, orderLines] of byOrder) {
              A('prepare-po-order-' + orderId,
                `Constituer une PO · commande ${orderLines.ref} (${orderLines.ids.length} ligne(s))`, {
                  why: 'uniquement les lignes de cette commande ; autres commandes inchangées',
                  disabled: lock,
                  run: (b) => prepareBatch(b, g.batch, orderLines.ids, null),
                });
            }
          }
          if (g.batch.compatible_draft_po_ids.length) {
            g.batch.compatible_draft_po_ids.forEach((id) => A(`attach-po-${id}`, `Ajouter au brouillon ${poRef(poById.get(id) || { id })}`, { why: 'même fournisseur · Hub · marché', disabled: lock || (crossBatch ? 'un seul fournisseur et marché par PO' : null), run: (b) => prepareBatch(b, g.batch, lineIds, id) }));
          } else A('attach-po', 'Ajouter à un PO brouillon existant', { disabled: 'aucun brouillon compatible' });
        }
      } else if (sel.type === 'po') {
        const po = poById.get(sel.id);
        if (po) {
          const draft = po.step.key === 'draft';
          const eff = po.totals.effective || 0;
          if (draft) {
            A('authorize-commitment', 'Valider l’engagement d’achat', { primary: true, why: 'droit purchase_commitment', disabled: lock || grant(viewer && viewer.can_authorize_commitment, 'réservé à la responsable Hub'), run: () => openForm('commitment', po.id) });
            A('detach-line', 'Retirer une ligne', { why: 'la ligne redevient un besoin ouvert', disabled: lock, run: () => openForm('detach', po.id) });
          }
          if (!readOnly && po.authorizations.commitment?.pdf_available) {
            A('download-commitment-pdf', 'Télécharger le bon de commande PDF', {
              href: `/api/purchasing/po/${encodeURIComponent(po.id)}/commitment-pdf`,
              why: 'usage interne Hub',
            });
          }
          if (po.step.key === 'validation') A('submit-po', 'Soumettre la PO', { primary: true, why: 'rien n’est encore envoyé', disabled: lock, run: (b) => submitPo(b, po.id) });
          if (po.step.key === 'engaged') A('record-sent', 'Enregistrer l’envoi fournisseur', { primary: true, why: 'canal réel, auteur, heure', disabled: lock, run: () => openForm('sent', po.id) });
          if (po.status === 'notified' && po.sent_at) A('confirm-po', 'Confirmation fournisseur', { why: 'quantités confirmées (déclaratif)', disabled: lock, run: () => openForm('confirm', po.id) });
          if (!draft) A('receive', 'Réceptionner une livraison', { primary: po.totals.missing > 0, why: 'scan et quantité reçue', disabled: lock || (po.totals.missing > 0 ? null : 'PO soldée'), run: () => openForm('receive', po.id) });
          else A('receive', 'Réceptionner une livraison', { disabled: 'PO encore en brouillon' });
          if (!draft && !po.authorizations.payment) A('authorize-payment', 'Autoriser le paiement fournisseur', { why: 'décision distincte de l’engagement', disabled: lock || (!po.authorizations.commitment ? 'après engagement et envoi' : grant(viewer && viewer.can_authorize_payment, 'réservé à la responsable Hub')), run: () => openForm('payment', po.id) });
          else if (draft) A('authorize-payment', 'Autoriser le paiement fournisseur', { disabled: 'après engagement et envoi' });
          void eff;
        }
      } else if (sel.type === 'order') {
        const o = orderById.get(sel.id);
        if (o) {
          if (o.totals.uncovered > 0) A('resolve-sourcing', 'Résoudre le sourcing / créer un achat manuel', { primary: true, why: 'choisir fournisseur et ligne d’achat', disabled: lock, run: () => ctx.openSourcing(o.id) });
          const r = o.readiness;
          if (r.ready_to_pack) A('create-bag', `Préparer le sac ${o.reference}`, { primary: true, why: 'commande complète, prête à ensacher', disabled: lock, run: (b) => createBag(b, o, false) });
          else if (r.bag_open) A('create-bag', `Préparer le sac ${o.reference}`, { disabled: 'un sac est déjà ouvert' });
          else if (r.partial && r.unbagged_received > 0) A('create-partial-bag', 'Préparer un sac partiel', { primary: !o.totals.uncovered, why: 'explicite : le reliquat reste suivi', disabled: lock, run: (b) => createBag(b, o, true) });
          else A('create-bag', `Préparer le sac ${o.reference}`, { disabled: r.partial ? 'aucune unité reçue à ensacher' : 'rien reçu pour l’instant' });
          if (o.po_ids.length) A('goto-po', 'Suivre dans ses PO', { why: 'voir les PO de la commande', run: () => select('po', o.po_ids[0]) });
        }
      } else if (sel.type === 'bag') {
        const b = physical.flatMap((s2) => s2.items).find((it) => it.key === selKey);
        if (b && b.closable) A('close-bag', 'Fermer le sac', { primary: true, why: 'contenu scanné = contenu prévu', disabled: lock, run: (btn) => closeBag(btn, b.bag_unit_id) });
        else if (b && b.bag_unit_id && /ouvert/.test(b.meta)) A('open-physical', 'Déposer (scan)', { primary: true, why: 'scan des articles dans le sac', disabled: lock, run: () => ctx.openPhysical() });
        else A('close-bag', 'Fermer le sac', { disabled: 'sac déjà fermé' });
      } else if (sel.type === 'box') {
        const b = (d.boxes || []).find((x) => x.unit_id === sel.id);
        if (b && !b.shipment_ref) A('attach-box', 'Rattacher à une expédition', { primary: true, why: 'expéditions ouvertes du marché', disabled: lock || ((d.open_shipments || []).length ? null : 'aucune expédition ouverte'), run: () => { state.form = { kind: 'box', box: b.unit_id }; paint(); } });
        else if (b) A('attach-box', 'Rattacher à une expédition', { disabled: `déjà rattachée à ${b.shipment_ref}` });
      }
      return acts;
    }
    function boxForm(box) {
      const form = el(doc, 'form', 'hlc-form');
      form.setAttribute('data-hlc-form', 'box');
      const selShip = doc.createElement('select');
      selShip.setAttribute('aria-label', 'Expédition ouverte');
      (d.open_shipments || []).forEach((s2) => selShip.appendChild(Object.assign(doc.createElement('option'), { value: s2.reference, textContent: `${s2.reference} · ${s2.forwarder_name || 'transitaire'} · ${s2.box_count} carton(s)` })));
      form.appendChild(selShip);
      const go = button(doc, 'Rattacher', 'submit-box', 'is-primary');
      go.type = 'submit';
      form.appendChild(go);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        execute(go, { url: ctx.endpoint(`boxes/${encodeURIComponent(box.unit_id)}/shipment`), body: { shipment_reference: selShip.value },
          runningMessage: 'Rattachement à l’expédition…', successMessage: `KOM-BOX ${box.reference} rattachée à ${selShip.value}.`, onSuccess: () => { state.form = null; } });
      });
      return form;
    }
    function detachForm(po) {
      const form = el(doc, 'form', 'hlc-form');
      form.setAttribute('data-hlc-form', 'detach');
      const pick = doc.createElement('select');
      pick.setAttribute('aria-label', 'Ligne à retirer');
      po.lines.forEach((l) => pick.appendChild(Object.assign(doc.createElement('option'), { value: l.line_id, textContent: `${l.order_ref} · ${l.product || 'Article'} ×${l.ordered}` })));
      form.appendChild(pick);
      const go = button(doc, 'Retirer la ligne', 'submit-detach', 'is-primary');
      go.type = 'submit';
      form.appendChild(go);
      form.appendChild(el(doc, 'small', 'hlc-reason', 'La ligne redevient un besoin ouvert. Impossible après validation de l’engagement.'));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        execute(go, { url: purchasing(`po/${encodeURIComponent(po.id)}/detach`), body: { line_ids: [pick.value] },
          confirmMessage: `Retirer cette ligne de la ${poRef(po)} ? Elle redevient un besoin ouvert.`, runningMessage: 'Retrait en cours…', successMessage: 'Ligne retirée de la PO.', onSuccess: () => { state.form = null; } });
      });
      return form;
    }

    const panel = el(doc, 'section', 'hlc-panel');
    panel.setAttribute('data-hlc-panel', '');
    panel.setAttribute('aria-label', 'Objet sélectionné');
    const fil = lineageFor();
    const leftP = el(doc, 'div', 'hlc-panel-left');
    const filHead = el(doc, 'div', 'hlc-row');
    filHead.appendChild(el(doc, 'span', 'hlc-label', 'Fil de'));
    const ft = el(doc, 'strong', 'hlc-ref', fil.title);
    ft.setAttribute('data-hlc-fil-title', '');
    filHead.appendChild(ft);
    filHead.appendChild(el(doc, 'span', 'hlc-meta', fil.sub));
    leftP.appendChild(filHead);
    const chain = el(doc, 'div', 'hlc-chain');
    chain.setAttribute('data-hlc-chain', '');
    fil.nodes.forEach((n, i) => {
      const nd = el(doc, 'div', `hlc-node${n.tone ? ' is-' + n.tone : ''}`);
      if (n.title) nd.title = n.title;
      nd.setAttribute('data-hlc-node', n.kind);
      nd.appendChild(el(doc, 'span', 'hlc-node-kind', n.kind));
      nd.appendChild(el(doc, 'span', 'hlc-ref', n.ref));
      nd.appendChild(el(doc, 'span', 'hlc-node-state', n.state));
      chain.appendChild(nd);
      if (i < fil.nodes.length - 1) chain.appendChild(el(doc, 'span', 'hlc-arrow', '→'));
    });
    leftP.appendChild(chain);
    if (fil.blocker) {
      const bl = el(doc, 'div', 'hlc-blocker');
      bl.setAttribute('data-hlc-blocker', '');
      bl.appendChild(el(doc, 'strong', '', 'Ce qui bloque : '));
      bl.appendChild(doc.createTextNode(fil.blocker));
      leftP.appendChild(bl);
    }
    panel.appendChild(leftP);

    const rightP = el(doc, 'div', 'hlc-panel-right');
    rightP.appendChild(el(doc, 'span', 'hlc-label', `Actions autorisées · ${roleLabel}`));
    const list = el(doc, 'div', 'hlc-actions');
    // Le marqueur data-hlc-actions est porté par l'unique ancêtre commun
    // aux deux emplacements d'actions après déplacement du CTA principal.
    let primaryUsed = false;
    actionsFor().forEach((a) => {
      if (a.primary && !a.disabled) { if (primaryUsed) a.primary = false; else primaryUsed = true; } else if (a.disabled) a.primary = false;
      const row = el(doc, 'div', 'hlc-action-row');
      const b = a.href ? el(doc, 'a', 'hlc-btn', a.label)
        : button(doc, a.label, a.key, a.primary ? 'is-primary' : '');
      if (a.href) b.setAttribute('href', a.href);
      if (a.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); b.title = a.disabled; }
      else if (a.run) b.addEventListener('click', () => { a.run(b); });
      row.appendChild(b);
      row.appendChild(el(doc, 'span', 'hlc-reason', a.disabled || a.why || ''));
      list.appendChild(row);
    });
    if (!list.children.length) list.appendChild(el(doc, 'span', 'hlc-empty', 'Aucune action sur cet objet.'));
    rightP.appendChild(list);
    if (state.form && !readOnly) {
      if (state.form.kind === 'box' && sel && sel.type === 'box' && state.form.box === sel.id) {
        const box = (d.boxes || []).find((x) => x.unit_id === sel.id);
        if (box) rightP.appendChild(boxForm(box));
      } else if (state.form.po && sel && sel.type === 'po' && state.form.po === sel.id) {
        const po = poById.get(sel.id);
        if (po) rightP.appendChild(state.form.kind === 'detach' ? detachForm(po) : poForm(po, state.form.kind));
      }
    }
    // Le seul bouton principal est déplacé (non dupliqué) au-dessus de la file
    // physique : même handler, même protection contre le double POST.
    const nextAction = el(doc, 'section', 'hlc-next-action');
    nextAction.setAttribute('data-hlc-next-action', '');
    nextAction.appendChild(el(doc, 'strong', 'hlc-next-action-title', 'À faire sur ce dossier'));
    const primaryRow = Array.from(list.children).find(row => row.querySelector && row.querySelector('.hlc-btn.is-primary:not(:disabled)'));
    if (primaryRow) nextAction.appendChild(primaryRow);
    else nextAction.appendChild(el(doc, 'span', 'hlc-meta',
      sel ? 'Aucun geste immédiat : consultez les actions et prérequis dans le fil ci-dessous.'
          : 'Sélectionnez une commande, un besoin ou une unité physique.'));
    right.insertBefore(nextAction, right.children[1]);
    panel.appendChild(rightP);
    rootEl.appendChild(panel);
    const saved = state.form && state.form.values;
    const liveForm = rightP.querySelector('form[data-hlc-form]');
    if (saved && liveForm && saved.kind === liveForm.getAttribute('data-hlc-form')) {
      const fields = [...liveForm.querySelectorAll('input,select,textarea')];
      if (fields.length === saved.items.length) {
        fields.forEach((f, i) => {
          const it = saved.items[i];
          if (!it) return;
          if (f.type === 'checkbox' || f.type === 'radio') f.checked = it.c; else f.value = it.v;
        });
        const target = fields[saved.focus];
        if (target && typeof target.focus === 'function') {
          target.focus();
          if (saved.sel && target.setSelectionRange) { try { target.setSelectionRange(saved.sel[0], saved.sel[1]); } catch (e) { /* type sans sélection */ } }
        }
      }
    }
    return rootEl;
  }

  return Object.freeze({ render, STEP_LABELS });
});
