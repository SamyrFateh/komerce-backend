/**
 * @komerce-arch
 * @role          golden-upstream-evidence-projection
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   medium
 * @inputs        catalog_product_id, market_code, storefront_base_url
 * @outputs       read_only_upstream_gate_evidence, cockpit_readiness_stage
 * @depends       services/sourcing-certification, services/sourcing-canonical-unit-product-sku-resolution
 * @used-by       routes/admin-order-360
 * @db-read       orders, order_items, purchase_lines, purchase_orders, sourcing_candidates, import_runtime_runs, sourcing_sources, sourcing_captures, sourcing_observations, catalog_enrichment_runs, catalog_media, products, product_skus, product_market_exposure, product_market_price_drafts, markets
 * @db-write      none
 * @db-txn        none
 * @doctrine      projection_only_no_business_authority, absent_or_ambiguous_proof_is_not_proved
 * @impact-areas  dashboard, e2e-certification, sourcing, catalog
 * @version       2026-10
 */

'use strict';

/**
 * Projection en lecture seule des quatre portes amont de la Golden : Sourcing → Raffinerie → Catalogue → Boutique.
 * Aucune autorité métier : chaque constat vient d'un propriétaire canonique (verdict de certification Sourcing,
 * résolveur canonique Unit↔SKU, exposition Market, prix local actif, API publique de la boutique).
 * Règle fail-closed : une preuve absente, ambiguë ou illisible est NON_PROUVE, jamais PROVED.
 */
const crypto = require('crypto');
const { evaluateSourcingCandidateOutcome } = require('./sourcing-certification');
const unitResolver = require('./sourcing-canonical-unit-product-sku-resolution');

const GATE = Object.freeze({
  PROVED: 'PROVED',
  NON_PROUVE: 'NON_PROUVE',
  ANOMALIE: 'ANOMALIE',
});

const STAGE = Object.freeze({
  NON_DEMARRE: 'NON DÉMARRÉ',
  EN_PREPARATION: 'EN PRÉPARATION',
  PREUVE_MANQUANTE: 'PREUVE MANQUANTE',
  ANOMALIE: 'ANOMALIE',
  PRET: 'PRÊT POUR RECETTE',
});

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rowsOf = (result) => (result && Array.isArray(result.rows) ? result.rows : []);

function check(key, ok, detail) {
  return { key, ok: Boolean(ok), detail: detail || null };
}

function settle({ key, label, link, expected, checks, anomalies = [], evidence = {}, nextAction, humanChecks = [] }) {
  const failed = checks.filter((c) => !c.ok);
  let status = GATE.PROVED;
  if (anomalies.length) status = GATE.ANOMALIE;
  else if (failed.length) status = GATE.NON_PROUVE;
  return {
    key,
    label,
    link,
    expected,
    status,
    checks,
    anomalies,
    evidence,
    human_checks: humanChecks,
    finding: status === GATE.PROVED
      ? 'Tous les faits canoniques attendus sont présents.'
      : (anomalies[0] || `Preuve manquante : ${failed.map((c) => c.key).join(', ')}`),
    next_action: status === GATE.PROVED ? 'Contrôle humain à l’écran réel (distinct de la preuve automatique).' : nextAction,
  };
}

function unproved(key, label, link, expected, reason, nextAction) {
  return settle({
    key, label, link, expected, nextAction,
    checks: [check(reason, false, 'preuve non lisible ou absente')],
  });
}

async function safeQuery(db, sql, params) {
  try {
    return { rows: rowsOf(await db.query(sql, params)), error: null };
  } catch (err) {
    return { rows: [], error: err.code || err.message || 'read_error' };
  }
}

async function loadSourceGate(db, productId) {
  const meta = {
    key: 'SOURCE_PROVED',
    label: 'Sourcing',
    link: '/admin/workspaces/sourcing',
    expected: 'Source, offre, identité fournisseur, capture/observation et décision de sourcing attestées',
  };
  const { rows, error } = await safeQuery(db, `
    SELECT sc.*, r.run_ref, r.source_ref AS run_source_ref
      FROM sourcing_candidates sc
      LEFT JOIN LATERAL (
        SELECT run_ref, source_ref FROM import_runtime_runs
         WHERE import_id = sc.import_id ORDER BY started_at DESC LIMIT 1
      ) r ON TRUE
     WHERE sc.product_id = $1
     ORDER BY sc.updated_at DESC
     LIMIT 3`, [productId]);
  if (error) return unproved(meta.key, meta.label, meta.link, meta.expected, `read_error:${error}`, 'Vérifier la disponibilité de la base puis relire.');
  if (!rows.length) return unproved(meta.key, meta.label, meta.link, meta.expected, 'sourcing_candidate_missing', 'Lancer un vrai sourcing dans l’écran Sourcing ; aucun produit seed n’est accepté.');
  if (rows.length > 1) return unproved(meta.key, meta.label, meta.link, meta.expected, 'sourcing_candidate_ambiguous', 'Plusieurs candidats pointent ce produit : lever l’ambiguïté dans Sourcing.');

  const sc = rows[0];
  const verdict = evaluateSourcingCandidateOutcome({ ...sc, raw_payload: sc.raw_payload });
  const anomalies = [];
  if (['rejected', 'quarantined', 'archived'].includes(sc.state)) {
    anomalies.push(`Le candidat source est ${sc.state} alors qu’un produit catalogue y est rattaché.`);
  }
  const checks = [
    check('candidate_found', true, sc.candidate_ref),
    check('supplier_identity', Boolean(sc.supplier_name && sc.supplier_product_id), `${sc.supplier_name || '?'} / ${sc.supplier_product_id || '?'}`),
    check('sourcing_certified', verdict.sourcing_certified, verdict.reasons.join(', ') || verdict.outcome),
    check('import_run', Boolean(sc.run_ref), sc.run_ref || 'aucun run KIR rattaché'),
  ];

  let sourceKnown = false;
  let observation = null;
  if (sc.run_source_ref) {
    const src = await safeQuery(db, `SELECT source_id FROM sourcing_sources WHERE source_id = $1 AND status = 'active' LIMIT 1`, [sc.run_source_ref]);
    sourceKnown = src.rows.length === 1;
    const obs = await safeQuery(db, `
      SELECT c.capture_id, o.observation_id, o.observed_at
        FROM sourcing_observations o
        JOIN sourcing_captures c ON c.capture_id = o.capture_id
       WHERE c.source_id = $1 AND o.source_ref = $2
       ORDER BY o.observed_at DESC LIMIT 1`, [sc.run_source_ref, sc.supplier_product_id]);
    observation = obs.rows[0] || null;
  }
  checks.push(check('source_active', sourceKnown, sc.run_source_ref || 'source du run inconnue'));
  checks.push(check('capture_observation', Boolean(observation), observation ? `${observation.capture_id} / ${observation.observation_id}` : 'aucune capture/observation attestée'));

  return settle({
    ...meta,
    checks,
    anomalies,
    evidence: {
      candidate_id: sc.id,
      candidate_ref: sc.candidate_ref,
      supplier_name: sc.supplier_name,
      supplier_product_id: sc.supplier_product_id,
      run_ref: sc.run_ref || null,
      source_id: sc.run_source_ref || null,
      capture_id: observation ? observation.capture_id : null,
      observation_id: observation ? observation.observation_id : null,
      observed_at: observation ? observation.observed_at : (sc.observed_at || null),
    },
    nextAction: 'Ouvrir Sourcing : rattacher le candidat à un run, une source active et une capture réelle.',
    humanChecks: ['Source et offre reconnues à l’écran Sourcing', 'Décision de sourcing lisible et cohérente'],
  });
}

async function loadRefineryGate(db, productId) {
  const meta = {
    key: 'REFINERY_PROVED',
    label: 'Raffinerie',
    link: '/admin/workspaces/catalog',
    expected: 'Exécution et résultat des contrôles, contenu FR, médias, variantes, rejets ou approbations',
  };
  const cand = await safeQuery(db, `
    SELECT scan_at, komerce_category, state, scan_result, promotion_status
      FROM sourcing_candidates WHERE product_id = $1 ORDER BY updated_at DESC LIMIT 2`, [productId]);
  if (cand.error) return unproved(meta.key, meta.label, meta.link, meta.expected, `read_error:${cand.error}`, 'Vérifier la disponibilité de la base puis relire.');
  if (cand.rows.length !== 1) {
    return unproved(meta.key, meta.label, meta.link, meta.expected,
      cand.rows.length ? 'refinery_candidate_ambiguous' : 'refinery_candidate_missing',
      'Faire passer le produit sourcé par la Raffinerie (écran Catalogue / import runtime).');
  }
  const sc = cand.rows[0];
  const [enrich, media, skus] = await Promise.all([
    safeQuery(db, `SELECT status, created_at FROM catalog_enrichment_runs WHERE product_id = $1 ORDER BY created_at DESC LIMIT 1`, [productId]),
    safeQuery(db, `SELECT COUNT(*)::int AS n FROM catalog_media WHERE product_id = $1 AND is_active = TRUE`, [productId]),
    safeQuery(db, `SELECT COUNT(*)::int AS n FROM product_skus WHERE product_id = $1 AND is_active = TRUE`, [productId]),
  ]);
  const readError = enrich.error || media.error || skus.error;
  if (readError) return unproved(meta.key, meta.label, meta.link, meta.expected, `read_error:${readError}`, 'Vérifier la disponibilité de la base puis relire.');

  const anomalies = [];
  if (['rejected', 'quarantined'].includes(sc.state) || String(sc.promotion_status || '').startsWith('QUARANTINED_')) {
    anomalies.push('La Raffinerie a rejeté ou mis en quarantaine ce produit.');
  }
  const run = enrich.rows[0] || null;
  const checks = [
    check('refinery_executed', Boolean(sc.scan_at), sc.scan_at ? String(sc.scan_at) : 'aucune exécution de contrôle'),
    check('taxonomy', Boolean(sc.komerce_category), sc.komerce_category || 'catégorie absente'),
    check('content_fr_enrichment_ok', Boolean(run && run.status === 'ok'), run ? `statut ${run.status}` : 'aucun run d’enrichissement'),
    check('media_present', media.rows[0].n > 0, `${media.rows[0].n} média(s) actif(s)`),
    check('variants_present', skus.rows[0].n > 0, `${skus.rows[0].n} SKU actif(s)`),
  ];
  return settle({
    ...meta,
    checks,
    anomalies,
    evidence: { enrichment_status: run ? run.status : null, media_count: media.rows[0].n, active_sku_count: skus.rows[0].n, komerce_category: sc.komerce_category || null },
    nextAction: 'Ouvrir Catalogue / Raffinerie : exécuter les contrôles, valider le contenu FR, les médias et les variantes.',
    humanChecks: ['Contenu FR relu', 'Médias et variantes conformes', 'Rejets ou approbations journalisés visibles'],
  });
}

async function loadCatalogGate(db, productId, marketCode) {
  const meta = {
    key: 'CATALOG_RELEASE_PROVED',
    label: 'Catalogue',
    link: '/admin/workspaces/catalog',
    expected: 'Passage KIR, produit/SKU/SOI exacts, prix local et exposition Market autorisée',
  };
  const [prod, cand, skuRows] = await Promise.all([
    safeQuery(db, `SELECT id, lifecycle_status, is_active FROM products WHERE id = $1`, [productId]),
    safeQuery(db, `SELECT state, run.run_ref FROM sourcing_candidates sc LEFT JOIN LATERAL (SELECT run_ref FROM import_runtime_runs WHERE import_id = sc.import_id ORDER BY started_at DESC LIMIT 1) run ON TRUE WHERE sc.product_id = $1 ORDER BY sc.updated_at DESC LIMIT 1`, [productId]),
    safeQuery(db, `SELECT id, supplier_unit_ref FROM product_skus WHERE product_id = $1 AND is_active = TRUE ORDER BY created_at, id`, [productId]),
  ]);
  const readError = prod.error || cand.error || skuRows.error;
  if (readError) return unproved(meta.key, meta.label, meta.link, meta.expected, `read_error:${readError}`, 'Vérifier la disponibilité de la base puis relire.');
  if (!prod.rows.length) return unproved(meta.key, meta.label, meta.link, meta.expected, 'product_missing', 'Le produit n’existe pas au catalogue : le faire entrer par la remise Sourcing → Catalogue.');

  const product = prod.rows[0];
  const anomalies = [];
  const checks = [
    check('kir_handoff', Boolean(cand.rows[0] && cand.rows[0].state === 'imported_to_catalog'), cand.rows[0] ? `${cand.rows[0].run_ref || 'sans run'} · ${cand.rows[0].state}` : 'aucun candidat'),
    check('product_published', product.lifecycle_status === 'active' && product.is_active === true, `${product.lifecycle_status}${product.is_active ? '' : ' · inactif'}`),
  ];

  // Identité exacte SKU ↔ Unit/SOI : tout écart est une anomalie, jamais un vert.
  const resolutions = [];
  for (const sku of skuRows.rows) {
    try {
      const r = await unitResolver.resolveCanonicalUnitForProductSku(sku.id, db.query.bind(db));
      resolutions.push({ product_sku_id: sku.id, status: r.status, supplier_unit_ref: r.supplier_unit_ref || sku.supplier_unit_ref || null, reason: r.reason || null });
    } catch (err) {
      resolutions.push({ product_sku_id: sku.id, status: 'READ_ERROR', supplier_unit_ref: null, reason: err.code || 'read_error' });
    }
  }
  const diverging = resolutions.filter((r) => r.status !== unitResolver.STATUS.RESOLVED && r.status !== 'READ_ERROR');
  const unreadable = resolutions.filter((r) => r.status === 'READ_ERROR');
  if (diverging.length) {
    anomalies.push(`SKU/SOI divergent : ${diverging.map((r) => `${r.product_sku_id}=${r.status}`).join(', ')}`);
  }
  checks.push(check('sku_present', resolutions.length > 0, `${resolutions.length} SKU actif(s)`));
  checks.push(check('sku_soi_resolved', resolutions.length > 0 && !diverging.length && !unreadable.length, resolutions.map((r) => `${r.product_sku_id}:${r.status}`).join(' ') || 'aucun SKU'));

  let exposure = null;
  let price = null;
  if (marketCode) {
    const exp = await safeQuery(db, `
      SELECT e.commercial_exposure FROM product_market_exposure e JOIN markets m ON m.id = e.market_id
       WHERE e.product_id = $1 AND m.code = $2 LIMIT 1`, [productId, marketCode]);
    const prc = await safeQuery(db, `
      SELECT d.status, d.amount, d.currency, m.currency AS market_currency
        FROM product_market_price_drafts d JOIN markets m ON m.id = d.market_id
       WHERE d.product_id = $1 AND m.code = $2 LIMIT 1`, [productId, marketCode]);
    if (exp.error || prc.error) {
      return unproved(meta.key, meta.label, meta.link, meta.expected, `read_error:${exp.error || prc.error}`, 'Vérifier la disponibilité de la base puis relire.');
    }
    exposure = exp.rows[0] || null;
    price = prc.rows[0] || null;
  }
  checks.push(check('market_selected', Boolean(marketCode), marketCode || 'Market non choisi'));
  checks.push(check('market_exposure_enabled', Boolean(exposure && exposure.commercial_exposure === 'ENABLED'), exposure ? exposure.commercial_exposure : 'aucune exposition'));
  checks.push(check('local_price_active', Boolean(price && price.status === 'LOCAL_ACTIVE'), price ? `${price.status} ${price.amount} ${price.currency}` : 'aucun prix local'));
  if (price && price.status === 'LOCAL_ACTIVE' && price.currency !== price.market_currency) {
    anomalies.push(`Prix local en ${price.currency} alors que le Market vend en ${price.market_currency}.`);
  }

  return settle({
    ...meta,
    checks,
    anomalies,
    evidence: {
      product_id: productId,
      lifecycle_status: product.lifecycle_status,
      run_ref: cand.rows[0] ? cand.rows[0].run_ref || null : null,
      skus: resolutions,
      market_code: marketCode || null,
      exposure: exposure ? exposure.commercial_exposure : null,
      local_price: price ? { status: price.status, amount: price.amount, currency: price.currency } : null,
    },
    nextAction: 'Ouvrir Catalogue / Pricing / Commerce : publier le produit, autoriser l’exposition Market et activer le prix local.',
    humanChecks: ['Fiche Produit 360 cohérente (SKU, SOI, prix)', 'Exposition Market lue à l’écran Commerce'],
  });
}

async function loadStorefrontGate({ productId, marketCode, baseUrl, fetchImpl, catalogGate }) {
  const meta = {
    key: 'STOREFRONT_PROVED',
    label: 'Boutique',
    link: baseUrl ? `${baseUrl.replace(/\/+$/, '')}/boutique/` : null,
    expected: 'Produit réellement visible et vendable dans la boutique staging, avec variante et prix cohérents',
  };
  if (!baseUrl) return unproved(meta.key, meta.label, meta.link, meta.expected, 'storefront_url_unconfigured', 'Configurer STOREFRONT_BASE_URL (ou PUBLIC_BASE_URL) : aucune URL n’est inventée.');
  if (!marketCode) return unproved(meta.key, meta.label, meta.link, meta.expected, 'market_missing', 'Choisir le Market à observer.');
  const url = `${baseUrl.replace(/\/+$/, '')}/api/products/${encodeURIComponent(productId)}?market=${encodeURIComponent(marketCode)}`;
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    return unproved(meta.key, meta.label, meta.link, meta.expected, 'storefront_unreachable', 'Boutique injoignable : relire plus tard, ne rien conclure.');
  }
  const releasedInCatalog = catalogGate && catalogGate.status === GATE.PROVED;
  if (response.status === 404) {
    const checks = [check('storefront_visible', false, 'HTTP 404')];
    // 404 alors que le catalogue affirme la remise : divergence ; sinon simple absence de preuve.
    return settle({
      ...meta, checks,
      anomalies: releasedInCatalog ? ['Le catalogue déclare le produit remis et vendable, la boutique répond 404.'] : [],
      evidence: { http_status: 404, url },
      nextAction: 'Comparer exposition Market, prix local et visibilité publique du produit.',
    });
  }
  if (!response.ok) return unproved(meta.key, meta.label, meta.link, meta.expected, `storefront_http_${response.status}`, 'Boutique indisponible : relire plus tard, ne rien conclure.');
  let body = null;
  try { body = await response.json(); } catch (_) { body = null; }
  if (!body || String(body.id) !== String(productId)) {
    return unproved(meta.key, meta.label, meta.link, meta.expected, 'storefront_payload_unreadable', 'Réponse boutique illisible ou d’un autre produit.');
  }
  const price = Number(body.price_kmf);
  const checks = [
    check('storefront_visible', true, 'HTTP 200'),
    check('sellable', body.purchasable !== false, body.purchasable === false ? 'purchasable=false' : 'vendable'),
    check('price_present', Number.isFinite(price) && price > 0, Number.isFinite(price) ? `${price} KMF` : 'prix absent'),
  ];
  return settle({
    ...meta, checks,
    evidence: { http_status: 200, url, price_kmf: Number.isFinite(price) ? price : null, has_variants: Boolean(body.has_variants) },
    nextAction: 'Ouvrir la boutique : le produit doit y être visible et vendable avec le bon prix.',
    humanChecks: ['Fiche produit, variante, stock et prix lus dans la vraie boutique (desktop et mobile)'],
  });
}

/**
 * Étape du cockpit, déduite UNIQUEMENT des preuves automatiques (jamais des clics humains).
 * Chaîne attendue : Sourcing → Raffinerie → Catalogue → Boutique.
 */
/**
 * Dossier de preuve exportable (HUB P0b) : séparation explicite des niveaux, provenance des données et
 * empreinte SHA-256 de la partie probante (sans horodatage), pour qu'un export identique soit vérifiable.
 * Le verdict humain n'est jamais porté par le serveur : il reste un constat distinct, jamais une preuve backend.
 */
function buildDossierMeta({ ids, gates, stage }) {
  const ref = ids.order_reference || '';
  const provenance = /^K-GOLDEN-/i.test(ref)
    ? 'SYNTHETIC_GOLDEN_CREATE'
    : (ref ? 'ORDER_ORIGIN_NOT_PROVED' : 'NO_ORDER');
  const probative = {
    ids,
    stage,
    gates: gates.map((g) => ({ key: g.key, status: g.status, checks: g.checks.map((c) => [c.key, c.ok]), anomalies: g.anomalies })),
  };
  return {
    version: 1,
    provenance,
    // Une projection de faits persistés ne prouve jamais, seule, qu'un navigateur a traversé un vrai checkout.
    complete: stage === STAGE.PRET && provenance === 'REAL_CHECKOUT_PROVED',
    incomplete_reasons: [
      ...(stage === STAGE.PRET ? [] : [`Étape ${stage}`]),
      ...(provenance === 'SYNTHETIC_GOLDEN_CREATE' ? ['Commande synthétique (golden-create) : ne certifie pas un vrai checkout'] : []),
      ...(provenance === 'ORDER_ORIGIN_NOT_PROVED' ? ['Origine du checkout non prouvée par cette projection'] : []),
      'Verdict humain et niveau de preuve L0–L6 non portés par le serveur',
    ],
    proof_levels: { backend_projection: 'faits persistés de la cible interrogée (L4 local / L5 staging selon la cible)', human_verdict: 'constat distinct, jamais une preuve backend' },
    sha256: crypto.createHash('sha256').update(JSON.stringify(probative)).digest('hex'),
  };
}

/**
 * CUSTOMER_ORDER_PROVED — filiation order_items → purchase_lines → PO, identité exacte.
 * Aucune substitution tolérée : le product_sku_id acheté doit être celui vendu, et le supplier_unit_ref
 * (et l'identité SOI) de la ligne d'achat doit être celui du SKU sourcé. Quantités exactes.
 */
async function loadCustomerOrderGate(db, { productId, orderReference }) {
  const meta = {
    key: 'CUSTOMER_ORDER_PROVED',
    label: 'Commande client → achat fournisseur',
    link: '/admin/workspaces/purchasing',
    expected: 'Chaque ligne vendue du produit sourcé est couverte par des lignes d’achat portant le même SKU et la même unité fournisseur',
  };
  const nextAction = 'Rattacher la commande au PO fournisseur exact (SKU/SOI) via le propriétaire Purchasing, sans substitution.';
  if (!orderReference) return unproved(meta.key, meta.label, meta.link, meta.expected, 'order_reference_missing', 'Renseigner la référence de la commande issue du vrai checkout.');
  const order = await safeQuery(db, 'SELECT id, reference, status, payment_status FROM orders WHERE reference = $1', [String(orderReference)]);
  if (order.error) return unproved(meta.key, meta.label, meta.link, meta.expected, 'order_unreadable', nextAction);
  if (!order.rows.length) return unproved(meta.key, meta.label, meta.link, meta.expected, 'order_not_found', nextAction);
  const orderId = order.rows[0].id;

  const items = await safeQuery(db, `
    SELECT oi.id AS order_item_id, oi.quantity, oi.sku_id, oi.product_id,
           ps.product_id AS sku_product_id, ps.supplier_unit_ref AS sku_unit_ref,
           ps.supplier_order_identity->'payload'->>'supplier_unit_ref' AS sku_soi_unit_ref
      FROM order_items oi
      LEFT JOIN product_skus ps ON ps.id = oi.sku_id
     WHERE oi.order_id = $1 AND oi.product_id = $2`, [orderId, productId]);
  const lines = await safeQuery(db, `
    SELECT pl.order_item_id, pl.product_sku_id, pl.supplier_unit_ref, pl.quantity, pl.purchase_order_id,
           pl.supplier_order_identity->'payload'->>'supplier_unit_ref' AS soi_unit_ref,
           po.status AS po_status
      FROM purchase_lines pl
      LEFT JOIN purchase_orders po ON po.id = pl.purchase_order_id
     WHERE pl.cancelled_at IS NULL
       AND pl.order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [orderId]);
  if (items.error || lines.error) return unproved(meta.key, meta.label, meta.link, meta.expected, 'purchase_chain_unreadable', nextAction);

  const checks = [check('order_has_item_of_product', items.rows.length > 0, 'La commande contient une ligne du produit sourcé')];
  const anomalies = [];
  const perItem = [];
  for (const item of items.rows) {
    const mine = lines.rows.filter((l) => l.order_item_id === item.order_item_id);
    const covered = mine.reduce((sum, l) => sum + Number(l.quantity || 0), 0);
    const substituted = mine.filter((l) => l.product_sku_id !== item.sku_id);
    const unitMismatch = item.sku_unit_ref
      ? mine.filter((l) => l.supplier_unit_ref !== item.sku_unit_ref || (l.soi_unit_ref && l.soi_unit_ref !== item.sku_unit_ref))
      : [];
    if (substituted.length) anomalies.push(`SKU_SUBSTITUTION:${item.order_item_id}`);
    if (unitMismatch.length) anomalies.push(`SUPPLIER_UNIT_MISMATCH:${item.order_item_id}`);
    if (covered > Number(item.quantity)) anomalies.push(`PURCHASE_OVER_QUANTITY:${item.order_item_id}`);
    checks.push(check(`sku_belongs_to_product:${item.order_item_id}`, item.sku_id && item.sku_product_id === item.product_id, 'Le SKU vendu appartient au produit sourcé'));
    checks.push(check(`sku_has_supplier_unit:${item.order_item_id}`, Boolean(item.sku_unit_ref), 'Le SKU porte une unité fournisseur'));
    checks.push(check(`purchase_line_exists:${item.order_item_id}`, mine.length > 0, 'Au moins une ligne d’achat'));
    checks.push(check(`purchase_attached_to_po:${item.order_item_id}`, mine.length > 0 && mine.every((l) => l.purchase_order_id), 'Chaque ligne d’achat est rattachée à un PO'));
    checks.push(check(`quantity_exactly_covered:${item.order_item_id}`, covered === Number(item.quantity), `couvert ${covered} / vendu ${item.quantity}`));
    perItem.push({ order_item_id: item.order_item_id, sold_quantity: Number(item.quantity), purchased_quantity: covered, purchase_lines: mine.length });
  }
  return settle({ ...meta, checks, anomalies, nextAction, evidence: { order_reference: order.rows[0].reference, items: perItem } });
}

function deriveReadiness({ gates = [], productId = null, orderReference = null } = {}) {
  if (!productId && !orderReference && !gates.length) return STAGE.NON_DEMARRE;
  if (gates.some((g) => g.status === GATE.ANOMALIE)) return STAGE.ANOMALIE;
  const proved = gates.map((g) => g.status === GATE.PROVED);
  // Sans commande : les 4 portes amont. Avec commande : la 5e porte (commande → achat exact) est exigée.
  const expectedGates = orderReference ? 5 : 4;
  if (proved.length === expectedGates && proved.every(Boolean)) return STAGE.PRET;
  const firstGap = proved.indexOf(false);
  const hole = firstGap >= 0 && proved.slice(firstGap + 1).some(Boolean);
  if (hole) return STAGE.PREUVE_MANQUANTE;
  if (orderReference && !productId) return STAGE.PREUVE_MANQUANTE;
  if (!productId) return STAGE.NON_DEMARRE;
  return STAGE.EN_PREPARATION;
}

async function projectUpstreamEvidence(db, {
  productId = null,
  marketCode = null,
  orderReference = null,
  storefrontBaseUrl = null,
  fetchImpl = (typeof fetch === 'function' ? fetch : null),
} = {}) {
  const market = marketCode && /^[A-Z]{2}$/i.test(marketCode) ? String(marketCode).toUpperCase() : null;
  const product = productId && UUID_RX.test(productId) ? String(productId).toLowerCase() : null;
  let gates = [];
  if (product) {
    const source = await loadSourceGate(db, product);
    const refinery = await loadRefineryGate(db, product);
    const catalog = await loadCatalogGate(db, product, market);
    const storefront = fetchImpl
      ? await loadStorefrontGate({ productId: product, marketCode: market, baseUrl: storefrontBaseUrl, fetchImpl, catalogGate: catalog })
      : unproved('STOREFRONT_PROVED', 'Boutique', null, 'Produit visible et vendable dans la boutique', 'storefront_probe_unavailable', 'Sonde HTTP indisponible dans ce runtime.');
    gates = [source, refinery, catalog, storefront];
    if (orderReference) gates.push(await loadCustomerOrderGate(db, { productId: product, orderReference: String(orderReference) }));
  }
  const stage = deriveReadiness({ gates, productId: product, orderReference });
  const ids = { product_id: product, market_code: market, order_reference: orderReference || null };
  return {
    doctrine: 'read_only_projection_no_business_authority',
    proof_level: 'Projection des faits persistés de la cible interrogée ; ne vaut pas L5 sans exécution réelle observée',
    certification: 'NON CERTIFIÉE',
    certification_reasons: [
      'Parcours source → client non certifiable dans ce lot (checkout réel, documents et validations humaines requis)',
      'Une validation humaine ne remplace jamais une preuve backend',
    ],
    stage,
    ids,
    gates,
    dossier: buildDossierMeta({ ids, gates, stage }),
    observed_at: new Date().toISOString(),
  };
}

module.exports = { projectUpstreamEvidence, deriveReadiness, GATE, STAGE };
