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
 * @doctrine      une décision, une autorité, un enregistrement ; projection en lecture seule, aucune seconde source de vérité
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
// Décision 6 (#3998) : alerte directrice au-delà de 48 h d'ancienneté d'une tâche.
const TASK_OVERDUE_AFTER_H = 48;

// Ancienneté d'une tâche, dérivée de la date du fait déclencheur (jamais stockée). Date inconnue : champs null.
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
  if (!ref) throw failure(400, 'MARKET_REQUIRED', 'Un marché est obligatoire');
  const { rows: [market] } = UUID_RE.test(ref)
    ? await q.query('SELECT id, code, name FROM markets WHERE id = $1', [ref])
    : await q.query('SELECT id, code, name FROM markets WHERE UPPER(code) = UPPER($1)', [ref]);
  if (!market) throw failure(404, 'MARKET_NOT_FOUND', 'Marché introuvable');
  return market;
}

// Étape métier dérivée, jamais stockée.
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

// Étape de la barre PO (brouillon → validation → engagé → envoyé/expédié → reçu), dérivée, jamais stockée.
// « Validation » = engagement validé par la responsable Hub (la PO reste modifiable jusqu'à la soumission).
// Le paiement fournisseur est une autorisation distincte, jamais une étape de cette barre.
function poStep(po, commitment) {
  if (po.status === 'cancelled') return { key: 'cancelled', index: 0 };
  if (po.status === 'draft') return commitment ? { key: 'validation', index: 2 } : { key: 'draft', index: 1 };
  // La réception physique prime sur le statut fournisseur (une PO peut être reçue avant d'être confirmée).
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

// Commande prête / partielle : une ligne complète n'est pas une commande complète, et une commande partiellement
// reçue n'est jamais « prête à emballer » (préparation partielle = geste explicite côté route).
function orderReadiness(order, bagsOpenByOrder) {
  const items = order.items;
  const pending = items.filter((i) => i.received < i.ordered).map((i) => ({
    order_item_id: i.id, product: i.product, missing: i.ordered - i.received,
  }));
  const complete = items.length > 0 && pending.length === 0;
  const unbagged = items.reduce((t, i) => t + Math.max(0, i.received - i.in_bags - i.in_boxes), 0);
  const bagOpen = bagsOpenByOrder.has(String(order.id));
  const received = items.reduce((t, i) => t + i.received, 0);
  const blockers = [];
  if (items.some((i) => i.purchasing_missing > 0)) blockers.push('Besoin non couvert par une ligne d’achat');
  if (items.some((i) => i.anomaly > 0)) blockers.push('Unité en quarantaine ou écart à traiter');
  if (!complete) blockers.push('Articles non reçus : ' + pending.map((p) => `${p.product || 'article'} (${p.missing})`).join(', '));
  return {
    complete,
    partial: !complete && received > 0,
    ready_to_pack: complete && unbagged > 0 && !bagOpen && !items.some((i) => i.anomaly > 0),
    unbagged_received: unbagged,
    bag_open: bagOpen,
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

function buildTodo({ orders, unsourced, needBatches, purchaseOrders, bagsOpen, bagsReady, boxes, viewer, parcelsToReconcile = [], blockedItems = [], queuedOrders = [], now = new Date() }) {
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
        ? `Sourcing requis — aucun fournisseur admissible · ${list[0].order_ref}`
        : `Anomalie ${list[0].order_ref} : fournisseur du SKU non rattaché aux achats`,
      why: list.some((u) => !u.supplier_mapping_present)
        ? 'Aucun fournisseur admissible pour le produit et la plateforme du SKU.'
        : 'Aucune ligne d’achat créée.',
      since: list[0].order_created_at || null,
      action: { type: 'resolve_sourcing', order_id: orderId, label: 'Ouvrir une ligne d’achat' }, ...can(true),
    });
  }
  for (const batch of needBatches) {
    push({
      id: `PREPARE_PO:${batch.key}`, kind: 'PREPARE_PO', priority: 20, owner: 'agent_hub', subject: { batch_key: batch.key },
      missing: `${batch.quantity} u à regrouper chez ${batch.supplier_name}`,
      why: `${batch.order_count} commande(s) à regrouper en une PO.`,
      since: batch.oldest_at || null,
      action: { type: 'prepare_po', batch_key: batch.key, label: batch.compatible_draft_po_ids.length ? 'Rattacher au brouillon' : 'Préparer la PO' },
      ...can(true),
    });
  }
  for (const po of purchaseOrders) {
    const ref = `${po.supplier_name} · ${poRef(po.id)}`;
    const subject = { po_id: po.id };
    if (po.step.key === 'draft') {
      push({ id: `AUTHORIZE_COMMITMENT:${po.id}`, kind: 'AUTHORIZE_COMMITMENT', priority: 30, owner: 'responsable_hub', subject,
        missing: `${ref} : engagement à valider`,
        why: 'Sans la responsable Hub, la PO ne part pas.',
        since: po.created_at,
        action: { type: 'authorize_commitment', po_id: po.id, label: 'Valider l’engagement' },
        ...can(viewer && viewer.can_authorize_commitment, 'réservé à la responsable Hub') });
    } else if (po.step.key === 'validation') {
      push({ id: `SUBMIT_PO:${po.id}`, kind: 'SUBMIT_PO', priority: 31, owner: 'agent_hub', subject,
        missing: `${ref} : engagement validé, à soumettre`,
        why: 'Le fournisseur n’est pas encore informé.',
        since: po.authorizations.commitment && po.authorizations.commitment.decided_at,
        action: { type: 'submit_po', po_id: po.id, label: 'Soumettre la PO' }, ...can(true) });
    } else if (po.step.key === 'engaged') {
      push({ id: `RECORD_SENT:${po.id}`, kind: 'RECORD_SENT', priority: 32, owner: 'agent_hub', subject,
        missing: `${ref} : envoi à enregistrer`,
        why: 'Une PO soumise n’est pas encore envoyée.',
        since: po.ordered_at || po.updated_at,
        action: { type: 'record_sent', po_id: po.id, label: 'Enregistrer l’envoi' }, ...can(true) });
    } else if (po.status === 'notified' && po.sent_at) {
      push({ id: `CONFIRM_PO:${po.id}`, kind: 'CONFIRM_PO', priority: 33, owner: 'agent_hub', subject,
        missing: `${ref} : confirmation fournisseur à saisir`,
        why: 'Quantités confirmées par le fournisseur.',
        since: po.sent_at,
        action: { type: 'confirm_po', po_id: po.id, label: 'Enregistrer la confirmation' }, ...can(true) });
    }
    if (po.status !== 'draft' && po.status !== 'cancelled' && po.authorizations.commitment && !po.authorizations.payment) {
      push({ id: `AUTHORIZE_PAYMENT:${po.id}`, kind: 'AUTHORIZE_PAYMENT', priority: 40, owner: 'responsable_hub', subject,
        missing: `${ref} : paiement à autoriser`,
        why: 'Engagement validé ne vaut pas paiement.',
        since: po.authorizations.commitment.decided_at,
        action: { type: 'authorize_payment', po_id: po.id, label: 'Autoriser le paiement' },
        ...can(viewer && viewer.can_authorize_payment, 'réservé à la responsable Hub') });
    }
    if (po.status !== 'draft' && po.status !== 'cancelled' && po.totals.missing > 0) {
      push({ id: `AWAIT_RECEIPT:${po.id}`, kind: 'AWAIT_RECEIPT', priority: 50, owner: 'agent_hub', subject,
        missing: `${ref} : ${po.totals.missing} u attendue(s)`,
        why: 'Seule la réception physique compte.',
        since: po.confirmed_at || po.sent_at || po.ordered_at,
        action: { type: 'receive', po_id: po.id, label: 'Enregistrer une réception' }, ...can(true) });
    }
    if (po.totals.anomaly > 0) {
      push({ id: `REVIEW_ANOMALY:${po.id}`, kind: 'REVIEW_ANOMALY', priority: 45, owner: 'agent_hub', subject,
        missing: `${ref} : ${po.totals.anomaly} u en écart`,
        why: 'Ces unités ne comptent pas comme reçues.',
        since: po.updated_at,
        action: { type: 'open_physical', po_id: po.id, label: 'Voir le détail physique' }, ...can(true) });
    }
  }
  for (const order of orders) {
    if (order.readiness.ready_to_pack) {
      push({ id: `PREPARE_BAG:${order.id}`, kind: 'PREPARE_BAG', priority: 60, owner: 'agent_hub', subject: { order_id: order.id },
        missing: `${order.reference} : sac à préparer`,
        why: 'Commande complète : prête à emballer.',
        since: order.created_at,
        action: { type: 'create_bag', order_id: order.id, label: 'Créer le sac client' }, ...can(true) });
    }
  }
  for (const bag of bagsOpen) {
    const planned = (bag.bag_plan || []).reduce((t, x) => t + Number(x.quantity), 0);
    const actual = (bag.actual_contents || []).reduce((t, x) => t + Number(x.quantity), 0);
    if (planned > 0 && planned === actual) {
      push({ id: `CLOSE_BAG:${bag.unit_id}`, kind: 'CLOSE_BAG', priority: 61, owner: 'agent_hub', subject: { order_id: bag.order_id, bag_unit_id: bag.unit_id },
        missing: `${bag.order_ref} : sac à fermer`,
        why: 'Seul un sac fermé entre en KOM-BOX.',
        since: bag.created_at,
        action: { type: 'close_bag', bag_unit_id: bag.unit_id, label: 'Fermer le sac' }, ...can(true) });
    } else if (planned > 0) {
      push({ id: `DEPOSIT_BAG:${bag.unit_id}`, kind: 'DEPOSIT_BAG', priority: 62, owner: 'agent_hub', subject: { order_id: bag.order_id, bag_unit_id: bag.unit_id },
        missing: `${bag.order_ref} : sac ${actual}/${planned}`,
        why: 'Chaque dépôt exige un scan.',
        since: bag.created_at,
        action: { type: 'open_physical', label: 'Déposer dans le sac (scan)' }, ...can(true) });
    }
  }
  if (bagsReady.length) {
    push({ id: 'BOX_BAGS', kind: 'BOX_BAGS', priority: 63, owner: 'agent_hub', subject: {},
      missing: `${bagsReady.length} sac(s) fermé(s) à mettre en KOM-BOX`, why: 'Scan du sac puis de la KOM-BOX.',
      since: bagsReady.map((b) => b.since).filter(Boolean).sort()[0] || null,
      action: { type: 'open_physical', label: 'Placer en KOM-BOX (scan)' }, ...can(true) });
  }
  for (const b of boxes) {
    if (b.state === 'PACKED' && !b.shipment_ref) {
      push({ id: `BOX_UNSHIPPED:${b.unit_id}`, kind: 'BOX_UNSHIPPED', priority: 64, owner: 'agent_hub', subject: { box_unit_id: b.unit_id },
        missing: `${b.reference} : à rattacher à une expédition`, why: 'Sans expédition, la KOM-BOX ne part pas.',
        since: b.created_at,
        action: { type: 'open_physical', label: 'Rattacher à une expédition' }, ...can(true) });
    }
  }
  // HB-08 : colis fournisseur arrivé sans contenu déclaré — invisible des allocations, donc des tâches par PO.
  for (const parcel of parcelsToReconcile) {
    push({ id: `RECONCILE_PARCEL:${parcel.unit_id}`, kind: 'RECONCILE_PARCEL', priority: 35, owner: 'agent_hub', severity: 'anomaly',
      subject: { parcel_unit_id: parcel.unit_id },
      missing: `Colis ${parcel.reference} arrivé à rapprocher`,
      why: 'Reçu au Hub sans contenu déclaré : il n’appartient à aucune PO tant qu’il n’est pas déballé.',
      since: parcel.created_at,
      action: { type: 'open_physical', label: 'Déballer et rapprocher (scan)' }, ...can(true) });
  }
  // HB-02 : commande dont les lignes d'achat sont toutes soldées ou annulées sous le besoin — elle n'avancera jamais seule.
  const blockedByOrder = new Map();
  blockedItems.forEach((b) => blockedByOrder.set(b.order_id, [...(blockedByOrder.get(b.order_id) || []), b]));
  for (const [orderId, list] of blockedByOrder) {
    const units = list.reduce((t, b) => t + (b.ordered - b.covered), 0);
    push({ id: `BLOCKED_BY_SHORTFALL:${orderId}`, kind: 'BLOCKED_BY_SHORTFALL', priority: 11, owner: 'responsable_hub', severity: 'anomaly',
      subject: { order_id: orderId },
      missing: `${list[0].order_ref} : bloquée par rupture · ${units} u non couvertes`,
      why: 'Toutes les lignes d’achat sont soldées ou annulées sous le besoin : arbitrer (envoi partiel et remboursement de la quantité manquante).',
      since: list.map((b) => b.since).filter(Boolean).sort().slice(-1)[0] || null,
      action: { type: 'open_order', order_id: orderId, label: 'Ouvrir la commande' }, ...can(true) });
  }
  // HB-12 : aucun colis local ne peut accueillir le reliquat et le maximum de trois
  // colis ouverts au relais est atteint. Le constat reste une projection, jamais un état enregistré.
  for (const wait of queuedOrders) {
    push({ id: `PARCEL_CAPACITY_WAIT:${wait.order_id}`, kind: 'PARCEL_CAPACITY_WAIT', priority: 57,
      owner: 'agent_hub', severity: 'anomaly', subject: { order_id: wait.order_id },
      missing: `${wait.order_ref} : en file de colis · ${wait.relais_name || 'relais'} (${wait.open_parcels} ouverts)`,
      why: 'La capacité des trois colis locaux ouverts est saturée : expédier ou libérer une place avant de répartir.',
      since: wait.since,
      action: { type: 'open_order', order_id: wait.order_id, label: 'Ouvrir la commande en attente' }, ...can(true),
    });
  }
  // Actions exécutables par le rôle courant d'abord, puis attentes d'un autre rôle ; priorité métier ensuite.
  const own = (t) => (t.viewer_can_act === false ? 1 : 0);
  return todo.map((t) => withAge(t, now)).sort((a, b) => own(a) - own(b) || a.priority - b.priority);
}


// ── Projection « maquette C » : états par unité, pastilles de statut, sections physiques ──
// Tout est dérivé ici des mêmes quantités serveur ; le navigateur n'additionne ni ne déduit rien.
const poRef = (id) => `PO-${String(id || '').slice(0, 4).toUpperCase()}`;
const UNIT_LABELS = Object.freeze({
  none: 'À acheter', sourcing: 'Fournisseur du SKU non rattaché aux achats', draft: 'Dans une PO brouillon', pending: 'Validation responsable',
  shipped: 'Chez / expédié fournisseur', received: 'Reçu au Hub', bag_open: 'En sac (ouvert)', bag_closed: 'Sac fermé', boxed: 'En KOM-BOX',
});

function itemUnits(item, poById) {
  const units = [];
  let left = item.received;
  const take = (n, state) => { const k = Math.min(n, left); for (let i = 0; i < k; i += 1) units.push(state); left -= k; };
  take(item.in_boxes, 'boxed'); take(item.in_bags_closed, 'bag_closed'); take(item.in_bags_open, 'bag_open'); take(left, 'received');
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
  if ((states.has('bag_open') || states.has('bag_closed')) && !states.has('received')) return states.has('bag_open') ? 'en sac ouvert' : 'sac fermé';
  if (item.received > 0) return `reçu · ${ref}`;
  if (states.size === 1 && states.has('none')) return 'à regrouper';
  return ref || 'à regrouper';
}

function orderStatus(order) {
  const t = order.totals;
  const r = order.readiness;
  const states = new Set(order.items.flatMap((i) => i.units.map((u) => u.state)));
  // Cause dominante : anomalie > à regrouper/acheter > reliquat > attente fournisseur > prête.
  if (t.uncovered > 0) return { label: 'Anomalie fournisseur', tone: 'bad' };
  if (t.anomaly > 0) return { label: 'Anomalie réception', tone: 'bad' };
  if (states.has('none')) return { label: t.received > 0 ? `Partielle · ${t.requested - t.received} à acheter` : 'À regrouper', tone: 'act' };
  if (r.partial && ['shipped', 'pending', 'draft'].some((k) => states.has(k))) return { label: `Reliquat ${t.received}/${t.requested}`, tone: 'warn' };
  if (t.in_boxes > 0 && r.complete) return { label: 'Dans KOM-BOX', tone: 'done' };
  if (r.bag_open) return { label: 'Sac en cours', tone: 'act' };
  if (r.ready_to_pack) return { label: 'Prête à ensacher', tone: 'act' };
  if (states.has('draft')) return { label: 'PO brouillon', tone: 'act' };
  if (states.has('pending')) return { label: 'En validation', tone: 'amber' };
  return { label: 'Attente fournisseur', tone: 'wait' };
}

function poStatusView(po) {
  const t = po.totals;
  const eff = t.effective || po.lines.reduce((s, l) => s + l.ordered, 0);
  if (po.step.key === 'received' || t.received > 0) {
    const label = t.received >= eff ? `Reçue ${t.received}/${eff}` : `Reçue ${t.received}/${eff} · reliquat ${eff - t.received}`;
    return { label, tone: t.received >= eff ? 'ok' : 'warn' };
  }
  if (po.step.key === 'draft') return { label: 'Brouillon', tone: 'act' };
  if (po.step.key === 'validation') return { label: 'En validation', tone: 'amber' };
  if (po.step.key === 'engaged') return { label: 'Engagée', tone: 'wait' };
  return { label: 'Expédiée fournisseur', tone: 'wait' };
}

function buildPhysical({ orders, bagsOpen, bagsReady, boxes, poById }) {
  const item = (key, ref, meta, text, extra) => ({ key, ref, meta, text, ...(extra || {}) });
  const unbagged = orders.filter((o) => o.readiness.unbagged_received > 0).map((o) => {
    const parts = o.items.filter((i) => i.received - i.in_bags - i.in_boxes > 0).map((i) => {
      const refs = [...new Set(i.lines.filter((l) => l.po_id && l.received > 0).map((l) => poRef(l.po_id)))].join(', ');
      return `${i.product} ×${i.received - i.in_bags - i.in_boxes}${refs ? ` (${refs})` : ''}`;
    });
    return item(`order:${o.id}`, o.reference, 'FIFO', parts.join(' · '), { order_id: o.id });
  });
  const bags = [
    ...bagsOpen.map((b) => {
      const planned = (b.bag_plan || []).reduce((t, x) => t + Number(x.quantity), 0);
      const actual = (b.actual_contents || []).reduce((t, x) => t + Number(x.quantity), 0);
      return item(`bag:${b.unit_id}`, b.reference, `ouvert · ${actual}/${planned}`, `${b.order_ref} · dépôt scanné SKU + quantité`, { order_id: b.order_id, bag_unit_id: b.unit_id, closable: planned > 0 && planned === actual });
    }),
    ...bagsReady.map((b) => item(`bag:${b.unit_id}`, b.reference, `fermé · ${b.quantity}`, `${b.order_ref} · à scanner dans une KOM-BOX`, { order_id: b.order_id, bag_unit_id: b.unit_id })),
  ];
  const boxList = [...boxes];
  const orderIdsOf = (b) => [...new Set((b.contents || []).map((c) => c.order_id).filter(Boolean))];
  const open = boxList.filter((b) => !b.shipment_ref).map((b) => item(`box:${b.unit_id}`, b.reference, b.state, `${[...new Set((b.contents || []).map((c) => c.order_ref))].join(', ') || 'KOM-BOX'} · à rattacher à une expédition`, { order_ids: orderIdsOf(b), box_unit_id: b.unit_id }));
  const shipped = boxList.filter((b) => b.shipment_ref).map((b) => item(`box:${b.unit_id}`, b.reference, b.shipment_ref, `expédition ${b.shipment_stage || 'ouverte'}`, { order_ids: orderIdsOf(b), box_unit_id: b.unit_id }));
  const reliquats = orders.flatMap((o) => o.items.filter((i) => i.remaining_to_deliver > 0 && i.po_ids.some((id) => poById.get(id) && poById.get(id).totals.received > 0)).map((i) =>
    item(`order:${o.id}`, o.reference, i.po_ids.map(poRef).join(', '), `${i.product} ×${i.remaining_to_deliver} · attendu du fournisseur`, { order_id: o.id })));
  return [
    { key: 'received', title: 'Reçu au Hub · non ensaché', tone: 'ok', items: unbagged, empty_text: 'Rien de reçu pour l’instant.' },
    { key: 'bags', title: 'Sacs clients', tone: 'bag', items: bags, empty_text: 'Aucun sac ouvert.' },
    { key: 'boxes', title: 'KOM-BOX', tone: 'box', items: open, empty_text: 'Aucune KOM-BOX en cours.' },
    { key: 'shipped', title: 'Expédié au relais', tone: 'grey', items: shipped, empty_text: 'Aucun départ aujourd’hui.' },
    { key: 'reliquats', title: 'Reliquats attendus', tone: 'warn', items: reliquats, empty_text: 'Aucun reliquat.' },
  ];
}

async function loadCockpit({
  q, marketId, viewer, orderMap, needsRows, purchaseOrders, unsourcedItems, bagsOpen, bagsReady, boxes,
  parcelsToReconcile = [], blockedItems = [], queuedOrders = [], now = new Date(),
}) {
  const grants = new Set();
  if (viewer && viewer.id) {
    const { rows } = await q.query(
      'SELECT authorization_type FROM hub_authorization_grants WHERE user_id = $1 AND revoked_at IS NULL', [viewer.id]);
    (rows || []).forEach((r) => grants.add(r.authorization_type));
  }
  const rights = viewerRights(viewer, grants);

  // Autorisations tracées (append-only) par PO.
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

  // Ventilation physique par article de commande (une seule lecture, mêmes tables que le dossier).
  const itemIds = [...orderMap.values()].flatMap((o) => o.items.map((i) => i.id));
  const physical = new Map();
  if (itemIds.length) {
    const { rows } = await q.query(PHYSICAL_BY_ITEM_SQL, [marketId, itemIds]);
    (rows || []).forEach((r) => physical.set(r.order_item_id, r));
  }

  // Lignes d'achat par article (ouvertes + rattachées) et rang FIFO par (PO, SKU).
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

  const bagsOpenByOrder = new Set(bagsOpen.map((b) => String(b.order_id)));
  // Ligne d'achat SANS PO : même source (needsRows) que la colonne « Achats et PO ».
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
      // Trois états disjoints du besoin : en PO / ligne d'achat sans PO (à regrouper) / sans ligne d'achat (sourcing).
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
    order.readiness = orderReadiness(order, bagsOpenByOrder);
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

  // Besoins ouverts : fournisseur × Hub d'achat × marché (une PO) puis SKU. Le marché est celui de la route.
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
    // Une ligne ne se rattache qu'à un brouillon dont l'engagement n'est pas encore validé (même fournisseur, Hub et marché).
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
    physical: buildPhysical({ orders, bagsOpen, bagsReady, boxes, poById }),
    todo: buildTodo({ orders, unsourced: unsourcedItems, needBatches, purchaseOrders, bagsOpen, bagsReady, boxes, viewer: rights, parcelsToReconcile, blockedItems, queuedOrders, now }),
  };
}

async function getDossier({ marketId, supplierId = null, viewer = null, now = new Date() }, q = db) {
  // Entrée Work : la commande IMPORT reste visible même avant l'ouverture de
  // sa première ligne d'achat. LOCAL_STOCK et les sources inconnues ne sont
  // jamais projetées dans la file Hub. Aucun état métier calculé ici.
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
    // Le manque de sourcing est un fait calculé depuis la couverture achat
    // effective, pas un statut de commande ni une réception physique inventée.
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
  // (hub_physical_units/MARKET_PARCEL). Les deux preuves restent séparées.
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
        // Preuve physique dérivée des réceptions Hub et des placements KOM-BOX (migration 363), jamais préremplie.
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
    SELECT po.id AS po_id, po.status, po.sent_at, po.sent_channel, po.supplier_order_id, po.supplier_id,
           s.name AS supplier_name, po.procurement_hub_ref, po.created_at, po.updated_at, po.ordered_at,
           pl.id AS line_id, pl.order_item_id, oi.order_id, o.reference AS order_ref, p.name AS product_name,
           pl.product_sku_id, pl.quantity AS ordered, vp.effective_quantity AS effective, vp.received_quantity AS received,
           po.trigger_mode, po.confirmed_at, po.market_id AS po_market_id,
           pl.supplier_unit_price, pl.supplier_currency, o.created_at AS order_created_at
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN purchase_lines pl ON pl.purchase_order_id = po.id AND pl.cancelled_at IS NULL
      JOIN v_purchase_line_progress vp ON vp.line_id = pl.id
      JOIN order_items oi ON oi.id = pl.order_item_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.market_id = $1 AND ($2::uuid IS NULL OR po.supplier_id = $2::uuid)
     ORDER BY po.created_at DESC, po.id, pl.id`, [marketId, supplierId]);

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
        procurement_hub_ref: r.procurement_hub_ref, sent_at: r.sent_at, sent_channel: r.sent_channel,
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
      unit_price: r.supplier_unit_price == null ? null : Number(r.supplier_unit_price),
      currency: r.supplier_currency || null,
    });
  }
  const purchaseOrders = [...pos.values()].map((po) => {
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

  // KOM-BOX vides (créées depuis le Hub, pas encore composées) : visibles pour pouvoir être remplies.
  const { rows: emptyBoxRows } = await q.query(`
    SELECT u.id AS unit_id, u.reference, u.state, u.created_at FROM hub_physical_units u
     WHERE u.unit_type = 'MARKET_PARCEL' AND u.state NOT IN ('DISPATCHED','SUPERSEDED','QUARANTINED')
       AND (u.market_id = $1 OR u.market_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM hub_box_effective_placements p WHERE p.box_unit_id = u.id)
     ORDER BY u.created_at DESC LIMIT 20`, [marketId]);
  for (const r of emptyBoxRows) {
    if (!boxes.has(r.unit_id)) boxes.set(r.unit_id, { unit_id: r.unit_id, reference: r.reference, state: r.state, created_at: r.created_at || null, shipment_ref: null, shipment_stage: null, contents: [] });
  }

  // Quantités reçues pas encore mises en carton : sources proposées pour composer une KOM-BOX (REPACK), sans ressaisie.
  const { rows: fillableRows } = await q.query(`
    SELECT p.allocation_id, u.id AS from_unit_id, u.reference AS from_unit_ref, a.order_id, o.reference AS order_ref,
           a.order_item_id, a.product_sku_id, pr.name AS product_name, p.quantity
      FROM hub_physical_unit_placements p
      JOIN hub_physical_units u ON u.id = p.physical_unit_id AND u.unit_type <> 'MARKET_PARCEL'
           AND u.state NOT IN ('QUARANTINED','SUPERSEDED','DISPATCHED')
           AND NOT (u.unit_type='HANDLING_UNIT' AND u.order_id IS NOT NULL)
      JOIN hub_purchase_allocations a ON a.id = p.allocation_id
      JOIN orders o ON o.id = a.order_id
      LEFT JOIN order_items oi ON oi.id = a.order_item_id
      LEFT JOIN products pr ON pr.id = oi.product_id
     WHERE p.removed_at IS NULL AND p.quantity > 0 AND a.market_id = $1
     ORDER BY u.created_at DESC, p.allocation_id LIMIT 200`, [marketId]);
  const fillable = fillableRows.map((r) => ({
    allocation_id: r.allocation_id, from_unit_id: r.from_unit_id, from_unit_ref: r.from_unit_ref,
    order_id: r.order_id, order_ref: r.order_ref,
    order_item_id: r.order_item_id, product_sku_id: r.product_sku_id,
    product: r.product_name || null, quantity: Number(r.quantity),
  }));

  // Sacs de commande en cours de préparation : une seule unité physique
  // mono-commande, dont le manifeste est immuable et partial-friendly.
  const {rows:openBagRows}=await q.query(
    "SELECT u.id AS unit_id, u.reference, u.state, u.order_id, " +
    "o.reference AS order_ref, u.bag_plan, u.created_at, " +
    "COALESCE((SELECT jsonb_agg(jsonb_build_object('order_item_id',q.order_item_id, " +
    "'quantity',q.actual_qty)) FROM (SELECT a.order_item_id,SUM(p.quantity)::int AS actual_qty " +
    "FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id=p.allocation_id " +
    "WHERE p.physical_unit_id=u.id AND p.removed_at IS NULL GROUP BY a.order_item_id) q), " +
    "'[]'::jsonb) AS actual_contents " +
    "FROM hub_physical_units u JOIN orders o ON o.id=u.order_id " +
    "WHERE u.unit_type='HANDLING_UNIT' AND u.order_id IS NOT NULL " +
    "AND u.state NOT IN ('PACKED','DISPATCHED','QUARANTINED','SUPERSEDED') " +
    "AND o.market_id=$1 ORDER BY u.created_at DESC LIMIT 100", [marketId]
  );
  const bags_open=openBagRows.map(r=>({
    unit_id:r.unit_id,reference:r.reference,state:r.state,order_id:r.order_id,
    order_ref:r.order_ref,created_at:r.created_at||null,bag_plan:r.bag_plan||[],actual_contents:r.actual_contents||[],
  }));

  // Sacs clients scellés, encore hors carton : à scanner dans une KOM-BOX.
  const { rows: readyBagRows } = await q.query(
    "SELECT u.id AS unit_id, u.reference, u.order_id, o.reference AS order_ref, u.updated_at AS since, " +
    "sum(p.quantity)::int AS quantity " +
    "FROM hub_physical_units u " +
    "JOIN orders o ON o.id=u.order_id " +
    "JOIN hub_physical_unit_placements p ON p.physical_unit_id=u.id AND p.removed_at IS NULL " +
    "JOIN hub_purchase_allocations a ON a.id=p.allocation_id " +
    "WHERE u.unit_type='HANDLING_UNIT' AND u.order_id IS NOT NULL " +
    "AND u.state='PACKED' AND a.market_id=$1 " +
    "AND NOT EXISTS (SELECT 1 FROM hub_box_bags l WHERE l.bag_unit_id=u.id) " +
    "GROUP BY u.id, u.reference, u.order_id, o.reference, u.updated_at " +
    "ORDER BY u.reference LIMIT 100", [marketId]
  );
  const bags_ready = readyBagRows.map(r => ({
    unit_id: r.unit_id, reference: r.reference, order_id: r.order_id,
    order_ref: r.order_ref, quantity: Number(r.quantity), since: r.since || null,
  }));

  // Expéditions encore ouvertes (hub_ready) du marché : cibles de rattachement proposées au Hub, sans ressaisie.
  const { rows: shipmentRows } = await q.query(
    `SELECT s.reference, s.forwarder_name, s.transport_mode,
            (SELECT COUNT(*)::int FROM international_shipment_hub_units h WHERE h.shipment_id = s.id) AS box_count
       FROM international_shipments s WHERE s.market_id = $1 AND s.stage = 'hub_ready'
      ORDER BY s.created_at DESC LIMIT 50`, [marketId]);

  const hoursSince = (date) => (date ? (now.getTime() - new Date(date).getTime()) / HOUR : 0);
  const toHandle = [];
  // Une commande payée sans purchase_line est un travail Hub à part entière.
  // Les alertes de résolution restent visibles même lorsque le trigger initial
  // a terminé avec « Stripe trigger OK » sans créer de besoin d'achat.
  for (const item of unsourcedItems) {
    toHandle.push({
      kind: 'ORDER_SOURCING_REQUIRED',
      ...item,
      reason: `${item.order_ref} · ${item.product_name} : ${item.missing_quantity} unité(s) sans ligne d'achat` +
        (item.supplier_mapping_present ? '' : ' · aucun fournisseur admissible'),
    });
  }
  for (const po of purchaseOrders) {
    if (po.stage === 'issued_not_sent' && hoursSince(po.ordered_at || po.updated_at) > ISSUED_NOT_SENT_AFTER_H) {
      toHandle.push({ kind: 'PO_ISSUED_NOT_SENT', po_id: po.id, supplier_name: po.supplier_name, reason: `Bon émis depuis plus de ${ISSUED_NOT_SENT_AFTER_H} h, envoi non enregistré` });
    }
    if (po.stage === 'sent' && hoursSince(po.sent_at) > SENT_NOT_CONFIRMED_AFTER_H) {
      toHandle.push({ kind: 'PO_SENT_UNCONFIRMED', po_id: po.id, supplier_name: po.supplier_name, reason: `Envoyée depuis plus de ${SENT_NOT_CONFIRMED_AFTER_H} h, sans confirmation` });
    }
    if (['confirmed', 'partially_received'].includes(po.stage) && po.totals.missing > 0 && po.status !== 'draft') {
      toHandle.push({ kind: 'PO_MISSING_QTY', po_id: po.id, supplier_name: po.supplier_name, reason: `${po.totals.missing} unité(s) confirmée(s) non reçue(s)` });
    }
  }
  for (const r of receiptRows) {
    if (r.state === 'QUARANTINED') toHandle.push({ kind: 'UNIT_QUARANTINED', unit_id: r.id, reason: `Colis ${r.reference} en quarantaine` });
  }
  for (const b of boxes.values()) {
    if (['PACKED'].includes(b.state) && !b.shipment_ref) toHandle.push({ kind: 'BOX_UNSHIPPED', unit_id: b.unit_id, reason: `Carton ${b.reference} emballé, sans expédition` });
  }

  // HB-08 : colis fournisseur arrivé sans aucun placement (donc sans allocation, ni marché lisible par les tâches par PO).
  // Un colis sans marché connu est projeté dans chaque marché ; la vue directrice le dédoublonne.
  const { rows: parcelRows } = await q.query(`
    SELECT u.id AS unit_id, u.reference, u.created_at
      FROM hub_physical_units u
     WHERE u.unit_type = 'SUPPLIER_PACKAGE' AND u.state = 'RECEIVED' AND u.outcome_type IS NULL
       AND (u.market_id = $1 OR u.market_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM hub_physical_unit_placements p WHERE p.physical_unit_id = u.id)
     ORDER BY u.created_at, u.id LIMIT 100`, [marketId]);
  // HB-02 : article IMPORT dont toutes les lignes d'achat sont soldées/annulées sous le besoin (invariant H2).
  const { rows: blockedRows } = await q.query(`
    SELECT o.id AS order_id, o.reference AS order_ref, oi.id AS order_item_id, oi.quantity AS ordered,
           SUM(v.effective_quantity)::int AS covered, MAX(pl.updated_at) AS since
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN v_purchase_line_progress v ON v.order_item_id = oi.id AND v.line_id IS NOT NULL
      JOIN purchase_lines pl ON pl.id = v.line_id
     WHERE o.market_id = $1 AND o.status IN ('ordered', 'preparation') AND oi.fulfillment_source = 'IMPORT'
     GROUP BY o.id, o.reference, oi.id, oi.quantity
    HAVING SUM(v.effective_quantity) < oi.quantity AND bool_and(v.cancelled OR v.received_quantity >= v.effective_quantity)`, [marketId]);

  // HB-12 : même limite que auto-parcel (trois colis locaux ouverts par relais,
  // 30 unités et dix commandes par colis). La file n'est signalée que si aucun colis
  // existant n'a la capacité d'absorber la quantité locale encore non affectée.
  const { rows: queuedRows } = await q.query(`
    SELECT o.id AS order_id, o.reference AS order_ref, o.created_at AS since,
           r.name AS relais_name, COUNT(DISTINCT p.id)::int AS open_parcels
      FROM orders o
      JOIN relais r ON r.id = o.relais_id
      JOIN LATERAL (
        SELECT COALESCE(SUM(oi.quantity), 0)::int AS pending_qty
          FROM order_items oi
         WHERE oi.order_id = o.id AND COALESCE(oi.fulfillment_source, '') <> 'IMPORT'
           AND NOT EXISTS (
             SELECT 1 FROM parcel_items pi
               JOIN parcels assigned ON assigned.id = pi.parcel_id AND assigned.status <> 'cancelled'
              WHERE pi.order_item_id = oi.id
           )
      ) pending ON pending.pending_qty > 0
      JOIN parcels p ON p.relais_id = o.relais_id AND p.status IN ('draft', 'preparation')
      LEFT JOIN LATERAL (
        SELECT COUNT(pi.id)::int AS item_count,
               COUNT(DISTINCT oi.order_id)::int AS order_count,
               ARRAY_AGG(DISTINCT CASE WHEN oi.fulfillment_source = 'IMPORT' THEN 'import' ELSE 'local' END) AS lanes
          FROM parcel_items pi JOIN order_items oi ON oi.id = pi.order_item_id
         WHERE pi.parcel_id = p.id
      ) capacity ON TRUE
     WHERE o.market_id = $1 AND o.status IN ('ordered', 'preparation')
       AND (capacity.lanes IS NULL OR capacity.lanes = ARRAY['local']::text[])
     GROUP BY o.id, o.reference, o.created_at, r.name, pending.pending_qty
    HAVING COUNT(DISTINCT p.id) >= 3
       AND BOOL_AND(capacity.item_count + pending.pending_qty > 30 OR capacity.order_count >= 10)
     ORDER BY o.created_at LIMIT 100`, [marketId]);

  const count = (stage) => purchaseOrders.filter((po) => po.stage === stage).length;
  // Cockpit : mêmes lectures, enrichies (couverture, réception, ventilation physique, autorisations, À faire maintenant).
  const cockpit = await loadCockpit({
    q, marketId, viewer, orderMap: orders, needsRows, purchaseOrders, unsourcedItems,
    bagsOpen: bags_open, bagsReady: bags_ready, boxes: [...boxes.values()],
    parcelsToReconcile: parcelRows, queuedOrders: queuedRows, now,
    blockedItems: blockedRows.map((r) => ({ ...r, ordered: Number(r.ordered), covered: Number(r.covered) })),
  });
  return {
    market_id: marketId,
    generated_at: now.toISOString(),
    kpis: {
      orders_waiting: new Set([...needsRows.map((r) => r.order_id), ...unsourcedItems.map((r) => r.order_id)]).size,
      items_sourcing_required: unsourcedItems.length,
      units_sourcing_required: unsourcedItems.reduce((sum, r) => sum + r.missing_quantity, 0),
      lines_open: needsRows.length,
      po_draft: count('draft'),
      po_issued_not_sent: count('issued_not_sent'),
      po_sent_unconfirmed: count('sent'),
      qty_missing: purchaseOrders.reduce((s, po) => s + po.totals.missing, 0),
      qty_anomaly: purchaseOrders.reduce((s, po) => s + po.totals.anomaly, 0),
      boxes_open: [...boxes.values()].filter((b) => !['DISPATCHED'].includes(b.state)).length,
      boxes_unshipped: [...boxes.values()].filter((b) => !b.shipment_ref).length,
    },
    orders: cockpit.orders,
    cockpit: { allocation_rule: cockpit.allocation_rule, po_steps: cockpit.po_steps, viewer: cockpit.viewer,
      need_batches: cockpit.need_batches, unit_legend: cockpit.unit_legend, physical: cockpit.physical, todo: cockpit.todo },
    client_parcels: [...clientParcels.values()],
    needs: needsRows,
    purchase_orders: purchaseOrders,
    receipts: receiptRows.map((r) => ({ id: r.id, reference: r.reference, external_ref: r.external_ref, state: r.state,
      received_at: r.created_at, po_ids: r.po_ids, qty: Number(r.qty) })),
    boxes: [...boxes.values()],
    bags_ready,
    bags_open,
    fillable,
    open_shipments: shipmentRows,
    to_handle: toHandle,
  };
}

// Vue directrice (décision 6) : tâches de TOUS les marchés actifs, la plus ancienne d'abord, alerte au-delà de 48 h.
// Même service et mêmes tâches que le dossier par marché : aucune seconde source de vérité.
async function getDirectorTodo({ viewer = null, now = new Date() } = {}, q = db) {
  const { rows: markets } = await q.query('SELECT id, code, name FROM markets WHERE is_active = TRUE ORDER BY code');
  const tasks = new Map();
  for (const market of markets) {
    const d = await getDossier({ marketId: market.id, viewer, now }, q);
    for (const t of d.cockpit.todo) {
      // Une action "BOX_BAGS" (ou autre ID local) peut exister dans plusieurs marchés.
      // Le dossier directeur ne doit pas effacer les tâches du deuxième marché.
      // Seul le colis fournisseur sans rattachement est réellement global et dédoublonné par unité.
      const key = t.kind === 'RECONCILE_PARCEL' ? t.id : `${market.id}:${t.id}`;
      if (!tasks.has(key)) tasks.set(key, { ...t, market: { id: market.id, code: market.code, name: market.name } });
    }
  }
  const list = [...tasks.values()].sort((a, b) => (b.overdue - a.overdue) || ((b.age_hours ?? -1) - (a.age_hours ?? -1)) || a.priority - b.priority);
  return {
    generated_at: now.toISOString(),
    scope: 'ALL_MARKETS',
    overdue_after_hours: TASK_OVERDUE_AFTER_H,
    total: list.length,
    overdue_count: list.filter((t) => t.overdue).length,
    markets: markets.map((m) => m.code),
    tasks: list,
  };
}

// Filiation complète d'une commande ou d'une PO :
//   commande → order_item → ligne d'achat → PO → réception → allocation → carton → expédition.
async function getTrace({ orderId = null, purchaseOrderId = null, allowedMarketIds = null }, q = db) {
  if (!orderId && !purchaseOrderId) throw failure(400, 'TRACE_KEY_REQUIRED', 'order_id ou po_id est obligatoire');
  for (const [name, value] of [['order_id', orderId], ['po_id', purchaseOrderId]]) {
    if (value && !UUID_RE.test(String(value))) throw failure(400, 'HUB_OPERATOR_UUID_INVALID', `${name} doit être un UUID valide`);
  }
  const { rows } = await q.query(`
    SELECT oi.id AS order_item_id, oi.order_id, o.reference AS order_ref, o.market_id, p.name AS product_name,
           pl.id AS line_id, pl.quantity AS ordered, pl.purchase_order_id, po.status AS po_status, po.sent_at,
           po.sent_channel, po.supplier_order_id,
           a.id AS allocation_id, pu.quantity AS placed, pu.operation_type, pu.removed_at,
           u.id AS unit_id, u.reference AS unit_ref, u.unit_type, u.state AS unit_state, u.external_ref,
           sh.id AS shipment_id, sh.reference AS shipment_ref, sh.stage AS shipment_stage
      FROM purchase_lines pl
      JOIN order_items oi ON oi.id = pl.order_item_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN purchase_orders po ON po.id = pl.purchase_order_id
      LEFT JOIN hub_purchase_allocations a ON a.purchase_line_id = pl.id
      LEFT JOIN hub_physical_unit_placements pu ON pu.allocation_id = a.id
      LEFT JOIN hub_physical_units u ON u.id = pu.physical_unit_id
      LEFT JOIN international_shipment_hub_units hs ON hs.physical_unit_id = u.id
      LEFT JOIN international_shipments sh ON sh.id = hs.shipment_id
     WHERE pl.cancelled_at IS NULL
       AND ($1::uuid IS NULL OR oi.order_id = $1::uuid)
       AND ($2::uuid IS NULL OR pl.purchase_order_id = $2::uuid)
       AND ($3::uuid[] IS NULL OR o.market_id = ANY($3::uuid[]))
     ORDER BY oi.order_id, oi.id, pl.id, pu.placed_at`, [orderId, purchaseOrderId, allowedMarketIds]);

  const items = new Map();
  for (const r of rows) {
    const key = `${r.order_item_id}|${r.line_id}`;
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

// Complétude d'une commande IMPORT : chaque article doit être reçu (matière physique utilisable) à hauteur de la quantité commandée.
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
