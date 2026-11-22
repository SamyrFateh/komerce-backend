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

// Hub Live concept C â€” Â« flux du besoin Â» : Commandes importÃ©es â†’ Besoins & PO â†’ ExÃ©cution physique.
// Le navigateur ne calcule aucune vÃ©ritÃ© mÃ©tier : quantitÃ©s, Ã©tapes, droits et Â« Ã€ faire maintenant Â»
// viennent de GET /market/:code/supply (section cockpit). Les gestes appellent les routes existantes
// (/api/purchasing/* et /api/admin/workspaces/operations/*) ; jamais /api/hub/*.
(function initHubLiveCockpit(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceHubLiveCockpit = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createHubLiveCockpit() {
  const PO_TRACK = Object.freeze(['Brouillon', 'Validation', 'EngagÃ©e', 'ExpÃ©diÃ©e', 'ReÃ§ue']);
  const STEP_LABELS = Object.freeze({ draft: 'Brouillon', validation: 'Validation', engaged: 'EngagÃ©e', sent: 'ExpÃ©diÃ©e', received: 'ReÃ§ue' });
  const OWNER_LABELS = Object.freeze({ agent_hub: 'Agent Hub', responsable_hub: 'Responsable Hub' });
  const CHANNELS = Object.freeze([['email', 'E-mail'], ['whatsapp', 'WhatsApp'], ['phone', 'TÃ©lÃ©phone'], ['api', 'API'], ['other', 'Autre']]);
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const num = (v) => nf.format(Number(v) || 0);
  const short = (v) => String(v || '').slice(0, 8);
  // Traduction strictement visuelle : les Ã©tats API et le Golden restent inchangÃ©s.
  const PHYSICAL_STATE_LABELS = Object.freeze({
    PICKED: 'PrÃ©levÃ©', PACKED: 'EmballÃ©', DISPATCHED: 'PrÃªt au dÃ©part',
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

  // Action impossible : dÃ©sactivÃ©e AVEC la raison visible (jamais un bouton muet).
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



  const STEP_HELP = Object.freeze({ draft: 'Brouillon : PO prÃ©parÃ©e, engagement non validÃ©', validation: 'Validation : engagement validÃ© par la responsable Hub', engaged: 'EngagÃ©e : soumise, envoi Ã  enregistrer', sent: 'ExpÃ©diÃ©e : envoyÃ©e au fournisseur', received: 'ReÃ§ue : livraison enregistrÃ©e au Hub' });
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
    // UX2 : les PO partiellement reÃ§us restent EN COURS ; seuls les PO achevÃ©s
    // passent en historique. Le dossier complet reste dans poById et sÃ©lectionnable.
    const isHistoricalPo = po => !po.step?.partial &&
      (['received','closed','completed'].includes(po.status) ||
       (po.step?.key === 'received' && Number(po.totals?.effective) > 0 &&
        Number(po.totals?.received) >= Number(po.totals?.effective)));
    const activePos = pos.filter(po => !isHistoricalPo(po));
    const historyPos = pos.filter(isHistoricalPo);
    const batches = cockpit.need_batches || [];
    const todo = (cockpit.todo || []).filter(item => !['PREPARE_BAG','CLOSE_BAG','DEPOSIT_BAG','BOX_BAGS'].includes(item.kind));
    const physical = (cockpit.physical || []).filter(section => section.key !== 'bags');
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
    // Les sÃ©lecteurs du Golden restent valides sans dupliquer un seul bouton.
    rootEl.setAttribute('data-hlc-actions', '');
    const markReady = () => {
      const r = host.querySelector && host.querySelector('[data-hub-cockpit]');
      if (r) r.setAttribute('data-hlc-ready', state.pending > 0 ? 'false' : 'true');
    };
    rootEl.setAttribute('data-render-epoch', String(state.epoch));
    rootEl.setAttribute('data-hlc-ready', state.pending > 0 ? 'false' : 'true');
    host.appendChild(rootEl);

    // â”€â”€ Actions : un seul point d'exÃ©cution, dÃ©sactivÃ© pendant la requÃªte, Ã©tat incertain â†’ recharger et vÃ©rifier.
    async function execute(btn, options) {
      state.pending = (state.pending || 0) + 1;
      markReady();
      try {
        return await ctx.act(btn, options);
      } catch (error) {
        if (!error || !error.status) {
          ctx.feedback('RÃ©ponse rÃ©seau incertaine : lâ€™opÃ©ration a peut-Ãªtre Ã©tÃ© appliquÃ©e. Rechargement de lâ€™Ã©tat, vÃ©rifiez avant de recommencer.', 'critical');
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
    // UX3 â€” partage d'une sÃ©lection sans perdre marchÃ©, vue ni filtres dans l'URL.
    const win = doc.defaultView;
    const isHubRoute = () => win?.location?.pathname === '/admin/hub-live';
    function readUrlSelection() {
      if (!isHubRoute()) return null;
      const value = new win.URLSearchParams(win.location.search).get('sel') || '';
      const i = value.indexOf(':');
      if (i < 1) return null;
      const type = value.slice(0, i), id = value.slice(i + 1);
      return ['po','order','need','box'].includes(type) && id.length > 0 && id.length < 160 ? {type,id} : null;
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

    // â”€â”€ Gestes (routes existantes) â”€â”€
    function prepareBatch(btn, batch, lineIds, draftPoId) {
      const n = lineIds.length;
      if (draftPoId) {
        return execute(btn, {
          url: purchasing(`po/${encodeURIComponent(draftPoId)}/attach`), body: { line_ids: lineIds },
          confirmMessage: `Rattacher ${n} ligne(s) au brouillon PO ${short(draftPoId)} (${batch.supplier_name}) ?`,
          runningMessage: 'Rattachement en coursâ€¦', successMessage: `${n} ligne(s) rattachÃ©e(s) au brouillon.`,
        });
      }
      return execute(btn, {
        url: purchasing('po/prepare'), body: { supplier_id: batch.supplier_id, procurement_hub_ref: batch.procurement_hub_ref, line_ids: lineIds },
        confirmMessage: `PrÃ©parer une PO ${batch.supplier_name} (${batch.procurement_hub_ref || 'Hub'}) avec ${n} ligne(s) ? Aucun envoi ni paiement.`,
        runningMessage: 'PrÃ©paration de la POâ€¦', successMessage: 'PO prÃ©parÃ©e en brouillon : validation dâ€™engagement attendue.',
      });
    }

    function submitPo(btn, poId) {
      return execute(btn, {
        url: purchasing(`po/${encodeURIComponent(poId)}/submit`), body: {},
        confirmMessage: `Soumettre la PO ${short(poId)} ? Lâ€™engagement validÃ© est requis ; rien nâ€™est envoyÃ© au fournisseur.`,
        runningMessage: 'Soumission en coursâ€¦', successMessage: 'PO soumise : enregistrer maintenant son envoi rÃ©el.',
      });
    }
    // â”€â”€ SÃ©lection par dÃ©faut et lien Â« Ã€ faire maintenant Â» â†’ objet â”€â”€
    function todoSel(item) {
      const s = item.subject || {};
      if (s.po_id) return { type: 'po', id: s.po_id };
      if (s.batch_key) { const b = batches.find((x) => x.key === s.batch_key); return b && b.groups[0] ? { type: 'need', id: b.groups[0].key } : null; }
      if (s.order_id) {
        const o = orderById.get(s.order_id);
        return o && o.totals.uncovered > 0 && item.kind === 'SOURCING_REQUIRED' ? { type: 'order', id: o.id } : { type: 'order', id: s.order_id };
      }
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
        state.sel.type === 'box' ? (d.boxes || []).some(b => b.unit_id === state.sel.id) : false;
      // La tÃ¢che serveur est une rÃ©fÃ©rence mÃ©tier valide mÃªme si la liste
      // compacte n'inclut pas le dossier : conserver sa sÃ©lection au clic.
      const inTodo = todo.some(item => {
        const target = todoSel(item);
        return target && target.type === state.sel.type && target.id === state.sel.id;
      });
      if (!known && !inTodo) state.sel = null;
    }
    const sel = state.sel;
    const selKey = sel ? `${sel.type}:${sel.id}` : '';
    rootEl.setAttribute('data-hlc-selection', selKey);

    // â”€â”€ Liens de navigation (rÃ©fÃ©rences du dossier serveur, aucune quantitÃ© calculÃ©e) â”€â”€
    const boxOrders = (b) => [...new Set((b.contents || []).map((c) => c.order_id).filter(Boolean))];
    const needGroups = batches.flatMap((b) => b.groups.map((g) => ({ batch: b, group: g })));
    const sourcingNeeds = orders.flatMap((o) => o.items.filter((i) => i.uncovered > 0).map((i) => ({ order: o, item: i, key: `src:${o.id}:${i.id}` })));
    function related() {
      const r = { orders: new Set(), pos: new Set(), needs: new Set(), boxes: new Set() };
      if (!sel) return r;
      if (sel.type === 'order') {
        const o = orderById.get(sel.id);
        if (o) { r.orders.add(o.id); o.po_ids.forEach((id) => r.pos.add(id)); }
        (d.boxes || []).filter((b) => boxOrders(b).includes(sel.id)).forEach((b) => r.boxes.add(b.unit_id));
        needGroups.filter(({ group }) => group.lines.some((l) => l.order_id === sel.id)).forEach(({ group }) => r.needs.add(group.key));
        sourcingNeeds.filter((n) => n.order.id === sel.id).forEach((n) => r.needs.add(n.key));
      } else if (sel.type === 'po') {
        const po = poById.get(sel.id);
  m«ëŒ+Š×ž®º+º$zzb¥æÚ±î¸Â¸­yêë¢°k¢G§¦*^      if (po) { r.pos.add(po.id); po.order_ids.forEach((id) => r.orders.add(id)); }
      } else if (sel.type === 'need') {
        const g = needGroups.find((x) => x.group.key === sel.id);
        if (g) g.group.lines.forEach((l) => r.orders.add(l.order_id));
        const s = sourcingNeeds.find((x) => x.key === sel.id);
        if (s) r.orders.add(s.order.id);
        r.needs.add(sel.id);
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

    // â”€â”€ 1. Ã€ faire maintenant : pastilles compactes, clic = sÃ©lection de l'objet â”€â”€
    const todoBar = el(doc, 'section', 'hlc-todo');
    todoBar.setAttribute('data-hlc-todo', '');
    todoBar.setAttribute('aria-label', 'Ã€ faire maintenant');
    todoBar.appendChild(el(doc, 'strong', 'hlc-todo-title', 'Ã€ faire maintenant'));
    if (!todo.length) todoBar.appendChild(el(doc, 'span', 'hlc-empty', 'Rien Ã  traiter : toutes les commandes import suivent leur cours.'));
    const PILLS = 4;
    (state.todoAll ? todo : todo.slice(0, PILLS)).forEach((item) => {
      const target = todoSel(item);
      const tone = item.viewer_can_act === false ? 'wait' : item.severity === 'anomaly' ? 'bad' : WARN_KINDS.has(item.kind) ? 'warn' : 'act';
      const b = el(doc, 'button', `hlc-todo-pill is-${tone}${target && `${target.type}:${target.id}` === selKey ? ' is-on' : ''}`);
      b.type = 'button';
      b.setAttribute('data-hlc-todo-item', item.kind);
      b.setAttribute('data-owner', item.owner);
      b.title = `${item.missing} â€” ${item.why}${item.blocked_reason ? ` (${item.blocked_reason})` : ''}`;
      b.appendChild(el(doc, 'span', `hlc-dot is-${tone}`));
      b.appendChild(el(doc, 'span', 'hlc-todo-text', item.missing));
      if (item.age_hours != null) {
        // AnciennetÃ© dÃ©rivÃ©e cÃ´tÃ© serveur (H4) ; alerte au-delÃ  du seuil fixÃ© par le serveur (48 h).
        const age = item.age_hours >= 48 ? `${Math.floor(item.age_hours / 24)} j` : `${item.age_hours} h`;
        const badge = el(doc, 'span', `hlc-todo-age${item.overdue ? ' is-overdue' : ''}`, item.overdue ? `âš  ${age}` : age);
        badge.setAttribute('data-hlc-age', String(item.age_hours));
        b.appendChild(badge);
      }
      b.addEventListener('click', () => { if (target) select(target.type, target.id); });
      todoBar.appendChild(b);
    });
    if (todo.length > PILLS) {
      const more = button(doc, state.todoAll ? 'RÃ©duire' : `+${todo.length - PILLS} autres`, 'todo-toggle', 'is-link');
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

    // â”€â”€ Colonne 1 : commandes importÃ©es, pavÃ©s par unitÃ© â”€â”€
    const left = column('orders', 'hlc-col-orders', '1 Â· Commandes importÃ©es', `${orders.length} commande(s)`);
    if (!orders.length) left.appendChild(el(doc, 'p', 'hlc-empty', 'Aucune commande import Ã  suivre sur ce marchÃ©.'));
    orders.forEach((order, index) => {
      const c = card('hlc-order', { 'data-hlc-order': order.id }, selKey === `order:${order.id}`, rel.orders.has(order.id), () => select('order', order.id));
      const head = el(doc, 'div', 'hlc-row');
      head.appendChild(el(doc, 'span', 'hlc-ref', order.reference));
      const relayMeta = el(doc, 'span', 'hlc-meta', `${marketCode} Â· ${order.relay_name || 'relais â€”'}`);
      if (order.relay_id) relayMeta.title = `Relais Â· identifiant technique : ${order.relay_id}`;
      head.appendChild(relayMeta);
      head.appendChild(el(doc, 'small', 'hlc-fifo', `Ordre dâ€™arrivÃ©e nÂ° ${index + 1}`));
      head.appendChild(el(doc, 'span', 'hlc-spacer'));
      const st = pill(order.status.label, order.status.tone);
      st.setAttribute('data-hlc-order-state', '');
      head.appendChild(st);
      c.appendChild(head);
      order.items.forEach((item) => {
        const row = el(doc, 'div', 'hlc-row hlc-line');
        row.setAttribute('data-hlc-item', item.id);
        row.appendChild(el(doc, 'span', 'hlc-line-label', `${item.product || 'Article'} Ã—${num(item.requested)}`));
        const pips = el(doc, 'span', 'hlc-pips');
        pips.setAttribute('role', 'img');
        pips.setAttribute('aria-label', `reÃ§u ${num(item.received)} sur ${num(item.requested)} Â· ${legend.filter((g) => item.unit_counts[g.state]).map((g) => `${item.unit_counts[g.state]} ${g.label}`).join(', ')}`);
        if (item.units.length <= MAX_PIPS) {
          item.units.forEach((u) => { const p = el(doc, 'span', `hlc-pip is-${u.state}`); p.title = u.label; pips.appendChild(p); });
        } else {
          pips.classList.add('is-bar');
          legend.filter((g) => item.unit_counts[g.state]).forEach((g) => {
            const seg = el(doc, 'span', `hlc-seg is-${g.state}`);
            seg.style.flexGrow = String(item.unit_counts[g.state]);
            seg.title = `${item.unit_counts[g.state]} Â· ${g.label}`;
            pips.appendChild(seg);
          });
          pips.appendChild(el(doc, 'small', 'hlc-bar-count', `${num(item.units.length)} u`));
        }
        row.appendChild(pips);
        row.appendChild(el(doc, 'span', 'hlc-where', `${item.where}${item.anomaly ? ` Â· Ã©cart ${num(item.anomaly)}` : ''}`));
        c.appendChild(row);
      });
      left.appendChild(c);
    });
    const leg = el(doc, 'div', 'hlc-legend');
    leg.setAttribute('aria-label', 'Signification des Ã©tats Â· lÃ©gende non interactive');
    leg.appendChild(el(doc, 'strong', 'hlc-legend-title', 'Signification des Ã©tats'));
    legend.forEach((g) => { const i = el(doc, 'span', 'hlc-legend-item'); i.appendChild(el(doc, 'span', `hlc-pip is-${g.state}`)); i.appendChild(doc.createTextNode(g.label)); leg.appendChild(i); });
    left.appendChild(leg);

    // â”€â”€ Colonne 2 : besoins non couverts puis PO â”€â”€
    const center = column('purchases', 'hlc-col-purchases', '2 Â· Besoins & PO fournisseurs', 'regroupÃ©s par fournisseur Ã— marchÃ©');
    if (needGroups.length || sourcingNeeds.length) center.appendChild(el(doc, 'span', 'hlc-label', 'Besoins non couverts'));
    needGroups.forEach(({ batch, group }) => {
      const c = card('hlc-need', { 'data-hlc-need': group.key }, selKey === `need:${group.key}`, rel.needs.has(group.key), () => select('need', group.key));
      const head = el(doc, 'div', 'hlc-row');
      const cb = doc.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-hlc-need-check', group.key);
      cb.setAttribute('aria-label', `SÃ©lectionner ${group.product || 'besoin'}`);
      cb.checked = state.picked.has(group.key);
      cb.disabled = readOnly;
      cb.addEventListener('click', (event) => event.stopPropagation());
      cb.addEventListener('change', () => { if (cb.checked) state.picked.add(group.key); else state.picked.delete(group.key); paint(); });
      head.appendChild(cb);
      head.appendChild(el(doc, 'strong', 'hlc-need-title', `${group.product || group.supplier_sku || 'Article'} â€” ${batch.supplier_name} Â· ${marketCode}${batch.procurement_hub_ref ? ' Â· Hub ' + batch.procurement_hub_ref : ''}`));
      head.appendChild(el(doc, 'span', 'hlc-spacer'));
      head.appendChild(el(doc, 'span', 'hlc-ref', `${num(group.quantity)} u`));
      c.appendChild(head);
      const chips = el(doc, 'div', 'hlc-row hlc-chips');
      group.lines.forEach((l) => chips.appendChild(el(doc, 'span', 'hlc-chip', `${l.order_ref} Ã—${num(l.quantity)}`)));
      chips.appendChild(el(doc, 'span', 'hlc-spacer'));
      chips.appendChild(el(doc, 'small', 'hlc-meta', 'compatibles : mÃªme fournisseur, SKU, marchÃ©'));
      c.appendChild(chips);
      center.appendChild(c);
    });
    sourcingNeeds.forEach((n) => {
      const c = card('hlc-need is-dashed', { 'data-hlc-need': n.key }, selKey === `need:${n.key}`, rel.needs.has(n.key), () => select('need', n.key));
      const head = el(doc, 'div', 'hlc-row');
      head.appendChild(el(doc, 'strong', 'hlc-need-title', `Sourcing requis â€” aucun fournisseur admissible Â· ${n.item.product || 'Article'}`));
      head.appendChild(el(doc, 'span', 'hlc-spacer'));
      head.appendChild(el(doc, 'span', 'hlc-ref', `${num(n.item.uncovered)} u`));
      c.appendChild(head);
      const chips = el(doc, 'div', 'hlc-row hlc-chips');
      chips.appendChild(el(doc, 'span', 'hlc-chip', `${n.order.reference} Ã—${num(n.item.uncovered)}`));
      chips.appendChild(el(doc, 'span', 'hlc-spacer'));
      chips.appendChild(el(doc, 'small', 'hlc-meta', 'ni ligne dâ€™achat ni fournisseur associÃ©'));
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
      if (po.simulation_scope === 'G6-BUYER') head.appendChild(el(doc, 'span', 'hlc-chip', 'SIMULATION STAGING Â· aucun fournisseur contactÃ©'));

      const eff = po.totals.effective || po.lines.reduce((t, l) => t + l.ordered, 0);
      const auth = `${po.authorizations.commitment ? 'engagement validÃ©' : 'engagement non validÃ©'} Â· ${po.authorizations.payment ? 'paiement autorisÃ©' : 'paiement non autorisÃ©'}`;
      head.appendChild(el(doc, 'small', 'hlc-meta', `${marketCode} Â· ${num(eff)} u Â· ${auth}`));
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
        li.title = partialHere ? `ReÃ§ue ${num(po.totals.received)} sur ${num(eff)} : reliquat attendu` : STEP_HELP[key];
        li.appendChild(el(doc, 'span', 'hlc-step-bar'));
        li.appendChild(el(doc, 'span', 'hlc-step-label', partialHere ? `ReÃ§ue ${num(po.totals.received)}/${num(eff)}` : (STEP_LABELS[key] || key)));
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
        const q = po.status === 'draft' ? `${num(l.ordered)} u` : `${num(l.received)}/${num(l.confirmed)} reÃ§u${l.missing > 0 ? ` Â· reliquat ${num(l.missing)}` : ''}`;
        row.appendChild(el(doc, 'span', `hlc-feed-qty${l.missing > 0 && l.received > 0 || (po.step.partial && l.missing > 0) ? ' is-warn' : l.missing === 0 && po.status !== 'draft' ? ' is-ok' : ''}`, q));
        row.appendChild(el(doc, 'small', `hlc-fifo${l.fifo_next ? ' is-next' : ''}`, `FIFO nÂ° ${l.fifo_rank || 'â€”'}${l.fifo_next ? ' Â· prochaine servie' : ''}`));
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
      center.appendChild(el(doc,'p','hlc-empty','Aucun PO en cours ; consulter lâ€™historique.'));
    if (!pos.length && !needGroups.length && !sourcingNeeds.length) center.appendChild(el(doc, 'p', 'hlc-empty', 'Aucun besoin ouvert ni PO sur ce marchÃ©.'));

    // â”€â”€ Colonne 3 : exÃ©cution physique â”€â”€
    const right = column('physical', 'hlc-col-physical', '3 Â· ExÃ©cution physique', 'Hub â†’ relais');
    physical.forEach((section) => {
      const block = el(doc, 'div', 'hlc-phys');
      block.setAttribute('data-hlc-phys', section.key);
      const title = el(doc, 'span',m«ëŒ+Š×ž®º+º$zzb¥âÒçVÖ&W"†ÖöæW’ççfÇVR“°¢&÷ræ6öæf—&ÖVEö7W'&Væ7’ÒÖöæW’æ2çfÇVRçG&–Ò‚’çFõWW$66R‚“°¢Ð¢&WGW&â&÷s°¢Ò“°¢–b†Æ–æW2ç6öÖR‚‡‚’ÓâçVÖ&W"æ—4–çFVvW"‡‚æ6öæf—&ÖVE÷VçF—G’’ÇÂ‚æ6öæf—&ÖVE÷VçF—G’Â’’²æ÷FRçFW‡D6öçFVçBÒuVçF—L:—26öæf—&Ü:–W2¢VçF–W'2÷6—F–g2÷RçVÇ2âs²&WGW&ã²Ð¢–b†Æ–æW2ç6öÖR‚‡‚’Óâ‚æ6öæf—&ÖVE÷Væ—E÷&–6RÓÒVæFVf–æVBb`¢‚‡‚æ6öæf—&ÖVE÷Væ—E÷&–6Râ’ÇÂõå´Õ¥×³7ÒBòçFW7B‡‚æ6öæf—&ÖVEö7W'&Væ7’’’’’°¢æ÷FRçFW‡D6öçFVçBÒu&—‚6öæf—&Ü:’÷6—F–bWBFWf—6Rö&Æ–vFö—&R÷W"ÆW2Æ–væW26ç2FWf—2f÷W&æ—76WW"âs²&WGW&ã°¢Ð¢–b†Æ–æW2ç6öÖR‚‡‚’Óâ‚æ6öæf—&ÖVE÷VçF—G’â’bb6öæf—&Õ&ööbçfÇVRçG&–Ò‚’æÆVæwF‚ÂB’²æ÷FRçFW‡D6öçFVçBÒt§W7F–f–6F–bN(	–6†Bö&Æ–vFö—&RƒB6&7L:‡&W2Ö–æ–×VÒ’âs²&WGW&ã²Ð¢ÆWBW†V7WF–öç3°¢–b†6öæf—&ÔW†V7WF–öç2æÆVæwF‚’°¢W†V7WF–öç2ÒµÓ°¢6öç7BÆÆö6FVBÒæWrÖ‚“°¢f÷"†6öç7BVçG'’öb6öæf—&ÔW†V7WF–öç2’°¢6öç7BW&6†6TÆ–æT–BÒVçG'’æÆ–æU6VÆV7BçfÇVS°¢6öç7B6VÆÆW$Æ&VÂÒVçG'’ç6VÆÆW$–çWBçfÇVRçG&–Ò‚“°¢6öç7BVçF—G’ÒçVÖ&W"†VçG'’çVçF—G”–çWBçfÇVR“°¢6öç7BÖ÷VçEfÇVRÒçVÖ&W"†VçG'’æÖ÷VçD–çWBçfÇVR“°¢6öç7B7W'&Væ7•fÇVRÒVçG'’æ7W'&Væ7”–çWBçfÇVRçG&–Ò‚’çFõWW$66R‚“°¢6öç7B&ööefÇVRÒVçG'’ç&ööd–çWBçfÇVRçG&–Ò‚“°¢–b‚Æ–æW2ç6öÖR‚†Æ–æR’ÓâÆ–æRçW&6†6UöÆ–æUö–BÓÓÒW&6†6TÆ–æT–BbbÆ–æRæ6öæf—&ÖVE÷VçF—G’â’’°¢æ÷FRçFW‡D6öçFVçBÒt6†VRÆÆö6F–öâFö—Bö–çFW"fW'2VæRÆ–væR6öæf—&Ü:–Râs²&WGW&ã°¢Ð¢–b‚6VÆÆW$Æ&VÂÇÂ6VÆÆW$Æ&VÂçFôÆ÷vW$66R‚’ÓÓÒvf÷W&æ—76WW"6VçG&Â‡V"rÇÀ¢çVÖ&W"æ—4–çFVvW"‡VçF—G’’ÇÂVçF—G’ÂÇÂ†Ö÷VçEfÇVRâ’ÇÀ¢õå´Õ¥×³7ÒBòçFW7B†7W'&Væ7•fÇVR’ÇÂ&ööefÇVRæÆVæwF‚ÂB’°¢æ÷FRçFW‡D6öçFVçBÒt6†VRÆÆö6F–öâW†–vRVâfVæFWW"ÂVæRVçF—L:’ÂVâÖöçFçBÂVæRFWf—6RWB6öâ§W7F–f–6F–bâs²&WGW&ã°¢Ð¢ÆÆö6FVBç6WB‡W&6†6TÆ–æT–BÂ†ÆÆö6FVBævWB‡W&6†6TÆ–æT–B’ÇÂ’²VçF—G’“°¢W†V7WF–öç2çW6‚‡²W&6†6UöÆ–æUö–C¢W&6†6TÆ–æT–BÂ6VÆÆW%öÆ&VÃ¢6VÆÆW$Æ&VÂÂ6†ææVÃ¢v–å÷W'6öârÂVçF—G’ÂÖ÷VçC¢Ö÷VçEfÇVRÂ7W'&Væ7“¢7W'&Væ7•fÇVRÂ&ööe÷&Vc¢&ööefÇVRÒ“°¢Ð¢f÷"†6öç7BÆ–æRöbÆ–æW2’°¢–b‚†ÆÆö6FVBævWB†Æ–æRçW&6†6UöÆ–æUö–B’ÇÂ’ÓÒÆ–æRæ6öæf—&ÖVE÷VçF—G’’°¢æ÷FRçFW‡D6öçFVçBÒtÆW2ÆÆö6F–öç2fVæFWW'2Fö—fVçB6÷Wg&—"W†7FVÖVçBÆVçF—L:’6öæf—&Ü:–RFR6†VRÆ–væRâs²&WGW&ã°¢Ð¢Ð¢ÒVÇ6R–b†Æ–æW2ç6öÖR‚‡‚’Óâ‚æ6öæf—&ÖVE÷VçF—G’â’bb6öæf—&Õ6VÆÆW"çfÇVRçG&–Ò‚’æÆVæwF‚Â"’°¢æ÷FRçFW‡D6öçFVçBÒt–æF—VW¢ÆRfVæFWW"fçBFR6öæf—&ÖW"Î(	–6†BÖçVVÂâs²&WGW&ã°¢Ð¢W†V7WFR‡7V&Ö—BÂ°¢W&Ã¢W&6†6–ær†òòG¶–GÒö6öæf—&Ö’À¢&öG“¢²Æ–æW2Ââââ‡7WÆ–W$÷&FW"çfÇVRçG&–Ò‚’ò²7WÆ–W%ö÷&FW%ö–C¢7WÆ–W$÷&FW"çfÇVRçG&–Ò‚’Ò¢·Ò’Ââââ†6öæf—&Õ&ööbçfÇVRçG&–Ò‚’ò²W&6†6U÷&ööe÷&Vc¢6öæf—&Õ&ööbçfÇVRçG&–Ò‚’Ò¢·Ò’Ââââ†W†V7WF–öç2ò²W†V7WF–öç2Ò¢†6öæf—&Õ6VÆÆW"çfÇVRçG&–Ò‚’ò²6VÆÆW%öÆ&VÃ¢6öæf—&Õ6VÆÆW"çfÇVRçG&–Ò‚’Ò¢·Ò’’Ââââ‡6–×VÆFVBò²6–×VÆFVC¢G'VRÒ¢·Ò’ÒÀ¢6öæf—&ÔÖW76vS¢6–×VÆFVBòt6öæf—&ÖW"ÆW2VçF—L:—2WBÎ(	–6†Bd”5D”e27W"7Fv–ærÂ6ç2f÷W&æ—76WW"æ’–VÖVçB,:–VÂòr¢tVç&Vv—7G&W"Æ6öæf—&ÖF–öâf÷W&æ—76WW"òF÷WFRVçF—L:’æöâ6öæf—&Ü:–R&VFWf–VçBVâ&W6ö–â÷WfW'BârÀ¢'Vææ–ætÖW76vS¢tVç&Vv—7G&VÖVçBFRÆ6öæf—&ÖF–öî(
brÂ7V66W74ÖW76vS¢6–×VÆFVBòt6öæf—&ÖF–öâWB6†Bf–7F–g2G&<:—2(	BV7Vâf÷W&æ—76WW"6öçF7L:’âr¢t6öæf—&ÖF–öâf÷W&æ—76WW"Vç&Vv—7G,:–RârÂöå7V66W73¢‚’Óâ²7FFRæf÷&ÒÒçVÆÃ²ÒÀ¢Ò“°¢Ð¢Ò“°¢&WGW&âf÷&Ó°¢Ð ¢òò)H)HææVR&2¢f–ÂFRÂvö&¦WB<:–ÆV7F–öæì:’²7F–öç2WF÷&—<:–W2)H)H ¢6öç7BæöFRÒ†¶–æBÂ&VbÂ7BÂFöæRÂF—FÆR’Óâ‡²¶–æBÂ&VbÂ7FFS¢7BÂFöæS¢FöæRÇÂrrÂF—FÆS¢F—FÆRÇÂrrÒ“°¢6öç7BDôäUôäôDRÒ²&C¢v&ÇVRçG&–Ò‚’æÆVæwF‚ÂB’²æ÷FRçFW‡D6öçFVçBÒt§W7F–f–6F–bN(	–6†Bö&Æ–vFö—&RƒB6&7L:‡&W2Ö–æ–×VÒ’âs²&WGW&ã²Ð¢ÆWBW†V7WF–öç3°¢–b†6öæf—&ÔW†V7WF–öç2æÆVæwF‚’°¢W†V7WF–öç2ÒµÓ°¢6öç7BÆÆö6FVBÒæWrÖ‚“°¢f÷"†6öç7BVçG'’öb6öæf—&ÔW†V7WF–öç2’°¢6öç7BW&6†6TÆ–æT–BÒVçG'’æÆ–æU6VÆV7BçfÇVS°¢6öç7B6VÆÆW$Æ&VÂÒVçG'’ç6VÆÆW$–çWBçfÇVRçG&–Ò‚“°¢6öç7BVçF—G’ÒçVÖ&W"†VçG'’çVçF—G”–çWBçfÇVR“°¢6öç7BÖ÷VçEfÇVRÒçVÖ&W"†VçG'’æÖ÷VçD–çWBçfÇVR“°¢6öç7B7W'&Væ7•fÇVRÒVçG'’æ7W'&Væ7”–çWBçfÇVRçG&–Ò‚’çFõWW$66R‚“°¢6öç7B&ööefÇVRÒVçG'’ç&ööd–çWBçfÇVRçG&–Ò‚“°¢–b‚Æ–æW2ç6öÖR‚†Æ–æR’ÓâÆ–æRçW&6†6UöÆ–æUö–BÓÓÒW&6†6TÆ–æT–BbbÆ–æRæ6öæf—&ÖVE÷VçF—G’â’’°¢æ÷FRçFW‡D6öçFVçBÒt6†VRÆÆö6F–öâFö—Bö–çFW"fW'2VæRÆ–væR6öæf—&Ü:–Râs²&WGW&ã°¢Ð¢–b‚6VÆÆW$Æ&VÂÇÂ6VÆÆW$Æ&VÂçFôÆ÷vW$66R‚’ÓÓÒvf÷W&æ—76WW"6VçG&Â‡V"rÇÀ¢çVÖ&W"æ—4–çFVvW"‡VçF—G’’ÇÂVçF—G’ÂÇÂ†Ö÷VçEfÇVRâ’ÇÀ¢õå´Õ¥×³7ÒBòçFW7B†7W'&Væ7•fÇVR’ÇÂ&ööefÇVRæÆVæwF‚ÂB’°¢æ÷FRçFW‡D6öçFVçBÒt6†VRÆÆö6F–öâW†–vRVâfVæFWW"ÂVæRVçF—L:’ÂVâÖöçFçBÂVæRFWf—6RWB6öâ§W7F–f–6F–bâs²&WGW&ã°¢Ð¢ÆÆö6FVBç6WB‡W&6†6TÆ–æT–BÂ†ÆÆö6FVBævWB‡W&6†6TÆ–æT–B’ÇÂ’²VçF—G’“°¢W†V7WF–öç2çW6‚‡²W&6†6UöÆ–æUö–C¢W&6†6TÆ–æT–BÂ6VÆÆW%öÆ&VÃ¢6VÆÆW$Æ&VÂÂ6†ææVÃ¢v–å÷W'6öârÂVçF—G’ÂÖ÷VçC¢Ö÷VçEfÇVRÂ7W'&Væ7“¢7W'&Væ7•fÇVRÂ&ööe÷&Vc¢&ööefÇVRÒ“°¢Ð¢f÷"†6öç7BÆ–æRöbÆ–æW2’°¢–b‚†ÆÆö6FVBævWB†Æ–æRçW&6†6UöÆ–æUö–B’ÇÂ’ÓÒÆ–æRæ6öæf—&ÖVE÷VçF—G’’°¢æ÷FRçFW‡D6öçFVçBÒtÆW2ÆÆö6F–öç2fVæFWW'2Fö—fVçB6÷Wg&—"W†7FVÖVçBÆVçF—L:’6öæf—&Ü:–RFR6†VRÆ–væRâs²&WGW&ã°¢Ð¢Ð¢ÒVÇ6R–b†Æ–æW2ç6öÖR‚‡‚’Óâ‚æ6öæf—&ÖVE÷VçF—G’â’bb6öæf—&Õ6VÆÆW"çfÇVRçG&–Ò‚’æÆVæwF‚Â"’°¢æ÷FRçFW‡D6öçFVçBÒt–æF—VW¢ÆRfVæFWW"fçBFR6öæf—&ÖW"Î(	–6†BÖçVVÂâs²&WGW&ã°¢Ð¢W†V7WFR‡7V&Ö—BÂ°¢W&Ã¢W&6†6–ær†òòG¶–GÒö6öæf—&Ö’À¢&öG“¢²Æ–æW2Ââââ‡7WÆ–W$÷&FW"çfÇVRçG&–Ò‚’ò²7WÆ–W%ö÷&FW%ö–C¢7WÆ–W$÷&FW"çfÇVRçG&–Ò‚’Ò¢·Ò’Ââââ†6öæf—&Õ&ööbçfÇVRçG&–Ò‚’ò²W&6†6U÷&ööe÷&Vc¢6öæf—&Õ&ööbçfÇVRçG&–Ò‚’Ò¢·Ò’Ââââ†W†V7WF–öç2ò²W†V7WF–öç2Ò¢†6öæf—&Õ6VÆÆW"çfÇVRçG&–Ò‚’ò²6VÆÆW%öÆ&VÃ¢6öæf—&Õ6VÆÆW"çfÇVRçG&–Ò‚’Ò¢·Ò’’Ââââ‡6–×VÆFVBò²6–×VÆFVC¢G'VRÒ¢·Ò’ÒÀ¢6öæf—&ÔÖW76vS¢6–×VÆFVBòt6öæf—&ÖW"ÆW2VçF—L:—2WBÎ(	–6†Bd”5D”e27W"7Fv–ærÂ6ç2f÷W&æ—76WW"æ’–VÖVçB,:–VÂòr¢tVç&Vv—7G&W"Æ6öæf—&ÖF–öâf÷W&æ—76WW"òF÷WFRVçF—L:’æöâ6öæf—&Ü:–R&VFWf–VçBVâ&W6ö–â÷WfW'BârÀ¢'Vææ–ætÖW76vS¢tVç&Vv—7G&VÖVçBFRÆ6öæf—&ÖF–öî(
brÂ7V66W74ÖW76vS¢6–×VÆFVBòt6öæf—&ÖF–öâWB6†Bf–7F–g2G&<:—2(	BV7Vâf÷W&æ—76WW"6öçF7L:’âr¢t6öæf—&ÖF–öâf÷W&æ—76WW"Vç&Vv—7G,:–RârÂöå7V66W73¢‚’Óâ²7FFRæf÷&ÒÒçVÆÃ²ÒÀ¢Ò“°¢Ð¢Ò“°¢&WGW&âf÷&Ó°¢Ð ¢òò)H)HææVR&2¢f–ÂFRÂvö&¦WB<:–ÆV7F–öæì:’²7F–öç2WF÷&—<:–W2)H)H ¢6öç7BæöFRÒ†¶–æBÂ&VbÂ7BÂFöæRÂF—FÆR’Óâ‡²¶–æBÂ&VbÂ7FFS¢7BÂFöæS¢FöæRÇÂrrÂF—FÆS¢F—FÆRÇÂrrÒ“°¢6öç7BDôäUôäôDRÒ²&C¢v&BrÂv&ã¢wv&ârÂö³¢vö²rÂFöæS¢vö²rÂ7C¢vöârÂÖ&W#¢wv&ârÂv—C¢rrÓ°¢gVæ7F–öâ&÷„æöFW2†÷&FW$–G2’°¢6öç7B÷WBÒµÓ°¢†Bæ&÷†W2ÇÂµÒ’æf–ÇFW"‚†"’Óâ&÷„÷&FW'2†"’ç6öÖR‚†–B’Óâ÷&FW$–G2æ–æ6ÇVFW2†–B’’’æf÷$V6‚‚†"’Óâ÷WBçW6‚†æöFR‚t4ôÔ$õ‚rÂ"ç&VfW&Væ6RÂ"ç6†—ÖVçE÷&VbòW‡:–F—F–öâG¶"ç6†—ÖVçE÷&VgÖ¢|:&GF6†W"rÂvö²r’’“°¢&WGW&â÷WC°¢Ð¢gVæ7F–öâÆ–æVvTf÷"‚’°¢ÆWBF—FÆRÒrs²ÆWB7V"Òrs²ÆWBæöFW2ÒµÓ²ÆWB&Æö6¶W"Òrs°¢–b‚6VÂ’&WGW&â²F—FÆS¢u<:–ÆV7F–öææW¢Vâ:–Ì:–ÖVçBrÂ7V#¢t6†ö—6—76W¢VâF÷76–W"ÂVâ&W6ö–â÷RVæRòFç2ÆW26öÆöææW2GR‡V"ârÂæöFW2Â&Æö6¶W"Ó°¢–b‡6VÂçG—RÓÓÒv÷&FW"r’°¢6öç7BòÒ÷&FW$'”–BævWB‡6VÂæ–B“°¢–b†ò’°¢F—FÆRÒòç&VfW&Væ6S²7V"ÒG¶Ö&¶WD6öFWÒ+rG¶òç&VÆ•öæÖRÇÂw&VÆ—2(	BwÖ°¢æöFW2çW6‚†æöFR‚t6öÖÖæFRrÂòç&VfW&Væ6RÂòç7FGW2æÆ&VÂÂDôäUôäôDU¶òç7FGW2çFöæUÒÇÂvöâr’“°¢òæ—FV×2æf÷$V6‚‚†’’ÓâæöFW2çW6‚†æöFR‚tÆ–væRrÂG¶’ç&öGV7GÒ9rG¶çVÒ†’ç&WVW7FVB—ÖÂ’çv†W&RÂ’çVæ6÷fW&VBâòv&Br¢÷&VÆ—VBòçFW7B†’çv†W&R’òwv&âr¢’æ6ö×ÆWFRòvö²r¢rr’’“°¢òçõö–G2æf÷$V6‚‚†–B’Óâ²6öç7BÒô'”–BævWB†–B“²–b‡’æöFW2çW6‚†æöFR‚uòrÂõ&Vb‡’Âç7FGW5÷f–WræÆ&VÂÂDôäUôäôDU·ç7FGW5÷f–WrçFöæUÒÇÂrr’“²Ò“°¢–b†òçF÷FÇ2ç&V6V—fVBâ’æöFW2çW6‚†æöFR‚u,:–6WF–öârÂG¶çVÒ†òçF÷FÇ2ç&V6V—fVB—ÒòG¶çVÒ†òçF÷FÇ2ç&WVW7FVB—ÖÂ6ö6·—BæÆÆö6F–öå÷'VÆRòtd”dò6öÖÖæFRÆÇW2æ6–VææRr¢rrÂòçF÷FÇ2ç&V6V—fVBãÒòçF÷FÇ2ç&WVW7FVBòvö²r¢wv&âr’“°¢æöFW2ÒæöFW2æ6öæ6B†&÷„æöFW2…¶òæ–EÒ’“°¢æöFW2çW6‚†æöFR‚u&VÆ—2rÂòç&VÆ•öæÖRÇÂ~(	BrÂ|:fVæ—"rÂrrÂòç&VÆ•ö–Bò&VÆ—2+r–FVçF–f–çBFV6†æ—VR¢G¶òç&VÆ•ö–GÖ¢rr’“°¢&Æö6¶W"Ò†òçF÷FÇ2çVæ6÷fW&VBâòu6÷W&6–ær&WV—2(	BV7Vâf÷W&æ—76WW"FÖ—76–&ÆRâr¢rr’²†òç&VF–æW72æ&Æö6¶W'2ÇÂµÒ’æ¦ö–â‚r+rr“°¢Ð¢ÒVÇ6R–b‡6VÂçG—RÓÓÒwòr’°¢6öç7BÒô'”–BævWB‡6VÂæ–B“°¢–b‡’°¢F—FÆRÒõ&Vb‡“²7V"ÒG·ç7WÆ–W%öæÖWÒ+rG¶Ö&¶WD6öFWÖ°¢æ÷&FW%ö–G2æf÷$V6‚‚†–B’Óâ²6öç7BòÒ÷&FW$'”–BævWB†–B“²6öç7BÇ2ÒæÆ–æW2æf–ÇFW"‚†Â’ÓâÂæ÷&FW%ö–BÓÓÒ–B“²–b†ò’æöFW2çW6‚†æöFR‚t6öÖÖæFRrÂòç&VfW&Væ6RÂÇ2æÖ‚†Â’ÓâG¶Âç&öGV7GÒ9rG¶çVÒ†Âæ÷&FW&VB—Ö’æ¦ö–â‚rÂr’Âvöâr’“²Ò“°¢æöFW2çW6‚†æöFR‚uòrÂõ&Vb‡’Âç7FGW5÷f–WræÆ&VÂÂDôäUôäôDU·ç7FGW5÷f–WrçFöæUÒÇÂvöâr’“°¢6öç7B&V7fBÒæÆ–æW2æf–ÇFW"‚†Â’ÓâÂç&V6V—fVBâ“°¢–b‡&V7fBæÆVæwF‚’æöFW2çW6‚†æöFR‚u,:–6WF–öârÂG¶çVÒ‡çF÷FÇ2ç&V6V—fVB—ÒòG¶çVÒ‡çF÷FÇ2æVffV7F—fR—ÖÂd”dò(i"G·&V7fBæÖ‚†Â’ÓâG¶Âæ÷&FW%÷&VgÒ9rG¶çVÒ†Âç&V6V—fVB—Ö’æ¦ö–â‚rÂr—ÖÂçF÷FÇ2æÖ—76–ærâòwv&âr¢vö²r’“°¢æöFW2ÒæöFW2æ6öæ6B†&÷„æöFW2‡æ÷&FW%ö–G2’“°¢6öç7Bv—F–ærÒæÆ–æW2æf–ÇFW"‚†Â’ÓâÂæÖ—76–ærâbbç7FGW2ÓÒvG&gBr“°¢–b‡ç7FGW2ÓÓÒvG&gBrbbæWF†÷&—¦F–öç2æ6öÖÖ—FÖVçB’&Æö6¶W"ÒvÎ(	–VævvVÖVçBN(	–6†BFö—B:§G&RfÆ–L:’"Æ&W7öç6&ÆR‡V"fçB6÷VÖ—76–öââs°¢VÇ6R–b‡ç7FGW2ÓÓÒvG&gBr’&Æö6¶W"ÒvVævvVÖVçBfÆ–L:’¢ÆòFö—BVæ6÷&R:§G&R6÷VÖ—6RV—26öâVçfö’,:–VÂVç&Vv—7G,:’âs°¢VÇ6R–b‡v—F–æræÆVæwF‚bbçF÷FÇ2ç&V6V—fVBâ’&Æö6¶W"ÒG¶çVÒ‡çF÷FÇ2æÖ—76–ær—ÒRÖçVçFR‡2’¢G·v—F–æræÖ‚†Â’ÓâG¶Âæ÷&FW%÷&VgÒ&W7FRVâ&VÆ—VB‚G¶çVÒ†ÂæÖ—76–ær—Ò–’æ¦ö–â‚rÂr—ÒFçBVRÆRf÷W&æ—76WW"î(	–2Æ—g,:’æ°¢VÇ6R–b‡ç7FGW2ÓÒvG&gBrbbæWF†÷&—¦F–öç2æ6öÖÖ—FÖVçBbbæWF†÷&—¦F–öç2ç–ÖVçB’&Æö6¶W"ÒvÆR–VÖVçBf÷W&æ—76WW"&W7FRVæRL:–6—6–öâF—7F–æ7FRFRÎ(	–VævvVÖVçB‡&W7öç6&ÆR‡V"’âs°¢Ð¢ÒVÇ6R–b‡6VÂçG—RÓÓÒvæVVBr’°¢6öç7BrÒæVVDw&÷W2æf–æB‚‡‚’Óâ‚æw&÷Wæ¶W’ÓÓÒ6VÂæ–B“°¢6öç7B2Ò6÷W&6–ætæVVG2æf–æB‚‡‚’Óâ‚æ¶W’ÓÓÒ6VÂæ–B“°¢–b†r’°¢F—FÆRÒ&W6ö–âG¶ræw&÷Wç&öGV7BÇÂv'F–6ÆRwÖ²7V"ÒG¶ræ&F6‚ç7WÆ–W%öæÖWÒ+rG¶Ö&¶WD6öFWÒ+rG¶çVÒ†ræw&÷WçVçF—G’—ÒV°¢ræw&÷WæÆ–æW2æf÷$V6‚‚†Â’ÓâæöFW2çW6‚†æöFR‚t6öÖÖæFRrÂÂæ÷&FW%÷&VbÂ9rG¶çVÒ†ÂçVçF—G’—ÖÂvöâr’’“°¢æöFW2çW6‚†æöFR‚u&Vw&÷WVÖVçBrÂG¶çVÒ†ræw&÷WçVçF—G’—ÒVÂvÜ:¦ÖR4µR+rÜ:¦ÖRÖ&6Œ:’rÂvöâr’ÂæöFR‚uòrÂ|:6öç7F—GVW"rÂv'&÷V–ÆÆöârÂrr’“°¢ÒVÇ6R–b‡2’°¢F—FÆRÒ&W6ö–âG·2æ—FVÒç&öGV7BÇÂv'F–6ÆRwÖ²7V"ÒG·2æ÷&FW"ç&VfW&Væ6WÒ+rG¶Ö&¶WD6öFWÒ+rG¶çVÒ‡2æ—FVÒçVæ6÷fW&VB—ÒV°¢æöFW2Ò¶æöFR‚t6öÖÖæFRrÂ2æ÷&FW"ç&VfW&Væ6RÂ2æ÷&FW"ç7FGW2æÆ&VÂÂvöâr’ÂæöFR‚t&W6ö–ârÂG·2æ—FVÒç&öGV7GÒ9rG¶çVÒ‡2æ—FVÒçVæ6÷fW&VB—ÖÂw6ç2Æ–væRN(	–6†BrÂwv&âr’ÂæöFR‚tf÷W&æ—76WW"rÂ~(	BrÂvV7VâFÖ—76–&ÆRrÂwv&âr’ÂæöFR‚uòrÂ~(	BrÂv–×÷76–&ÆRrÂrr•Ó°¢&Æö6¶W"Òu6÷W&6–ær&WV—2(	BV7Vâf÷W&æ—76WW"FÖ—76–&ÆR¢V7VæRò÷76–&ÆRâs°¢Ð¢ÒVÇ6R–b‡6VÂçG—RÓÓÒv&÷‚r’°¢6öç7B"Ò†Bæ&÷†W2ÇÂµÒ’æf–æB‚‡‚’Óâ‚çVæ—Eö–BÓÓÒ6VÂæ–B“°¢–b†"’°¢F—FÆRÒ"ç&VfW&Væ6S²7V"Ò4ôÔ$õ‚+rG¶"ç7FFWÖ°¢æöFW2Ò¶æöFR‚t6öÖÖæFW2rÂ²ââææWr6WB‚†"æ6öçFVçG2ÇÂµÒ’æÖ‚†2’Óâ2æ÷&FW%÷&Vb’•Òæ¦ö–â‚rÂr’ÇÂ~(	BrÂv'F–6ÆW2G&<:—2Fç2Æ4ôÔ$õ‚rÂvö²r’ÂæöFR‚t4ôÔ$õ‚rÂ"ç&VfW&Væ6RÂ‡VÖå‡—6–6Å7FFR†"ç7FFR’Âvöâr’ÂæöFR‚tW‡:–F—F–öârÂ"ç6†—ÖVçE÷&VbÇÂ~(	BrÂ"ç6†—ÖVçE÷&Vbò†"ç6†—ÖVçE÷7FvRÇÂv÷WfW'FRr’¢|:&GF6†W"rÂ"ç6†—ÖVçE÷&Vbòvö²r¢rr’ÂæöFR‚u&VÆ—2rÂ~(	BrÂvGFW7FF–öâ:Æ,:–6WF–öârÂrr•Ó°¢Ð¢Ð¢&WGW&â²F—FÆS¢F—FÆRÇÂ6VÄ¶W’Â7V"ÂæöFW2Â&Æö6¶W"Ó°¢Ð ¢òò7F–öç2¢WŒ:–7WFVçBÆ&÷WFR,:–VÆÆR²–×÷76–&ÆW2(i"L:—67F—l:–W2dT2Æ&—6öâ†¦Ö—2Ö7\:–W26ç2W‡Æ–6F–öâ’à¢gVæ7F–öâ7F–öç4f÷"‚’°¢6öç7B7G2ÒµÓ°¢6öç7BÒ†¶W’ÂÆ&VÂÂò’Óâ7G2çW6‚‡²¶W’ÂÆ&VÂÂâââ†òÇÂ·Ò’Ò“°¢6öç7BÆö6²Ò&VDöæÇ’òvÆV7GW&R6WVÆRr¢çVÆÃ°¢6öç7Bw&çBÒ†fÆrÂ&V6öâ’Óâ‡f–WvW"bbfÆròçVÆÂ¢&V6öâ“°¢–b‚6VÂ’&WGW&â7G3°¢–b‡6VÂçG—RÓÓÒvæVVBr’°¢6öç7BrÒæVVDw&÷W2æf–æB‚‡‚’Óâ‚æw&÷Wæ¶W’ÓÓÒ6VÂæ–B“°¢6öç7B2Ò6÷W&6–ætæVVG2æf–æB‚‡‚’Óâ‚æ¶W’ÓÓÒ6VÂæ–B“°¢–b‡2’°¢‚w&W6öÇfR×6÷W&6–ærrÂu,:—6÷VG&RÆR6÷W&6–ærò7,:–W"Vâ6†BÖçVVÂrÂ²&–Ö'“¢G'VRÂv‡“¢v6†ö—6—"f÷W&æ—76WW"WBÆ–væRN(	–6†BrÂF—6&ÆVC¢Æö6²Â'Vã¢‚’Óâ7G‚æ÷Vå6÷W&6–ær‡2æ÷&FW"æ–B’Ò“°¢‚w&W&R×òrÂt6öç7F—GVW"VâòrÂ²F—6&ÆVC¢v–×÷76–&ÆR6ç2f÷W&æ—76WW"rÒ“°¢ÒVÇ6R–b†r’°¢6öç7BÖ–æRÒræ&F6‚æw&÷W2æf–ÇFW"‚‡‚’Óâ7FFRç–6¶VBæ†2‡‚æ¶W’’“°¢6öç7B7&÷74&F6‚Ò²ââç7FFRç–6¶VEÒç6öÖR‚†²’Óâræ&F6‚æw&÷W2ç6öÖR‚‡‚’Óâ‚æ¶W’ÓÓÒ²’“°¢6öç7BW6RÒÖ–æRæÆVæwF‚òÖ–æR¢¶ræw&÷WÓ°¢6öç7BÆ–æT–G2ÒW6RæfÆDÖ‚‡‚’Óâ‚æÆ–æW2æÖ‚†Â’ÓâÂæÆ–æUö–B’“°¢6öç7BG’ÒW6Rç&VGV6R‚‡BÂ‚’ÓâB²‚çVçF—G’Â“°¢‚w&W&R×òrÂ6öç7F—GVW"VæRò+rG¶çVÒ‡G’—ÒR‚G·W6RæÖ‚‡‚’Óâ‚ç&öGV7BÇÂv'F–6ÆRr’æ¦ö–â‚r²r—Ò–Â°¢&–Ö'“¢G'VRÂv‡“¢w&Vw&÷WRÆW2&W6ö–ç26ö6Œ:—2rÂF—6&ÆVC¢Æö6²ÇÂ†7&÷74&F6‚òwVâ6WVÂf÷W&æ—76WW"WBÖ&6Œ:’"òr¢çVÆÂ’À¢'Vã¢†"’Óâ&W&T&F6‚†"Âræ&F6‚ÂÆ–æT–G2ÂçVÆÂ’À¢Ò“°¢òòVæRÜ:¦ÖR,:–l:—&Væ6Rf÷W&æ—76WW"õ4µRWWB&Vw&÷WW"ÇW6–WW'26öÖÖæFW2à¢òòÆR‡V"Fö—BW76’÷Wfö—"6öç7F—GVW"VæRò÷W"TäR6öÖÖæFR6ç0¢òò&GF6†W"6–ÆVæ6–WW6VÖVçBÆW2Æ–væW2FW2WG&W26öÖÖæFW2à¢6öç7B'”÷&FW"ÒæWrÖ‚“°¢f÷"†6öç7BÆ–æRöbræw&÷WæÆ–æW2’°¢–b‚Æ–æRæ÷&FW%ö–BÇÂÆ–æRæ÷&FW%÷&VbÇÂÆ–æRæÆ–æUö–B’6öçF–çVS°¢–b‚'”÷&FW"æ†2†Æ–æRæ÷&FW%ö–B’’'”÷&FW"ç6WB†Æ–æRæ÷&FW%ö–BÂ²&Vc¢Æ–æRæ÷&FW%÷&VbÂ–G3¢µÒÒ“°¢'”÷&FW"ævWB†Æ–æRæ÷&FW%ö–B’æ–G2çW6‚†Æ–æRæÆ–æUö–B“°¢Ð¢–b†'”÷&FW"ç6—¦Râ’°¢f÷"†6öç7B¶÷&FW$–BÂ÷&FW$Æ–æW5Òöb'”÷&FW"’°¢‚w&W&R×òÖ÷&FW"Òr²÷&FW$–BÀ¢6öç7F—GVW"VæRò+r6öÖÖæFRG¶÷&FW$Æ–æW2ç&VgÒ‚G¶÷&FW$Æ–æW2æ–G2æÆVæwF‡ÒÆ–væR‡2’–Â°¢v‡“¢wVæ—VVÖVçBÆW2Æ–væW2FR6WGFR6öÖÖæFR²WG&W26öÖÖæFW2–æ6†æ|:–W2rÀ¢F—6&ÆVC¢Æö6²À¢'Vã¢†"’Óâ&W&T&F6‚†"Âræ&F6‚Â÷&FW$Æ–æW2æ–G2ÂçVÆÂ’À¢Ò“°¢Ð¢Ð¢–b†ræ&F6‚æ6ö×F–&ÆUöG&gE÷õö–G2æÆVæwF‚’°¢ræ&F6‚æ6ö×F–&ÆUöG&gE÷õö–G2æf÷$V6‚‚†–B’Óâ†GF6‚×òÒG¶–GÖÂ¦÷WFW"R'&÷V–ÆÆöâG·õ&Vb‡ô'”–BævWB†–B’ÇÂ²–BÒ—ÖÂ²v‡“¢vÜ:¦ÖRf÷W&æ—76WW"+r‡V"+rÖ&6Œ:’rÂF—6&ÆVC¢Æö6²ÇÂ†7&÷74&F6‚òwVâ6WVÂf÷W&æ—76WW"WBÖ&6Œ:’"òr¢çVÆÂ’Â'Vã¢†"’Óâ&W&T&F6‚†"Âræ&F6‚ÂÆ–æT–G2Â–B’Ò’“°¢ÒVÇ6R‚vGF6‚×òrÂt¦÷WFW":Vâò'&÷V–ÆÆöâW†—7FçBrÂ²F—6&ÆVC¢vV7Vâ'&÷V–ÆÆöâ6ö×F–&ÆRrÒ“°¢Ð¢ÒVÇ6R–b‡6VÂçG—RÓÓÒwòr’°¢6öç7BòÒô'”–BævWB‡6VÂæ–B“°¢–b‡ò’°¢6öç7BG&gBÒòç7FWæ¶W’ÓÓÒvG&gBs°¢6öç7BVfbÒòçF÷FÇ2æVffV7F—fRÇÂ°¢–b†G&gB’°¢‚vWF†÷&—¦RÖ6öÖÖ—FÖVçBrÂufÆ–FW"Î(	–VævvVÖVçBN(	–6†BrÂ²&–Ö'“¢G'VRÂv‡“¢vG&ö—BW&6†6Uö6öÖÖ—FÖVçBrÂF—6&ÆVC¢Æö6²ÇÂw&çB‡f–WvW"bbf–WvW"æ6åöWF†÷&—¦Uö6öÖÖ—FÖVçBÂw,:—6W'l:’:Æ&W7öç6&ÆR‡V"r’Â'Vã¢‚’Óâ÷Väf÷&Ò‚v6öÖÖ—FÖVçBrÂòæ–B’Ò“°¢‚vFWF6‚ÖÆ–æRrÂu&WF—&W"VæRÆ–væRrÂ²v‡“¢vÆÆ–væR&VFWf–VçBVâ&W6ö–â÷WfW'BrÂF—6&ÆVC¢Æö6²Â'Vã¢‚’Óâ÷Väf÷&Ò‚vFWF6‚rÂòæ–B’Ò“°¢Ð¢–b‚&VDöæÇ’bbòæWF†÷&—¦F–öç2æ6öÖÖ—FÖVçCòçFeöf–Æ&ÆR’°¢‚vF÷væÆöBÖ6öÖÖ—FÖVçB×FbrÂuL:–Ì:–6†&vW"ÆR&öâFR6öÖÖæFRDbrÂ°¢‡&Vc¢ö’÷W&6†6–ær÷òòG¶Væ6öFUU$”6ö×öæVçB‡òæ–B—Òö6öÖÖ—FÖVçB×FfÀ¢v‡“¢wW6vR–çFW&æR‡V"rÀ¢Ò“°¢Ð¢–b‡òç7FWæ¶W’ÓÓÒwfÆ–FF–öâr’‚w7V&Ö—B×òrÂu6÷VÖWGG&RÆòrÂ²&–Ö'“¢G'VRÂv‡“¢w&–Vâî(	–W7BVæ6÷&RVçf÷œ:’rÂF—6&ÆVC¢Æö6²Â'Vã¢†"’Óâ7V&Ö—Eò†"Âòæ–B’Ò“°¢–b‡òç7FWæ¶W’ÓÓÒvVævvVBr’‚w&V6÷&B×6VçBrÂtVç&Vv—7G&W"Î(	–Vçfö’f÷W&æ—76WW"rÂ²&–Ö'“¢G'VRÂv‡“¢v6æÂ,:–VÂÂWFWW"Â†WW&RrÂF—6&ÆVC¢Æö6²Â'Vã¢‚’Óâ÷Väf÷&Ò‚w6VçBrÂòæ–B’Ò“°¢–b‡òç7FGW2ÓÓÒvæ÷F–f–VBrbbòç6VçEöB’‚v6öæf—&Ò×òrÂt6öæf—&ÖF–öâf÷W&æ—76WW"rÂ²v‡“¢wVçF—L:—26öæf—&Ü:–W2†L:–6Æ&F–b’rÂF—6&ÆVC¢Æö6²Â'Vã¢‚’Óâ÷Väf÷&Ò‚v6öæf—&ÒrÂòæ–B’Ò“°¢–b‚G&gB’‚w&V6V—fRrÂu,:–6WF–öææW"VæRÆ—g&—6öârÂ²&–Ö'“¢òçF÷FÇ2æÖ—76–ærâÂv‡“¢w66âWBVçF—L:’&\:wVRrÂF—6&ÆVC¢Æö6²ÇÂ‡òçF÷FÇ2æÖ—76–ærâòçVÆÂ¢uò6öÆL:–Rr’Â'Vã¢‚’Óâ÷Väf÷&Ò‚w&V6V—fRrÂòæ–B’Ò“°¢VÇ6R‚w&V6V—fRrÂu,:–6WF–öææW"VæRÆ—g&—6öârÂ²F—6&ÆVC¢uòVæ6÷&RVâ'&÷V–ÆÆöârÒ“°¢–b‚G&gBbbòæWF†÷&—¦F–öç2ç–ÖVçB’‚vWF†÷&—¦R×–ÖVçBrÂtWF÷&—6W"ÆR–VÖVçBf÷W&æ—76WW"rÂ²v‡“¢vL:–6—6–öâF—7F–æ7FRFRÎ(	–VævvVÖVçBrÂF—6&ÆVC¢Æö6²ÇÂ‚òæWF†÷&—¦F–öç2æ6öÖÖ—FÖVçBòv,:‡2VævvVÖVçBWBVçfö’r¢w&çB‡f–WvW"bbf–WvW"æ6åöWF†÷&—¦U÷–ÖVçBÂw,:—6W'l:’:Æ&W7öç6&ÆR‡V"r’’Â'Vã¢‚’Óâ÷Väf÷&Ò‚w–ÖVçBrÂòæ–B’Ò“°¢VÇ6R–b†G&gB’‚vWF†÷&—¦R×–ÖVçBrÂtWF÷&—6W"ÆR–VÖVçBf÷W&æ—76WW"rÂ²F—6&ÆVC¢v,:‡2VævvVÖVçBWBVçfö’rÒ“°¢fö–BVfc°¢Ð¢ÒVÇ6R–b‡6VÂçG—RÓÓÒv÷&FW"r’°¢6öç7BòÒ÷&FW$'”–BævWB‡6VÂæ–B“°¢–b†ò’°¢–b†òçF÷FÇ2çVæ6÷fW&VBâ’‚w&W6öÇfR×6÷W&6–ærrÂu,:—6÷VG&RÆR6÷W&6–ærò7,:–W"Vâ6†BÖçVVÂrÂ²&–Ö'“¢G'VRÂv‡“¢v6†ö—6—"f÷W&æ—76WW"WBÆ–væRN(	–6†BrÂF—6&ÆVC¢Æö6²Â'Vã¢‚’Óâ7G‚æ÷Vå6÷W&6–ær†òæ–B’Ò“°¢6öç7B"Òòç&VF–æW73°¢–b‡"çVæ&÷†VE÷&V6V—fVBâ’‚w&W&RÖ6öÖ&÷‚rÂu,:—'F—"ÆW2'F–6ÆW2Vâ4ôÔ$õ‚rÂ²&–Ö'“¢G'VRÂv‡“¢v6†ö—6—"VæR4ôÔ$õ‚WB66