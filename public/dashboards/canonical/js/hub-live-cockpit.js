/**
 * @komerce-arch
 * @role          canonical-hub-live-cockpit-flux-du-besoin
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        hub_procurement_dossier_cockpit, viewer_rights, receivable_purchase_orders
 * @outputs       hub_live_cockpit_dom, authorized_action_requests
 * @depends       operations-workspace (runAction, reception card, sourcing form)
 * @used-by       public/dashboards/canonical/js/operations-workspace.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      une_seule_source_de_verite_serveur, aucun_calcul_metier_navigateur, action_impossible_masquee_ou_desactivee_avec_raison, idempotence_ui_desactivation_pendant_requete
 * @impact-areas  admin-dashboard, hub, purchasing, logistics
 * @version       2026-11-hub-live-cockpit-c
 */
'use strict';

// Hub Live concept C — « flux du besoin » : Commandes et besoins → Achats et PO → Suivi physique.
// Le navigateur ne calcule aucune vérité métier : quantités, étapes, droits et « À faire maintenant »
// viennent de GET /market/:code/supply (section cockpit). Les gestes appellent les routes existantes
// (/api/purchasing/* et /api/admin/workspaces/operations/*) ; jamais /api/hub/*.
(function initHubLiveCockpit(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceHubLiveCockpit = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createHubLiveCockpit() {
  const STEP_LABELS = Object.freeze({ draft: 'Brouillon', validation: 'Validation', engaged: 'Engagé', sent: 'Envoyé / expédié', received: 'Reçu' });
  const OWNER_LABELS = Object.freeze({ agent_hub: 'Agent Hub', responsable_hub: 'Responsable Hub' });
  const CHANNELS = Object.freeze([['email', 'E-mail'], ['whatsapp', 'WhatsApp'], ['phone', 'Téléphone'], ['api', 'API'], ['other', 'Autre']]);
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const num = (v) => nf.format(Number(v) || 0);
  const short = (v) => String(v || '').slice(0, 8);

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

  function render(host, ctx) {
    const doc = ctx.document;
    const d = ctx.dossier;
    const cockpit = d.cockpit || {};
    const viewer = cockpit.viewer || null;
    const state = ctx.state;
    const orders = [...(d.orders || [])].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const pos = (d.purchase_orders || []).filter((p) => p.status !== 'cancelled');
    const batches = cockpit.need_batches || [];
    const todo = cockpit.todo || [];
    const readOnly = ctx.isReadOnly;
    if (!state.picked) state.picked = new Set();

    host.replaceChildren();
    const rootEl = el(doc, 'div', 'hlc');
    rootEl.setAttribute('data-hub-cockpit', '');
    host.appendChild(rootEl);

    // ── Actions : un seul point d'exécution, désactivé pendant la requête, état incertain → recharger et vérifier.
    async function execute(btn, options) {
      try {
        return await ctx.act(btn, options);
      } catch (error) {
        if (!error || !error.status) {
          ctx.feedback('Réponse réseau incertaine : l’opération a peut-être été appliquée. Rechargement de l’état, vérifiez avant de recommencer.', 'critical');
          ctx.reload().catch(() => {});
        }
        return null;
      }
    }
    const purchasing = (path) => `/api/purchasing/${path}`;

    function selectPo(id) { state.sel = { type: 'po', id }; applySelection(); const node = rootEl.querySelector(`[data-hlc-po="${id}"]`); if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' }); }
    function selectOrder(id) { state.sel = { type: 'order', id }; applySelection(); const node = rootEl.querySelector(`[data-hlc-order="${id}"]`); if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' }); }
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

    function runTodo(btn, item) {
      const a = item.action || {};
      if (a.type === 'resolve_sourcing') return ctx.openSourcing(a.order_id);
      if (a.type === 'open_physical') return ctx.openPhysical();
      if (a.type === 'prepare_po') {
        const batch = batches.find((b) => b.key === a.batch_key);
        if (!batch) return null;
        return prepareBatch(btn, batch, batch.groups.flatMap((g) => g.lines.map((l) => l.line_id)), batch.compatible_draft_po_ids[0] || null);
      }
      if (['authorize_commitment', 'authorize_payment', 'record_sent', 'confirm_po', 'receive'].includes(a.type)) {
        return openForm({ authorize_commitment: 'commitment', authorize_payment: 'payment', record_sent: 'sent', confirm_po: 'confirm', receive: 'receive' }[a.type], a.po_id);
      }
      if (a.type === 'submit_po') return submitPo(btn, a.po_id);
      if (a.type === 'create_bag') return createBag(btn, orders.find((o) => o.id === a.order_id), false);
      if (a.type === 'close_bag') return closeBag(btn, a.bag_unit_id);
      return null;
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

    // ── 1. À faire maintenant ──
    const todoSection = el(doc, 'section', 'hlc-todo');
    todoSection.setAttribute('data-hlc-todo', '');
    const todoHead = el(doc, 'header', 'hlc-todo-head');
    todoHead.appendChild(el(doc, 'h2', '', 'À faire maintenant'));
    todoHead.appendChild(el(doc, 'span', 'hlc-count', `${todo.length} action(s)${viewer ? ` · vous : ${viewer.role === 'admin' ? 'Admin central' : 'Agent Hub'}` : ''}`));
    todoSection.appendChild(todoHead);
    if (!todo.length) todoSection.appendChild(el(doc, 'p', 'hlc-empty', 'Rien à traiter : toutes les commandes import suivent leur cours.'));
    const visible = state.todoAll ? todo : todo.slice(0, 4);
    visible.forEach((item) => {
      const row = el(doc, 'article', 'hlc-todo-item');
      row.setAttribute('data-hlc-todo-item', item.kind);
      row.setAttribute('data-owner', item.owner);
      const copy = el(doc, 'div', 'hlc-todo-copy');
      copy.appendChild(el(doc, 'strong', '', item.missing));
      copy.appendChild(el(doc, 'span', 'hlc-why', item.why));
      copy.appendChild(el(doc, 'small', 'hlc-who', `Qui agit : ${OWNER_LABELS[item.owner] || item.owner}`));
      row.appendChild(copy);
      const actions = el(doc, 'div', 'hlc-todo-actions');
      const b = button(doc, item.action.label, `todo-${item.action.type}`, 'is-primary');
      const reason = readOnly ? 'Lecture seule : ouvrir Hub live · Exécution pour agir.' : (item.viewer_can_act === false ? item.blocked_reason : null);
      gated(doc, actions, b, reason);
      if (!reason) b.addEventListener('click', () => { runTodo(b, item); });
      row.appendChild(actions);
      todoSection.appendChild(row);
    });
    if (todo.length > 4) {
      const more = button(doc, state.todoAll ? 'Réduire' : `Voir les ${todo.length - 4} autres actions`, 'todo-toggle', 'is-link');
      more.addEventListener('click', () => { state.todoAll = !state.todoAll; paint(); });
      todoSection.appendChild(more);
    }
    rootEl.appendChild(todoSection);

    // ── 2. Trois zones ──
    const grid = el(doc, 'div', 'hlc-grid');
    rootEl.appendChild(grid);

    // Zone gauche : commandes et besoins.
    const left = el(doc, 'section', 'hlc-zone hlc-zone-orders');
    left.setAttribute('data-hlc-zone', 'orders');
    left.appendChild(el(doc, 'h3', 'hlc-zone-title', 'Commandes et besoins'));
    left.appendChild(el(doc, 'p', 'hlc-zone-hint', 'Demandé, couvert par un PO, reçu au Hub et restant à livrer — par commande, du plus ancien au plus récent.'));
    if (!orders.length) left.appendChild(el(doc, 'p', 'hlc-empty', 'Aucune commande d’import à traiter pour ce marché.'));
    orders.forEach((order, index) => {
      const t = order.totals;
      const r = order.readiness;
      const card = el(doc, 'article', 'hlc-card hlc-order');
      card.setAttribute('data-hlc-order', order.id);
      card.tabIndex = 0;
      card.setAttribute('aria-label', `Commande ${order.reference}`);
      const head = el(doc, 'header', 'hlc-card-head');
      head.appendChild(el(doc, 'strong', '', order.reference));
      head.appendChild(el(doc, 'small', 'hlc-fifo', `n° ${index + 1} FIFO`));
      const chipText = t.uncovered > 0 ? 'Sourcing requis' : r.ready_to_pack ? 'Prête à emballer' : r.complete ? (r.bag_open ? 'Sac en cours' : 'Complète') : r.partial ? 'Partiellement reçue' : 'En attente';
      const chip = el(doc, 'span', `hlc-chip ${t.uncovered > 0 ? 'is-critical' : r.ready_to_pack ? 'is-ok' : r.partial ? 'is-warn' : ''}`, chipText);
      chip.setAttribute('data-hlc-order-state', '');
      head.appendChild(chip);
      card.appendChild(head);
      card.appendChild(bar(doc, [['is-received', t.received], ['is-covered', Math.max(0, t.covered - t.received)], ['is-uncovered', t.uncovered]], t.requested,
        `Reçu ${t.received}, couvert non reçu ${Math.max(0, t.covered - t.received)}, non couvert ${t.uncovered} sur ${t.requested} demandé(s)`));
      const nums = el(doc, 'p', 'hlc-nums');
      [['demandé', t.requested], ['couvert', t.covered], ['non couvert', t.uncovered], ['reçu', t.received], ['reste à livrer', t.remaining]].forEach(([k, v]) => {
        const s = el(doc, 'span', 'hlc-num');
        s.appendChild(el(doc, 'b', '', num(v)));
        s.appendChild(document_text(doc, ` ${k}`));
        nums.appendChild(s);
      });
      card.appendChild(nums);
      const lines = el(doc, 'ul', 'hlc-items');
      order.items.forEach((item) => {
        const li = el(doc, 'li', 'hlc-item');
        li.setAttribute('data-hlc-item', item.id);
        li.appendChild(el(doc, 'span', 'hlc-item-name', item.product || 'Article'));
        li.appendChild(el(doc, 'span', `hlc-item-q${item.complete ? ' is-complete' : ''}`,
          `reçu ${num(item.received)}/${num(item.requested)}${item.uncovered ? ` · non couvert ${num(item.uncovered)}` : ''}${item.anomaly ? ` · écart ${num(item.anomaly)}` : ''}`));
        lines.appendChild(li);
      });
      card.appendChild(lines);
      const chips = el(doc, 'div', 'hlc-po-links');
      order.po_ids.forEach((id) => {
        const po = pos.find((p) => p.id === id);
        if (!po) return;
        const link = button(doc, `${po.supplier_name} · ${STEP_LABELS[po.step.key] || po.step.key}`, 'goto-po', 'is-link');
        link.setAttribute('data-hlc-goto-po', id);
        link.addEventListener('click', (event) => { event.stopPropagation(); selectPo(id); });
        chips.appendChild(link);
      });
      if (chips.children.length) card.appendChild(chips);
      if (!readOnly) {
        const acts = el(doc, 'div', 'hlc-card-actions');
        if (t.uncovered > 0) {
          const b = button(doc, 'Résoudre le sourcing', 'resolve-sourcing');
          b.addEventListener('click', (event) => { event.stopPropagation(); ctx.openSourcing(order.id); });
          acts.appendChild(b);
        }
        if (r.ready_to_pack) {
          const b = button(doc, 'Créer le sac client', 'create-bag', 'is-primary');
          b.addEventListener('click', (event) => { event.stopPropagation(); createBag(b, order, false); });
          acts.appendChild(b);
        } else if (r.partial && r.unbagged_received > 0 && !r.bag_open) {
          const b = button(doc, 'Préparation partielle…', 'create-partial-bag');
          b.title = 'Geste explicite : seules les unités déjà reçues partent dans le sac.';
          b.addEventListener('click', (event) => { event.stopPropagation(); createBag(b, order, true); });
          acts.appendChild(b);
          acts.appendChild(el(doc, 'small', 'hlc-reason', 'Pas prête à emballer : ' + r.blockers.slice(-1)[0]));
        } else if (!r.complete && r.blockers.length) {
          acts.appendChild(el(doc, 'small', 'hlc-reason', 'Pas prête à emballer : ' + r.blockers.slice(-1)[0]));
        }
        if (acts.children.length) card.appendChild(acts);
      }
      card.addEventListener('click', () => selectOrder(order.id));
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target === card) selectOrder(order.id); });
      left.appendChild(card);
    });
    grid.appendChild(left);

    // Zone centrale : achats et PO.
    const center = el(doc, 'section', 'hlc-zone hlc-zone-purchases');
    center.setAttribute('data-hlc-zone', 'purchases');
    center.appendChild(el(doc, 'h3', 'hlc-zone-title', 'Achats et PO'));
    center.appendChild(el(doc, 'p', 'hlc-zone-hint', `Besoins non couverts regroupables par fournisseur et marché ; une PO = un fournisseur, un marché. Réception : ${cockpit.allocation_rule || 'FIFO commande la plus ancienne'}.`));

    batches.forEach((batch) => {
      const card = el(doc, 'article', 'hlc-card hlc-batch');
      card.setAttribute('data-hlc-batch', batch.key);
      const head = el(doc, 'header', 'hlc-card-head');
      head.appendChild(el(doc, 'strong', '', `${batch.supplier_name} · ${d.market ? d.market.code : ctx.marketCode}${batch.procurement_hub_ref ? ' · Hub ' + batch.procurement_hub_ref : ''}`));
      head.appendChild(el(doc, 'span', 'hlc-chip is-warn', `${num(batch.quantity)} unité(s) à couvrir`));
      card.appendChild(head);
      const picked = state.picked;
      batch.groups.forEach((group) => {
        const label = el(doc, 'label', 'hlc-need');
        label.setAttribute('data-hlc-need', group.key);
        const cb = doc.createElement('input');
        cb.type = 'checkbox';
        cb.setAttribute('data-hlc-need-check', group.key);
        cb.checked = picked.has(group.key);
        cb.disabled = readOnly;
        cb.addEventListener('click', (event) => event.stopPropagation());
        cb.addEventListener('change', () => { if (cb.checked) picked.add(group.key); else picked.delete(group.key); syncPrepare(); });
        label.appendChild(cb);
        label.appendChild(el(doc, 'span', 'hlc-need-name', group.product || group.supplier_sku || 'Article'));
        label.appendChild(el(doc, 'b', '', `×${num(group.quantity)}`));
        label.appendChild(el(doc, 'small', '', [...new Set(group.lines.map((l) => l.order_ref))].join(', ')));
        label.addEventListener('mouseenter', () => {});
        label.addEventListener('click', () => { state.sel = { type: 'need', id: group.key }; applySelection(); });
        card.appendChild(label);
      });
      if (!readOnly) {
        const acts = el(doc, 'div', 'hlc-card-actions');
        const prep = button(doc, 'Préparer la PO avec la sélection', 'prepare-po', 'is-primary');
        prep.setAttribute('data-hlc-prepare', batch.key);
        let draftSelect = null;
        if (batch.compatible_draft_po_ids.length) {
          draftSelect = doc.createElement('select');
          draftSelect.className = 'hlc-select';
          draftSelect.setAttribute('aria-label', 'Brouillon compatible');
          draftSelect.appendChild(Object.assign(doc.createElement('option'), { value: '', textContent: 'Nouvelle PO' }));
          batch.compatible_draft_po_ids.forEach((id) => draftSelect.appendChild(Object.assign(doc.createElement('option'), { value: id, textContent: `Brouillon PO ${short(id)}` })));
          draftSelect.addEventListener('change', syncPrepare);
          acts.appendChild(draftSelect);
        }
        acts.appendChild(prep);
        const hint = el(doc, 'small', 'hlc-reason', '');
        acts.appendChild(hint);
        function syncPrepareBatch() {
          const keys = batch.groups.filter((g) => picked.has(g.key));
          prep.disabled = keys.length === 0;
          hint.textContent = keys.length ? '' : 'Cochez au moins un besoin de ce lot.';
          prep.textContent = draftSelect && draftSelect.value ? 'Rattacher au brouillon' : 'Préparer la PO avec la sélection';
        }
        batch.sync = syncPrepareBatch;
        prep.addEventListener('click', () => {
          const lineIds = batch.groups.filter((g) => picked.has(g.key)).flatMap((g) => g.lines.map((l) => l.line_id));
          if (!lineIds.length) return;
          prepareBatch(prep, batch, lineIds, draftSelect && draftSelect.value ? draftSelect.value : null);
        });
        syncPrepareBatch();
        card.appendChild(acts);
      }
      center.appendChild(card);
    });
    function syncPrepare() { batches.forEach((b) => b.sync && b.sync()); }

    if (!pos.length && !batches.length) center.appendChild(el(doc, 'p', 'hlc-empty', 'Aucun besoin ouvert ni PO sur ce marché.'));
    pos.forEach((po) => center.appendChild(poCard(po)));
    grid.appendChild(center);

    // Zone droite : suivi physique (secondaire).
    const right = el(doc, 'aside', 'hlc-zone hlc-zone-physical');
    right.setAttribute('data-hlc-zone', 'physical');
    renderPhysical(right);
    grid.appendChild(right);

    // ── PO ──
    function poCard(po) {
      const card = el(doc, 'article', 'hlc-card hlc-po');
      card.setAttribute('data-hlc-po', po.id);
      card.tabIndex = 0;
      const head = el(doc, 'header', 'hlc-card-head');
      head.appendChild(el(doc, 'strong', '', `${po.supplier_name} · PO ${short(po.id)}`));
      head.appendChild(el(doc, 'span', 'hlc-chip', `${num(po.totals.received)}/${num(po.totals.effective || po.lines.reduce((t, l) => t + l.ordered, 0))} reçu`));
      card.appendChild(head);
      const steps = el(doc, 'ol', 'hlc-steps');
      steps.setAttribute('data-hlc-steps', po.step.key);
      (cockpit.po_steps || []).forEach((key, i) => {
        const li = el(doc, 'li', `hlc-step${i + 1 < po.step.index ? ' is-done' : ''}${i + 1 === po.step.index ? ' is-current' : ''}`, STEP_LABELS[key] || key);
        li.setAttribute('data-step', key);
        if (i + 1 === po.step.index) li.setAttribute('aria-current', 'step');
        steps.appendChild(li);
      });
      card.appendChild(steps);
      const auth = el(doc, 'p', 'hlc-auth');
      const c = po.authorizations.commitment; const p = po.authorizations.payment;
      auth.appendChild(el(doc, 'span', `hlc-chip ${c ? 'is-ok' : ''}`, c ? `Engagement validé · ${c.decided_by_name || 'responsable'} · ${num(c.amount)} ${c.currency}` : 'Engagement non validé'));
      auth.appendChild(el(doc, 'span', `hlc-chip ${p ? 'is-ok' : ''}`, p ? `Paiement autorisé · ${num(p.amount)} ${p.currency}` : 'Paiement non autorisé'));
      auth.title = 'Approuvé ne veut pas dire payé : le paiement fournisseur est une décision distincte.';
      card.appendChild(auth);

      const lines = el(doc, 'ul', 'hlc-po-lines');
      po.lines.forEach((l) => {
        const li = el(doc, 'li', 'hlc-po-line');
        li.setAttribute('data-hlc-po-line', l.line_id);
        li.setAttribute('data-hlc-line-order', l.order_id);
        const who = button(doc, l.order_ref, 'goto-order', 'is-link');
        who.setAttribute('data-hlc-goto-order', l.order_id);
        who.addEventListener('click', (event) => { event.stopPropagation(); selectOrder(l.order_id); });
        li.appendChild(who);
        li.appendChild(el(doc, 'span', 'hlc-item-name', l.product || 'Article'));
        li.appendChild(el(doc, 'span', 'hlc-item-q', `reçu ${num(l.received)}/${num(l.confirmed)} · reliquat ${num(l.missing)}${l.anomaly ? ` · écart ${num(l.anomaly)}` : ''}`));
        if (l.fifo_rank) li.appendChild(el(doc, 'small', `hlc-fifo${l.fifo_next ? ' is-next' : ''}`, `FIFO n° ${l.fifo_rank}${l.fifo_next ? ' · prochaine servie' : ''}`));
        if (!readOnly && po.step.key === 'draft') {
          const rm = button(doc, 'Retirer', 'detach-line', 'is-link');
          rm.addEventListener('click', (event) => {
            event.stopPropagation();
            execute(rm, {
              url: purchasing(`po/${encodeURIComponent(po.id)}/detach`), body: { line_ids: [l.line_id] },
              confirmMessage: `Retirer cette ligne (${l.order_ref}) de la PO ${short(po.id)} ? Elle redevient un besoin ouvert.`,
              runningMessage: 'Retrait en cours…', successMessage: 'Ligne retirée de la PO.',
            });
          });
          li.appendChild(rm);
        }
        lines.appendChild(li);
      });
      card.appendChild(lines);

      if (!readOnly) {
        const acts = el(doc, 'div', 'hlc-card-actions');
        const grantNo = (flag, reason) => (viewer && flag ? null : reason);
        if (po.step.key === 'draft') {
          const b = button(doc, 'Valider l’engagement', 'authorize-commitment', 'is-primary');
          gated(doc, acts, b, grantNo(viewer && viewer.can_authorize_commitment, 'Réservé à la responsable Hub (autorisation d’engagement attribuée par l’Admin central).'));
          b.addEventListener('click', (event) => { event.stopPropagation(); openForm('commitment', po.id); });
        }
        if (po.step.key === 'validation') {
          const b = button(doc, 'Soumettre la PO', 'submit-po', 'is-primary');
          acts.appendChild(b);
          b.addEventListener('click', (event) => { event.stopPropagation(); submitPo(b, po.id); });
        }
        if (po.step.key === 'engaged') {
          const b = button(doc, 'Enregistrer l’envoi', 'record-sent', 'is-primary');
          acts.appendChild(b);
          b.addEventListener('click', (event) => { event.stopPropagation(); openForm('sent', po.id); });
        }
        if (po.status === 'notified' && po.sent_at) {
          const b = button(doc, 'Confirmation fournisseur', 'confirm-po');
          acts.appendChild(b);
          b.addEventListener('click', (event) => { event.stopPropagation(); openForm('confirm', po.id); });
        }
        if (po.status !== 'draft' && po.authorizations.commitment && !po.authorizations.payment) {
          const b = button(doc, 'Autoriser le paiement', 'authorize-payment');
          gated(doc, acts, b, grantNo(viewer && viewer.can_authorize_payment, 'Réservé à la responsable Hub (autorisation de paiement attribuée par l’Admin central).'));
          b.addEventListener('click', (event) => { event.stopPropagation(); openForm('payment', po.id); });
        }
        if (po.status !== 'draft' && po.totals.missing > 0) {
          const b = button(doc, 'Réceptionner', 'receive', 'is-primary');
          acts.appendChild(b);
          b.addEventListener('click', (event) => { event.stopPropagation(); openForm('receive', po.id); });
        } else if (po.status === 'draft') {
          acts.appendChild(el(doc, 'small', 'hlc-reason', 'Réception impossible : la PO est encore en brouillon.'));
        }
        if (acts.children.length) card.appendChild(acts);
        if (state.form && state.form.po === po.id) card.appendChild(poForm(po, state.form.kind));
      }
      card.addEventListener('click', () => { state.sel = { type: 'po', id: po.id }; applySelection(); });
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target === card) { state.sel = { type: 'po', id: po.id }; applySelection(); } });
      return card;
    }

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
      let channel; let supplierOrder; let confirmProof; let confirmQty = [];
      if (kind === 'sent') {
        channel = field(form, 'Canal d’envoi réel', doc.createElement('select'));
        CHANNELS.forEach(([v, l]) => channel.appendChild(Object.assign(doc.createElement('option'), { value: v, textContent: l })));
        supplierOrder = field(form, 'Référence de commande fournisseur (facultative)', textInput('', 'supplier_order_id'));
      }
      if (kind === 'confirm') {
        form.appendChild(el(doc, 'p', 'hlc-zone-hint', 'Quantités confirmées par le fournisseur (déclaratif, pas une réception). Le reliquat éventuel redevient un besoin ouvert.'));
        po.lines.forEach((l) => {
          const q = field(form, `${l.order_ref} · ${l.product || 'Article'} (commandé ${l.ordered})`, Object.assign(doc.createElement('input'), { type: 'number', min: '0', max: String(l.ordered), step: '1', value: String(l.ordered) }));
          confirmQty.push([l, q]);
        });
        supplierOrder = field(form, 'Référence de commande fournisseur', textInput('', 'supplier_order_id'));
        confirmProof = field(form, 'Justificatif d’achat (obligatoire)', textInput('Facture, capture, reçu…', 'purchase_proof_ref'));
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
            url: purchasing(`po/${id}/sent`), body: { channel: channel.value, ...(supplierOrder.value.trim() ? { supplier_order_id: supplierOrder.value.trim() } : {}) },
            runningMessage: 'Enregistrement de l’envoi…', successMessage: 'Envoi enregistré (canal, auteur, heure).', onSuccess: () => { state.form = null; },
          });
        } else if (kind === 'confirm') {
          const lines = confirmQty.map(([l, q]) => ({ purchase_line_id: l.line_id, confirmed_quantity: Number(q.value) }));
          if (lines.some((x) => !Number.isInteger(x.confirmed_quantity) || x.confirmed_quantity < 0)) { note.textContent = 'Quantités confirmées : entiers positifs ou nuls.'; return; }
          if (lines.some((x) => x.confirmed_quantity > 0) && confirmProof.value.trim().length < 4) { note.textContent = 'Justificatif d’achat obligatoire (4 caractères minimum).'; return; }
          execute(submit, {
            url: purchasing(`po/${id}/confirm`),
            body: { lines, ...(supplierOrder.value.trim() ? { supplier_order_id: supplierOrder.value.trim() } : {}), ...(confirmProof.value.trim() ? { purchase_proof_ref: confirmProof.value.trim() } : {}) },
            confirmMessage: 'Enregistrer la confirmation fournisseur ? Toute quantité non confirmée redevient un besoin ouvert.',
            runningMessage: 'Enregistrement de la confirmation…', successMessage: 'Confirmation fournisseur enregistrée.', onSuccess: () => { state.form = null; },
          });
        }
      });
      return form;
    }

    // ── Suivi physique ──
    function renderPhysical(zone) {
      zone.replaceChildren();
      zone.appendChild(el(doc, 'h3', 'hlc-zone-title', 'Suivi physique'));
      const sel = state.sel;
      let scope = 'Tout le marché'; let t = null; let receiptsFor = null;
      if (sel && sel.type === 'order') {
        const o = orders.find((x) => x.id === sel.id);
        if (o) { scope = o.reference; t = o.totals; receiptsFor = new Set(o.po_ids); }
      } else if (sel && sel.type === 'po') {
        const po = pos.find((x) => x.id === sel.id);
        if (po) {
          scope = `PO ${short(po.id)}`; receiptsFor = new Set([po.id]);
          const linked = orders.filter((o) => po.order_ids.includes(o.id));
          t = linked.reduce((a, o) => Object.fromEntries(Object.keys(o.totals).map((k) => [k, (a[k] || 0) + o.totals[k]])), {});
          scope += ` · ${linked.length} commande(s)`;
        }
      }
      if (!t) t = orders.reduce((a, o) => Object.fromEntries(Object.keys(o.totals).map((k) => [k, (a[k] || 0) + o.totals[k]])), {});
      zone.appendChild(el(doc, 'p', 'hlc-zone-hint', `Périmètre : ${scope}`));
      const list = el(doc, 'dl', 'hlc-phys');
      list.setAttribute('data-hlc-physical-totals', '');
      [['Reçu au Hub', t.received], ['À contrôler', t.to_control], ['Contrôlé', t.controlled], ['Quarantaine / écart', t.anomaly], ['En sacs', t.in_bags], ['En KOM-BOX', t.in_boxes], ['Expédié', t.shipped]].forEach(([k, v]) => {
        const row = el(doc, 'div', 'hlc-phys-row');
        row.appendChild(el(doc, 'dt', '', k));
        row.appendChild(el(doc, 'dd', '', num(v || 0)));
        list.appendChild(row);
      });
      zone.appendChild(list);
      zone.appendChild(el(doc, 'small', 'hlc-reason', 'Contrôlé = colis fournisseur au-delà de « qualité vérifiée » ; reçu ne vaut ni contrôlé ni attribué.'));

      const receipts = (d.receipts || []).filter((r) => !receiptsFor || (r.po_ids || []).some((id) => receiptsFor.has(id)));
      const rec = el(doc, 'section', 'hlc-sub');
      rec.appendChild(el(doc, 'h4', '', `Réceptions (${receipts.length})`));
      receipts.slice(0, 5).forEach((r) => {
        const row = el(doc, 'button', 'hlc-link-row');
        row.type = 'button';
        row.setAttribute('data-hlc-receipt', r.id);
        row.textContent = `${r.reference} · ${num(r.qty)} u · ${r.state}`;
        row.addEventListener('click', () => { if (r.po_ids && r.po_ids[0]) selectPo(r.po_ids[0]); });
        rec.appendChild(row);
      });
      if (!receipts.length) rec.appendChild(el(doc, 'p', 'hlc-empty', 'Aucune réception.'));
      zone.appendChild(rec);

      const bags = el(doc, 'section', 'hlc-sub');
      bags.setAttribute('data-hlc-bags', '');
      const open = d.bags_open || [];
      bags.appendChild(el(doc, 'h4', '', `Sacs · ${open.length} en cours · ${(d.bags_ready || []).length} fermé(s) hors KOM-BOX`));
      open.forEach((bag) => {
        const planned = (bag.bag_plan || []).reduce((s, x) => s + Number(x.quantity), 0);
        const actual = (bag.actual_contents || []).reduce((s, x) => s + Number(x.quantity), 0);
        const row = el(doc, 'div', 'hlc-bag-row');
        row.appendChild(el(doc, 'span', '', `${bag.reference} · ${bag.order_ref} · ${actual}/${planned}`));
        if (!readOnly && planned > 0 && planned === actual) {
          const b = button(doc, 'Fermer le sac', 'close-bag');
          b.addEventListener('click', () => closeBag(b, bag.unit_id));
          row.appendChild(b);
        } else if (!readOnly) {
          const b = button(doc, 'Déposer (scan)', 'open-physical', 'is-link');
          b.addEventListener('click', () => ctx.openPhysical());
          row.appendChild(b);
        }
        bags.appendChild(row);
      });
      zone.appendChild(bags);

      const boxes = el(doc, 'section', 'hlc-sub');
      boxes.appendChild(el(doc, 'h4', '', `KOM-BOX · ${(d.boxes || []).length} · expéditions ouvertes ${(d.open_shipments || []).length}`));
      (d.boxes || []).slice(0, 4).forEach((b) => boxes.appendChild(el(doc, 'p', 'hlc-bag-row', `${b.reference} · ${b.state}${b.shipment_ref ? ' · ' + b.shipment_ref : ' · sans expédition'}`)));
      zone.appendChild(boxes);
      const more = button(doc, 'Détails physiques exhaustifs', 'open-physical-details');
      more.addEventListener('click', () => ctx.openPhysical());
      zone.appendChild(more);
    }

    // ── Sélection bidirectionnelle (classes seulement : les formulaires en cours ne sont pas détruits) ──
    function applySelection() {
      const sel = state.sel;
      const related = { orders: new Set(), pos: new Set() };
      if (sel && sel.type === 'order') {
        const o = orders.find((x) => x.id === sel.id);
        if (o) o.po_ids.forEach((id) => related.pos.add(id));
      } else if (sel && sel.type === 'po') {
        const po = pos.find((x) => x.id === sel.id);
        if (po) po.order_ids.forEach((id) => related.orders.add(id));
      } else if (sel && sel.type === 'need') {
        batches.forEach((b) => b.groups.filter((g) => g.key === sel.id).forEach((g) => g.lines.forEach((l) => related.orders.add(l.order_id))));
      }
      rootEl.querySelectorAll('[data-hlc-order]').forEach((n) => {
        const id = n.getAttribute('data-hlc-order');
        n.classList.toggle('is-selected', !!sel && sel.type === 'order' && sel.id === id);
        n.classList.toggle('is-related', related.orders.has(id));
      });
      rootEl.querySelectorAll('[data-hlc-po]').forEach((n) => {
        const id = n.getAttribute('data-hlc-po');
        n.classList.toggle('is-selected', !!sel && sel.type === 'po' && sel.id === id);
        n.classList.toggle('is-related', related.pos.has(id));
      });
      rootEl.querySelectorAll('[data-hlc-po-line]').forEach((n) => {
        const orderId = n.getAttribute('data-hlc-line-order');
        const hit = (sel && sel.type === 'order' && sel.id === orderId) || (sel && sel.type === 'po' && n.closest('[data-hlc-po]').getAttribute('data-hlc-po') === sel.id);
        n.classList.toggle('is-highlight', !!hit);
      });
      rootEl.querySelectorAll('[data-hlc-need]').forEach((n) => {
        const key = n.getAttribute('data-hlc-need');
        let hit = !!sel && sel.type === 'need' && sel.id === key;
        if (sel && sel.type === 'order') {
          batches.forEach((b) => b.groups.filter((g) => g.key === key).forEach((g) => { if (g.lines.some((l) => l.order_id === sel.id)) hit = true; }));
        }
        n.classList.toggle('is-highlight', hit);
      });
      renderPhysical(right);
      rootEl.setAttribute('data-hlc-selection', sel ? `${sel.type}:${sel.id}` : '');
    }

    function paint() { render(host, ctx); }
    applySelection();
    syncPrepare();
    return rootEl;
  }

  function document_text(doc, value) { return doc.createTextNode(value); }

  return Object.freeze({ render, STEP_LABELS });
});
