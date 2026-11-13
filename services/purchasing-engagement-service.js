/**
 * @komerce-arch
 * @role          purchasing-engagement-service
 * @domain        purchasing
 * @layer         service
 * @criticality   critical
 * @inputs        purchase_order_id, purchase_line_id, supplier_confirmation, runtime_context
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/purchasing-grouped-service.js, services/supplier-shortage-service.js, services/purchase-line-snapshot.js, services/notification-service.js, services/hub-reference.js, services/suppliers/provider-authority.js, services/suppliers/canonical-unit-purchasing-gate.js, services/suppliers/purchase-order-confirmation-boundary.js, services/suppliers/execution-adapter-registry.js, services/suppliers/supplier-fulfillment-adapter-contract.js, utils/logger.js
 * @used-by       routes/purchasing.js
 * @db-read       manual_purchase_executions, order_items, orders, product_suppliers, products, purchase_lines, purchase_order_authorizations, purchase_orders, supplier_execution_payments, suppliers, v_purchase_line_progress
 * @db-write      alerts, incidents, manual_purchase_executions, purchase_lines, purchase_orders
 * @db-txn        owns_transaction
 * @doctrine      docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-10
 */

'use strict';

/**
 * Engagement d'une PO regroupée (PR 5/8, MISSION_PURCHASE_LINES §6-8), derrière KOMERCE_GROUPED_PURCHASING.
 *
 *   submit  : PO draft → notified (préparation par groupe supplier_unit_ref, message agrégé) ; échec = PO reste draft.
 *   confirm : PO notified → confirmed (ou cancelled si tout à 0), une confirmation par ligne, reliquat en ligne ouverte.
 *   settle  : écart à la réception — ligne confirmée soldée à une quantité ≤ reçu et < effectif, reliquat optionnel
 *             (reopen_remainder) ; la PO passe en hub_received quand toutes ses lignes sont soldées.
 *   POST /lines : création manuelle d'une ligne ouverte (ex. racheter un reliquat chez un autre fournisseur).
 *
 * Ordre d'écriture imposé par I1 (somme des effectifs ≤ besoin) : la confirmation (ou la clôture) de la ligne
 * d'origine d'abord — son effectif baisse — puis l'insertion du reliquat. Verrous : PO d'abord, lignes triées par id.
 *
 * Le marché reste une propriété de chaque ligne (v_purchase_line_market) : les réponses l'exposent par marché en
 * lecture seule (quantités, montants confirmés). Aucune ventilation financière ni refacturation n'est écrite ici.
 * `placeOrder` n'est jamais appelé : place_order_invoked=false reste un invariant.
 */

const db = require('../db');
const { notifyText } = require('./notification-service');
const { buildSupplierTagRequest } = require('./hub-reference');
const providerAuthority = require('./suppliers/provider-authority');
const adapterContract = require('./suppliers/supplier-fulfillment-adapter-contract');
const { EXECUTION_ADAPTER_REGISTRY } = require('./suppliers/execution-adapter-registry');
const { evaluateCanonicalProcurementReadiness } = require('./suppliers/canonical-unit-purchasing-gate');
const { verifyProviderEvidenceForConfirmation, COMMITMENT_VERDICT } = require('./suppliers/purchase-order-confirmation-boundary');
const {
  loadExactSoldSku,
  resolveExactSkuProcurementReadiness,
  buildPurchaseTarget,
  insertOpenPurchaseLine,
  procurementHubLabel,
} = require('./purchase-line-snapshot');
const { shared } = require('./purchasing-grouped-service');
const { openSupplierShortage } = require('./supplier-shortage-service');
const log = require('../utils/logger').child({ module: 'purchasing-engagement' });

const {
  fail, requireUuid, withTransaction, lockGroupedPo,
  loadPurchaseOrderLines, summarizeMarkets, shapeLine, LINE_COLUMNS, LINE_JOINS,
} = shared;

// Statuts de PO regroupée où une ligne peut être soldée (seul `confirmed` : `hub_received` est terminal).
// Une PO manuelle se solde dès `notified` (achat réel passé, aucune confirmation fournisseur artificielle).
const SETTLEABLE_PO_STATUSES = ['notified', 'confirmed'];

function requireNonNegativeInt(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail(400, 'INVALID_INPUT', `${name} doit être un entier >= 0`);
  return value;
}

function requirePositiveInt(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw fail(400, 'INVALID_INPUT', `${name} doit être un entier >= 1`);
  return value;
}

function optionalText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function uuidOrNull(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

// ─── Projection par marché (lecture seule) ────────────────────────────────────────────────────────

/**
 * Quantités et montants confirmés par marché, calculés depuis les lignes (qui portent chacune leur marché).
 * Projection pour le futur règlement par marché : rien n'est écrit, aucune refacturation.
 */
function summarizeCommitmentByMarket(lines, remnants = []) {
  const byMarket = new Map();
  const entryFor = (line) => {
    const key = String(line.market_id);
    if (!byMarket.has(key)) {
      byMarket.set(key, {
        market_id: line.market_id, market_code: line.market_code, market_name: line.market_name,
        lines: 0, confirmed_quantity: 0, remnant_quantity: 0, amounts: new Map(),
      });
    }
    return byMarket.get(key);
  };
  for (const line of lines) {
    if (line.cancelled) continue;
    const entry = entryFor(line);
    entry.lines += 1;
    const quantity = Number(line.effective_quantity);
    entry.confirmed_quantity += quantity;
    const price = line.confirmed_unit_price ?? line.expected_unit_price;
    if (price !== null && price !== undefined && line.supplier_currency) {
      entry.amounts.set(line.supplier_currency, (entry.amounts.get(line.supplier_currency) || 0) + quantity * Number(price));
    }
  }
  for (const remnant of remnants) {
    entryFor(remnant).remnant_quantity += Number(remnant.quantity);
  }
  const markets = [...byMarket.values()]
    .map((m) => ({
      market_id: m.market_id, market_code: m.market_code, market_name: m.market_name,
      lines: m.lines, confirmed_quantity: m.confirmed_quantity, remnant_quantity: m.remnant_quantity,
      confirmed_amounts: [...m.amounts.entries()]
        .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 10000) / 10000 }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    }))
    .sort((a, b) => String(a.market_code || a.market_id).localeCompare(String(b.market_code || b.market_id)));
  return { markets, multi_market: markets.length > 1 };
}

async function loadLinesByIds(q, ids) {
  if (!ids.length) return [];
  const { rows } = await q.query(`
    SELECT ${LINE_COLUMNS}
    ${LINE_JOINS}
     WHERE pl.id = ANY($1::uuid[])
     ORDER BY pl.id
  `, [ids]);
  return rows.map(shapeLine);
}

// ─── Reliquat : ligne ouverte copiée de la ligne d'origine ────────────────────────────────────────

async function insertRemnant(client, line, quantity, actor) {
  const { rows: [remnant] } = await client.query(`
    INSERT INTO purchase_lines
      (purchase_order_id, order_item_id, supplier_id, product_supplier_id, product_sku_id,
       supplier_sku, supplier_unit_ref, supplier_order_identity, quantity,
       supplier_unit_price, supplier_currency, procurement_hub_ref, parent_line_id, created_by)
    VALUES (NULL,$1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)
    RETURNING id
  `, [
    line.order_item_id, line.supplier_id, line.product_supplier_id, line.product_sku_id,
    line.supplier_sku, line.supplier_unit_ref,
    line.supplier_order_identity ? JSON.stringify(line.supplier_order_identity) : null,
    quantity, line.supplier_unit_price, line.supplier_currency, line.procurement_hub_ref,
    line.id, uuidOrNull(actor && actor.id),
  ]);
  return remnant.id;
}

// ─── Soumission ───────────────────────────────────────────────────────────────────────────────────

function groupBySupplierUnitRef(lines) {
  const groups = new Map();
  for (const line of lines) {
    const key = line.supplier_unit_ref || `${line.product_sku_id || 'line'}:${line.supplier_sku}:${line.supplier_unit_ref ? '' : line.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        supplier_unit_ref: key,
        supplier_sku: line.supplier_sku,
        identity: line.supplier_order_identity,
        product_sku_id: line.product_sku_id,
        product_name: line.product_name,
        supplier_unit_price: line.supplier_unit_price,
        supplier_currency: line.supplier_currency,
        quantity: 0,
        line_ids: [],
      });
    }
    const group = groups.get(key);
    group.quantity += Number(line.quantity);
    group.line_ids.push(line.id);
  }
  return [...groups.values()];
}

function buildSubmitMessage({ po, supplier, groups, tag, hubLabel }) {
  const lines = groups.map((g) => {
    const total = g.supplier_unit_price !== null
      ? ` — ${(Number(g.supplier_unit_price) * g.quantity).toFixed(2)} ${g.supplier_currency}` : '';
    const reference = g.supplier_sku
      ? ` — Réf. fournisseur : ${g.supplier_sku}`
      : ' — Référence Komerce ; référence fournisseur à renseigner par le Hub';
    return `- ${g.product_name || g.supplier_sku || 'Produit'} (x${g.quantity})${reference}${total}`;
  });
  return {
    supplier: [
      `Bonjour ${supplier.name},`, '', 'Je souhaite commander :', ...lines, '',
      `Référence commande Komerce : ${po.id}`,
      `Référence colis Komerce à apposer si possible : ${tag.printable_text}`,
      'Merci de conserver cette référence sur chaque colis physique de cette commande.',
      `Livraison au Hub ${hubLabel}.`, 'Merci de confirmer la disponibilité.',
    ].join('\n'),
    admin: [
      '🛒 KOMERCE — À commander (PO regroupée)',
      `PO : ${po.id}`, `Fournisseur : ${supplier.name} (${supplier.platform || 'manuel'})`,
      ...lines, `Hub : ${hubLabel}`, `Tag colis Komerce : ${tag.printable_text}`, '',
      '→ Confirmer sur le dashboard ou via :', `POST /api/purchasing/po/${po.id}/confirm`,
    ].join('\n'),
  };
}

/**
 * Préparation distante par groupe (une évaluation par supplier_unit_ref, quantité sommée), uniquement pour les
 * providers dont l'autorité exige une préparation distante. Tout verdict ≠ prêt refuse la soumission.
 */
async function prepareGroups(client, groups, context) {
  const verdicts = [];
  const readyByProvider = new Map();
  for (const group of groups) {
    const provider = group.identity && group.identity.provider;
    const requirement = providerAuthority.remotePreflightRequirement(provider);
    if (requirement === providerAuthority.PREFLIGHT_REQUIREMENT.NOT_REQUIRED) {
      verdicts.push({ supplier_unit_ref: group.supplier_unit_ref, provider, quantity: group.quantity, ready: true, status: 'NOT_REQUIRED' });
      continue;
    }
    const readiness = await evaluateCanonicalProcurementReadiness({
      productSkuId: group.product_sku_id,
      quantity: group.quantity,
      soldIdentity: group.identity,
      query: client.query.bind(client),
      adapters: EXECUTION_ADAPTER_REGISTRY,
      context,
    });
    verdicts.push({
      supplier_unit_ref: group.supplier_unit_ref, provider, quantity: group.quantity,
      ready: Boolean(readiness && readiness.ready), status: readiness ? readiness.status : 'UNKNOWN',
      reason: readiness && readiness.reason ? readiness.reason : null,
    });
    if (readiness && readiness.ready) {
      if (!readyByProvider.has(provider)) readyByProvider.set(provider, []);
      readyByProvider.get(provider).push({ group, preflight: readiness.preflight || readiness });
    }
  }
  return { verdicts, readyByProvider };
}

function manualVerdicts(groups) {
  return {
    verdicts: groups.map((g) => ({
      supplier_unit_ref: g.supplier_unit_ref, provider: g.identity && g.identity.provider, quantity: g.quantity, ready: true, status: 'MANUAL',
    })),
    readyByProvider: new Map(),
  };
}

/** Charge utile fournisseur (adaptateurs qui savent en construire une) : un refus de l'adaptateur refuse la soumission. */
async function buildProviderPayloads(readyByProvider, context, verdicts) {
  for (const [provider, entries] of readyByProvider.entries()) {
    const adapter = EXECUTION_ADAPTER_REGISTRY[provider];
    const check = adapterContract.validateAdapter(provider, adapter);
    if (!check.ok || typeof check.adapter.buildOrderPayload !== 'function') continue;
    try {
      await check.adapter.buildOrderPayload({
        items: entries.map(({ group }) => ({
          identity: group.identity, supplier_unit_ref: group.supplier_unit_ref,
          supplier_sku: group.supplier_sku, quantity: group.quantity,
        })),
        preflights: entries.map(({ preflight }) => preflight),
        context,
      });
    } catch (error) {
      for (const { group } of entries) {
        const verdict = verdicts.find((v) => v.supplier_unit_ref === group.supplier_unit_ref);
        if (verdict) { verdict.ready = false; verdict.status = 'BUILD_ORDER_PAYLOAD_REFUSED'; verdict.reason = String(error && error.message || error); }
      }
    }
  }
}

async function submitPurchaseOrder(poId, { actor = null, context = {} } = {}) {
  requireUuid(poId, 'po_id');

  const outcome = await withTransaction(async (client) => {
    const po = await lockGroupedPo(client, poId);
    await require('./hub-authorization-service').assertCommitmentAuthorized(client, po.id);
    const { rows: lineRows } = await client.query(`
      SELECT pl.id, pl.product_sku_id, pl.supplier_sku, pl.supplier_unit_ref, pl.supplier_order_identity,
             pl.quantity, pl.supplier_unit_price, pl.supplier_currency, p.name AS product_name,
              NULLIF(to_jsonb(o)->>'simulation_scope','') AS simulation_scope
        FROM purchase_lines pl
        JOIN order_items oi ON oi.id = pl.order_item_id
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
       WHERE pl.purchase_order_id = $1 AND pl.cancelled_at IS NULL
       ORDER BY pl.id FOR UPDATE OF pl
    `, [po.id]);
    if (!lineRows.length) throw fail(409, 'PURCHASE_ORDER_EMPTY', 'Une PO sans ligne ne peut pas être soumise');
    // Une PO simulée ne doit jamais contenir une vente réelle ou d'un autre
    // scénario. Aucune simulation ne doit déclencher un adaptateur fournisseur.
    const scopes = new Set(lineRows.map((line) => line.simulation_scope || null));
    if (scopes.size !== 1) {
      throw fail(409, 'PURCHASE_ORDER_SIMULATION_SCOPE_MIXED', 'PO mixte simulation et activité réelle interdite');
    }
    const simulationScope = [...scopes][0];
    if (simulationScope && po.trigger_mode === 'auto') {
      throw fail(409, 'SIMULATED_PO_AUTO_ORDER_FORBIDDEN', 'Achat API fournisseur interdit pour une PO simulée');
    }

    const groups = groupBySupplierUnitRef(lineRows.map((r) => ({ ...r })));
    // Mode manuel : aucune dépendance API (ni préparation distante ni réconciliation) — le Hub achète puis enregistre.
    const { verdicts, readyByProvider } = po.trigger_mode === 'auto'
      ? await prepareGroups(client, groups, context)
      : manualVerdicts(groups);
    if (verdicts.every((v) => v.ready)) await buildProviderPayloads(readyByProvider, context, verdicts);
    if (verdicts.some((v) => !v.ready)) {
      throw fail(409, 'PURCHASE_ORDER_SUBMIT_REFUSED', 'Soumission refusée : préparation fournisseur non prête, la PO reste en brouillon', {
        verdicts,
      });
    }

    const { rows: [supplier] } = await client.query(
      'SELECT name, platform, contact_phone FROM suppliers WHERE id = $1', [po.supplier_id]
    );
    const { rows: [header] } = await client.query('SELECT trigger_mode FROM purchase_orders WHERE id = $1', [po.id]);
    const tag = buildSupplierTagRequest(po.id);
    const messages = buildSubmitMessage({ po, supplier, groups, tag, hubLabel: procurementHubLabel(po.procurement_hub_ref) });

    // Décision 4 (#3998) : pour une PO automatique, la soumission API vaut preuve d'envoi (canal « api », auteur = acteur) ;
    // le geste manuel « Enregistrer l'envoi » n'existe que pour les PO manuelles/WhatsApp. Jamais en simulation.
    const apiSent = header.trigger_mode === 'auto' && !simulationScope;
    await client.query(
      apiSent
        ? `UPDATE purchase_orders SET status = 'notified', ordered_at = NOW(), updated_at = NOW(),
                  sent_at = NOW(), sent_channel = 'api', sent_by = $2 WHERE id = $1`
        : `UPDATE purchase_orders SET status = 'notified', ordered_at = NOW(), updated_at = NOW() WHERE id = $1`,
      apiSent ? [po.id, uuidOrNull(actor && actor.id)] : [po.id]
    );
    // Invariant 14 de la carte : le lien WhatsApp s'écrit APRÈS la persistance de la PO.
    let waUrl = null;
    if (!simulationScope && header.trigger_mode === 'whatsapp' && supplier.contact_phone) {
      waUrl = `https://wa.me/${supplier.contact_phone}?text=${encodeURIComponent(messages.supplier)}`;
      await client.query('UPDATE purchase_orders SET notes = $1, updated_at = NOW() WHERE id = $2', [`wa_url:${waUrl}`, po.id]);
    }
    return { po_id: po.id, verdicts, groups, adminMessage: messages.admin, waUrl, tag, actor, simulationScope };
  });

  // Notification admin après COMMIT : jamais pour une soumission annulée.
  const channel = outcome.simulationScope ? 'simulation_no_notification' : (outcome.waUrl ? 'whatsapp' : 'admin_manual');
  if (!outcome.simulationScope && !outcome.waUrl && process.env.ADMIN_PHONE) {
    notifyText(process.env.ADMIN_PHONE, outcome.adminMessage, 'purchase_manual', outcome.po_id)
      .catch((err) => log.error({ err }, 'Notification purchase_manual (PO regroupée) failed'));
  }
  log.info({ po_id: outcome.po_id, channel, groups: outcome.groups.length }, '[PURCHASING] PO regroupée soumise');

  const lines = await loadPurchaseOrderLines(db, outcome.po_id);
  const { rows: [purchaseOrder] } = await db.query('SELECT * FROM purchase_orders WHERE id = $1', [outcome.po_id]);
  return {
    purchase_order: purchaseOrder,
    lines,
    groups: outcome.groups.map((g) => ({
      supplier_unit_ref: g.supplier_unit_ref, supplier_sku: g.supplier_sku, quantity: g.quantity, line_ids: g.line_ids,
    })),
    preflights: outcome.verdicts,
    notification: { channel, wa_url: outcome.waUrl, inbound_tag: outcome.tag.reference },
    place_order_invoked: false,
    ...summarizeMarkets(lines),
  };
}

// ─── Confirmation au niveau PO ────────────────────────────────────────────────────────────────────

function parseConfirmationLines(body) {
  const rawLines = body && body.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw fail(400, 'INVALID_INPUT', 'lines doit contenir une entrée par ligne de la PO');
  const parsed = rawLines.map((entry) => {
    if (!entry || typeof entry !== 'object') throw fail(400, 'INVALID_INPUT', 'lines[] invalide');
    const id = requireUuid(entry.purchase_line_id, 'lines[].purchase_line_id');
    const confirmedQuantity = requireNonNegativeInt(entry.confirmed_quantity, 'lines[].confirmed_quantity');
    let price = null;
    if (entry.confirmed_unit_price !== undefined && entry.confirmed_unit_price !== null) {
      price = Number(entry.confirmed_unit_price);
      if (!Number.isFinite(price) || price <= 0) throw fail(400, 'INVALID_INPUT', 'lines[].confirmed_unit_price doit être > 0');
    }
    return { id, confirmedQuantity, price };
  });
  if (new Set(parsed.map((p) => p.id)).size !== parsed.length) throw fail(400, 'INVALID_INPUT', 'lines contient des doublons');
  return parsed;
}

async function verifyConfirmationEvidence(lines, confirmations, supplierOrderId, context) {
  const byLine = new Map(confirmations.map((c) => [c.id, c]));
  const itemsByProvider = new Map();
  for (const line of lines) {
    const confirmed = byLine.get(line.id).confirmedQuantity;
    if (confirmed < 1) continue;
    const provider = line.supplier_order_identity && line.supplier_order_identity.provider;
    if (!provider) continue;
    if (!itemsByProvider.has(provider)) itemsByProvider.set(provider, new Map());
    const items = itemsByProvider.get(provider);
    const existing = items.get(line.supplier_unit_ref);
    if (existing) existing.quantity += confirmed;
    else items.set(line.supplier_unit_ref, {
      identity: line.supplier_order_identity, supplier_unit_ref: line.supplier_unit_ref,
      supplier_sku: line.supplier_sku, quantity: confirmed,
    });
  }

  let verifiedRef = supplierOrderId;
  for (const [provider, items] of itemsByProvider.entries()) {
    const list = [...items.values()];
    const evidence = await verifyProviderEvidenceForConfirmation({
      identity: list[0].identity, externalRef: supplierOrderId, items: list,
      adapters: EXECUTION_ADAPTER_REGISTRY, context,
    });
    if (!evidence.required) continue;
    if (evidence.commitment_verdict !== COMMITMENT_VERDICT.COMMITTED) {
      throw fail(409, 'PURCHASE_ORDER_CONFIRMATION_REJECTED',
        `Confirmation impossible : réconciliation fournisseur non validée (${evidence.evidence && evidence.evidence.reason || 'raison inconnue'}).`,
        { provider });
    }
    // La PO snapshotte la référence VÉRIFIÉE, jamais la valeur brute fournie par l'opérateur.
    verifiedRef = evidence.external_ref;
  }
  return verifiedRef;
}

const EXECUTION_CHANNELS = ['in_person', 'phone', 'whatsapp', 'email', 'other'];
const money4 = (n) => Math.round(Number(n) * 10000) / 10000;

/**
 * Vendeur réel par achat physique (A2/A2-bis) : obligatoire à la confirmation d'une PO manuelle, jamais `central_hub`.
 * Forme longue `executions[]` (allocations vendeur -> ligne -> quantité/montant) ou raccourci `seller_supplier_id`/`seller_label`
 * (un seul vendeur couvrant toutes les lignes confirmées, au prix confirmé). Chaque ligne confirmée doit être allouée à
 * l'unité près. L'écart montant justifié / montant confirmé (par devise) exige `variance_reason`.
 */
async function buildManualExecutions(client, lines, byId, body, manualProof) {
  const confirmedLines = lines.filter((l) => byId.get(l.id).confirmedQuantity > 0);
  const unitPrice = (l) => (byId.get(l.id).price !== null ? byId.get(l.id).price : Number(l.supplier_unit_price));
  let raw = body.executions;
  if (raw === undefined || raw === null) {
    const label = optionalText(body.seller_label);
    const sid = optionalText(body.seller_supplier_id);
    raw = confirmedLines.map((l) => ({
      purchase_line_id: l.id, seller_supplier_id: sid, seller_label: label, channel: body.channel,
      quantity: byId.get(l.id).confirmedQuantity, amount: money4(byId.get(l.id).confirmedQuantity * unitPrice(l)),
    }));
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw fail(400, 'MANUAL_PURCHASE_SELLER_REQUIRED', 'Vendeur réel obligatoire à la confirmation d’un achat manuel (executions[] ou seller_label/seller_supplier_id).');
  }
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const sellerIds = [...new Set(raw.map((e) => e && optionalText(e.seller_supplier_id)).filter(Boolean))];
  for (const id of sellerIds) requireUuid(id, 'executions[].seller_supplier_id');
  const hubIds = new Set();
  if (sellerIds.length) {
    const { rows } = await client.query('SELECT id, system_key FROM suppliers WHERE id = ANY($1::uuid[])', [sellerIds]);
    if (rows.length !== sellerIds.length) throw fail(400, 'INVALID_INPUT', 'seller_supplier_id inconnu');
    for (const r of rows) if (r.system_key === 'central_hub') hubIds.add(r.id);
  }
  const allocated = new Map();
  const execs = raw.map((e) => {
    if (!e || typeof e !== 'object') throw fail(400, 'INVALID_INPUT', 'executions[] invalide');
    const lineId = requireUuid(e.purchase_line_id, 'executions[].purchase_line_id');
    const line = lineById.get(lineId);
    if (!line || byId.get(lineId).confirmedQuantity < 1) {
      throw fail(409, 'MANUAL_PURCHASE_EXECUTION_LINE_INVALID', 'Allocation vendeur sur une ligne non confirmée de la PO', { purchase_line_id: lineId });
    }
    const sid = optionalText(e.seller_supplier_id);
    const label = optionalText(e.seller_label);
    if (sid && hubIds.has(sid)) throw fail(400, 'MANUAL_PURCHASE_SELLER_CENTRAL_HUB', 'central_hub coordonne l’achat : le vendeur réel doit être déclaré (fournisseur référencé ou seller_label).');
    if (!sid && !label) throw fail(400, 'MANUAL_PURCHASE_SELLER_REQUIRED', 'Vendeur réel obligatoire (seller_supplier_id ou seller_label) pour chaque allocation.');
    const quantity = requireNonNegativeInt(e.quantity, 'executions[].quantity');
    if (quantity < 1) throw fail(400, 'INVALID_INPUT', 'executions[].quantity doit être ≥ 1');
    const amount = Number(e.amount);
    if (!Number.isFinite(amount) || amount < 0) throw fail(400, 'INVALID_INPUT', 'executions[].amount invalide');
    const channel = optionalText(e.channel) || 'other';
    if (!EXECUTION_CHANNELS.includes(channel)) throw fail(400, 'INVALID_INPUT', 'executions[].channel invalide');
    const currency = String(optionalText(e.currency) || line.supplier_currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw fail(400, 'INVALID_INPUT', 'executions[].currency (devise de la PO) obligatoire');
    allocated.set(lineId, (allocated.get(lineId) || 0) + quantity);
    return { lineId, sid, label, channel, quantity, amount: money4(amount), currency, proof: optionalText(e.proof_ref) || manualProof };
  });
  for (const l of confirmedLines) {
    const got = allocated.get(l.id) || 0;
    const want = byId.get(l.id).confirmedQuantity;
    if (got !== want) {
      throw fail(409, 'MANUAL_PURCHASE_ALLOCATION_MISMATCH', 'Les allocations vendeur doivent couvrir exactement la quantité confirmée de chaque ligne', { purchase_line_id: l.id, allocated: got, confirmed: want });
    }
  }
  const diff = new Map();
  for (const l of confirmedLines) {
    const cur = String(l.supplier_currency || '').toUpperCase();
    diff.set(cur, (diff.get(cur) || 0) - byId.get(l.id).confirmedQuantity * unitPrice(l));
  }
  for (const e of execs) diff.set(e.currency, (diff.get(e.currency) || 0) + e.amount);
  const variance = [...diff.values()].some((d) => Math.abs(d) > 0.0001);
  const varianceReason = optionalText(body.variance_reason);
  if (variance && !varianceReason) {
    throw fail(409, 'MANUAL_PURCHASE_VARIANCE_REASON_REQUIRED', 'Écart entre le total justifié et le total confirmé : variance_reason obligatoire.', { variance: Object.fromEntries(diff) });
  }
  return { execs, varianceReason: variance ? varianceReason : null };
}

async function insertManualExecutions(client, poId, { execs, varianceReason }, actor) {
  for (const e of execs) {
    await client.query(`
      INSERT INTO manual_purchase_executions
        (purchase_order_id, purchase_line_id, seller_supplier_id, seller_label, channel, quantity, amount, currency, proof_ref, variance_reason, recorded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [poId, e.lineId, e.sid, e.sid ? null : e.label, e.channel, e.quantity, e.amount, e.currency, e.proof, varianceReason, actor && actor.id || null]);
  }
}

/** Rapprochement par cumuls et plafonds (A2-ter) : confirmé ↔ justifié ↔ autorisé/payé, par devise. Lecture seule. */
async function getPurchaseReconciliation(poId) {
  requireUuid(poId, 'po_id');
  const [confirmed, justified, auths, paid] = await Promise.all([
    db.query(`SELECT supplier_currency AS currency, SUM(confirmed_quantity * COALESCE(confirmed_unit_price, supplier_unit_price)) AS total
                FROM purchase_lines WHERE purchase_order_id = $1 AND cancelled_at IS NULL AND confirmed_quantity > 0 GROUP BY 1`, [poId]),
    db.query('SELECT currency, SUM(amount) AS total FROM manual_purchase_executions WHERE purchase_order_id = $1 GROUP BY 1', [poId]),
    db.query('SELECT authorization_type, amount, currency FROM purchase_order_authorizations WHERE purchase_order_id = $1', [poId]),
    db.query(`SELECT currency, SUM(expected_amount) AS total FROM supplier_execution_payments
               WHERE purchase_order_id = $1 AND status IN ('prepared','requested','succeeded','ambiguous') GROUP BY 1`, [poId]),
  ]);
  const cur = {};
  const put = (rows, key) => rows.forEach((r) => { (cur[r.currency] = cur[r.currency] || {})[key] = Number(r.total); });
  put(confirmed.rows, 'confirmed_total'); put(justified.rows, 'justified_total'); put(paid.rows, 'paid_or_committed_total');
  auths.rows.forEach((a) => { (cur[a.currency] = cur[a.currency] || {})[`${a.authorization_type}_cap`] = Number(a.amount); });
  const currencies = Object.entries(cur).map(([currency, v]) => ({
    currency, ...v,
    justification_gap: money4((v.confirmed_total || 0) - (v.justified_total || 0)),
    payment_within_cap: v.supplier_payment_cap === undefined ? null : (v.paid_or_committed_total || 0) <= v.supplier_payment_cap + 0.0001,
  }));
  return { purchase_order_id: poId, currencies };
}

async function confirmGroupedPurchaseOrder(poId, body = {}, { actor = null, context = {} } = {}) {
  requireUuid(poId, 'po_id');
  const confirmations = parseConfirmationLines(body);
  const supplierOrderId = optionalText(body.supplier_order_id);
  const trackingUrl = optionalText(body.tracking_url);
  const trackingNumber = optionalText(body.tracking_number);
  const notes = optionalText(body.notes);
  const manualProof = optionalText(body.purchase_proof_ref);

  const outcome = await withTransaction(async (client) => {
    const po = await lockGroupedPo(client, poId, { requireDraft: false });
    if (po.trigger_mode !== 'auto' && confirmations.some((line) => line.confirmedQuantity > 0) && (!manualProof || manualProof.length < 4)) {
      throw fail(400, 'MANUAL_PURCHASE_PROOF_REQUIRED', 'Une référence de justificatif d’achat est obligatoire avant toute confirmation manuelle.');
    }
    if (po.status !== 'notified') {
      throw fail(409, 'PURCHASE_ORDER_NOT_NOTIFIED', `PO au statut "${po.status}" : seule une PO soumise (notified) se confirme`, {
        current_status: po.status,
      });
    }
    const { rows: lines } = await client.query(`
      SELECT id, order_item_id, supplier_id, product_supplier_id, product_sku_id, supplier_sku, supplier_unit_ref,
             supplier_order_identity, quantity, supplier_unit_price, supplier_currency, procurement_hub_ref
        FROM purchase_lines
       WHERE purchase_order_id = $1 AND cancelled_at IS NULL
       ORDER BY id FOR UPDATE
    `, [po.id]);

    // `lines` doit couvrir EXACTEMENT les lignes non annulées de la PO.
    const known = new Set(lines.map((l) => l.id));
    const given = new Set(confirmations.map((c) => c.id));
    const missing = [...known].filter((id) => !given.has(id));
    const extra = [...given].filter((id) => !known.has(id));
    if (missing.length || extra.length) {
      throw fail(409, 'PURCHASE_LINES_MISMATCH', 'lines doit contenir exactement les lignes non annulées de la PO', { missing, extra });
    }
    const byId = new Map(confirmations.map((c) => [c.id, c]));
    for (const line of lines) {
      if (byId.get(line.id).confirmedQuantity > line.quantity) {
        throw fail(400, 'INVALID_INPUT', `confirmed_quantity dépasse la quantité de la ligne ${line.id}`, { purchase_line_id: line.id, quantity: line.quantity });
      }
    }
    // HB-05 : la réception avant confirmation est permise, mais une confirmation ne peut pas descendre sous le déjà reçu
    // (unique définition SQL du reçu, hors quarantaine) : l'allocation figée serait dépassée et le reçu recommandé en double.
    for (const line of lines) {
      const { rows: [r] } = await client.query('SELECT purchase_line_received_quantity($1) AS received', [line.id]);
      const received = Number(r?.received || 0);
      if (byId.get(line.id).confirmedQuantity < received) {
        throw fail(409, 'CONFIRMED_QUANTITY_BELOW_RECEIVED', `confirmed_quantity (${byId.get(line.id).confirmedQuantity}) inférieure à la quantité déjà reçue (${received}) pour la ligne ${line.id}`, {
          purchase_line_id: line.id, confirmed_quantity: byId.get(line.id).confirmedQuantity, received_quantity: received,
        });
      }
    }

    for (const line of lines) {
      const c = byId.get(line.id);
      if (c.confirmedQuantity > 0 && c.price === null && !(Number(line.supplier_unit_price) > 0)) {
        throw fail(400, 'CONFIRMED_PRICE_REQUIRED', 'Prix unitaire confirmé obligatoire pour une ligne sans prix fournisseur connu', { purchase_line_id: line.id });
      }
    }

    const allZero = confirmations.every((c) => c.confirmedQuantity === 0);
    // A2/A2-bis : vendeur réel structuré, obligatoire à la confirmation d'un achat manuel, même transaction.
    const manualExecutions = (po.trigger_mode !== 'auto' && !allZero)
      ? await buildManualExecutions(client, lines, byId, body, manualProof) : null;
    // Réconciliation fournisseur uniquement pour une PO API ; une PO manuelle enregistre la référence/preuve déclarée par le Hub.
    const verifiedRef = (allZero || po.trigger_mode !== 'auto')
      ? supplierOrderId
      : await verifyConfirmationEvidence(lines, confirmations, supplierOrderId, context);

    // 1) confirmations d'abord (l'effectif des lignes d'origine baisse), 2) reliquats ensuite (I1).
    for (const line of lines) {
      const c = byId.get(line.id);
      await client.query(`
        UPDATE purchase_lines
           SET confirmed_quantity = $2, confirmed_unit_price = COALESCE($3, supplier_unit_price),
               confirmed_at = NOW(), updated_at = NOW()
         WHERE id = $1
      `, [line.id, c.confirmedQuantity, c.price]);
    }
    const remnantIds = [];
    for (const line of lines) {
      const remaining = line.quantity - byId.get(line.id).confirmedQuantity;
      if (remaining > 0) remnantIds.push(await insertRemnant(client, line, remaining, actor));
    }

    if (allZero) {
      // Le trigger d'annulation de PO annule les lignes ; les reliquats (non rattachés) restent ouverts.
      await client.query(
        `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW(),
                notes = CONCAT(COALESCE(notes, ''), E'\\n[GROUPED] aucune ligne confirmée par le fournisseur') WHERE id = $1`,
        [po.id]
      );
    } else {
      await client.query(`
        UPDATE purchase_orders
           SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW(),
               supplier_order_id = COALESCE($2, supplier_order_id),
               tracking_url = COALESCE($3, tracking_url),
               tracking_number = COALESCE($4, tracking_number),
               notes = CASE WHEN $5::text IS NULL THEN notes ELSE CONCAT(COALESCE(notes, ''), E'\\n', $5::text) END
         WHERE id = $1
      `, [po.id, verifiedRef, trackingUrl, trackingNumber,
        po.trigger_mode === 'auto' ? notes : [notes, manualProof && `[PREUVE_ACHAT_MANUEL] ${manualProof}`].filter(Boolean).join('\n') || null]);
    }
    if (manualExecutions) await insertManualExecutions(client, po.id, manualExecutions, actor);
    return { po_id: po.id, remnantIds, allZero };
  });

  const lines = await loadPurchaseOrderLines(db, outcome.po_id);
  const remnants = await loadLinesByIds(db, outcome.remnantIds);
  const { rows: [purchaseOrder] } = await db.query('SELECT * FROM purchase_orders WHERE id = $1', [outcome.po_id]);
  log.info({ po_id: outcome.po_id, status: purchaseOrder.status, remnants: remnants.length }, '[PURCHASING] PO regroupée confirmée');
  return {
    purchase_order: purchaseOrder,
    lines,
    remnants,
    ...summarizeCommitmentByMarket(lines, remnants),
  };
}

// ─── Clôture d'une ligne (écart à la réception) ───────────────────────────────────────────────────

/**
 * Écart à la réception (casse ou manquant) : la ligne confirmée est soldée à `settled_quantity`, qui ne peut pas
 * dépasser ce que le Hub a reçu (v_purchase_line_progress) et doit être strictement inférieure à l'effectif.
 * `settled_*` s'écrit d'abord (l'effectif baisse), le reliquat ensuite (I1). Clôture de la PO regroupée : quand toutes
 * ses lignes non annulées sont soldées (reçu ≥ effectif), la PO passe en `hub_received`.
 * La réclamation fournisseur reste hors périmètre.
 */
async function closeGroupedPurchaseOrderIfComplete(client, poId) {
  const { rows: progress } = await client.query(`
    SELECT effective_quantity, received_quantity
      FROM v_purchase_line_progress
     WHERE purchase_order_id = $1 AND line_id IS NOT NULL AND NOT cancelled
  `, [poId]);
  if (!progress.length) return false;
  if (!progress.every((p) => Number(p.received_quantity) >= Number(p.effective_quantity))) return false;
  await client.query(`
    UPDATE purchase_orders
       SET status = 'hub_received', hub_received_at = COALESCE(hub_received_at, NOW()), updated_at = NOW(),
           notes = CONCAT(COALESCE(notes, ''), E'\\n[GROUPED] toutes les lignes sont soldées')
     WHERE id = $1 AND status IN ('notified', 'confirmed')
  `, [poId]);
  return true;
}

async function settleLine(lineId, body = {}, { actor = null } = {}) {
  requireUuid(lineId, 'line_id');
  const settledQuantity = requireNonNegativeInt(body.settled_quantity, 'settled_quantity');
  const reason = optionalText(body.reason);
  if (!reason) throw fail(400, 'INVALID_INPUT', 'reason obligatoire');
  const reopenExplicit = body.reopen_remainder;

  const outcome = await withTransaction(async (client) => {
    // Ordre commun : PO d'abord (lue sans verrou, verrouillée), puis la ligne.
    const { rows: [peek] } = await client.query('SELECT id, purchase_order_id FROM purchase_lines WHERE id = $1', [lineId]);
    if (!peek) throw fail(404, 'PURCHASE_LINE_NOT_FOUND', 'Ligne d\'achat introuvable');
    if (!peek.purchase_order_id) throw fail(409, 'PURCHASE_LINE_NOT_SETTLEABLE', 'Une ligne ouverte ne se solde pas : elle s\'annule');
    const po = await lockGroupedPo(client, peek.purchase_order_id, { requireDraft: false });
    if (!SETTLEABLE_PO_STATUSES.includes(po.status)) {
      throw fail(409, 'PURCHASE_LINE_NOT_SETTLEABLE', `PO au statut "${po.status}" : la ligne n'est pas confirmée`, { current_status: po.status });
    }

    const { rows: [line] } = await client.query(`
      SELECT id, purchase_order_id, order_item_id, supplier_id, product_supplier_id, product_sku_id, supplier_sku,
             supplier_unit_ref, supplier_order_identity, quantity, supplier_unit_price, supplier_currency,
             procurement_hub_ref, confirmed_quantity, settled_at, cancelled_at
        FROM purchase_lines WHERE id = $1 FOR UPDATE
    `, [lineId]);
    if (String(line.purchase_order_id || '') !== String(peek.purchase_order_id)) {
      throw fail(409, 'PURCHASE_LINE_CONCURRENT_CHANGE', 'La ligne a changé pendant l\'opération, réessayez');
    }
    if (line.cancelled_at) throw fail(409, 'PURCHASE_LINE_ALREADY_CANCELLED', 'Ligne annulée');
    if (line.settled_at) throw fail(409, 'PURCHASE_LINE_ALREADY_SETTLED', 'Clôture déjà enregistrée');
    // Ligne non confirmée (PO manuelle soumise) : l'effectif est la quantité commandée.
    if (line.confirmed_quantity === null && po.status === 'confirmed') {
      throw fail(409, 'PURCHASE_LINE_NOT_CONFIRMED', 'La ligne n\'est pas confirmée');
    }

    const effective = line.confirmed_quantity === null ? line.quantity : line.confirmed_quantity;
    if (settledQuantity >= effective) {
      throw fail(400, 'INVALID_INPUT', 'settled_quantity doit être strictement inférieure à la quantité effective', { confirmed_quantity: effective });
    }
    const { rows: [progress] } = await client.query(
      'SELECT received_quantity FROM v_purchase_line_progress WHERE line_id = $1', [lineId]
    );
    const received = progress ? Number(progress.received_quantity) : 0;
    if (settledQuantity > received) {
      throw fail(409, 'PURCHASE_LINE_SETTLE_ABOVE_RECEIVED', 'La clôture ne peut pas dépasser ce que le Hub a reçu', {
        received_quantity: received,
      });
    }

    // 1) clôture d'abord (l'effectif baisse), 2) reliquat ensuite (I1).
    await client.query(`
      UPDATE purchase_lines SET settled_quantity = $2, settled_at = NOW(), settle_reason = $3, updated_at = NOW()
       WHERE id = $1
    `, [lineId, settledQuantity, reason]);
    const remaining = effective - settledQuantity;
    let remnantId = null;
    // PO manuelle : le reliquat est conservé automatiquement (ligne enfant), sauf refus explicite.
    const reopenRemainder = reopenExplicit === undefined ? po.trigger_mode !== 'auto' : reopenExplicit === true;
    if (reopenRemainder) remnantId = await insertRemnant(client, line, remaining, actor);
    // H1 : sans reliquat, la clôture Hub vaut constat de rupture fournisseur (incident + alerte de remboursement).
    else {
      await openSupplierShortage(client, {
        purchaseLineId: lineId, orderItemId: line.order_item_id, missingQuantity: remaining,
        receivedQuantity: received, reason, actorId: uuidOrNull(actor && actor.id),
      });
    }
    const closed = await closeGroupedPurchaseOrderIfComplete(client, po.id);
    return { lineId, remnantId, remaining, poId: po.id, closed };
  });

  const [line] = await loadLinesByIds(db, [outcome.lineId]);
  const remnants = outcome.remnantId ? await loadLinesByIds(db, [outcome.remnantId]) : [];
  const { rows: [purchaseOrder] } = await db.query('SELECT id, status, hub_received_at FROM purchase_orders WHERE id = $1', [outcome.poId]);
  return {
    line,
    remnant: remnants[0] || null,
    unsettled_quantity: outcome.remaining,
    purchase_order: purchaseOrder,
    ...summarizeCommitmentByMarket([line], remnants),
  };
}

// ─── Création manuelle d'une ligne ouverte ────────────────────────────────────────────────────────

async function createLineInTransaction(client, { orderItemId, productSupplierId, quantity, actor, context, executionMode, parentLineId = null }) {
  const { rows: [item] } = await client.query(`
    SELECT oi.*, p.name AS product_name, o.status AS order_status
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
     WHERE oi.id = $1
  `, [orderItemId]);
  if (!item) throw fail(404, 'ORDER_ITEM_NOT_FOUND', 'Article de commande introuvable');
  if (item.fulfillment_source === 'LOCAL_STOCK') throw fail(409, 'ORDER_ITEM_LOCAL_STOCK', 'Un article en stock local ne s\'achète pas');
  if (item.order_status === 'cancelled') throw fail(409, 'ORDER_CANCELLED', 'La commande est annulée');

  const { rows: [ps] } = await client.query(`
    SELECT ps.*, s.name AS supplier_name, s.platform, s.auto_order, s.contact_phone
      FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
     WHERE ps.id = $1 AND ps.product_id = $2 AND ps.is_active = TRUE AND s.is_active = TRUE
       AND ps.deleted_at IS NULL AND s.deleted_at IS NULL
  `, [productSupplierId, item.product_id]);
  if (!ps) throw fail(404, 'PRODUCT_SUPPLIER_NOT_FOUND', 'Mapping fournisseur actif introuvable pour ce produit');

  // Seule une unité à identité exacte est regroupable (I4) : même instantané que le déclencheur.
  let exactSku;
  let readiness;
  try {
    exactSku = await loadExactSoldSku(client, item);
    if (!exactSku && executionMode === 'api') throw fail(409, 'EXACT_IDENTITY_REQUIRED', 'Une ligne en exécution API exige un article à SKU exact');
    if (!exactSku) {
      // Mapping fournisseur manuel (modèle unique) : pas d'identité exacte, prix AED du mapping s'il existe.
      readiness = null;
    } else if (executionMode === 'api') {
      // Exécution API : le fournisseur doit être celui du provider de l'identité, prêt selon le moteur canonique.
      if (String(ps.platform || '').toLowerCase() !== exactSku.supplier_order_identity.provider) {
        throw fail(409, 'SUPPLIER_PROVIDER_MISMATCH', 'Une ligne en exécution API doit être achetée chez le provider de l\'identité du SKU vendu');
      }
      readiness = await resolveExactSkuProcurementReadiness(client, exactSku, quantity, context);
    } else {
      // Exécution manuelle : l'identité du SKU reste l'identité produit ; le Hub achète où il veut, au prix réel du mapping.
      // Aucune préparation distante : l'achat réel est enregistré par le Hub.
      readiness = {
        unit_price: Number(ps.supplier_price_aed), currency: 'AED',
        supplier_unit_ref: exactSku.supplier_unit_ref, supplier_order_identity: exactSku.supplier_order_identity,
      };
      if (!exactSku.supplier_unit_ref) throw fail(409, 'EXACT_IDENTITY_REQUIRED', 'supplier_unit_ref absent sur le SKU vendu');
    }
  } catch (error) {
    if (error && error.code === 'BLOCKED_SUPPLIER_IDENTITY') {
      throw fail(409, 'BLOCKED_SUPPLIER_IDENTITY', error.message, { details: error.details || {} });
    }
    throw error;
  }
  let snapshot;
  if (exactSku) {
    snapshot = { ...buildPurchaseTarget(ps, exactSku, readiness), productSkuId: exactSku.id };
  } else {
    const amount = Number(ps.supplier_price_aed);
    snapshot = {
      purchaseTarget: ps, productSkuId: null, supplierUnitRef: null, supplierOrderIdentity: null,
      money: Number.isFinite(amount) && amount > 0 ? { amount, currency: 'AED' } : null,
    };
  }
  // I1 (base) refuse tout sur-engagement de l'article ; mapDbError le remonte en 409.
  const line = await insertOpenPurchaseLine(client, { item, ps, snapshot, quantity, parentLineId });
  if (actor && uuidOrNull(actor.id)) {
    await client.query('UPDATE purchase_lines SET created_by = $2 WHERE id = $1', [line.id, actor.id]);
  }
  return line.id;
}

function parseExecutionMode(value) {
  if (value === undefined || value === null) return 'manual';
  if (value !== 'manual' && value !== 'api') throw fail(400, 'INVALID_INPUT', 'execution_mode doit valoir manual ou api');
  return value;
}

async function createManualLine(body = {}, { actor = null, context = {} } = {}) {
  const orderItemId = requireUuid(body.order_item_id, 'order_item_id');
  const productSupplierId = requireUuid(body.product_supplier_id, 'product_supplier_id');
  const quantity = requirePositiveInt(body.quantity, 'quantity');
  const executionMode = parseExecutionMode(body.execution_mode);

  const lineId = await withTransaction((client) => createLineInTransaction(client, {
    orderItemId, productSupplierId, quantity, actor, context, executionMode,
  }));
  const [line] = await loadLinesByIds(db, [lineId]);
  return { line, ...summarizeMarkets([line]) };
}

/**
 * Changement de fournisseur d'une ligne NON engagée (ouverte ou en brouillon) : la ligne d'origine est annulée
 * (elle reste dans l'historique), la nouvelle naît avec `parent_line_id` = l'ancienne (filiation). Aucun double
 * comptage : I1 ne compte pas la ligne annulée. Une ligne engagée (PO soumise) se change via son reliquat.
 */
async function changeLineSupplier(lineId, body = {}, { actor = null, context = {} } = {}) {
  requireUuid(lineId, 'line_id');
  const productSupplierId = requireUuid(body.product_supplier_id, 'product_supplier_id');
  const reason = optionalText(body.reason);
  if (!reason) throw fail(400, 'INVALID_INPUT', 'reason obligatoire');
  const executionMode = parseExecutionMode(body.execution_mode);

  const newLineId = await withTransaction(async (client) => {
    const { rows: [peek] } = await client.query('SELECT id, purchase_order_id FROM purchase_lines WHERE id = $1', [lineId]);
    if (!peek) throw fail(404, 'PURCHASE_LINE_NOT_FOUND', 'Ligne d\'achat introuvable');
    if (peek.purchase_order_id) await lockGroupedPo(client, peek.purchase_order_id, { requireDraft: true });
    const { rows: [line] } = await client.query(
      'SELECT id, order_item_id, quantity, supplier_id, purchase_order_id, cancelled_at, confirmed_quantity FROM purchase_lines WHERE id = $1 FOR UPDATE', [lineId]
    );
    if (line.cancelled_at) throw fail(409, 'PURCHASE_LINE_ALREADY_CANCELLED', 'Ligne déjà annulée');
    if (line.confirmed_quantity !== null) throw fail(409, 'PURCHASE_LINE_NOT_CANCELLABLE', 'Ligne déjà confirmée : changer le fournisseur de son reliquat');
    await client.query(
      'UPDATE purchase_lines SET purchase_order_id = NULL, updated_at = NOW() WHERE id = $1 AND purchase_order_id IS NOT NULL', [lineId]
    );
    await client.query(
      'UPDATE purchase_lines SET cancelled_at = NOW(), cancel_reason = $2, updated_at = NOW() WHERE id = $1',
      [lineId, `Changement de fournisseur : ${reason}`]
    );
    return createLineInTransaction(client, {
      orderItemId: line.order_item_id, productSupplierId, quantity: Number(line.quantity), actor, context, executionMode, parentLineId: line.id,
    });
  });
  const [line] = await loadLinesByIds(db, [newLineId]);
  return { line, replaced_line_id: lineId, ...summarizeMarkets([line]) };
}

// ─── Preuve d'envoi : « bon émis » (submit) ≠ « envoyé au fournisseur » ─────────────────────────
// Un lien WhatsApp généré n'est pas une transmission. L'opérateur (ou un adaptateur API) déclare
// l'envoi réellement effectué : canal, auteur, heure ; immuable ensuite (trigger migration 358).
const SENT_CHANNELS = new Set(['email', 'whatsapp', 'phone', 'api', 'other']);

async function recordPurchaseOrderSent(poId, body = {}, { actor = null } = {}) {
  requireUuid(poId, 'po_id');
  const channel = String((body && body.channel) || '').trim().toLowerCase();
  if (!SENT_CHANNELS.has(channel)) {
    throw fail(400, 'INVALID_INPUT', `channel doit valoir ${[...SENT_CHANNELS].join(', ')}`);
  }
  const supplierOrderId = optionalText(body && body.supplier_order_id);
  const note = optionalText(body && body.note);

  return withTransaction(async (client) => {
    const po = await lockGroupedPo(client, poId, { requireDraft: false });
    if (po.status !== 'notified') {
      throw fail(409, 'PURCHASE_ORDER_NOT_SUBMITTED', `PO au statut "${po.status}" : seule une PO soumise (notified) peut être déclarée envoyée`, {
        current_status: po.status,
      });
    }
    const { rows: [header] } = await client.query(
      'SELECT sent_at, sent_channel, supplier_order_id FROM purchase_orders WHERE id = $1', [po.id]
    );
    if (header.sent_at) {
      if (header.sent_channel === channel) return { purchase_order_id: po.id, already_sent: true, sent_at: header.sent_at, sent_channel: header.sent_channel };
      throw fail(409, 'PURCHASE_ORDER_ALREADY_SENT', `Envoi déjà enregistré par ${header.sent_channel}`, { current_status: po.status });
    }
    const { rows: [updated] } = await client.query(
      `UPDATE purchase_orders
          SET sent_at = NOW(), sent_channel = $2, sent_by = $3, sent_note = $4,
              supplier_order_id = COALESCE(supplier_order_id, $5), updated_at = NOW()
        WHERE id = $1
        RETURNING id, status, sent_at, sent_channel, sent_by, sent_note, supplier_order_id`,
      [po.id, channel, actor && actor.id ? actor.id : null, note, supplierOrderId]
    );
    return { purchase_order_id: updated.id, already_sent: false, status: updated.status, sent_at: updated.sent_at,
      sent_channel: updated.sent_channel, sent_by: updated.sent_by, supplier_order_id: updated.supplier_order_id };
  });
}

module.exports = {
  summarizeCommitmentByMarket,
  recordPurchaseOrderSent,
  submitPurchaseOrder,
  confirmGroupedPurchaseOrder,
  getPurchaseReconciliation,
  settleLine,
  createManualLine,
  changeLineSupplier,
};
