'use strict';
/**
 * Fixture Playwright : habille un dossier « ancien format » (API simulée) de la section cockpit que le serveur
 * calcule réellement (GET /market/:code/supply). Ce n'est PAS une logique métier de production : les specs
 * simulent la réponse serveur, le navigateur ne calcule rien.
 */
const STEPS = ['draft', 'validation', 'engaged', 'sent', 'received'];

function shapeDossier(source, { viewer = { role: 'agent_hub', can_authorize_commitment: false, can_authorize_payment: false }, todo = [], needBatches = [] } = {}) {
  const d = JSON.parse(JSON.stringify(source));
  const pos = d.purchase_orders || [];
  const authFor = (po) => po.authorizations || { commitment: null, payment: null };
  pos.forEach((po) => {
    po.authorizations = authFor(po);
    po.supplier_id = po.supplier_id || `sup-${po.supplier_name}`;
    po.ref = `PO-${String(po.id).slice(0, 4).toUpperCase()}`;
    po.status_view = po.status_view || { label: po.status === 'draft' ? 'Brouillon' : 'Chez le fournisseur', tone: 'wait' };
    po.order_ids = [...new Set((po.lines || []).map((l) => l.order_id))];
    po.amount = po.amount || { amount: null, currency: null, derived: false };
    if (!po.step) {
      const t = po.totals || { effective: 0, received: 0, missing: 0, anomaly: 0 };
      if (po.status === 'draft') po.step = po.authorizations.commitment ? { key: 'validation', index: 2 } : { key: 'draft', index: 1 };
      else if (t.effective > 0 && t.received >= t.effective) po.step = { key: 'received', index: 5 };
      else if (t.received > 0) po.step = { key: 'received', index: 5, partial: true };
      else if (po.status === 'notified' && !po.sent_at) po.step = { key: 'engaged', index: 3 };
      else po.step = { key: 'sent', index: 4 };
    }
  });
  d.orders = (d.orders || []).map((order) => {
    const items = (order.items || []).map((item) => {
      const lines = pos.flatMap((po) => (po.lines || []).filter((l) => l.order_item_id === item.id).map((l) => ({
        line_id: l.line_id, po_id: po.id, quantity: l.ordered, effective: l.confirmed, received: l.received, anomaly: l.anomaly || 0, fifo_rank: l.fifo_rank || 1,
      })));
      const received = item.received != null ? item.received : lines.reduce((t, l) => t + l.received, 0);
      const uncovered = item.purchasing_missing || 0;
      return {
        in_bags: 0, in_boxes: 0, shipped: 0, to_control: 0, controlled: 0, anomaly: lines.reduce((t, l) => t + l.anomaly, 0), ...item,
        requested: item.ordered, covered: item.ordered - uncovered, uncovered, received, remaining_to_deliver: Math.max(item.ordered - received, 0),
        complete: received >= item.ordered, lines, po_ids: [...new Set(lines.map((l) => l.po_id))],
      };
    });
    items.forEach((i) => {
      const states = [...Array(Math.min(i.received, i.ordered)).fill('received'), ...Array(Math.max(i.ordered - i.received, 0)).fill(i.lines.length ? 'shipped' : i.uncovered ? 'sourcing' : 'none')];
      i.units = states.map((state) => ({ state, label: state }));
      i.unit_counts = states.reduce((t, st) => ({ ...t, [st]: (t[st] || 0) + 1 }), {});
      i.where = i.lines.length ? 'PO' : 'à regrouper';
    });
    const sum = (key) => items.reduce((t, i) => t + (i[key] || 0), 0);
    const pending = items.filter((i) => !i.complete).map((i) => ({ order_item_id: i.id, product: i.product, missing: i.remaining_to_deliver }));
    const complete = items.length > 0 && pending.length === 0;
    return {
      created_at: '2026-11-01T08:00:00Z', ...order, items,
      po_ids: [...new Set(items.flatMap((i) => i.po_ids))],
      relay_name: order.relay_name || 'Relais',
      status: sum('uncovered') > 0 ? { label: 'Anomalie fournisseur', tone: 'bad' } : { label: 'Attente fournisseur', tone: 'wait' },
      totals: {
        requested: sum('requested'), covered: sum('covered'), uncovered: sum('uncovered'), received: sum('received'), remaining: sum('remaining_to_deliver'),
        anomaly: sum('anomaly'), to_control: sum('to_control'), controlled: sum('controlled'), in_bags: sum('in_bags'), in_boxes: sum('in_boxes'), shipped: sum('shipped'),
      },
      readiness: {
        complete, partial: !complete && sum('received') > 0, ready_to_pack: complete && sum('anomaly') === 0, unbagged_received: sum('received') - sum('in_bags') - sum('in_boxes'),
        bag_open: false, pending_items: pending,
        blockers: complete ? [] : ['Articles non reçus : ' + pending.map((p) => `${p.product} (${p.missing})`).join(', ')],
      },
    };
  });
  d.cockpit = {
    allocation_rule: 'FIFO : la commande la plus ancienne est servie en premier (par SKU dans la PO)',
    unit_legend: ['none', 'draft', 'pending', 'shipped', 'received', 'boxed'].map((state) => ({ state, label: state })),
    physical: [['received', 'Reçu au Hub · non ensaché'], ['bags', 'Sacs clients'], ['boxes', 'KOM-BOX'], ['shipped', 'Expédié au relais'], ['reliquats', 'Reliquats attendus']]
      .map(([key, title]) => ({ key, title, tone: 'grey', items: [], empty_text: 'Rien.' })),
    po_steps: STEPS, viewer, need_batches: needBatches, todo, ...(source.cockpit || {}),
  };
  d.bags_open = d.bags_open || [];
  d.bags_ready = d.bags_ready || [];
  d.fillable = d.fillable || [];
  return d;
}

module.exports = { shapeDossier };
