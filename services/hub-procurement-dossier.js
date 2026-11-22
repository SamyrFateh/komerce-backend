/**
 * @komerce-arch
 * @role          hub-procurement-dossier
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        market_id, optional_supplier_id, order_or_purchase_order_id
 * @outputs       market_procurement_dossier, physical_trace
 * @depends       db, services/supplier-source-resolution.js
 * @used-by       routes/hub.js, routes/admin-operations-workspace.js
 * @db-read       markets, orders, order_items, products, product_skus, product_suppliers, suppliers, purchase_lines, purchase_orders, purchase_order_authorizations, hub_authorization_grants, users, relais, v_purchase_line_progress, hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, hub_box_bags, hub_box_effective_placements, international_shipments, international_shipment_hub_units, parcels, parcel_items
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      une dÃ©cision, une autoritÃ©, un enregistrement ; projection en lecture seule, aucune seconde source de vÃ©ritÃ©
 * @impact-areas  logistics, purchasing, market
 * @version       2026-11
 */

'use strict';

const db = require('../db');
const { hasEligibleSourceSql } = require('./supplier-source-resolution');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3600 * 1000;
const ISSUED_NOT_SENT_AFTER_H = 24;
const SENT_NOT_CONFIRMED_AFTER_H = 72;
// DÃ©cision 6 (#3998) : alerte directrice au-delÃ  de 48 h d'anciennetÃ© d'une tÃ¢che.
const TASK_OVERDUE_AFTER_H = 48;

// AnciennetÃ© d'une tÃ¢che, dÃ©rivÃ©e de la date du fait dÃ©clencheur (jamais stockÃ©e). Date inconnue : champs null.
function withAge(task, now) {
  const t = task.since ? new Date(task.since).getTime() : NaN;
  if (!Number.isFinite(t)) return { ...task, since: null, age_hours: null, overdue: false };
  const ageHours = Math.max(0, Math.floor((now.getTime() - t) / HOUR));
  return { ...task, since: new Date(t).toISOString(), age_hours: ageHours, overdue: ageHours >= TASK_OVERDUE_AFTER_H };
}

function failure(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function resolveMarket(marketRef, q = db) {
  const ref = String(marketRef || '').trim();
  if (!ref) throw failure(400, 'MARKET_REQUIRED', 'Un marchÃ© est obligatoire');
  const { rows: [market] } = UUID_RE.test(ref)
    ? await q.query('SELECT id, code, name FROM markets WHERE id = $1', [ref])
    : await q.query('SELECT id, code, name FROM markets WHERE UPPER(code) = UPPER($1)', [ref]);
  if (!market) throw failure(404, 'MARKET_NOT_FOUND', 'MarchÃ© introuvable');
  return market;
}

// Ã‰tape mÃ©tier dÃ©rivÃ©e, jamais stockÃ©e.
function poStage(po, totals) {
  if (po.status === 'cancelled') return 'cancelled';
  if (po.status === 'draft') return 'draft';
  if (po.status === 'notified') return po.sent_at ? 'sent' : 'issued_not_sent';
  if (totals.effective > 0 && totals.received >= totals.effective) return 'received';
  if (totals.received > 0) return 'partially_received';
  return 'confirmed';
}


const ALLOCATION_RULE = 'FIFO : la commande la plus ancienne est servie en premier (par SKU dans la PO)';
const PO_STEPS = Object.freeze(['draft', 'validation', 'engaged', 'sent', 'received']);

// Ã‰tape de la barre PO (brouillon â†’ validation â†’ engagÃ© â†’ envoyÃ©/expÃ©diÃ© â†’ reÃ§u), dÃ©rivÃ©e, jamais stockÃ©e.
// Â« Validation Â» = engagement validÃ© par la responsable Hub (la PO reste modifiable jusqu'Ã  la soumission).
// Le paiement fournisseur est une autorisation distincte, jamais une Ã©tape de cette barre.
function poStep(po, commitment) {
  if (po.status === 'cancelled') return { key: 'cancelled', index: 0 };
  if (po.status === 'draft') return commitment ? { key: 'validation', index: 2 } : { key: 'draft', index: 1 };
  // La rÃ©ception physique prime sur le statut fournisseur (une PO peut Ãªtre reÃ§ue avant d'Ãªtre confirmÃ©e).
  if (po.totals.effective > 0 && po.totals.received >= po.totals.effective) return { key: 'received', index: 5 };
  if (po.totals.received > 0) return { key: 'received', index: 5, partial: true };
  if (po.status === 'notified' && !po.sent_at) return { key: 'engaged', index: 3 };
  return { key: 'sent', index: 4 };
}

function viewerRights(viewer, grants) {
  if (!viewer) return null;
  return {
    user_id: viewer.id || null,
    role: viewer.role || null,
    can_authorize_commitment: grants.has('purchase_commitment'),
    can_authorize_payment: grants.has('supplier_payment'),
  };
}

// Les quantitÃ©s reÃ§ues restent rÃ©partissables indÃ©pendamment du reliquat fournisseur.
function orderReadiness(order) {
  const items = order.items;
  const pending = items.filter((i) => i.received < i.ordered).map((i) => ({
    order_item_id: i.id, product: i.product, missing: i.ordered - i.received,
  }));
  const complete = items.length > 0 && pending.length === 0;
  const unboxed = items.reduce((t, i) => t + Math.max(0, i.received - i.in_bags - i.in_boxes), 0);
  const received = items.reduce((t, i) => t + i.received, 0);
  const blockers = [];
  if (items.some((i) => i.purchasing_missing > 0)) blockers.push('Besoin non couvert par une ligne dâ€™achat');
  if (items.some((i) => i.anomaly > 0)) blockers.push('UnitÃ© en quarantaine ou Ã©cart Ã  traiter');
  if (!complete) blockers.push('Articles non reÃ§us : ' + pending.map((p) => `${p.product || 'article'} (${p.missing})`).join(', '));
  return {
    complete,
    partial: !complete && received > 0,
    ready_to_combox: unboxed > 0 && !items.some((i) => i.anomaly > 0),
    unboxed_received: unboxed,
    pending_items: pending,
    blockers,
  };
}

const PHYSICAL_BY_ITEM_SQL = `
  SELECT a.order_item_id,
         SUM(p.quantity) FILTER (WHERE f.ok)::int AS usable,
         SUM(p.quantity) FILTER (WHERE NOT f.ok)::int AS anomaly,
         SUM(p.quantity) FILTER (WHERE f.ok AND u.unit_type = 'SUPPLIER_PACKAGE' AND u.state IN ('RECEIVED','IDENTIFIED'))::int AS to_control,
         SUM(p.quantity) FILTER (WHERE f.ok AND u.unit_type = 'SUPPLIER_PACKAGE' AND u.state NOT IN ('RECEIVED','IDENTIFIED'))::int AS controlled,
         SUM(p.quantity) FILTER (WHERE f.ok AND u.unit_type = 'HANDLING_UNIT' AND bb.bag_unit_id IS NULL)::int AS in_bags,
         SUM(p.quantity) FILTER (WHERE f.ok AND u.unit_type = 'HANDLING_UNIT' AND bb.bag_unit_id IS NULL AND u.state <> 'PACKED')::int AS in_bags_open,
         SUM(p.quantity) FILTER (WHERE f.ok AND u.unit_type = 'HANDLING_UNIT' AND bb.bag_unit_id IS NULL AND u.state = 'PACKED')::int AS in_bags_closed,
         SUM(p.quantity) FILTER (WHERE f.ok AND (bb.bag_unit_id IS NOT NULL OR u.unit_type = 'MARKET_PARCEL'))::int AS in_boxes,
         SUM(p.quantity) FILTER (WHERE f.ok AND hs.physical_unit_id IS NOT NULL)::int AS shipped
    FROM hub_purchase_allocations a
    JOIN hub_physical_unit_placements p ON p.allocation_id = a.id AND p.removed_at IS NULL
    JOIN hub_physical_units u ON u.id = p.physical_unit_id
    CROSS JOIN LATERAL (SELECT (u.outcome_type IS NULL AND u.state NOT IN ('QUARANTINED','SUPERSEDED')) AS ok) f
    LEFT JOIN hub_box_bags bb ON bb.bag_unit_id = u.id
    LEFT JOIN international_shipment_hub_units hs
           ON hs.physical_unit_id = COALESCE(bb.box_unit_id, CASE WHEN u.unit_type = 'MARKET_PARCEL' THEN u.id END)
   WHERE a.market_id = $1 AND a.order_item_id = ANY($2::uuid[])
   GROUP BY a.order_item_id`;

function buildTodo({ orders, unsourced, needBatches, purchaseOrders, boxes, viewer, parcelsToReconcile = [], blockedItems = [], queuedOrders = [], now = new Date() }) {
  const todo = [];
  const can = (flag, reason) => (viewer === null ? { viewer_can_act: null, blocked_reason: null }
    : flag ? { viewer_can_act: true, blocked_reason: null } : { viewer_can_act: false, blocked_reason: reason });
  const push = (item) => todo.push({ ...item });
  const byOrder = new Map();
  unsourced.forEach((u) => { byOrder.set(u.order_id, [...(byOrder.get(u.order_id) || []), u]); });
  for (const [orderId, list] of byOrder) {
    const units = list.reduce((t, u) => t + u.missing_quantity, 0);
    push({
      id: `SOURCING_REQUIRED:${orderId}`, kind: 'SOURCING_REQUIRED', priority: 10, owner: 'agent_hub', subject: { order_id: orderId },
      severity: 'anomaly',
      missing: list.some((u) => !u.supplier_mapping_present)
        ? `Sourcing requis â€” aucun fournisseur admissible Â· ${list[0].order_ref}`
        : `Anomalie ${list[0].order_ref} : fournisseur du SKU non rattachÃ© aux achats`,
      why: list.some((u) => !u.supplier_mapping_present)
        ? 'Aucun fournisseur admissible pour le produit et la plateforme du SKU.'
        : 'Aucune ligne dâ€™achat crÃ©Ã©e.',
      since: list[0].order_created_at || null,
      action: { type: 'resolve_sourcing', order_id: orderId, label: 'Ouvrir une ligne dâ€™achat' }, ...can(true),
    });
  }
  for (const batch of needBatches) {
    push({
      id: `PREPARE_PO:${batch.key}`, kind: 'PREPARE_PO', priority: 20, owner: 'agent_hub', subject: { batch_key: batch.key },
      missing: `${batch.quantity} u Ã  regrouper chez ${batch.supplier_name}`,
      why: `${batch.order_count} commande(s) Ã  regrouper en une PO.`,
      since: batch.oldest_at || null,
      action: { type: 'prepare_po', batch_key: batch.key, label: batch.compatible_draft_po_ids.length ? 'Rattacher au brouillon' : 'PrÃ©parer la PO' },
      ...can(true),
    });
  }
  for (const po of purchaseOrders) {
    const ref = `${po.supplier_name} Â· ${poRef(po.id)}`;
    const subject = { po_id: po.id };
    if (po.step.key === 'draft') {
      push({ id: `AUTHORIZE_COMMITMENT:${po.id}`, kind: 'AUTHORIZE_COMMITMENT', priority: 30, owner: 'responsable_hub', subject,
        missing: `${ref} : engagement Ã  valider`,
        why: 'Sans la responsable Hub, la PO ne part pas.',
        since: po.created_at,
        action: { type: 'authorize_commitment', po_id: po.id, label: 'Valider lâ€™engagement' },
        ...can(viewer && viewer.can_authorize_commitment, 'rÃ©servÃ© Ã  la responsable Hub') });
    } else if (po.step.key === 'validation') {
      push({ id: `SUBMIT_PO:${po.id}`, kind: 'SUBMIT_PO', priority: 31, owner: 'agent_hub', subject,
        missing: `${ref} : engagement validÃ©, Ã  soumettre`,
        why: 'Le fournisseur nâ€™est pas encore informÃ©.',
        since: po.authorizations.commitment && po.authorizations.commitment.decided_at,
        action: { type: 'submit_po', po_id: po.id, label: 'Soumettre la PO' }, ...can(true) });
    } else if (po.step.key === 'engaged') {
      push({ id: `RECORD_SENT:${po.id}`, kind: 'RECORD_SENT', priority: 32, owner: 'agent_hub', subject,
        missing: `${ref} : envoi Ã  enregistrer`,
        why: 'Une PO soumise nâ€™est pas encore envoyÃ©e.',
        since: po.ordered_at || po.updated_at,
        action: { type: 'record_sent', po_id: po.id, label: 'Enregistrer lâ€™envoi' }, ...can(true) });
    } else if (po.status === 'notified' && po.sent_at) {
      push({ id: `CONFIRM_PO:${po.id}`, kind: 'CONFIRM_PO', priority: 33, owner: 'agent_hub', subject,
        missing: `${ref} : confirmation fournisseur Ã  saisir`,
        why: 'QuantitÃ©s confirmÃ©es par le fournisseur.',
        since: po.sent_at,
        action: { type: 'confirm_po', po_id: po.id, label: 'Enregistrer la confirmation' }, ...can(true) });
    }
    if (po.status !== 'draft' && po.status !== 'cancelled' && po.authorizations.commitment && !po.authorizations.payment) {
      push({ id: `AUTHORIZE_PAYMENT:${po.id}`, kind: 'AUTHORIZE_PAYMENT', priority: 40, owner: 'responsable_hub', subject,
        missing: `${ref} : paiement Ã  autoriser`,
        why: 'Engagement validÃ© ne vaut pas paiement.',
        since: po.authorizations.commitment.decided_at,
        action: { type: 'authorize_payment', po_id: po.id, label: 'Autoriser le paiement' },
        ...can(viewer && viewer.can_authorize_payment, 'rÃ©servÃ© Ã  la responsable Hub') });
    }
    if (po.status !== 'draft' && po.status !== 'cancelled' && po.totals.missing > 0) {
      push({ id: `AWAIT_RECEIPT:${po.id}`, kind: 'AWAIT_RECEIPT', priority: 50, owner: 'agent_hub', subject,
        missing: `${ref} : ${po.totals.missing} u attendue(s)`,
        why: 'Seule la rÃ©ception physique compte.',
        since: po.confirmed_at || po.sent_at || po.ordered_at,
        action: { type: 'receive', po_id: po.id, label: 'Enregistrer une rÃ©ception' }, ...can(true) });
    }
    if (po.totals.anomaly > 0) {
      push({ id: `REVIEW_ANOMALY:${po.id}`, kind: 'REVIEW_ANOMALY', priority: 45, owner: 'agent_hub', subject,
        missing: `${ref} : ${po.totals.anomaly} u en Ã©cart`,
        why: 'Ces unitÃ©s ne comptent pas comme reÃ§ues.',
        since: po.updated_at,
        action: { type: 'open_physical', po_id: po.id, label: 'Voir le dÃ©tail physique' }, ...can(true) });
    }
  }
  for (const order of orders) {
    if (order.readiness.ready_to_combox) {
      push({ id: `PLACE_COMBOX:${order.id}`, kind: 'PLACE_COMBOX', priority: 60, owner: 'agent_hub', subject: { order_id: order.id },
        missing: `${order.reference} : articles reÃ§us Ã  rÃ©partir en COMBOX`,
        why: 'Les quantitÃ©s reÃ§ues peuvent Ãªtre rÃ©parties directement en COMBOX.',
        since: order.created_at,
        action: { type: 'open_physical', order_id: order.id, label: 'Composer les COMBOX' }, ...can(true) });
    }
  }
  for (const b of boxes) {
    if (b.state === 'PACKED' && !b.shipment_ref) {
      push({ id: `BOX_UNSHIPPED:${b.unit_id}`, kind: 'BOX_UNSHIPPED', priority: 64, owner: 'agent_hub', subject: { box_unit_id: b.unit_id },
        missing: `${b.reference} : Ã  rattacher Ã  une expÃ©dition`, why: 'Sans expÃ©dition, la KOM-BOX ne part pas.',
        since: b.created_at,
        action: { type: 'open_physical', label: 'Rattacher Ã  une expÃ©dition' }, ...can(true) });
    }
  }
  // HB-08 : colis fournisseur arrivÃ© sans contenu dÃ©clarÃ© â€” invisible des allocations, donc des tÃ¢ches par PO.
  for (const parcel of parcelsToReconcile) {
    push({ id: `RECONCILE_PARCEL:${parcel.unit_id}`, kind: 'RECONCILE_PARCEL', priority: 35, owner: 'agent_hub', severity: 'anomaly',
      subject: { parcel_unit_id: parcel.unit_id },
      missing: `Colis ${parcel.reference} arrivÃ© Ã  rapprocher`,
      why: 'ReÃ§u au Hub sans contenu dÃ©clarÃ© : il nâ€™appartient Ã  aucune PO tant quâ€™il nâ€™est pas dÃ©ballÃ©.',
      since: parcel.created_at,
      action: { type: 'open_physical', label: 'DÃ©baller et rapprocher (scan)' }, ...can(true) });
  }
  // HB-02 : commande dont les lignes d'achat sont toutes soldÃ©es ou annulÃ©es sous le besoin â€” elle n'avancera jamais seule.
  const blockedByOrder = new Map();
  blockedItems.forEach((b) => blockedByOrder.set(b.order_id, [...(blockedByOrder.get(b.order_id) || []), b]));
  for (const [orderId, list] of blockedByOrder) {
    const units = list.reduce((t, b) => t + (b.ordered - b.covered), 0);
    push({ id: `BLOCKED_BY_SHORTFALL:${orderId}`, kind: 'BLOCKED_BY_SHORTFALL', priority: 11, owm«ëŒ+Š×®º+º$zzb¥æÚ±î¸Â¸­yêë¢°k¢G§¦*^ner: 'responsable_hub', severity: 'anomaly',
      subject: { order_id: orderId },
      missing: `${list[0].order_ref} : bloquÃ©e par rupture Â· ${units} u non couvertes`,
      why: 'Toutes les lignes dâ€™achat sont soldÃ©es ou annulÃ©es sous le besoin : arbitrer (envoi partiel et remboursement de la quantitÃ© manquante).',
      since: list.map((b) => b.since).filter(Boolean).sort().slice(-1)[0] || null,
      action: { type: 'open_order', order_id: orderId, label: 'Ouvrir la commande' }, ...can(true) });
  }
  // HB-12 : aucun colis local ne peut accueillir le reliquat et le maximum de trois
  // colis ouverts au relais est atteint. Le constat reste une projection, jamais un Ã©tat enregistrÃ©.
  for (const wait of queuedOrders) {
    push({ id: `PARCEL_CAPACITY_WAIT:${wait.order_id}`, kind: 'PARCEL_CAPACITY_WAIT', priority: 57,
      owner: 'agent_hub', severity: 'anomaly', subject: { order_id: wait.order_id },
      missing: `${wait.order_ref} : en file de colis Â· ${wait.relais_name || 'relais'} (${wait.open_parcels} ouverts)`,
      why: 'La capacitÃ© des trois colis locaux ouverts est saturÃ©e : expÃ©dier ou libÃ©rer une place avant de rÃ©partir.',
      since: wait.since,
      action: { type: 'open_order', order_id: wait.order_id, label: 'Ouvrir la commande en attente' }, ...can(true),
    });
  }
  // Actions exÃ©cutables par le rÃ´le courant d'abord, puis attentes d'un autre rÃ´le ; prioritÃ© mÃ©tier ensuite.
  const own = (t) => (t.viewer_can_act === false ? 1 : 0);
  return todo.map((t) => withAge(t, now)).sort((a, b) => own(a) - own(b) || a.priority - b.priority);
}


// â”€â”€ Projection Â« maquette C Â» : Ã©tats par unitÃ©, pastilles de statut, sections physiques â”€â”€
// Tout est dÃ©rivÃ© ici des mÃªmes quantitÃ©s serveur ; le navigateur n'additionne ni ne dÃ©duit rien.
const poRef = (id) => `PO-${String(id || '').slice(0, 4).toUpperCase()}`;
const UNIT_LABELS = Object.freeze({
  none: 'Ã€ acheter', sourcing: 'Fournisseur du SKU non rattachÃ© aux achats', draft: 'Dans une PO brouillon', pending: 'Validation responsable',
  shipped: 'Chez / expÃ©diÃ© fournisseur', received: 'ReÃ§u au Hub', boxed: 'Dans une COMBOX',
});

function itemUnits(item, poById) {
  const units = [];
  let left = item.received;
  const take = (n, state) => { const k = Math.min(n, left); for (let i = 0; i < k; i += 1) units.push(state); left -= k; };
  take(item.in_boxes, 'boxed'); take(left, 'received');
  const lines = [...item.lines].sort((a, b) => (a.fifo_rank || 0) - (b.fifo_rank || 0));
  for (const l of lines) {
    const po = l.po_id ? poById.get(l.po_id) : null;
    const state = !po ? 'none' : po.step.key === 'draft' ? 'draft' : po.step.key === 'validation' ? 'pending' : 'shipped';
    const waiting = po ? Math.max(0, Number(l.effective) - Number(l.received || 0)) : Number(l.quantity);
    for (let i = 0; i < waiting; i += 1) units.push(state);
  }
  for (let i = 0; i < item.uncovered; i += 1) units.push('sourcing');
  while (units.length < item.ordered) units.push('none');
  return units.slice(0, item.ordered).map((state) => ({ state, label: UNIT_LABELS[state] }));
}

function itemWhere(item, poById) {
  const states = new Set(item.units.map((u) => u.state));
  const poIds = item.po_ids;
  const ref = poIds.length ? poRef(poIds[0]) : '';
  if (states.has('sourcing')) return 'sans fournisseur';
  const poReceiving = poIds.some((id) => poById.get(id) && poById.get(id).totals.received > 0);
  if (item.received < item.ordered && poIds.length && (item.received > 0 || poReceiving)) return `reliquat ${ref}`;
  if (states.has('boxed') && !states.has('received')) return 'en KOM-BOX';
  if (item.received > 0) return `reÃ§u Â· ${ref}`;
  if (states.size === 1 && states.has('none')) return 'Ã  regrouper';
  return ref || 'Ã  regrouper';
}

function orderStatus(order) {
  const t = order.totals;
  const r = order.readiness;
  const states = new Set(order.items.flatMap((i) => i.units.map((u) => u.state)));
  // Cause dominante : anomalie > Ã  regrouper/acheter > reliquat > attente fournisseur > prÃªte.
  if (t.uncovered > 0) return { label: 'Anomalie fournisseur', tone: 'bad' };
  if (t.anomaly > 0) return { label: 'Anomalie rÃ©ception', tone: 'bad' };
  if (states.has('none')) return { label: t.received > 0 ? `Partielle Â· ${t.requested - t.received} Ã  acheter` : 'Ã€ regrouper', tone: 'act' };
  if (r.partial && ['shipped', 'pending', 'draft'].some((k) => states.has(k))) return { label: `Reliquat ${t.received}/${t.requested}`, tone: 'warn' };
  if (t.in_boxes > 0 && r.complete) return { label: 'Dans une COMBOX', tone: 'done' };
  if (r.ready_to_combox) return { label: 'Ã€ rÃ©partir en COMBOX', tone: 'act' };
  if (states.has('draft')) return { label: 'PO brouillon', tone: 'act' };
  if (states.has('pending')) return { label: 'En validation', tone: 'amber' };
  return { label: 'Attente fournisseur', tone: 'wait' };
}

function poStatusView(po) {
  const t = po.totals;
  const eff = t.effective || po.lines.reduce((s, l) => s + l.ordered, 0);
  if (po.step.key === 'received' || t.received > 0) {
    const label = t.received >= eff ? `ReÃ§ue ${t.received}/${eff}` : `ReÃ§ue ${t.received}/${eff} Â· reliquat ${eff - t.received}`;
    return { label, tone: t.received >= eff ? 'ok' : 'warn' };
  }
  if (po.step.key === 'draft') return { label: 'Brouillon', tone: 'act' };
  if (po.step.key === 'validation') return { label: 'En validation', tone: 'amber' };
  if (po.step.key === 'engaged') return { label: 'EngagÃ©e', tone: 'wait' };
  return { label: 'ExpÃ©diÃ©e fournisseur', tone: 'wait' };
}

function buildPhysical({ orders, boxes, poById }) {
  const item = (key, ref, meta, text, extra) => ({ key, ref, meta, text, ...(extra || {}) });
  const unboxed = orders.filter((o) => o.readiness.unboxed_received > 0).map((o) => {
    const parts = o.items.filter((i) => i.received - i.in_bags - i.in_boxes > 0).map((i) => {
      const refs = [...new Set(i.lines.filter((l) => l.po_id && l.received > 0).map((l) => poRef(l.po_id)))].join(', ');
      return `${i.product} Ã—${i.received - i.in_bags - i.in_boxes}${refs ? ` (${refs})` : ''}`;
    });
    return item(`order:${o.id}`, o.reference, 'FIFO', parts.join(' Â· '), { order_id: o.id });
  });
  const boxList = [...boxes];
  const orderIdsOf = (b) => [...new Set((b.contents || []).map((c) => c.order_id).filter(Boolean))];
  const open = boxList.filter((b) => !b.shipment_ref).map((b) => item(`box:${b.unit_id}`, b.reference, b.state, `${[...new Set((b.contents || []).map((c) => c.order_ref))].join(', ') || 'KOM-BOX'} Â· Ã  rattacher Ã  une expÃ©dition`, { order_ids: orderIdsOf(b), box_unit_id: b.unit_id }));
  const shipped = boxList.filter((b) => b.shipment_ref).map((b) => item(`box:${b.unit_id}`, b.reference, b.shipment_ref, `expÃ©dition ${b.shipment_stage || 'ouverte'}`, { order_ids: orderIdsOf(b), box_unit_id: b.unit_id }));
  const reliquats = orders.flatMap((o) => o.items.filter((i) => i.remaining_to_deliver > 0 && i.po_ids.some((id) => poById.get(id) && poById.get(id).totals.received > 0)).map((i) =>
    item(`order:${o.id}`, o.reference, i.po_ids.map(poRef).join(', '), `${i.product} Ã—${i.remaining_to_deliver} Â· attendu du fournisseur`, { order_id: o.id })));
  return [
    { key: 'received', title: 'ReÃ§u au Hub Â· Ã  rÃ©partir en COMBOX', tone: 'ok', items: unboxed, empty_text: 'Rien de reÃ§u pour lâ€™instant.' },
    { key: 'boxes', title: 'COMBOX', tone: 'box', items: open, empty_text: 'Aucune COMBOX en cours.' },
    { key: 'shipped', title: 'ExpÃ©diÃ© au relais', tone: 'grey', items: shipped, empty_text: 'Aucun dÃ©part aujourdâ€™hui.' },
    { key: 'reliquats', title: 'Reliquats attendus', tone: 'warn', items: reliquats, empty_text: 'Aucun reliquat.' },
  ];
}

async function loadCockpit({
  q, marketId, viewer, orderMap, needsRows, purchaseOrders, unsourcedItems, boxes,
  parcelsToReconcile = [], blockedItems = [], queuedOrders = [], now = new Date(),
}) {
  const grants = new Set();
  if (viewer && viewer.id) {
    const { rows } = await q.query(
      'SELECT authorization_type FROM hub_authorization_grants WHERE user_id = $1 AND revoked_at IS NULL', [viewer.id]);
    (rows || []).forEach((r) => grants.add(r.authorization_type));
  }
  const rights = viewerRights(viewer, grants);

  // Autorisations tracÃ©es (append-only) par PO.
  const poIds = purchaseOrders.map((po) => po.id);
  const authByPo = new Map();
  if (poIds.length) {
    const { rows } = await q.query(`
      SELECT a.purchase_order_id, a.authorization_type, a.amount, a.currency, a.proof_ref, a.decided_at, a.commitment_pdf IS NOT NULL AS pdf_available, u.full_name
        FROM purchase_order_authorizations a LEFT JOIN users u ON u.id = a.decided_by
       WHERE a.purchase_order_id = ANY($1::uuid[])`, [poIds]);
    for (const r of rows || []) {
      const entry = authByPo.get(r.purchase_order_id) || { commitment: null, payment: null };
      const decision = { amount: Number(r.amount), currency: r.currency, proof_ref: r.proof_ref, decided_at: r.decided_at, decided_by_name: r.full_name || null };
      if (r.authorization_type === 'purchase_commitment') {
        entry.commitment = { ...decision, pdf_available: r.pdf_available === true };
      } else entry.payment = decision;
      authByPo.set(r.purchase_order_id, entry);
    }
  }

  // Ventilation physique par article de commande (une seule lecture, mÃªmes tables que le dossier).
  const itemIds = [...orderMap.values()].flatMap((o) => o.items.map((i) => i.id));
  const physical = new Map();
  if (itemIds.length) {
    const { rows } = await q.query(PHYSICAL_BY_ITEM_SQL, [marketId, itemIds]);
    (rows || []).forEach((r) => physical.set(r.order_item_id, r));
  }

  // Lignes d'achat par article (ouvertes + rattachÃ©es) et rang FIFO par (PO, SKU).
  const linesByItem = new Map();
  const addLine = (itemId, line) => linesByItem.set(itemId, [...(linesByItem.get(itemId) || []), line]);
  needsRows.forEach((n) => addLine(n.order_item_id, {
    line_id: n.line_id, po_id: null, quantity: Number(n.quantity), effective: Number(n.quantity), received: 0, anomaly: 0, fifo_rank: null,
  }));
  for (const po of purchaseOrders) {
    const bySku = new Map();
    po.lines.forEach((l) => bySku.set(l.product_sku_id || '', [...(bySku.get(l.product_sku_id || '') || []), l]));
    for (const group of bySku.values()) {
      group.sort((a, b) => (new Date(a.order_created_at) - new Date(b.order_created_at)) || String(a.line_id).localeCompare(String(b.line_id)));
      let nextFound = false;
      group.forEach((l, index) => {
        l.fifo_rank = index + 1;
        l.fifo_next = !nextFound && l.missing > 0 && po.status !== 'draft' && po.status !== 'cancelled';
        if (l.fifo_next) nextFound = true;
      });
    }
    po.lines.forEach((l) => addLine(l.order_item_id, {
      line_id: l.line_id, po_id: po.id, quantity: l.ordered, effective: l.confirmed, received: l.received, anomaly: l.anomaly,
      fifo_rank: l.fifo_rank, fifo_next: l.fifo_next,
    }));
  }

  for (const po of purchaseOrders) {
    const auth = authByPo.get(po.id) || { commitment: null, payment: null };
    po.authorizations = auth;
    po.step = poStep(po, auth.commitment);
    po.order_ids = [...new Set(po.lines.map((l) => l.order_id))];
    const priced = po.lines.length > 0 && po.lines.every((l) => l.unit_price != null && l.currency)
      && new Set(po.lines.map((l) => l.currency)).size === 1;
    po.amount = priced
      ? { amount: po.lines.reduce((t, l) => t + l.ordered * l.unit_price, 0), currency: po.lines[0].currency, derived: true }
      : { amount: null, currency: null, derived: false };
  }

  // Ligne d'achat SANS PO : mÃªme source (needsRows) que la colonne Â« Achats et PO Â».
  const toGroupByItem = new Map();
  for (const n of needsRows) toGroupByItem.set(n.order_item_id, (toGroupByItem.get(n.order_item_id) || 0) + Number(n.quantity));
  const poById = new Map(purchaseOrders.map((po) => [po.id, po]));
  for (const order of orderMap.values()) {
    for (const item of order.items) {
      const ph = physical.get(item.id) || {};
      item.anomaly = Number(ph.anomaly || 0);
      item.to_control = Number(ph.to_control || 0);
      item.controlled = Number(ph.controlled || 0);
      item.in_bags = Number(ph.in_bags || 0);
      item.in_bags_open = Number(ph.in_bags_open || 0);
      item.in_bags_closed = Number(ph.in_bags_closed || 0);
      item.in_boxes = Number(ph.in_boxes || 0);
      item.shipped = Number(ph.shipped || 0);
      item.requested = item.ordered;
      // Trois Ã©tats disjoints du besoin : en PO / ligne d'achat sans PO (Ã  regrouper) / sans ligne d'achat (sourcing).
      item.to_group = Math.min(toGroupByItem.get(item.id) || 0, item.purchasing_covered);
      item.covered = item.purchasing_covered - item.to_group;
      item.uncovered = item.purchasing_missing;
      item.remaining_to_deliver = Math.max(item.ordered - item.received, 0);
      item.lines = linesByItem.get(item.id) || [];
      item.po_ids = [...new Set(item.lines.map((l) => l.po_id).filter(Boolean))];
      item.complete = item.received >= item.ordered;
    }
    order.po_ids = [...new Set(order.items.flatMap((i) => i.po_ids))];
    order.supplier_count = new Set(order.po_ids.map((id) => (poById.get(id) || {}).supplier_id).filter(Boolean)).size;
    order.readiness = orderReadiness(order);
    order.totals = order.items.reduce((t, i) => ({
      requested: t.requested + i.ordered, covered: t.covered + i.covered, to_group: t.to_group + i.to_group, uncovered: t.uncovered + i.uncovered,
      received: t.received + i.received, remaining: t.remaining + i.remaining_to_deliver, anomaly: t.anomaly + i.anomaly,
      to_control: t.to_control + i.to_control, controlled: t.controlled + i.controlled,
      in_bags: t.in_bags + i.in_bags, in_boxes: t.in_boxes + i.in_boxes, shipped: t.shipped + i.shipped,
    }), { requested: 0, covered: 0, to_group: 0, uncovered: 0, received: 0, remaining: 0, anomaly: 0, to_control: 0, controlled: 0, in_bags: 0, in_boxes: 0, shipped: 0 });
  }

  for (const order of orderMap.values()) {
    for (const item of order.items) { item.units = itemUnits(item, poById);
      item.unit_counts = item.units.reduce((m, u) => ({ ...m, [u.state]: (m[u.state] || 0) + 1 }), {});
      item.where = itemWhere(item, poById); }
    order.status = orderStatus(order);
  }
  purchaseOrders.forEach((po) => { po.ref = poRef(po.id); po.status_view = poStatusView(po); });

  // Besoins ouverts : fournisseur Ã— Hub d'achat Ã— marchÃ© (une PO) puis SKU. Le marchÃ© est celui de la route.
  const batches = new Map();
  for (const n of needsRows) {
    const key = `${n.supplier_id}|${n.procurement_hub_ref || ''}|${marketId}`;
    if (!batches.has(key)) batches.set(key, {
      key, supplier_id: n.supplier_id, supplier_name: n.supplier_name, procurement_hub_ref: n.procurement_hub_ref || null,
      market_id: marketId, quantity: 0, order_ids: new Set(), groups: new Map(), oldest_at: null,
    });
    const batch = batches.get(key);
    if (n.created_at && (!batch.oldest_at || new Date(n.created_at) < new Date(batch.oldest_at))) batch.oldest_at = n.created_at;
    batch.quantity += Number(n.quantity);
    batch.order_ids.add(n.order_id);
    const skuKey = n.product_sku_id || `ref:${n.supplier_sku || n.product_name}`;
    if (!batch.groups.has(skuKey)) batch.groups.set(skuKey, {
      key: `${key}|${skuKey}`, product_sku_id: n.product_sku_id || null, product: n.product_name, supplier_sku: n.supplier_sku || null,
      quantity: 0, lines: [],
    });
    const group = batch.groups.get(skuKey);
    group.quantity += Number(n.quantity);
    group.lines.push({ line_id: n.line_id, order_id: n.order_id, order_ref: n.order_ref, order_item_id: n.order_item_id, quantity: Number(n.quantity) });
  }
  const needBatches = [...batches.values()].map((b) => ({
    key: b.key, supplier_id: b.supplier_id, supplier_name: b.supplier_name, procurement_hub_ref: b.procurement_hub_ref,
    market_id: b.market_id, quantity: b.quantity, order_count: b.order_ids.size, oldest_at: b.oldest_at,
    groups: [...b.groups.values()],
    // Une ligne ne se rattache qu'Ã  un brouillon dont l'engagement n'est pas encore validÃ© (mÃªme fournisseur, Hub et marchÃ©).
    compatible_draft_po_ids: purchaseOrders.filter((po) => po.status === 'draft' && !po.authorizations.commitment
      && po.supplier_id === b.supplier_id && (po.procurement_hub_ref || null) === b.procurement_hub_ref
      && String(po.market_id) === String(b.market_id)).map((po) => po.id),
  }));

  const orders = [...orderMap.values()];
  return {
    allocation_rule: ALLOCATION_RULE,
    po_steps: PO_STEPS,
    viewer: rights,
    need_batches: needBatches,
    orders,
    unit_legend: Object.entries(UNIT_LABELS).filter(([state]) => state !== 'sourcing').map(([state, label]) => ({ state, label })),
    physical: buildPhysical({ orders, boxes, poById }),
    todo: buildTodo({ orders, unsourced: unsourcedItems, needBatches, purchaseOrders, boxes, viewer: rights, parcelsToReconcile, blockedItems, queuedOrders, now }),
  };
}

async function getDossier({ marketId, supplierId = null, viewer = null, now = new Date() }, q = db) {
  // EntrÃ©e Work : la commande IMPORT reste visible mÃªme avant l'ouverture de
  // sa premiÃ¨re ligne d'achat. LOCAL_STOCK et les sources inconnues ne sont
  // jamais projetÃ©es dans la file Hub. Aucun Ã©tat mÃ©tier calculÃ© ici.
  const { rows: orderRows } = await q.query(`
    SELECT o.id AS order_id, o.reference AS order_ref, o.status AS order_status,
           oi.id AS order_item_id, oi.product_id, oi.sku_id, oi.quantity AS ordered,
           p.name AS product_name, oi.fulfillment_source, o.created_at AS order_created_at,
           (SELECT rl.name FROM relais rl WHERE rl.id = o.relais_id) AS relay_name, o.relais_id AS relay_id,
           COALESCE((
             SELECT SUM(v.received_quantity)::int
               FROM v_purchase_line_progress v
              WHERE v.order_item_id = oi.id AND NOT v.cancelled
           ), 0) AS purchase_received,
           COALESCE((
             SELECT SUM(v.effective_quantity)::int
               FROM v_purchase_line_progress v
              WHERE v.order_item_id = oi.id AND NOT v.cancelled
           ), 0) AS purchase_covered,
           ${hasEligibleSourceSql({
             productSql: 'oi.product_id',
             providerSql: "(SELECT k.supplier_order_identity->>'provider' FROM product_skus k WHERE k.id = oi.sku_id)",
           })} AS supplier_mapping_present
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id AND oi.fulfillment_source = 'IMPORT'
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.market_id = $1 AND o.status NOT IN ('pending', 'cancelled', 'refunded', 'collected')
       AND ($2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM purchase_lines pl
          WHERE pl.order_item_id = oi.id AND pl.supplier_id = $2 AND pl.cancelled_at IS NULL
       ))
     ORDER BY o.created_at DESC, o.id, oi.id`, [marketId, supplierId]);
  const orders = new Map();
  const unsourcedItems = [];
  for (const r of orderRows) {
    if (!orders.has(r.order_id)) orders.set(r.order_id, {
      id: r.order_id, reference: r.order_ref, status: r.order_status, created_at: r.order_created_at || null, relay_name: r.relay_name || null, relay_id: r.relay_id || null, items: [],
    });
    // Le manque de sourcing est un fait calculÃ© depuis la couverture achat
    // effective, pas un statut de commande ni une rÃ©ception physique inventÃ©e.
    const uncovered = Math.max(0, Number(r.ordered) - Number(r.purchase_covered || 0));
    const supplierMapped = r.supplier_mapping_present === true;
    orders.get(r.order_id).items.push({
      id: r.order_item_id, product_id: r.product_id, sku_id: r.sku_id,
      product: r.product_name, ordered: Number(r.ordered),
      fulfillment_source: r.fulfillment_source,
      purchasing_covered: Number(r.purchase_covered || 0),
      purchasing_missing: uncovered,
      received: Number(r.purchase_received || 0),
      supplier_mapping_present: supplierMapped,
      sourcing_required: uncovered > 0,
    });
    if (uncovered > 0) {
      unsourcedItems.push({
        order_id: r.order_id, order_ref: r.order_ref, order_item_id: r.order_item_id,
        product_name: r.product_name, missing_quantity: uncovered, order_created_at: r.order_created_at || null,
        supplier_mapping_present: supplierMapped,
      });
    }
  }

  // Le colis client (parcels) n'est PAS un carton de transport KOM-BOX
  // (hub_physical_units/MARKET_PARCEL). Les deux preuves restent sÃ©parÃ©es.
  const orderIds = [...orders.keys()];
  const clientParcels = new Map();
  if (orderIds.length) {
    const { rows: clientParcelRows } = await q.query(`
      SELECT pa.id AS parcel_id, pa.order_id, pa.reference, pa.status,
             pi.order_item_id, pi.quantity, pi.qty_allocated, pi.qty_packed, pi.qty_shipped
        FROM parcels pa
        JOIN parcel_items pi ON pi.parcel_id = pa.id
        JOIN order_items oi ON oi.id = pi.order_item_id AND oi.fulfillment_source = 'IMPORT'
       WHERE pa.order_id = ANY($1::uuid[]) AND pa.status <> 'cancelled'
       ORDER BY pa.created_at DESC, pa.id, pi.order_item_id`, [orderIds]);
    for (const r of clientParcelRows) {
      if (!clientParcels.has(r.parcel_id)) clientParcels.set(r.parcel_id, {
        id: r.parcel_id, order_id: r.order_id, reference: r.reference,
        status: r.status, contents: [],
      });
      clientParcels.get(r.parcel_id).contents.push({
        order_item_id: r.order_item_id, quantity: Number(r.quantity),
        // Preuve physique dÃ©rivÃ©e des rÃ©ceptions Hub et des placements KOM-BOX (migration 363), jamais prÃ©remplie.
        allocated: Number(r.qty_allocated), packed: Number(r.qty_packed), shipped: Number(r.qty_shipped),
      });
    }
  }

  const { rows: needsRows } = await q.query(`
    SELECT pl.id AS line_id, pl.supplier_id, s.name AS supplier_name, pl.product_sku_id, pl.supplier_sku,
           p.name AS product_name, pl.quantity, oi.order_id, o.reference AS order_ref, pl.order_item_id, pl.created_at,
           pl.procurement_hub_ref, o.created_at AS order_created_at
      FROM purchase_lines pl
      JOIN order_items oi ON oi.id = pl.order_item_id
      JOIN orders o ON o.id = oi.order_id
      JOIN suppliers s ON s.id = pl.supplier_id
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.market_id = $1 AND pl.purchase_order_id IS NULL AND pl.cancelled_at IS NULL
       AND ($2::uuid IS NULL OR pl.supplier_id = $2::uuid)
     ORDER BY s.name, pl.created_at, pl.id`, [marketId, supplierId]);

  const { rows: poRows } = await q.query(`
    SELECT po.id AS po_id, po.status, po.sent_at, po.sent_channel, po.sent_note, po.supplier_order_id, po.supplier_id,
           s.name AS supplier_name, po.procurement_hub_ref, po.created_at, po.updated_at, po.ordered_at,
           pl.id AS line_id, pl.order_item_id, oi.order_id, o.reference AS order_ref, NULLIF(to_jsonb(o)->>'simulation_scope','') AS simulation_scope, p.name AS product_name,
           pl.product_sku_id, pl.quantity AS ordered, vp.effective_quantity AS effective, vp.received_quantity AS received,
           po.trigger_mode, po.confirmed_at, po.market_id AS po_market_id,
           pl.supplier_unit_price, pl.supplier_currency,
           pl.confirmed_unit_price, pl.confirmed_currency, o.created_at AS order_created_at
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN purchase_lines pl ON pl.purchase_order_id = po.id AND pl.cancelled_at IS NULL
      JOIN v_purchase_line_progress vp ON vp.line_id = pl.id
      JOIN order_items oi ON oi.id = pl.order_item_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.market_id = $1 AND ($2::uuid IS NULL OR po.supplier_id = $2::uuid)
     ORDER BY po.created_at DESC, po.id, o.created_at, pl.id`, [marketId, supplierId]);

  const lineIds = poRows.map((r) => r.line_id);
  const anomalyByLine = new Map();
  if (lineIds.length) {
    const { rows } = await q.query(`
      SELECT a.purchase_line_id AS line_id, SUM(p.quantity)::int AS qty
        FROM hub_purchase_allocations a
        JOIN hub_physical_unit_placements p ON p.allocation_id = a.id AND p.removed_at IS NULL
        JOIN hub_physical_units u ON u.id = p.physical_unit_id
       WHERE a.purchase_line_id = ANY($1::uuid[]) AND (u.state = 'QUARANTINED' OR u.outcome_type IS NOT NULL)
       GROUP BY a.purchase_line_id`, [lineIds]);
    rows.forEach((r) => anomalyByLine.set(r.line_id, Number(r.qty)));
  }

  const pos = new Map();
  for (const r of poRows) {
    if (!pos.has(r.po_id)) {
      pos.set(r.po_id, {
        id: r.po_id, status: r.status, supplier_id: r.supplier_id, supplier_name: r.supplier_name,
        procurement_hub_ref: r.procurement_hub_ref, sent_at: r.sent_at, sent_channel: r.sent_channel, sent_note: r.sent_note,
        simulation_scope: r.simulation_scope || null,
        supplier_order_id: r.supplier_order_id, created_at: r.created_at, updated_at: r.updated_at, ordered_at: r.ordered_at,
        trigger_mode: r.trigger_mode || null, confirmed_at: r.confirmed_at || null, market_id: r.po_market_id || marketId,
        lines: [],
      });
    }
    const effective = Number(r.effective || 0);
    const received = Number(r.received || 0);
    pos.get(r.po_id).lines.push({
      line_id: r.line_id, order_id: r.order_id, order_ref: r.order_ref, order_item_id: r.order_item_id,
      product: r.product_name, product_sku_id: r.product_sku_id,
      ordered: Number(r.ordered), confirmed: effective, received, missing: Math.max(effective - received, 0),
      anomaly: anomalyByLine.get(r.line_id) || 0,
      order_created_at: r.order_created_at || null,
      simulation_scope: r.simulation_scope || null,
      unit_price: r.supplier_unit_price == null ? null : Number(r.supplier_unit_price),
      currency: r.supplier_currency || null,
      // Le devis fournisseur initial ne bouge jamais ; afficher la vÃ©ritÃ©
      // de la confirmation sÃ©parÃ©ment, y compris sur les PO Hub sans devis.
      confirmed_unit_price: r.confirmed_unit_price == null ? null : Number(r.confirmed_unit_price),
      confirmed_currency: r.confirmed_currency || r.supplier_currency || null,
    });
  }
  const purchaseOrders = [...pos.values()].map((po) => {
    // SimulÃ© seulement si TOUTES les lignes partagent la mÃªme portÃ©e (rÃ¨gle serveur g6SupplierSimulation).
    po.simulation_scope = new Set(po.lines.map((l) => l.simulation_scope)).size === 1 ? po.lines[0].simulation_scope : null;
    po.simulation_reference = po.simulation_scope === 'G6-BUYER' ? po.id : null;
    const totals = po.lines.reduce((t, l) => ({
      effective: t.effective + l.confirmed, received: t.received + l.received,
      missing: t.missing + l.missing, anomaly: t.anomaly + l.anomaly,
    }), { effective: 0, received: 0, missing: 0, anomaly: 0 });
    return { ...po, stage: poStage(po, totals), totals };
  });

  const { rows: receiptRows } = await q.query(`
    SELECT u.id, u.reference, u.external_ref, u.state, u.created_at,
           ARRAY_AGG(DISTINCT a.purchase_order_id) AS po_ids, SUM(p.quantity)::int AS qty
      FROM hub_physical_units u
      JOIN hub_physical_unit_placements p ON p.physical_unit_id = u.id AND p.operation_type = 'RECEIVE'
      JOIN hub_purchase_allocations a ON a.id = p.allocation_id
     WHERE a.market_id = $1 AND u.unit_type = 'SUPPLIER_PACKAGE'
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT 100`, [marketId]);

  const { rows: boxRows } = await q.query(`
    SELECT u.id AS unit_id, u.reference, u.state, u.market_id, u.created_at, sh.reference AS shipment_ref, sh.stage AS shipment_stage,
           a.order_id, o.reference AS order_ref, a.purchase_line_id, p.quantity, p.bag_unit_id
      FROM hub_physical_units u
      JOIN hub_box_effective_placements p ON p.box_unit_id = u.id
      JOIN hub_purchase_allocations a ON a.id = p.allocation_id
      JOIN orders o ON o.id = a.order_id
      LEFT JOIN international_shipment_hub_units hs ON hs.physical_unit_id = u.id
      LEFT JOIN international_shipments sh ON sh.id = hs.shipment_id
     WHERE u.unit_type = 'MARKET_PARCEL' AND a.market_id = $1
     ORDER BY u.created_at DESC, u.id`, [marketId]);
  const boxes = new Map();
  for (const r of boxRows) {
    if (!boxes.has(r.unit_id)) {
      boxes.set(r.unit_id, { unit_id: r.unit_id, reference: r.reference, state: r.state, created_at: r.created_at || null, shipment_ref: r.shipment_ref || null,
        shipment_stage: r.shipment_stage || null, contents: [] });
    }
    boxes.get(r.unit_id).contents.push({ order_id: r.order_id, order_ref: r.order_ref, line_id: r.purchase_line_id, qty: Number(r.quantity), bag_unit_id: r.bag_unit_id || null });
  }

  // KOM-BOX vides (crÃ©Ã©es depuis le Hub, pas encore composÃ©es) : visibles pour pouvoir Ãªtre remplies.
  const { rows: emptyBoxRows } = await q.query(`
    SELECT u.id AS unit_id, u.reference, u.state, u.created_at FROM hub_physical_units u
     WHERE u.unit_type = 'MARKET_PARCEL' AND u.state NOT IN ('DISPATCHED','SUPERSEDED','QUARANTINED')
       AND (u.market_id = $1 OR u.market_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM hub_box_effective_placements p WHERE p.box_unit_id = u.id)
     ORDER BY u.created_at DESC LIMIT 20`, [marketId]);
  for (const r of emptyBoxRows) {
    if (!boxes.has(r.unit_id)) boxes.set(r.unit_id, { unit_id: r.unit_id, reference: r.reference, state: r.state, created_at: r.created_at || null, shipment_ref: null, shipment_stage: null, contents: [] });
  }

  // QuantitÃ©s reÃ§ues pas encore mises en carton : sources proposÃ©es pour composer une KOM-BOX (REPACK), sans ressaisie.
  const { rows: fillableRows } = await q.query(`
    SELECT p.allocation_id, u.id AS from_unit_id, u.reference AS from_unit_ref, a.order_id, o.reference AS order_ref,
           a.order_item_id, a.product_sku_id, pr.name AS product_name, p.quantity
      FROM hub_phym«ëŒ+Š×®º+º$zzb¥çFVÕö–C¢âæ÷&FW%ö—FVÕö–BÂVçF—G“¢çVÖ&W"†âçVçF—G’’Ò“°¢Ğ¢6öç7BæVVD&F6†W2Ò²ââæ&F6†W2çfÇVW2‚•ÒæÖ‚†"’Óâ‡°¢¶W“¢"æ¶W’Â7WÆ–W%ö–C¢"ç7WÆ–W%ö–BÂ7WÆ–W%öæÖS¢"ç7WÆ–W%öæÖRÂ&ö7W&VÖVçEö‡V%÷&Vc¢"ç&ö7W&VÖVçEö‡V%÷&VbÀ¢Ö&¶WEö–C¢"æÖ&¶WEö–BÂVçF—G“¢"çVçF—G’Â÷&FW%ö6÷VçC¢"æ÷&FW%ö–G2ç6—¦RÂöÆFW7EöC¢"æöÆFW7EöBÀ¢w&÷W3¢²ââæ"æw&÷W2çfÇVW2‚•ÒÀ¢òòVæRÆ–væRæR6R&GF6†RR|:Vâ'&÷V–ÆÆöâFöçBÂvVævvVÖVçBâvW7B2Væ6÷&RfÆ–L:’†Ü:¦ÖRf÷W&æ—76WW"Â‡V"WBÖ&6Œ:’’à¢6ö×F–&ÆUöG&gE÷õö–G3¢W&6†6T÷&FW'2æf–ÇFW"‚‡ò’Óâòç7FGW2ÓÓÒvG&gBrbbòæWF†÷&—¦F–öç2æ6öÖÖ—FÖVç@¢bbòç7WÆ–W%ö–BÓÓÒ"ç7WÆ–W%ö–Bbb‡òç&ö7W&VÖVçEö‡V%÷&VbÇÂçVÆÂ’ÓÓÒ"ç&ö7W&VÖVçEö‡V%÷&V`¢bb7G&–ær‡òæÖ&¶WEö–B’ÓÓÒ7G&–ær†"æÖ&¶WEö–B’’æÖ‚‡ò’Óâòæ–B’À¢Ò’“° ¢6öç7B÷&FW'2Ò²ââæ÷&FW$ÖçfÇVW2‚•Ó°¢&WGW&â°¢ÆÆö6F–öå÷'VÆS¢ÄÄô4D”ôåõ%TÄRÀ¢õ÷7FW3¢õõ5DU2À¢f–WvW#¢&–v‡G2À¢æVVEö&F6†W3¢æVVD&F6†W2À¢÷&FW'2À¢Væ—EöÆVvVæC¢ö&¦V7BæVçG&–W2…Tä•EôÄ$TÅ2’æf–ÇFW"‚…·7FFUÒ’Óâ7FFRÓÒw6÷W&6–ærr’æÖ‚…·7FFRÂÆ&VÅÒ’Óâ‡²7FFRÂÆ&VÂÒ’’À¢‡—6–6Ã¢'V–ÆE‡—6–6Â‡²÷&FW'2Â&÷†W2Âô'”–BÒ’À¢FöFó¢'V–ÆEFöFò‡²÷&FW'2ÂVç6÷W&6VC¢Vç6÷W&6VD—FV×2ÂæVVD&F6†W2ÂW&6†6T÷&FW'2Â&÷†W2Âf–WvW#¢&–v‡G2Â&6VÇ5Fõ&V6öæ6–ÆRÂ&Æö6¶VD—FV×2ÂVWVVD÷&FW'2Âæ÷rÒ’À¢Ó°§Ğ ¦7–æ2gVæ7F–öâvWDF÷76–W"‡²Ö&¶WD–BÂ7WÆ–W$–BÒçVÆÂÂf–WvW"ÒçVÆÂÂæ÷rÒæWrFFR‚’ÒÂÒF"’°¢òòVçG,:–Rv÷&²¢Æ6öÖÖæFR”Õõ%B&W7FRf—6–&ÆRÜ:¦ÖRfçBÂv÷WfW'GW&RFP¢òò6&VÖœ:‡&RÆ–væRBv6†BâÄô4Åõ5Dô4²WBÆW26÷W&6W2–æ6öæçVW2æR6öç@¢òò¦Ö—2&ö¦WL:–W2Fç2Æf–ÆR‡V"âV7Vâ:—FBÜ:—F–W"6Æ7VÌ:’–6’à¢6öç7B²&÷w3¢÷&FW%&÷w2ÒÒv—BçVW'’† ¢4TÄT5Bòæ–B2÷&FW%ö–BÂòç&VfW&Væ6R2÷&FW%÷&VbÂòç7FGW22÷&FW%÷7FGW2À¢ö’æ–B2÷&FW%ö—FVÕö–BÂö’ç&öGV7Eö–BÂö’ç6·Uö–BÂö’çVçF—G’2÷&FW&VBÀ¢ææÖR2&öGV7EöæÖRÂö’ægVÆf–ÆÆÖVçE÷6÷W&6RÂòæ7&VFVEöB2÷&FW%ö7&VFVEöBÀ¢…4TÄT5B&ÂææÖRe$ôÒ&VÆ—2&Ât„U$R&Âæ–BÒòç&VÆ—5ö–B’2&VÆ•öæÖRÂòç&VÆ—5ö–B2&VÆ•ö–BÀ¢4ôÄU44R‚€¢4TÄT5B5TÒ‡bç&V6V—fVE÷VçF—G’“£¦–ç@¢e$ôÒe÷W&6†6UöÆ–æU÷&öw&W72`¢t„U$Rbæ÷&FW%ö—FVÕö–BÒö’æ–BäBäõBbæ6æ6VÆÆV@¢’Â’2W&6†6U÷&V6V—fVBÀ¢4ôÄU44R‚€¢4TÄT5B5TÒ‡bæVffV7F—fU÷VçF—G’“£¦–ç@¢e$ôÒe÷W&6†6UöÆ–æU÷&öw&W72`¢t„U$Rbæ÷&FW%ö—FVÕö–BÒö’æ–BäBäõBbæ6æ6VÆÆV@¢’Â’2W&6†6Uö6÷fW&VBÀ¢G¶†4VÆ–v–&ÆU6÷W&6U7Â‡°¢&öGV7E7Ã¢vö’ç&öGV7Eö–BrÀ¢&÷f–FW%7Ã¢"…4TÄT5B²ç7WÆ–W%ö÷&FW%ö–FVçF—G’Óãâw&÷f–FW"re$ôÒ&öGV7E÷6·W2²t„U$R²æ–BÒö’ç6·Uö–B’"À¢Ò—Ò27WÆ–W%öÖ–æu÷&W6Vç@¢e$ôÒ÷&FW'2ğ¢¤ô”â÷&FW%ö—FV×2ö’ôâö’æ÷&FW%ö–BÒòæ–BäBö’ægVÆf–ÆÆÖVçE÷6÷W&6RÒt”Õõ%Bp¢ÄTeB¤ô”â&öGV7G2ôâæ–BÒö’ç&öGV7Eö–@¢t„U$RòæÖ&¶WEö–BÒCäBòç7FGW2äõB”â‚wVæF–ærrÂv6æ6VÆÆVBrÂw&VgVæFVBrÂv6öÆÆV7FVBr¢äB‚C#£§WV–B•2åTÄÂõ"U„•5E2€¢4TÄT5Be$ôÒW&6†6UöÆ–æW2À¢t„U$RÂæ÷&FW%ö—FVÕö–BÒö’æ–BäBÂç7WÆ–W%ö–BÒC"äBÂæ6æ6VÆÆVEöB•2åTÄÀ¢’¢õ$DU"%’òæ7&VFVEöBDU42Âòæ–BÂö’æ–FÂ¶Ö&¶WD–BÂ7WÆ–W$–EÒ“°¢6öç7B÷&FW'2ÒæWrÖ‚“°¢6öç7BVç6÷W&6VD—FV×2ÒµÓ°¢f÷"†6öç7B"öb÷&FW%&÷w2’°¢–b‚÷&FW'2æ†2‡"æ÷&FW%ö–B’’÷&FW'2ç6WB‡"æ÷&FW%ö–BÂ°¢–C¢"æ÷&FW%ö–BÂ&VfW&Væ6S¢"æ÷&FW%÷&VbÂ7FGW3¢"æ÷&FW%÷7FGW2Â7&VFVEöC¢"æ÷&FW%ö7&VFVEöBÇÂçVÆÂÂ&VÆ•öæÖS¢"ç&VÆ•öæÖRÇÂçVÆÂÂ&VÆ•ö–C¢"ç&VÆ•ö–BÇÂçVÆÂÂ—FV×3¢µÒÀ¢Ò“°¢òòÆRÖçVRFR6÷W&6–ærW7BVâf—B6Æ7VÌ:’FWV—2Æ6÷WfW'GW&R6†@¢òòVffV7F—fRÂ2Vâ7FGWBFR6öÖÖæFRæ’VæR,:–6WF–öâ‡—6—VR–çfVçL:–Rà¢6öç7BVæ6÷fW&VBÒÖF‚æÖ‚ƒÂçVÖ&W"‡"æ÷&FW&VB’ÒçVÖ&W"‡"çW&6†6Uö6÷fW&VBÇÂ’“°¢6öç7B7WÆ–W$ÖVBÒ"ç7WÆ–W%öÖ–æu÷&W6VçBÓÓÒG'VS°¢÷&FW'2ævWB‡"æ÷&FW%ö–B’æ—FV×2çW6‚‡°¢–C¢"æ÷&FW%ö—FVÕö–BÂ&öGV7Eö–C¢"ç&öGV7Eö–BÂ6·Uö–C¢"ç6·Uö–BÀ¢&öGV7C¢"ç&öGV7EöæÖRÂ÷&FW&VC¢çVÖ&W"‡"æ÷&FW&VB’À¢gVÆf–ÆÆÖVçE÷6÷W&6S¢"ægVÆf–ÆÆÖVçE÷6÷W&6RÀ¢W&6†6–æuö6÷fW&VC¢çVÖ&W"‡"çW&6†6Uö6÷fW&VBÇÂ’À¢W&6†6–æuöÖ—76–æs¢Væ6÷fW&VBÀ¢&V6V—fVC¢çVÖ&W"‡"çW&6†6U÷&V6V—fVBÇÂ’À¢7WÆ–W%öÖ–æu÷&W6VçC¢7WÆ–W$ÖVBÀ¢6÷W&6–æu÷&WV—&VC¢Væ6÷fW&VBâÀ¢Ò“°¢–b‡Væ6÷fW&VBâ’°¢Vç6÷W&6VD—FV×2çW6‚‡°¢÷&FW%ö–C¢"æ÷&FW%ö–BÂ÷&FW%÷&Vc¢"æ÷&FW%÷&VbÂ÷&FW%ö—FVÕö–C¢"æ÷&FW%ö—FVÕö–BÀ¢&öGV7EöæÖS¢"ç&öGV7EöæÖRÂÖ—76–æu÷VçF—G“¢Væ6÷fW&VBÂ÷&FW%ö7&VFVEöC¢"æ÷&FW%ö7&VFVEöBÇÂçVÆÂÀ¢7WÆ–W%öÖ–æu÷&W6VçC¢7WÆ–W$ÖVBÀ¢Ò“°¢Ğ¢Ğ ¢òòÆR6öÆ—26Æ–VçB‡&6VÇ2’âvW7B2Vâ6'FöâFRG&ç7÷'B´ôÒÔ$õ€¢òò†‡V%÷‡—6–6Å÷Væ—G2ôÔ$´UEõ$4TÂ’âÆW2FWW‚&WWfW2&W7FVçB<:—,:–W2à¢6öç7B÷&FW$–G2Ò²ââæ÷&FW'2æ¶W—2‚•Ó°¢6öç7B6Æ–VçE&6VÇ2ÒæWrÖ‚“°¢–b†÷&FW$–G2æÆVæwF‚’°¢6öç7B²&÷w3¢6Æ–VçE&6VÅ&÷w2ÒÒv—BçVW'’† ¢4TÄT5Bæ–B2&6VÅö–BÂæ÷&FW%ö–BÂç&VfW&Væ6RÂç7FGW2À¢’æ÷&FW%ö—FVÕö–BÂ’çVçF—G’Â’çG•öÆÆö6FVBÂ’çG•÷6¶VBÂ’çG•÷6†—V@¢e$ôÒ&6VÇ2¢¤ô”â&6VÅö—FV×2’ôâ’ç&6VÅö–BÒæ–@¢¤ô”â÷&FW%ö—FV×2ö’ôâö’æ–BÒ’æ÷&FW%ö—FVÕö–BäBö’ægVÆf–ÆÆÖVçE÷6÷W&6RÒt”Õõ%Bp¢t„U$Ræ÷&FW%ö–BÒå’‚C£§WV–EµÒ’äBç7FGW2Ãâv6æ6VÆÆVBp¢õ$DU"%’æ7&VFVEöBDU42Âæ–BÂ’æ÷&FW%ö—FVÕö–FÂ¶÷&FW$–G5Ò“°¢f÷"†6öç7B"öb6Æ–VçE&6VÅ&÷w2’°¢–b‚6Æ–VçE&6VÇ2æ†2‡"ç&6VÅö–B’’6Æ–VçE&6VÇ2ç6WB‡"ç&6VÅö–BÂ°¢–C¢"ç&6VÅö–BÂ÷&FW%ö–C¢"æ÷&FW%ö–BÂ&VfW&Væ6S¢"ç&VfW&Væ6RÀ¢7FGW3¢"ç7FGW2Â6öçFVçG3¢µÒÀ¢Ò“°¢6Æ–VçE&6VÇ2ævWB‡"ç&6VÅö–B’æ6öçFVçG2çW6‚‡°¢÷&FW%ö—FVÕö–C¢"æ÷&FW%ö—FVÕö–BÂVçF—G“¢çVÖ&W"‡"çVçF—G’’À¢òò&WWfR‡—6—VRL:—&—l:–RFW2,:–6WF–öç2‡V"WBFW2Æ6VÖVçG2´ôÒÔ$õ‚†Ö–w&F–öâ3c2’Â¦Ö—2,:—&V×Æ–Rà¢ÆÆö6FVC¢çVÖ&W"‡"çG•öÆÆö6FVB’Â6¶VC¢çVÖ&W"‡"çG•÷6¶VB’Â6†—VC¢çVÖ&W"‡"çG•÷6†—VB’À¢Ò“°¢Ğ¢Ğ ¢6öç7B²&÷w3¢æVVG5&÷w2ÒÒv—BçVW'’† ¢4TÄT5BÂæ–B2Æ–æUö–BÂÂç7WÆ–W%ö–BÂ2ææÖR27WÆ–W%öæÖRÂÂç&öGV7E÷6·Uö–BÂÂç7WÆ–W%÷6·RÀ¢ææÖR2&öGV7EöæÖRÂÂçVçF—G’Âö’æ÷&FW%ö–BÂòç&VfW&Væ6R2÷&FW%÷&VbÂÂæ÷&FW%ö—FVÕö–BÂÂæ7&VFVEöBÀ¢Âç&ö7W&VÖVçEö‡V%÷&VbÂòæ7&VFVEöB2÷&FW%ö7&VFVEö@¢e$ôÒW&6†6UöÆ–æW2À¢¤ô”â÷&FW%ö—FV×2ö’ôâö’æ–BÒÂæ÷&FW%ö—FVÕö–@¢¤ô”â÷&FW'2òôâòæ–BÒö’æ÷&FW%ö–@¢¤ô”â7WÆ–W'22ôâ2æ–BÒÂç7WÆ–W%ö–@¢ÄTeB¤ô”â&öGV7G2ôâæ–BÒö’ç&öGV7Eö–@¢t„U$RòæÖ&¶WEö–BÒCäBÂçW&6†6Uö÷&FW%ö–B•2åTÄÂäBÂæ6æ6VÆÆVEöB•2åTÄÀ¢äB‚C#£§WV–B•2åTÄÂõ"Âç7WÆ–W%ö–BÒC#£§WV–B¢õ$DU"%’2ææÖRÂÂæ7&VFVEöBÂÂæ–FÂ¶Ö&¶WD–BÂ7WÆ–W$–EÒ“° ¢6öç7B²&÷w3¢õ&÷w2ÒÒv—BçVW'’† ¢4TÄT5Bòæ–B2õö–BÂòç7FGW2Âòç6VçEöBÂòç6VçEö6†ææVÂÂòç6VçEöæ÷FRÂòç7WÆ–W%ö÷&FW%ö–BÂòç7WÆ–W%ö–BÀ¢2ææÖR27WÆ–W%öæÖRÂòç&ö7W&VÖVçEö‡V%÷&VbÂòæ7&VFVEöBÂòçWFFVEöBÂòæ÷&FW&VEöBÀ¢Âæ–B2Æ–æUö–BÂÂæ÷&FW%ö—FVÕö–BÂö’æ÷&FW%ö–BÂòç&VfW&Væ6R2÷&FW%÷&VbÂåTÄÄ”b‡Fõö§6öæ"†ò’Óãâw6–×VÆF–öå÷66÷RrÂrr’26–×VÆF–öå÷66÷RÂææÖR2&öGV7EöæÖRÀ¢Âç&öGV7E÷6·Uö–BÂÂçVçF—G’2÷&FW&VBÂgæVffV7F—fU÷VçF—G’2VffV7F—fRÂgç&V6V—fVE÷VçF—G’2&V6V—fVBÀ¢òçG&–vvW%öÖöFRÂòæ6öæf—&ÖVEöBÂòæÖ&¶WEö–B2õöÖ&¶WEö–BÀ¢Âç7WÆ–W%÷Væ—E÷&–6RÂÂç7WÆ–W%ö7W'&Væ7’À¢Âæ6öæf—&ÖVE÷Væ—E÷&–6RÂÂæ6öæf—&ÖVEö7W'&Væ7’Âòæ7&VFVEöB2÷&FW%ö7&VFVEö@¢e$ôÒW&6†6Uö÷&FW'2ğ¢¤ô”â7WÆ–W'22ôâ2æ–BÒòç7WÆ–W%ö–@¢¤ô”âW&6†6UöÆ–æW2ÂôâÂçW&6†6Uö÷&FW%ö–BÒòæ–BäBÂæ6æ6VÆÆVEöB•2åTÄÀ¢¤ô”âe÷W&6†6UöÆ–æU÷&öw&W72gôâgæÆ–æUö–BÒÂæ–@¢¤ô”â÷&FW%ö—FV×2ö’ôâö’æ–BÒÂæ÷&FW%ö—FVÕö–@¢¤ô”â÷&FW'2òôâòæ–BÒö’æ÷&FW%ö–@¢ÄTeB¤ô”â&öGV7G2ôâæ–BÒö’ç&öGV7Eö–@¢t„U$RòæÖ&¶WEö–BÒCäB‚C#£§WV–B•2åTÄÂõ"òç7WÆ–W%ö–BÒC#£§WV–B¢õ$DU"%’òæ7&VFVEöBDU42Âòæ–BÂòæ7&VFVEöBÂÂæ–FÂ¶Ö&¶WD–BÂ7WÆ–W$–EÒ“° ¢6öç7BÆ–æT–G2Òõ&÷w2æÖ‚‡"’Óâ"æÆ–æUö–B“°¢6öç7BæöÖÇ”'”Æ–æRÒæWrÖ‚“°¢–b†Æ–æT–G2æÆVæwF‚’°¢6öç7B²&÷w2ÒÒv—BçVW'’† ¢4TÄT5BçW&6†6UöÆ–æUö–B2Æ–æUö–BÂ5TÒ‡çVçF—G’“£¦–çB2G¢e$ôÒ‡V%÷W&6†6UöÆÆö6F–öç2¢¤ô”â‡V%÷‡—6–6Å÷Væ—E÷Æ6VÖVçG2ôâæÆÆö6F–öåö–BÒæ–BäBç&VÖ÷fVEöB•2åTÄÀ¢¤ô”â‡V%÷‡—6–6Å÷Væ—G2RôâRæ–BÒç‡—6–6Å÷Væ—Eö–@¢t„U$RçW&6†6UöÆ–æUö–BÒå’‚C£§WV–EµÒ’äB‡Rç7FFRÒuT$åD”äTBrõ"Ræ÷WF6öÖU÷G—R•2äõBåTÄÂ¢u$õU%’çW&6†6UöÆ–æUö–FÂ¶Æ–æT–G5Ò“°¢&÷w2æf÷$V6‚‚‡"’ÓâæöÖÇ”'”Æ–æRç6WB‡"æÆ–æUö–BÂçVÖ&W"‡"çG’’’“°¢Ğ ¢6öç7B÷2ÒæWrÖ‚“°¢f÷"†6öç7B"öbõ&÷w2’°¢–b‚÷2æ†2‡"çõö–B’’°¢÷2ç6WB‡"çõö–BÂ°¢–C¢"çõö–BÂ7FGW3¢"ç7FGW2Â7WÆ–W%ö–C¢"ç7WÆ–W%ö–BÂ7WÆ–W%öæÖS¢"ç7WÆ–W%öæÖRÀ¢&ö7W&VÖVçEö‡V%÷&Vc¢"ç&ö7W&VÖVçEö‡V%÷&VbÂ6VçEöC¢"ç6VçEöBÂ6VçEö6†ææVÃ¢"ç6VçEö6†ææVÂÂ6VçEöæ÷FS¢"ç6VçEöæ÷FRÀ¢6–×VÆF–öå÷66÷S¢"ç6–×VÆF–öå÷66÷RÇÂçVÆÂÀ¢7WÆ–W%ö÷&FW%ö–C¢"ç7WÆ–W%ö÷&FW%ö–BÂ7&VFVEöC¢"æ7&VFVEöBÂWFFVEöC¢"çWFFVEöBÂ÷&FW&VEöC¢"æ÷&FW&VEöBÀ¢G&–vvW%öÖöFS¢"çG&–vvW%öÖöFRÇÂçVÆÂÂ6öæf—&ÖVEöC¢"æ6öæf—&ÖVEöBÇÂçVÆÂÂÖ&¶WEö–C¢"çõöÖ&¶WEö–BÇÂÖ&¶WD–BÀ¢Æ–æW3¢µÒÀ¢Ò“°¢Ğ¢6öç7BVffV7F—fRÒçVÖ&W"‡"æVffV7F—fRÇÂ“°¢6öç7B&V6V—fVBÒçVÖ&W"‡"ç&V6V—fVBÇÂ“°¢÷2ævWB‡"çõö–B’æÆ–æW2çW6‚‡°¢Æ–æUö–C¢"æÆ–æUö–BÂ÷&FW%ö–C¢"æ÷&FW%ö–BÂ÷&FW%÷&Vc¢"æ÷&FW%÷&VbÂ÷&FW%ö—FVÕö–C¢"æ÷&FW%ö—FVÕö–BÀ¢&öGV7C¢"ç&öGV7EöæÖRÂ&öGV7E÷6·Uö–C¢"ç&öGV7E÷6·Uö–BÀ¢÷&FW&VC¢çVÖ&W"‡"æ÷&FW&VB’Â6öæf—&ÖVC¢VffV7F—fRÂ&V6V—fVBÂÖ—76–æs¢ÖF‚æÖ‚†VffV7F—fRÒ&V6V—fVBÂ’À¢æöÖÇ“¢æöÖÇ”'”Æ–æRævWB‡"æÆ–æUö–B’ÇÂÀ¢÷&FW%ö7&VFVEöC¢"æ÷&FW%ö7&VFVEöBÇÂçVÆÂÀ¢6–×VÆF–öå÷66÷S¢"ç6–×VÆF–öå÷66÷RÇÂçVÆÂÀ¢Væ—E÷&–6S¢"ç7WÆ–W%÷Væ—E÷&–6RÓÒçVÆÂòçVÆÂ¢çVÖ&W"‡"ç7WÆ–W%÷Væ—E÷&–6R’À¢7W'&Væ7“¢"ç7WÆ–W%ö7W'&Væ7’ÇÂçVÆÂÀ¢òòÆRFWf—2f÷W&æ—76WW"–æ—F–ÂæR&÷VvR¦Ö—2²ff–6†W"Æl:—&—L:¢òòFRÆ6öæf—&ÖF–öâ<:—,:–ÖVçBÂ’6ö×&—27W"ÆW2ò‡V"6ç2FWf—2à¢6öæf—&ÖVE÷Væ—E÷&–6S¢"æ6öæf—&ÖVE÷Væ—E÷&–6RÓÒçVÆÂòçVÆÂ¢çVÖ&W"‡"æ6öæf—&ÖVE÷Væ—E÷&–6R’À¢6öæf—&ÖVEö7W'&Væ7“¢"æ6öæf—&ÖVEö7W'&Væ7’ÇÂ"ç7WÆ–W%ö7W'&Væ7’ÇÂçVÆÂÀ¢Ò“°¢Ğ¢6öç7BW&6†6T÷&FW'2Ò²ââç÷2çfÇVW2‚•ÒæÖ‚‡ò’Óâ°¢òò6–×VÌ:’6WVÆVÖVçB6’DõUDU2ÆW2Æ–væW2'FvVçBÆÜ:¦ÖR÷'L:–R‡,:†vÆR6W'fWW"se7WÆ–W%6–×VÆF–öâ’à¢òç6–×VÆF–öå÷66÷RÒæWr6WB‡òæÆ–æW2æÖ‚†Â’ÓâÂç6–×VÆF–öå÷66÷R’’ç6—¦RÓÓÒòòæÆ–æW5³Òç6–×VÆF–öå÷66÷R¢çVÆÃ°¢òç6–×VÆF–öå÷&VfW&Væ6RÒòç6–×VÆF–öå÷66÷RÓÓÒtsbÔ%U”U"ròòæ–B¢çVÆÃ°¢6öç7BF÷FÇ2ÒòæÆ–æW2ç&VGV6R‚‡BÂÂ’Óâ‡°¢VffV7F—fS¢BæVffV7F—fR²Âæ6öæf—&ÖVBÂ&V6V—fVC¢Bç&V6V—fVB²Âç&V6V—fVBÀ¢Ö—76–æs¢BæÖ—76–ær²ÂæÖ—76–ærÂæöÖÇ“¢BææöÖÇ’²ÂææöÖÇ’À¢Ò’Â²VffV7F—fS¢Â&V6V—fVC¢ÂÖ—76–æs¢ÂæöÖÇ“¢Ò“°¢&WGW&â²ââçòÂ7FvS¢õ7FvR‡òÂF÷FÇ2’ÂF÷FÇ2Ó°¢Ò“° ¢6öç7B²&÷w3¢&V6V—E&÷w2ÒÒv—BçVW'’† ¢4TÄT5BRæ–BÂRç&VfW&Væ6RÂRæW‡FW&æÅ÷&VbÂRç7FFRÂRæ7&VFVEöBÀ¢%$•ôtr„D•5D”ä5BçW&6†6Uö÷&FW%ö–B’2õö–G2Â5TÒ‡çVçF—G’“£¦–çB2G¢e$ôÒ‡V%÷‡—6–6Å÷Væ—G2P¢¤ô”â‡V%÷‡—6–6Å÷Væ—E÷Æ6VÖVçG2ôâç‡—6–6Å÷Væ—Eö–BÒRæ–BäBæ÷W&F–öå÷G—RÒu$T4T•dRp¢¤ô”â‡V%÷W&6†6UöÆÆö6F–öç2ôâæ–BÒæÆÆö6F–öåö–@¢t„U$RæÖ&¶WEö–BÒCäBRçVæ—E÷G—RÒu5UÄ”U%õ4´tRp¢u$õU%’Ræ–Bõ$DU"%’Ræ7&VFVEöBDU42Ä”Ô•BÂ¶Ö&¶WD–EÒ“° ¢6öç7B²&÷w3¢&÷…&÷w2ÒÒv—BçVW'’† ¢4TÄT5BRæ–B2Væ—Eö–BÂRç&VfW&Væ6RÂRç7FFRÂRæÖ&¶WEö–BÂRæ7&VFVEöBÂ6‚ç&VfW&Væ6R26†—ÖVçE÷&VbÂ6‚ç7FvR26†—ÖVçE÷7FvRÀ¢æ÷&FW%ö–BÂòç&VfW&Væ6R2÷&FW%÷&VbÂçW&6†6UöÆ–æUö–BÂçVçF—G’Âæ&u÷Væ—Eö–@¢e$ôÒ‡V%÷‡—6–6Å÷Væ—G2P¢¤ô”â‡V%ö&÷…öVffV7F—fU÷Æ6VÖVçG2ôâæ&÷…÷Væ—Eö–BÒRæ–@¢¤ô”â‡V%÷W&6†6UöÆÆö6F–öç2ôâæ–BÒæÆÆö6F–öåö–@¢¤ô”â÷&FW'2òôâòæ–BÒæ÷&FW%ö–@¢ÄTeB¤ô”â–çFW&æF–öæÅ÷6†—ÖVçEö‡V%÷Væ—G2‡2ôâ‡2ç‡—6–6Å÷Væ—Eö–BÒRæ–@¢ÄTeB¤ô”â–çFW&æF–öæÅ÷6†—ÖVçG26‚ôâ6‚æ–BÒ‡2ç6†—ÖVçEö–@¢t„U$RRçVæ—E÷G—RÒtÔ$´UEõ$4TÂräBæÖ&¶WEö–BÒC¢õ$DU"%’Ræ7&VFVEöBDU42ÂRæ–FÂ¶Ö&¶WD–EÒ“°¢6öç7B&÷†W2ÒæWrÖ‚“°¢f÷"†6öç7B"öb&÷…&÷w2’°¢–b‚&÷†W2æ†2‡"çVæ—Eö–B’’°¢&÷†W2ç6WB‡"çVæ—Eö–BÂ²Væ—Eö–C¢"çVæ—Eö–BÂ&VfW&Væ6S¢"ç&VfW&Væ6RÂ7FFS¢"ç7FFRÂ7&VFVEöC¢"æ7&VFVEöBÇÂçVÆÂÂ6†—ÖVçE÷&Vc¢"ç6†—ÖVçE÷&VbÇÂçVÆÂÀ¢6†—ÖVçE÷7FvS¢"ç6†—ÖVçE÷7FvRÇÂçVÆÂÂ6öçFVçG3¢µÒÒ“°¢Ğ¢&÷†W2ævWB‡"çVæ—Eö–B’æ6öçFVçG2çW6‚‡²÷&FW%ö–C¢"æ÷&FW%ö–BÂ÷&FW%÷&Vc¢"æ÷&FW%÷&VbÂÆ–æUö–C¢"çW&6†6UöÆ–æUö–BÂG“¢çVÖ&W"‡"çVçF—G’’Â&u÷Væ—Eö–C¢"æ&u÷Væ—Eö–BÇÂçVÆÂÒ“°¢Ğ ¢òò´ôÒÔ$õ‚f–FW2†7,:œ:–W2FWV—2ÆR‡V"Â2Væ6÷&R6ö×÷<:–W2’¢f—6–&ÆW2÷W"÷Wfö—":§G&R&V×Æ–W2à¢6öç7B²&÷w3¢V×G”&÷…&÷w2ÒÒv—BçVW'’† ¢4TÄT5BRæ–B2Væ—Eö–BÂRç&VfW&Væ6RÂRç7FFRÂRæ7&VFVEöBe$ôÒ‡V%÷‡—6–6Å÷Væ—G2P¢t„U$RRçVæ—E÷G—RÒtÔ$´UEõ$4TÂräBRç7FFRäõB”â‚tD•5D4„TBrÂu5UU%4TDTBrÂuT$åD”äTBr¢äB‡RæÖ&¶WEö–BÒCõ"RæÖ&¶WEö–B•2åTÄÂ¢äBäõBU„•5E2…4TÄT5Be$ôÒ‡V%ö&÷…öVffV7F—fU÷Æ6VÖVçG2t„U$Ræ&÷…÷Væ—Eö–BÒRæ–B¢õ$DU"%’Ræ7&VFVEöBDU42Ä”Ô•B#Â¶Ö&¶WD–EÒ“°¢f÷"†6öç7B"öbV×G”&÷…&÷w2’°¢–b‚&÷†W2æ†2‡"çVæ—Eö–B’’&÷†W2ç6WB‡"çVæ—Eö–BÂ²Væ—Eö–C¢"çVæ—Eö–BÂ&VfW&Væ6S¢"ç&VfW&Væ6RÂ7FFS¢"ç7FFRÂ7&VFVEöC¢"æ7&VFVEöBÇÂçVÆÂÂ6†—ÖVçE÷&Vc¢çVÆÂÂ6†—ÖVçE÷7FvS¢çVÆÂÂ6öçFVçG3¢µÒÒ“°¢Ğ ¢òòVçF—L:—2&\:wVW22Væ6÷&RÖ—6W2Vâ6'Föâ¢6÷W&6W2&÷÷<:–W2÷W"6ö×÷6W"VæR´ôÒÔ$õ‚…$U4²’Â6ç2&W76—6–Rà¢6öç7B²&÷w3¢f–ÆÆ&ÆU&÷w2ÒÒv—BçVW'’† ¢4TÄT5BæÆÆö6F–öåö–BÂRæ–B2g&öÕ÷Væ—Eö–BÂRç&VfW&Væ6R2g&öÕ÷Væ—E÷&VbÂæ÷&FW%ö–BÂòç&VfW&Væ6R2÷&FW%÷&VbÀ¢æ÷&FW%ö—FVÕö–BÂç&öGV7E÷6·Uö–BÂ"ææÖR2&öGV7EöæÖRÂçVçF—G¢e$ôÒ‡V%÷‡—6–6Å÷Væ—E÷Æ6VÖVçG2 ¢¤ô”â‡V%÷‡—6–6Å÷Væ—G2RôâRæ–BÒç‡—6–6Å÷Væ—Eö–BäBRçVæ—E÷G—RÃâtÔ$´UEõ$4TÂp¢äBRç7FFRäõB”â‚uT$åD”äTBrÂu5UU%4TDTBrÂtD•5D4„TBr¢äBäõB‡RçVæ—E÷G—SÒt„äDÄ”äuõTä•BräBRæ÷&FW%ö–B•2äõBåTÄÂ¢¤ô”â‡V%÷W&6†6UöÆÆö6F–öç2ôâæ–BÒæÆÆö6F–öåö–@¢¤ô”â÷&FW'2òôâòæ–BÒæ÷&FW%ö–@¢ÄTeB¤ô”â÷&FW%ö—FV×2ö’ôâö’æ–BÒæ÷&FW%ö—FVÕö–@¢ÄTeB¤ô”â&öGV7G2"ôâ"æ–BÒö’ç&öGV7Eö–@¢t„U$Rç&VÖ÷fVEöB•2åTÄÂäBçVçF—G’âäBæÖ&¶WEö–BÒC¢õ$DU"%’Ræ7&VFVEöBDU42ÂæÆÆö6F–öåö–BÄ”Ô•B#Â¶Ö&¶WD–EÒ“°¢6öç7Bf–ÆÆ&ÆRÒf–ÆÆ&ÆU&÷w2æÖ‚‡"’Óâ‡°¢ÆÆö6F–öåö–C¢"æÆÆö6F–öåö–BÂg&öÕ÷Væ–Ú±î¸Â¸­yêë¢°k¢G§¦*^  const key = `${r.order_item_id}|${r.line_id}`;
    if (!items.has(key)) {
      items.set(key, {
        order_id: r.order_id, order_ref: r.order_ref, market_id: r.market_id, order_item_id: r.order_item_id,
        product: r.product_name, purchase_line_id: r.line_id, ordered: Number(r.ordered),
        purchase_order: r.purchase_order_id ? { id: r.purchase_order_id, status: r.po_status, sent_at: r.sent_at,
          sent_channel: r.sent_channel, supplier_order_id: r.supplier_order_id } : null,
        placements: [],
      });
    }
    if (r.unit_id) {
      items.get(key).placements.push({
        allocation_id: r.allocation_id, quantity: Number(r.placed), operation: r.operation_type, active: !r.removed_at,
        unit: { id: r.unit_id, reference: r.unit_ref, type: r.unit_type, state: r.unit_state, external_ref: r.external_ref },
        shipment: r.shipment_id ? { id: r.shipment_id, reference: r.shipment_ref, stage: r.shipment_stage } : null,
      });
    }
  }
  return { order_id: orderId, purchase_order_id: purchaseOrderId, chain: [...items.values()] };
}

// ComplÃ©tude d'une commande IMPORT : chaque article doit Ãªtre reÃ§u (matiÃ¨re physique utilisable) Ã  hauteur de la quantitÃ© commandÃ©e.
async function getOrderCompleteness(orderId, q = db) {
  const { rows } = await q.query(`
    SELECT oi.id AS order_item_id, p.name AS product, oi.quantity AS ordered,
           COALESCE((SELECT SUM(v.received_quantity)::int FROM v_purchase_line_progress v
                      WHERE v.order_item_id = oi.id AND NOT v.cancelled), 0) AS received
      FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1 AND oi.fulfillment_source = 'IMPORT'`, [orderId]);
  const pending = rows.filter((r) => Number(r.received) < Number(r.ordered)).map((r) => ({
    order_item_id: r.order_item_id, product: r.product, missing: Number(r.ordered) - Number(r.received),
  }));
  return { has_import: rows.length > 0, complete: rows.length > 0 && pending.length === 0, pending_items: pending };
}

module.exports = { resolveMarket, getDossier, getDirectorTodo, getTrace, poStage, getOrderCompleteness, orderStatus, withAge, TASK_OVERDUE_AFTER_H };
