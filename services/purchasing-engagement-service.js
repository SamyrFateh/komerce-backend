/**
 * @komerce-arch
 * @role          purchasing-engagement-service
 * @domain        purchasing
 * @layer         service
 * @criticality   critical
 * @inputs        purchase_order_id, purchase_line_id, supplier_confirmation, runtime_context
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/purchasing-grouped-service.js, services/purchase-line-snapshot.js, services/notification-service.js, services/hub-reference.js, services/suppliers/provider-authority.js, services/suppliers/canonical-unit-purchasing-gate.js, services/suppliers/purchase-order-confirmation-boundary.js, services/suppliers/execution-adapter-registry.js, services/suppliers/supplier-fulfillment-adapter-contract.js, utils/logger.js
 * @used-by       routes/purchasing.js
 * @db-read       order_items, orders, product_suppliers, products, purchase_lines, purchase_orders, suppliers, v_purchase_line_progress
 * @db-write      purchase_lines, purchase_orders
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
const log = require('../utils/logger').child({ module: 'purchasing-engagement' });

const {
  fail, requireEnabled, requireUuid, withTransaction, lockGroupedPo,
  loadPurchaseOrderLines, summarizeMarkets, shapeLine, LINE_COLUMNS, LINE_JOINS,
} = shared;

// Statuts de PO regroupée où une ligne peut être soldée (seul `confirmed` : `hub_received` est terminal).
const SETTLEABLE_PO_STATUSES = ['confirmed'];

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
    const key = line.supplier_unit_ref;
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
    return `- ${g.product_name || g.supplier_sku} (x${g.quantity}) — Ref : ${g.supplier_sku}${total}`;
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
  requireEnabled();
  requireUuid(poId, 'po_id');

  const outcome = await withTransaction(async (client) => {
    const po = await lockGroupedPo(client, poId);
    const { rows: lineRows } = await client.query(`
      SELECT pl.id, pl.product_sku_id, pl.supplier_sku, pl.supplier_unit_ref, pl.supplier_order_identity,
             pl.quantity, pl.supplier_unit_price, pl.supplier_currency, p.name AS product_name
        FROM purchase_lines pl
        JOIN order_items oi ON oi.id = pl.order_item_id
        LEFT JOIN products p ON p.id = oi.product_id
       WHERE pl.purchase_order_id = $1 AND pl.cancelled_at IS NULL
       ORDER BY pl.id FOR UPDATE OF pl
    `, [po.id]);
    if (!lineRows.length) throw fail(409, 'PURCHASE_ORDER_EMPTY', 'Une PO sans ligne ne peut pas être soumise');

    const groups = groupBySupplierUnitRef(lineRows.map((r) => ({ ...r })));
    const { verdicts, readyByProvider } = await prepareGroups(client, groups, context);
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

    await client.query(
      `UPDATE purchase_orders SET status = 'notified', ordered_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [po.id]
    );
    // Invariant 14 de la carte : le lien WhatsApp s'écrit APRÈS la persistance de la PO.
    let waUrl = null;
    if (header.trigger_mode === 'whatsapp' && supplier.contact_phone) {
      waUrl = `https://wa.me/${supplier.contact_phone}?text=${encodeURIComponent(messages.supplier)}`;
      await client.query('UPDATE purchase_orders SET notes = $1, updated_at = NOW() WHERE id = $2', [`wa_url:${waUrl}`, po.id]);
    }
    return { po_id: po.id, verdicts, groups, adminMessage: messages.admin, waUrl, tag, actor };
  });

  // Notification admin après COMMIT : jamais pour une soumission annulée.
  const channel = outcome.waUrl ? 'whatsapp' : 'admin_manual';
  if (!outcome.waUrl && process.env.ADMIN_PHONE) {
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

async function confirmGroupedPurchaseOrder(poId, body = {}, { actor = null, context = {} } = {}) {
  requireEnabled();
  requireUuid(poId, 'po_id');
  const confirmations = parseConfirmationLines(body);
  const supplierOrderId = optionalText(body.supplier_order_id);
  const trackingUrl = optionalText(body.tracking_url);
  const trackingNumber = optionalText(body.tracking_number);
  const notes = optionalText(body.notes);

  const outcome = await withTransaction(async (client) => {
    const po = await lockGroupedPo(client, poId, { requireDraft: false });
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

    const allZero = confirmations.every((c) => c.confirmedQuantity === 0);
    const verifiedRef = allZero ? supplierOrderId : await verifyConfirmationEvidence(lines, confirmations, supplierOrderId, context);

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
      `, [po.id, verifiedRef, trackingUrl, trackingNumber, notes]);
    }
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
     WHERE id = $1 AND status = 'confirmed'
  `, [poId]);
  return true;
}

async function settleLine(lineId, body = {}, { actor = null } = {}) {
  requireEnabled();
  requireUuid(lineId, 'line_id');
  const settledQuantity = requireNonNegativeInt(body.settled_quantity, 'settled_quantity');
  const reason = optionalText(body.reason);
  if (!reason) throw fail(400, 'INVALID_INPUT', 'reason obligatoire');
  const reopenRemainder = body.reopen_remainder === true;

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
    if (line.confirmed_quantity === null) throw fail(409, 'PURCHASE_LINE_NOT_CONFIRMED', 'La ligne n\'est pas confirmée');

    const effective = line.confirmed_quantity;
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
    if (reopenRemainder) remnantId = await insertRemnant(client, line, remaining, actor);
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

async function createManualLine(body = {}, { actor = null, context = {} } = {}) {
  requireEnabled();
  const orderItemId = requireUuid(body.order_item_id, 'order_item_id');
  const productSupplierId = requireUuid(body.product_supplier_id, 'product_supplier_id');
  const quantity = requirePositiveInt(body.quantity, 'quantity');

  const lineId = await withTransaction(async (client) => {
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
      if (!exactSku) throw fail(409, 'EXACT_IDENTITY_REQUIRED', 'Seul un article à SKU exact peut devenir une ligne d\'achat regroupable');
      if (String(ps.platform || '').toLowerCase() !== exactSku.supplier_order_identity.provider) {
        throw fail(409, 'SUPPLIER_PROVIDER_MISMATCH', 'Le fournisseur choisi ne correspond pas au provider de l\'identité du SKU vendu');
      }
      readiness = await resolveExactSkuProcurementReadiness(client, exactSku, quantity, context);
    } catch (error) {
      if (error && error.code === 'BLOCKED_SUPPLIER_IDENTITY') {
        throw fail(409, 'BLOCKED_SUPPLIER_IDENTITY', error.message, { details: error.details || {} });
      }
      throw error;
    }
    const snapshot = { ...buildPurchaseTarget(ps, exactSku, readiness), productSkuId: exactSku.id };
    // I1 (base) refuse tout sur-engagement de l'article ; mapDbError le remonte en 409.
    const line = await insertOpenPurchaseLine(client, { item, ps, snapshot, quantity });
    if (actor && uuidOrNull(actor.id)) {
      await client.query('UPDATE purchase_lines SET created_by = $2 WHERE id = $1', [line.id, actor.id]);
    }
    return line.id;
  });

  const [line] = await loadLinesByIds(db, [lineId]);
  return { line, ...summarizeMarkets([line]) };
}

module.exports = {
  summarizeCommitmentByMarket,
  submitPurchaseOrder,
  confirmGroupedPurchaseOrder,
  settleLine,
  createManualLine,
};
