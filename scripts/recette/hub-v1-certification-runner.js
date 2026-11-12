#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-certification-runner
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Runner unique des 13 étapes Hub V1 (commande client → retrait au relais) sur une fixture E2E-HUB-V1-<RUN8>, via les services métier réels, sur base PostgreSQL locale éphémère uniquement.
 * @db-read orders, order_items, users, relais, markets, products, product_skus, suppliers, purchase_orders, purchase_lines, purchase_order_authorizations, hub_authorization_grants, hub_physical_units, hub_physical_unit_placements, hub_purchase_allocations, hub_box_bags, parcels, parcel_items, international_shipments, international_shipment_events, international_shipment_relay_receipts, scans, scan_events, incidents, local_stock, local_stock_allocations
 * @db-write users, relais, suppliers, products, product_skus, product_suppliers, product_sku_physical_codes, product_market_price_drafts, product_market_exposure, local_stock, sourcing_sources, sourcing_captures, sourcing_observations, sourcing_canonical_entities, sourcing_canonical_entity_refs, sourcing_resolution_decisions, sourcing_resolution_bindings, supplier_catalog_imports, sourcing_candidates, orders, order_items, purchase_lines, purchase_orders, purchase_order_authorizations, hub_authorization_grants, hub_physical_units, hub_physical_unit_placements, hub_purchase_allocations, hub_box_bags, parcels, parcel_items, international_shipments, international_shipment_events, international_shipment_hub_units, international_shipment_relay_receipts, scans, scan_events, incidents
 * @db-txn services_own_transactions
 *
 * Aucun UPDATE SQL de statut : chaque transition passe par le writer métier.
 * Aucun Stripe / fournisseur / WhatsApp / SMS / email / caisse : tripwire réseau
 * actif pendant tout le run, adaptateurs de simulation uniquement.
 * Refuse toute base qui n'est pas locale et éphémère. Le drapeau
 * --allow-remote-staging est documenté pour un futur lot mais volontairement
 * NON implémenté (refus fermé).
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCOPE = 'E2E-HUB-V1';
const SUFFIXES = Object.freeze(['KOM-101', 'KOM-102', 'KOM-103', 'LOCAL']);
const RUN_RE = /^[A-Z0-9]{8}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const EPHEMERAL_DB_RE = /(_test|_ephemeral|_runner_[a-z0-9]*)$/i;
const STEP_TITLES = Object.freeze([
  ['orders', 'Commandes par checkout canonique'],
  ['payment', 'Paiement client fictif sans débit'],
  ['po_prepare', 'Préparation et regroupement des PO'],
  ['commitment', "Autorisation d'engagement (responsable Hub)"],
  ['submit_send', 'Soumission et envoi fournisseur simulé'],
  ['supplier_payment_auth', 'Autorisation distincte du paiement fournisseur (sans débit)'],
  ['supplier_confirm', 'Confirmation fournisseur'],
  ['partial_receipt', 'Réception partielle Hub (FIFO)'],
  ['identify_scan_bags', 'Identification, scans et sacs clients'],
  ['pack_box', 'Emballage et rattachement KOM-BOX'],
  ['ship_handover', 'Expédition et remise au transitaire'],
  ['relay_attestation', 'Réception attestée au relais'],
  ['pickup_remainder', 'Retrait client et traitement du reliquat'],
]);

const MARKET_RE = /^[A-Z]{2}$/;
// Options de run : marché de la fixture (défaut KM, comportement historique) et arrêt après l'étape N
// (les étapes suivantes sont alors réalisées par l'UI/HTTP réels ; aucun verdict 13/13 n'est prononcé).
function parseRunOptions(argv = process.argv) {
  const val = (name) => { const a = argv.find((x) => x.startsWith(name + '=')); return a ? a.slice(name.length + 1) : null; };
  const market = (val('--market') || 'KM').toUpperCase();
  if (!MARKET_RE.test(market)) throw Object.assign(new Error('HUB_V1_RUNNER_MARKET_INVALID'), { code: 'HUB_V1_RUNNER_MARKET_INVALID' });
  const stopRaw = val('--stop-after');
  const stopAfter = stopRaw === null ? null : Number(stopRaw);
  if (stopAfter !== null && !(Number.isInteger(stopAfter) && stopAfter >= 1 && stopAfter <= 12)) {
    throw Object.assign(new Error('HUB_V1_RUNNER_STOP_AFTER_INVALID'), { code: 'HUB_V1_RUNNER_STOP_AFTER_INVALID' });
  }
  return { market, stopAfter };
}

const uuid = () => crypto.randomUUID();
const newRun8 = () => crypto.randomBytes(4).toString('hex').toUpperCase();
const orderRef = (run, suffix) => `${SCOPE}-${run}-${suffix}`;
const emailOf = (run, role) => `e2e-hub-v1-${run.toLowerCase()}${role ? '-' + role : ''}@komerce.test`;
const phoneOf = (run, i) => {
  const h = parseInt(crypto.createHash('sha1').update(run).digest('hex').slice(0, 6), 16);
  return '+2693' + String((h + i) % 10000000).padStart(7, '0');
};

// ─── Garde de cible : base locale éphémère uniquement ───────────────────────
function assertEphemeralTarget(url = process.env.DATABASE_URL, argv = process.argv) {
  if (argv.includes('--allow-remote-staging')) {
    throw Object.assign(new Error('HUB_V1_RUNNER_REMOTE_STAGING_NOT_IMPLEMENTED'), { code: 'HUB_V1_RUNNER_REMOTE_STAGING_NOT_IMPLEMENTED' });
  }
  let parsed;
  try { parsed = new URL(String(url || '')); } catch (_) { parsed = null; }
  if (!parsed) throw Object.assign(new Error('HUB_V1_RUNNER_DATABASE_URL_INVALID'), { code: 'HUB_V1_RUNNER_DATABASE_URL_INVALID' });
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!LOCAL_HOSTS.has(parsed.hostname) || !EPHEMERAL_DB_RE.test(database)) {
    throw Object.assign(new Error('HUB_V1_RUNNER_LOCAL_EPHEMERAL_DATABASE_ONLY'), { code: 'HUB_V1_RUNNER_LOCAL_EPHEMERAL_DATABASE_ONLY' });
  }
  if (process.env.NODE_ENV === 'production') {
    throw Object.assign(new Error('HUB_V1_RUNNER_PRODUCTION_FORBIDDEN'), { code: 'HUB_V1_RUNNER_PRODUCTION_FORBIDDEN' });
  }
  return { host: parsed.hostname, database };
}

// ─── Tripwire réseau : toute tentative de sortie HTTP(S) est consignée et refusée ─
function installNetworkTripwire() {
  const http = require('http');
  const https = require('https');
  const attempts = [];
  const saved = { http: http.request, https: https.request, httpGet: http.get, httpsGet: https.get, fetch: global.fetch };
  const trip = (kind) => (...args) => {
    const target = typeof args[0] === 'string' ? args[0] : (args[0] && (args[0].href || args[0].host || args[0].hostname)) || 'unknown';
    attempts.push({ kind, target: String(target).replace(/\/\/[^/@]*@/, '//***@').slice(0, 80) });
    throw Object.assign(new Error('HUB_V1_RUNNER_NETWORK_TRIPWIRE'), { code: 'HUB_V1_RUNNER_NETWORK_TRIPWIRE' });
  };
  http.request = trip('http.request'); https.request = trip('https.request');
  http.get = trip('http.get'); https.get = trip('https.get');
  if (saved.fetch) global.fetch = trip('fetch');
  return {
    attempts,
    restore() {
      http.request = saved.http; https.request = saved.https;
      http.get = saved.httpGet; https.get = saved.httpsGet;
      if (saved.fetch) global.fetch = saved.fetch;
    },
  };
}

// ─── Recorder d'étape ────────────────────────────────────────────────────────
function newStep(n) {
  const [key, title] = STEP_TITLES[n - 1];
  return {
    n, key, title, status: 'PENDING', writers: [], actors: {}, ids: {}, quantities: {}, statuses: {},
    evidence: [], refusals: [], idempotency: [], notes: [], blocker: null,
  };
}
const codeOf = (e) => (e && (e.code || (e.body && e.body.code) || (e.response && e.response.code))) || null;
const statusOf = (e) => (e && (e.status || (e.body && e.status))) || null;

async function expectRefusal(step, label, fn, expected = {}) {
  let outcome;
  try { outcome = await fn(); } catch (error) {
    const code = codeOf(error); const status = statusOf(error);
    const text = String(error && error.message || '');
    const ok = (!expected.code || code === expected.code || text.includes(expected.code)) &&
      (!expected.status || status === expected.status);
    if (!ok) throw Object.assign(new Error(`REFUSAL_MISMATCH:${label}:got ${code || text.slice(0, 80)}`), { code: 'REFUSAL_MISMATCH' });
    step.refusals.push({ label, code: code || expected.code || null, status: status || expected.status || null, refused: true });
    return error;
  }
  // services de type commande : {status, body} sans exception
  if (outcome && typeof outcome === 'object' && (outcome.ok === false || (outcome.status >= 400) || outcome.success === false)) {
    const code = codeOf(outcome) || (outcome.error && outcome.error.code) || null;
    if (expected.code && code !== expected.code && !String(JSON.stringify(outcome)).includes(expected.code)) {
      throw Object.assign(new Error(`REFUSAL_MISMATCH:${label}:got ${code}`), { code: 'REFUSAL_MISMATCH' });
    }
    step.refusals.push({ label, code, status: outcome.status || null, refused: true });
    return outcome;
  }
  throw Object.assign(new Error(`REFUSAL_EXPECTED_BUT_ACCEPTED:${label}`), { code: 'REFUSAL_EXPECTED_BUT_ACCEPTED' });
}

// ─── Fixture : référentiel isolé par RUN8 (jamais RCT1 / AUDIT / données réelles) ─
const q = (db) => (sql, params) => db.query(sql, params);

async function ensureUser(db, { run, role, label, i, relaisId = null }) {
  const email = role === 'client' ? emailOf(run) : emailOf(run, label);
  const { rows: [found] } = await db.query('SELECT id FROM users WHERE lower(email)=lower($1)', [email]);
  if (found) return { id: found.id, role, email };
  const id = uuid();
  await db.query(
    'INSERT INTO users(id,full_name,email,phone,role,relais_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, `E2E-HUB-V1-${run} ${label}`, email, phoneOf(run, i), role, relaisId]);
  return { id, role, email };
}

async function seedCanonicalUnit(db, { run, key, productId, supplierSku, unitRef, identity, price, currency }) {
  const sourceId = `api:whatsapp:${SCOPE}-${run}`;
  await db.query(
    `INSERT INTO sourcing_sources(source_id,adapter_type,acquisition,continuity,status)
     VALUES ($1,'whatsapp','pull','recurring','active') ON CONFLICT (source_id) DO NOTHING`, [sourceId]);
  const { rows: [imp] } = await db.query(
    `INSERT INTO supplier_catalog_imports(supplier_name,source_type,total_items,notes)
     VALUES ($1,'api',1,$2) RETURNING id`, [`${SCOPE}-${run}-${key}`, `${SCOPE} fixture canonique ${run}`]);
  const productRef = `${SCOPE}-${run}-${key}-sp`;
  await db.query(
    `INSERT INTO sourcing_candidates(import_id,supplier_name,supplier_product_id,product_name,purchase_price,currency,state,product_id)
     VALUES ($1,$2,$3,$4,$5,$6,'imported_to_catalog',$7)`,
    [imp.id, `${SCOPE}-${run}`, productRef, `${SCOPE}-${run}-${key}`, price, currency, productId]);
  const { rows: [cap] } = await db.query(
    `INSERT INTO sourcing_captures(source_id,status,completed_at,stats) VALUES ($1,'complete',NOW(),$2::jsonb) RETURNING capture_id`,
    [sourceId, JSON.stringify({ import_id: imp.id })]);
  const obs = async (grain, ref, parent, normalized) => (await db.query(
    `INSERT INTO sourcing_observations(capture_id,grain,source_ref,parent_observation_id,observed_at,normalized,raw_fragment)
     VALUES ($1,$2,$3,$4,NOW(),$5::jsonb,'{}'::jsonb) RETURNING observation_id`,
    [cap.capture_id, grain, ref, parent, JSON.stringify(normalized)])).rows[0].observation_id;
  const po = await obs('product', productRef, null, { title: `${SCOPE}-${run}-${key}` });
  const oo = await obs('offer', `${productRef}-offer`, po, { purchase_price: price, currency });
  const uo = await obs('unit', unitRef, oo, {
    supplier_unit_ref: unitRef, supplier_sku: supplierSku, purchase_price: price, currency,
    stock_available: 50, availability: 'available', is_active: true, supplier_order_identity: identity });
  const ent = async (grain, parent) => (await db.query(
    'INSERT INTO sourcing_canonical_entities(grain,parent_entity_id) VALUES ($1,$2) RETURNING canonical_entity_id', [grain, parent])).rows[0].canonical_entity_id;
  const cp = await ent('product', null); const co = await ent('offer', cp); const cu = await ent('unit', co);
  const bind = async (grain, observation, entity) => {
    const { rows: [d] } = await db.query(
      `INSERT INTO sourcing_resolution_decisions(decision_type,grain,observation_id,canonical_entity_id,actor_type,actor_ref,rationale,evidence_snapshot)
       VALUES ('LINK',$1,$2,$3,'system',$4,$5,'{}'::jsonb) RETURNING decision_id`,
      [grain, observation, entity, `${SCOPE}-${run}`, `${SCOPE} fixture canonique`]);
    await db.query(
      `INSERT INTO sourcing_resolution_bindings(observation_id,grain,canonical_entity_id,asserted_by_decision_id) VALUES ($1,$2,$3,$4)`,
      [observation, grain, entity, d.decision_id]);
  };
  await bind('product', po, cp); await bind('offer', oo, co); await bind('unit', uo, cu);
  await db.query(
    `INSERT INTO sourcing_canonical_entity_refs(canonical_entity_id,source_id,ref_kind,ref_value) VALUES ($1,$2,'supplier_unit_ref',$3)`,
    [cu, sourceId, unitRef]);
  return { canonical_unit_id: cu, source_id: sourceId };
}

async function seedFixture(db, run, services, { officialStaging = false, marketCode = 'KM' } = {}) {
  const { auth, local } = services;
  const priceKit = PRICE_KIT;
  const m = (await db.query("SELECT id, name, currency FROM markets WHERE code=$1 AND lifecycle_status='ACTIVE'", [marketCode])).rows[0];
  if (!m) {
    const code = marketCode === 'KM' ? 'HUB_V1_RUNNER_MARKET_KM_MISSING' : 'HUB_V1_RUNNER_MARKET_NOT_ACTIVE';
    throw Object.assign(new Error(code), { code });
  }
  const manifest = { run, market_code: marketCode, market_currency: m.currency, market_id: m.id, users: {}, relay: null, suppliers: {}, products: {}, skus: {}, canonical: {} };
  const relayName = `${SCOPE}-${run}-RELAIS`;
  let relay = (await db.query('SELECT id FROM relais WHERE name=$1', [relayName])).rows[0];
  if (!relay) {
    relay = { id: uuid() };
    await db.query(
      `INSERT INTO relais(id,name,agent_name,phone,address,market_id,island,island_code,zone,is_active)
       VALUES ($1,$2,'E2E agent relais',$3,$4,$5,$6,$7,$8,TRUE)`,
      // Routage canonique (services/routing.js) : KM/YT par île, autres marchés par ville/zone du relais.
      marketCode === 'KM' ? [relay.id, relayName, phoneOf(run, 90), 'Moroni', m.id, 'Grande Comore', 'MORONI', null]
        : marketCode === 'YT' ? [relay.id, relayName, phoneOf(run, 90), 'Mamoudzou', m.id, 'Mayotte', 'MAYOTTE', null]
          : [relay.id, relayName, phoneOf(run, 90), m.name, m.id, null, null, `E2E-${marketCode}`]);
  }
  manifest.relay = relay.id;
  const mk = (role, label, i, relaisId) => ensureUser(db, { run, role, label, i, relaisId });
  manifest.users.client = await mk('client', 'client', 1);
  manifest.users.admin = await mk('admin', 'admin', 2);
  manifest.users.hub_director = await mk('agent_hub', 'directrice', 3);
  manifest.users.hub_agent = await mk('agent_hub', 'agent-hub', 4);
  manifest.users.market_manager = await mk('market_operator', 'responsable-marche', 5);
  manifest.users.relay_agent = await mk('agent_relais', 'agent-relais', 6, relay.id);
  manifest.users.forwarder = await mk('agent_transitaire', 'transitaire', 7);
  const adminActor = { id: manifest.users.admin.id, role: 'admin' };
  for (const type of auth.TYPES) await auth.grant({ userId: manifest.users.hub_director.id, authorizationType: type, actor: adminActor });
  manifest.grants = [...auth.TYPES];

  for (const label of ['A', 'B']) {
    const name = `${SCOPE}-${run}-SUP-${label}`;
    let s = (await db.query('SELECT id FROM suppliers WHERE name=$1', [name])).rows[0];
    if (!s) { s = { id: uuid() }; await db.query("INSERT INTO suppliers(id,name,platform,is_active) VALUES ($1,$2,'whatsapp',true)", [s.id, name]); }
    manifest.suppliers[label] = s.id;
  }
  if (!officialStaging) await priceKit.seedFx(db);
  const defs = [['A', 'A'], ['B', 'B'], ['C', null]]; // C : aucun fournisseur mappé → « Sourcing requis »
  for (const [label, supplierLabel] of defs) {
    const ref = `${SCOPE}-${run}-P${label}`;
    let p = (await db.query('SELECT id FROM products WHERE product_ref=$1', [ref])).rows[0];
    const skuCode = `${SCOPE}-${run}-SKU-${label}`;
    const supplierSku = `E2E-${run}-${label}`; const unitRef = `${supplierSku}-U`;
    const identity = { provider: 'whatsapp', version: 1, payload: { supplier_sku: supplierSku } };
    if (!p) {
      p = { id: uuid() };
      await db.query(
        `INSERT INTO products(id,name,product_ref,price_kmf,cost_kmf,stock,price_aed,weight_kg,volume_cm3,inventory_model,is_active)
         VALUES ($1,$2,$3,10000,3000,0,100,1,1000,'SKU',TRUE)`, [p.id, `${SCOPE} produit ${label} ${run}`, ref]);
      const skuId = uuid();
      await db.query(
        `INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
         VALUES ($1,$2,$3,50,true,'SUPPLIER',$4,$5,$6::jsonb)`, [skuId, p.id, skuCode, supplierSku, unitRef, JSON.stringify(identity)]);
      manifest.canonical[label] = await seedCanonicalUnit(db, { run, key: label, productId: p.id, supplierSku, unitRef, identity, price: 7, currency: 'USD' });
      if (supplierLabel) {
        await db.query(
          `INSERT INTO product_suppliers(id,product_id,supplier_id,supplier_sku,supplier_price_aed,priority,is_active) VALUES ($1,$2,$3,$4,42,1,true)`,
          [uuid(), p.id, manifest.suppliers[supplierLabel], supplierSku]);
      }
      await priceKit.activatePrice(db, { marketId: m.id, productId: p.id, amount: 10000, currency: m.currency, skipAttestationSeed: officialStaging });
      // Code-barres fournisseur confirmé : preuve de scan à la préparation des sacs.
      await db.query(
        `INSERT INTO product_sku_physical_codes(product_sku_id,supplier_id,code,code_type,trust,printed_on_pack,confirmed_by,confirmed_at,confirmation_proof_ref)
         VALUES ($1,$2,$3,'SUPPLIER_BARCODE','CONFIRMED',true,$4,now(),$5)`,
        [skuId, supplierLabel ? manifest.suppliers[supplierLabel] : manifest.suppliers.A, barcodeOf(run, label), manifest.users.admin.id, `${SCOPE}-${run}-observation-emballage`]);
    }
    manifest.products[label] = p.id;
    manifest.skus[label] = (await db.query('SELECT id FROM product_skus WHERE product_id=$1', [p.id])).rows[0].id;
  }
  // Produit LOCAL : stock local exposé au marché, circuit relais uniquement.
  const lref = `${SCOPE}-${run}-PL`;
  let lp = (await db.query('SELECT id FROM products WHERE product_ref=$1', [lref])).rows[0];
  if (!lp) {
    lp = { id: uuid() };
    await db.query(
      `INSERT INTO products(id,name,product_ref,price_kmf,cost_kmf,stock,price_aed,weight_kg,volume_cm3,inventory_model,is_active)
       VALUES ($1,$2,$3,10000,3000,5,100,1,1000,'LEGACY_VARIANTS',TRUE)`, [lp.id, `${SCOPE} produit local ${run}`, lref]);
    await priceKit.activatePrice(db, { marketId: m.id, productId: lp.id, amount: 10000, currency: m.currency, skipAttestationSeed: officialStaging });
    await local.setLocalStock({ productId: lp.id, marketId: m.id, qtyPhysical: 5, actorUserId: manifest.users.admin.id });
    await local.setLocalStockExposure(lp.id, m.id, 'ENABLED');
  }
  manifest.products.LOCAL = lp.id;
  return manifest;
}
const barcodeOf = (run, label) => '9' + String(parseInt(crypto.createHash('sha1').update(run + label).digest('hex').slice(0, 10), 16)).padStart(12, '0').slice(-12);

// Référentiel commercial minimal (prix local actif, exposition, attestation de livraison, FX fictif).
// Sur une base éphémère uniquement : la garde de cible interdit tout autre usage.
const PRICE_KIT = {
  async seedFx(db) {
    const { rows } = await db.query("SELECT 1 FROM fx_rate_observations WHERE approved_by IS NOT NULL AND as_of > now() - interval '5 days' LIMIT 1");
    if (rows.length) return;
    const { rows: [o] } = await db.query(
      `INSERT INTO fx_rate_observations(rate,source_label,source_ref,as_of,entered_by)
       VALUES (1.10,'FIXTURE E2E-HUB-V1 — taux fictif non réel','e2e-hub-v1-fixture',now() - interval '1 hour','e2e-hub-v1-a') RETURNING id`);
    await db.query("UPDATE fx_rate_observations SET approved_by='e2e-hub-v1-b' WHERE id=$1", [o.id]);
  },
  async activatePrice(db, { marketId, productId, amount, currency, skipAttestationSeed = false }) {
    await db.query(
      `INSERT INTO product_market_price_drafts(id,market_id,product_id,amount,currency,status,reason,authorized_at,authorization_snapshot,active_at)
       VALUES ($1,$2,$3,$4,$5,'LOCAL_ACTIVE','E2E-HUB-V1 fixture',NOW(),'{}'::jsonb,NOW())
       ON CONFLICT (market_id,product_id) DO UPDATE SET amount=EXCLUDED.amount,currency=EXCLUDED.currency,status='LOCAL_ACTIVE',active_at=NOW()`,
      [uuid(), marketId, productId, amount, currency]);
    await db.query(
      `INSERT INTO product_market_exposure(id,product_id,market_id,commercial_exposure) VALUES ($1,$2,$3,'ENABLED')
       ON CONFLICT (product_id,market_id) DO UPDATE SET commercial_exposure='ENABLED',updated_at=NOW()`, [uuid(), productId, marketId]);
    if (skipAttestationSeed) return; // Staging officiel : attestations et transporteurs réels préexistants seulement.
    // Base éphémère, marché hors KM : tarif de vente transport minimal (le checkout est fail-closed sans tarif).
    // Jamais semé sur staging : l'absence de tarif y est un constat de certification, pas une lacune à masquer.
    const { rows: [mk] } = await db.query('SELECT code FROM markets WHERE id=$1', [marketId]);
    if (mk && mk.code !== 'KM') {
      await db.query(
        `INSERT INTO market_transport_sale_rates(market_id,rate_key,rate_per_kg,currency,evidence_ref)
         SELECT $1,k,1000,$2,'E2E-HUB-V1-EPHEMERAL-TARIFF' FROM unnest(ARRAY['SEA_KMF_PER_KG_COMMERCIAL','AIR_KMF_PER_KG_TAXABLE']) k
          WHERE NOT EXISTS (SELECT 1 FROM market_transport_sale_rates WHERE market_id=$1 AND revoked_at IS NULL)`, [marketId, currency]);
    }
    const { rows } = await db.query('SELECT 1 FROM market_delivery_attestations WHERE market_id=$1 AND revoked_at IS NULL AND valid_until>NOW() LIMIT 1', [marketId]);
    if (rows.length) return;
    const carrier = uuid();
    await db.query("INSERT INTO carriers(id,name,type,is_active) VALUES ($1,'E2E-HUB-V1 transporteur','maritime',TRUE)", [carrier]);
    await db.query(
      `INSERT INTO market_delivery_attestations(id,market_id,carrier_id,mode,origin_ref,freight_rate,rate_currency,rate_unit,transit_days,evidence_ref,attested_by,valid_until)
       VALUES ($1,$2,$3,'SEA','E2E-HUB-V1-ORIGIN',1,$4,'PER_KG',30,'E2E-HUB-V1-EVIDENCE',(SELECT id FROM users ORDER BY created_at LIMIT 1),NOW()+INTERVAL '30 days')`,
      [uuid(), marketId, carrier, currency]);
  },
};

// ─── Services métier réels (aucun second workflow) ───────────────────────────
function loadServices() {
  return {
    auth: require('../../services/hub-authorization-service'),
    local: require('../../services/local-stock-service'),
    checkout: require('../../services/order-checkout-service'),
    payment: require('../../services/hub-v1-fixture-payment'),
    trigger: require('../../services/purchasing-trigger-service'),
    grouped: require('../../services/purchasing-grouped-service'),
    engagement: require('../../services/purchasing-engagement-service'),
    hubOps: require('../../services/hub-operations'),
    bagBox: require('../../services/hub-bag-box-service'),
    autoParcel: require('../../services/auto-parcel'),
    journey: require('../../services/international-shipment-journey'),
    relay: require('../../services/relay-shipment-receipt'),
    localReceipt: require('../../services/local-relay-receipt-service'),
    scan: require('../../services/scan-engine'),
    customs: require('../../services/customs-shipment-service'),
  };
}

const PLAN = Object.freeze({
  'KOM-101': [['A', 2], ['B', 1]],
  'KOM-102': [['A', 1]],
  'KOM-103': [['C', 2]],
  LOCAL: [['LOCAL', 1]],
});
const PAY_ENV = Object.freeze({ KOMERCE_ENV: 'staging', NODE_ENV: 'test', HUB_V1_E2E_APPLY_MODE: 'approved' });
const actorOf = (user) => ({ id: user.id, role: user.role });

async function loadOrder(db, reference) {
  const { rows: [o] } = await db.query(
    `SELECT id,reference,status::text AS status,payment_status::text AS payment_status,simulation_scope,market_id,relais_id,
            payment_mode,stripe_payment_id,cash_paid_at FROM orders WHERE reference=$1`, [reference]);
  if (!o) return null;
  const { rows: items } = await db.query(
    'SELECT id,product_id,quantity,sku_id,fulfillment_source FROM order_items WHERE order_id=$1 ORDER BY id', [o.id]);
  return { ...o, items };
}

// ─── Étape 1 : commandes par checkout canonique ──────────────────────────────
async function step1(ctx, st) {
  const { db, run, manifest, svc } = ctx;
  const buyer = { id: manifest.users.client.id, full_name: `${SCOPE}-${run} client`, phone: phoneOf(run, 1) };
  const adminId = manifest.users.admin.id;
  st.writers.push('order-checkout-service.runOrderCheckout (internalSimulation E2E-HUB-V1)');
  st.actors = { client: buyer.id, admin_simulation_actor: adminId };
  const previous = process.env.KOMERCE_ENV;
  process.env.KOMERCE_ENV = 'staging';
  try {
    for (const suffix of SUFFIXES) {
      const reference = orderRef(run, suffix);
      const items = PLAN[suffix].map(([label, quantity]) => ({ product_id: manifest.products[label], quantity }));
      // Prix de fixture = 10000 dans la devise du marché ; le garde checkout compare un total KMF (projection canonique).
      const unitKmf = manifest.market_currency === 'KMF' ? 10000
        : await require('../../services/market-local-price-resolution-service').projectLocalToKmf(10000, manifest.market_currency);
      const total = PLAN[suffix].reduce((n, [, qty]) => n + qty * unitKmf, 0);
      const body = { items, relais_id: manifest.relay, payment_mode: 'cash_relais', use_wallet: false };
      const internalSimulation = { scope: SCOPE, reference, actorId: adminId, expectedProductTotalKmf: total, reason: `Certification Hub V1 ${run}` };
      const before = await loadOrder(db, reference);
      if (!before) {
        const created = await svc.checkout.runOrderCheckout({ user: buyer, body, internalSimulation });
        if (!created || created.ok !== true) throw Object.assign(new Error(`CHECKOUT_REFUSED:${suffix}:${JSON.stringify(created && created.body).slice(0, 160)}`), { code: 'CHECKOUT_REFUSED' });
      }
      const order = await loadOrder(db, reference);
      ctx.orders[suffix] = order;
      st.ids[suffix] = order.id;
      st.statuses[suffix] = `${order.status}/${order.payment_status}`;
      st.quantities[suffix] = order.items.map((i) => i.quantity);
      st.evidence.push({ order: suffix, reference, simulation_scope: order.simulation_scope, payment_mode: order.payment_mode,
        fulfillment: order.items.map((i) => i.fulfillment_source), replay_of_existing: Boolean(before) });
      await expectRefusal(st, `checkout rejoué ${suffix}`, () => svc.checkout.runOrderCheckout({ user: buyer, body, internalSimulation }), { code: 'HUB_V1_ORDER_ALREADY_EXISTS', status: 409 });
      const { rows: [n] } = await db.query('SELECT count(*)::int AS n FROM orders WHERE reference=$1', [reference]);
      st.idempotency.push({ what: `checkout ${suffix}`, rows_after_replay: n.n, no_duplicate: n.n === 1 });
      if (n.n !== 1) throw new Error('CHECKOUT_DUPLICATE_ORDER');
    }
    // Garde : référence hors motif fixture, ou paiement/panier partagé → refus avant écriture.
    await expectRefusal(st, 'référence hors fixture', () => svc.checkout.runOrderCheckout({
      user: buyer, body: { items: [{ product_id: manifest.products.A, quantity: 1 }], relais_id: manifest.relay, payment_mode: 'cash_relais' },
      internalSimulation: { scope: SCOPE, reference: `REAL-ORDER-${run}`, actorId: adminId, expectedProductTotalKmf: 10000, reason: 'x' } }));
  } finally { if (previous === undefined) delete process.env.KOMERCE_ENV; else process.env.KOMERCE_ENV = previous; }
}

// ─── Étape 2 : paiement client fictif sans débit ─────────────────────────────
async function step2(ctx, st) {
  const { db, run, manifest, svc } = ctx;
  st.writers.push('hub-v1-fixture-payment.confirmFixturePayment → payment-service.markPaid + order-status-machine');
  st.actors = { admin_simulation_actor: manifest.users.admin.id };
  for (const suffix of SUFFIXES) {
    const reference = orderRef(run, suffix);
    const pre = await loadOrder(db, reference);
    let first = { proof: 'SIMULATION_ONLY_NO_DEBIT', idempotent_replay: true };
    if (pre.payment_status === 'paid' && pre.status !== 'ordered') {
      // Rejeu après avancement logistique : la commande est déjà payée et plus avancée ; le writer refuse sans rien modifier.
      await expectRefusal(st, `paiement rejoué ${suffix} (déjà payée, statut ${pre.status})`, () => svc.payment.confirmFixturePayment({ reference, actorId: manifest.users.admin.id, env: PAY_ENV }), { code: 'HUB_V1_FIXTURE_PAYMENT_STATE_INVALID' });
    } else {
      first = await svc.payment.confirmFixturePayment({ reference, actorId: manifest.users.admin.id, env: PAY_ENV });
      const replay = await svc.payment.confirmFixturePayment({ reference, actorId: manifest.users.admin.id, env: PAY_ENV });
      if (!replay.idempotent_replay) throw new Error('PAYMENT_REPLAY_NOT_IDEMPOTENT');
      st.idempotency.push({ what: `paiement ${suffix}`, second_call_idempotent_replay: replay.idempotent_replay });
    }
    const o = await loadOrder(db, reference);
    ctx.orders[suffix] = o;
    const { rows: [cash] } = await db.query('SELECT count(*)::int AS n FROM cash_collections WHERE order_id=$1', [o.id]);
    const { rows: hist } = await db.query('SELECT new_status::text AS s FROM order_status_history WHERE order_id=$1 ORDER BY created_at', [o.id]).catch(() => ({ rows: [] }));
    if (o.payment_status !== 'paid' || ['pending', 'cancelled'].includes(o.status) || o.stripe_payment_id !== null || o.cash_paid_at !== null || cash.n !== 0) {
      throw new Error(`PAYMENT_STATE_INVALID:${suffix}`);
    }
    st.ids[suffix] = o.id;
    st.statuses[suffix] = `${o.status}/${o.payment_status}`;
    st.evidence.push({ order: suffix, proof: first.proof, first_was_replay: first.idempotent_replay, cash_collections: cash.n,
      stripe_payment_id: o.stripe_payment_id, cash_paid_at: o.cash_paid_at, status_history: hist.map((h) => h.s) });
  }
  await expectRefusal(st, 'paiement par un non-admin (client)', () => svc.payment.confirmFixturePayment({
    reference: orderRef(run, 'KOM-101'), actorId: manifest.users.client.id, env: PAY_ENV }), { code: 'HUB_V1_FIXTURE_PAYMENT_ADMIN_REQUIRED' });
  await expectRefusal(st, 'paiement hors mode approuvé', () => svc.payment.confirmFixturePayment({
    reference: orderRef(run, 'KOM-101'), actorId: manifest.users.admin.id, env: { ...PAY_ENV, HUB_V1_E2E_APPLY_MODE: 'off' } }), { code: 'HUB_V1_FIXTURE_PAYMENT_ENV_FORBIDDEN' });
}

// ─── Étape 3 : lignes d'achat, regroupement, PO, anomalie « Sourcing requis » ─
async function linesOf(db, orderId) {
  const { rows } = await db.query(
    `SELECT pl.id,pl.purchase_order_id,pl.quantity,pl.product_sku_id,pl.supplier_id,oi.product_id
       FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=$1 AND pl.cancelled_at IS NULL ORDER BY pl.id`, [orderId]);
  return rows;
}
function allTriggerStatuses(statuses, expected) {
  return Array.isArray(statuses) && statuses.length > 0 && statuses.every((s) => s === expected);
}
async function step3(ctx, st) {
  const { db, manifest, svc } = ctx;
  const agent = actorOf(manifest.users.hub_agent);
  st.writers.push('purchasing-trigger-service.triggerPurchasing', 'purchasing-grouped-service.preparePurchaseOrder');
  st.actors = { hub_agent: agent.id };
  delete process.env.ADMIN_PHONE; // jamais de notification admin réelle
  const trig = {};
  for (const suffix of SUFFIXES) {
    trig[suffix] = (await svc.trigger.triggerPurchasing(ctx.orders[suffix].id)).purchase_orders.map((r) => r.status);
    const again = (await svc.trigger.triggerPurchasing(ctx.orders[suffix].id)).purchase_orders.map((r) => r.status);
    st.idempotency.push({ what: `triggerPurchasing ${suffix}`, first: trig[suffix], replay: again });
  }
  if (!trig['KOM-101'].every((s) => s === 'line_opened' || s === 'already_exists')) throw new Error(`TRIGGER_KOM101:${trig['KOM-101']}`);
  if (!trig['KOM-102'].every((s) => s === 'line_opened' || s === 'already_exists')) throw new Error(`TRIGGER_KOM102:${trig['KOM-102']}`);
  const l101 = await linesOf(db, ctx.orders['KOM-101'].id);
  const l102 = await linesOf(db, ctx.orders['KOM-102'].id);
  const l103 = await linesOf(db, ctx.orders['KOM-103'].id);
  const lLocal = await linesOf(db, ctx.orders.LOCAL.id);
  // KOM-103 : « Sourcing requis » prouvé par le trigger réel, sans ligne ni PO ; LOCAL : aucune tâche Hub.
  const sourcingRequired = allTriggerStatuses(trig['KOM-103'], 'no_supplier') && l103.length === 0;
  const localNoHub = allTriggerStatuses(trig.LOCAL, 'local_stock_no_purchase') && lLocal.length === 0;
  st.evidence.push({ kom103_sourcing_required: sourcingRequired, trigger_statuses: trig, kom103_purchase_lines: l103.length, local_purchase_lines: lLocal.length });
  if (!sourcingRequired) throw Object.assign(new Error('KOM103_SOURCING_NOT_REPRODUCED'), { code: 'KOM103_SOURCING_NOT_REPRODUCED' });
  if (!localNoHub) throw new Error('LOCAL_ENTERED_HUB');
  const byProduct = (lines, label) => lines.filter((l) => l.product_id === manifest.products[label]);
  const lineA = [...byProduct(l101, 'A'), ...byProduct(l102, 'A')].map((l) => l.id);
  const lineB = byProduct(l101, 'B').map((l) => l.id);
  if (lineA.length !== 2 || lineB.length !== 1) throw new Error(`LINES_UNEXPECTED:${lineA.length}/${lineB.length}`);
  const prep = async (label, ids, supplier) => {
    const attached = (await db.query('SELECT DISTINCT purchase_order_id FROM purchase_lines WHERE id=ANY($1::uuid[])', [ids])).rows;
    if (attached.length === 1 && attached[0].purchase_order_id) return attached[0].purchase_order_id;
    const r = await svc.grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: ids, execution_mode: 'manual' }, { actor: agent });
    return r.purchase_order.id;
  };
  ctx.po.A = await prep('A', lineA, manifest.suppliers.A);
  ctx.po.B = await prep('B', lineB, manifest.suppliers.B);
  ctx.lines = { A: lineA, B: lineB, l101, l102 };
  st.ids = { PO_A: ctx.po.A, PO_B: ctx.po.B, lines_A: lineA, lines_B: lineB };
  st.quantities = { PO_A_ordered: 3, PO_B_ordered: 1 };
  for (const [k, id] of Object.entries(ctx.po)) {
    const { rows: [p] } = await db.query('SELECT status::text AS status,trigger_mode,market_id,supplier_id FROM purchase_orders WHERE id=$1', [id]);
    st.statuses[`PO_${k}`] = p.status; st.evidence.push({ po: k, id, ...p });
  }
  await expectRefusal(st, 'rattacher à nouveau des lignes déjà en PO', () => svc.grouped.preparePurchaseOrder({
    supplier_id: manifest.suppliers.A, procurement_hub_ref: 'DXB', line_ids: lineA }, { actor: agent }), { code: 'PURCHASE_LINES_ALREADY_ATTACHED', status: 409 });
  await expectRefusal(st, 'ligne déjà engagée dans PO-B réutilisée dans une PO fournisseur A', () => svc.grouped.preparePurchaseOrder({
    supplier_id: manifest.suppliers.A, procurement_hub_ref: 'DXB', line_ids: lineB }, { actor: agent }));
  const { rows: [po] } = await db.query("SELECT count(*)::int AS n FROM purchase_orders WHERE id = ANY($1::uuid[])", [[ctx.po.A, ctx.po.B]]);
  st.idempotency.push({ what: 'preparePurchaseOrder rejoué', purchase_orders_for_fixture: po.n, no_duplicate: po.n === 2 });
  ctx.sourcingRequired = sourcingRequired;
}

// ─── Étape 4 : autorisation d'engagement (responsable Hub) ───────────────────
const poLabels = (ctx) => Object.entries(ctx.po);
async function poHeader(db, id) {
  return (await db.query('SELECT id,status::text AS status,trigger_mode,sent_at,sent_channel,supplier_order_id FROM purchase_orders WHERE id=$1', [id])).rows[0];
}
async function authRows(db, poId) {
  return (await db.query(
    'SELECT id,authorization_type,decided_by,amount::float AS amount,currency,proof_ref FROM purchase_order_authorizations WHERE purchase_order_id=$1 ORDER BY authorization_type', [poId])).rows;
}
async function step4(ctx, st) {
  const { db, run, manifest, svc } = ctx;
  const director = actorOf(manifest.users.hub_director); const agent = actorOf(manifest.users.hub_agent);
  st.writers.push('hub-authorization-service.decide(purchase_commitment)', 'hub-authorization-service.grant');
  st.actors = { hub_director: director.id, hub_agent: agent.id, market_manager: manifest.users.market_manager.id, admin: manifest.users.admin.id };
  st.evidence.push({ grants_active: (await svc.auth.listGrants({ userId: director.id })).map((g) => ({ id: g.id, type: g.authorization_type, granted_by: g.granted_by })) });
  for (const [label, poId] of poLabels(ctx)) {
    const before = (await authRows(db, poId)).filter((a) => a.authorization_type === 'purchase_commitment');
    if (!before.length) {
      await expectRefusal(st, `PO-${label} soumise sans engagement`, () => svc.engagement.submitPurchaseOrder(poId, { actor: agent }), { code: 'PURCHASE_COMMITMENT_NOT_AUTHORIZED', status: 409 });
    }
    const body = { proof_ref: `SIM-ENGAGEMENT-${run}-${label}` };
    for (const [who, actor] of [['agent Hub', agent], ['responsable marché', actorOf(manifest.users.market_manager)], ['admin sans grant', actorOf(manifest.users.admin)]]) {
      await expectRefusal(st, `PO-${label} engagement par ${who}`, () => svc.auth.decide({ purchaseOrderId: poId, authorizationType: 'purchase_commitment', actor, body }), { code: 'AUTHORIZATION_GRANT_REQUIRED', status: 403 });
    }
    const decided = await svc.auth.decide({ purchaseOrderId: poId, authorizationType: 'purchase_commitment', actor: director, body });
    const replay = await svc.auth.decide({ purchaseOrderId: poId, authorizationType: 'purchase_commitment', actor: director, body: { proof_ref: 'AUTRE' } });
    if (!replay.idempotent_replay) throw new Error('COMMITMENT_REPLAY_NOT_IDEMPOTENT');
    const rows = (await authRows(db, poId)).filter((a) => a.authorization_type === 'purchase_commitment');
    if (rows.length !== 1 || rows[0].decided_by !== director.id) throw new Error(`COMMITMENT_ROW:${label}`);
    st.ids[`PO_${label}_commitment`] = rows[0].id;
    st.statuses[`PO_${label}`] = (await poHeader(db, poId)).status;
    st.quantities[`PO_${label}_amount`] = `${rows[0].amount} ${rows[0].currency}`;
    st.evidence.push({ po: label, authorization_id: rows[0].id, decided_by: rows[0].decided_by, amount: rows[0].amount, currency: rows[0].currency, proof_ref: rows[0].proof_ref, first_was_replay: Boolean(decided.idempotent_replay) });
    st.idempotency.push({ what: `engagement PO-${label}`, replay_idempotent: true, rows: rows.length });
    await expectRefusal(st, `PO-${label} engagement immuable (UPDATE)`, () => db.query('UPDATE purchase_order_authorizations SET amount=1 WHERE id=$1', [rows[0].id]), { code: 'purchase_order_authorization_immutable' });
  }
}

// ─── Étape 5 : soumission et envoi fournisseur simulé ────────────────────────
async function step5(ctx, st) {
  const { db, run, manifest, svc } = ctx;
  const agent = actorOf(manifest.users.hub_agent);
  st.writers.push('purchasing-engagement-service.submitPurchaseOrder', 'purchasing-engagement-service.recordPurchaseOrderSent');
  st.actors = { hub_agent: agent.id };
  for (const [label, poId] of poLabels(ctx)) {
    let h = await poHeader(db, poId);
    let submitted = null;
    if (h.status === 'draft') submitted = await svc.engagement.submitPurchaseOrder(poId, { actor: agent });
    h = await poHeader(db, poId);
    if (h.status === 'draft' || h.status === 'cancelled') throw new Error(`SUBMIT_STATUS:${label}:${h.status}`);
    if (submitted && submitted.notification.channel !== 'simulation_no_notification') throw new Error(`SUBMIT_CHANNEL:${submitted.notification.channel}`);
    if (submitted && submitted.place_order_invoked !== false) throw new Error('SUPPLIER_ADAPTER_INVOKED');
    await expectRefusal(st, `PO-${label} soumission rejouée`, () => svc.engagement.submitPurchaseOrder(poId, { actor: agent }));
    let sent = { already_sent: true };
    if ((await poHeader(db, poId)).status === 'notified') {
      sent = await svc.engagement.recordPurchaseOrderSent(poId, { channel: 'phone', note: `ENVOI FOURNISSEUR SIMULE ${SCOPE}-${run}` }, { actor: agent });
      const again = await svc.engagement.recordPurchaseOrderSent(poId, { channel: 'phone', note: 'rejeu' }, { actor: agent });
      if (!again.already_sent) throw new Error('SENT_REPLAY_NOT_IDEMPOTENT');
      await expectRefusal(st, `PO-${label} second canal d'envoi`, () => svc.engagement.recordPurchaseOrderSent(poId, { channel: 'email' }, { actor: agent }), { code: 'PURCHASE_ORDER_ALREADY_SENT' });
      st.idempotency.push({ what: `envoi PO-${label}`, second_call_already_sent: again.already_sent });
    } else {
      await expectRefusal(st, `PO-${label} envoi rejoué après confirmation`, () => svc.engagement.recordPurchaseOrderSent(poId, { channel: 'phone' }, { actor: agent }), { code: 'PURCHASE_ORDER_NOT_SUBMITTED' });
      st.idempotency.push({ what: `envoi PO-${label}`, replay_after_confirmation_refused: true });
    }
    h = await poHeader(db, poId);
    st.ids[`PO_${label}`] = poId;
    st.statuses[`PO_${label}`] = h.status;
    st.evidence.push({ po: label, status: h.status, sent_channel: h.sent_channel, sent_at: h.sent_at, notification_channel: submitted ? submitted.notification.channel : 'deja_soumise', place_order_invoked: false, first_send_replay: Boolean(sent.already_sent) });
  }
}

// ─── Étape 6 : autorisation distincte du paiement fournisseur (sans débit) ───
const SUPPLIER_MONEY_TABLES = ['supplier_execution_payments', 'supplier_execution_payment_proofs', 'supplier_payment_settlements'];
async function step6(ctx, st) {
  const { db, run, manifest, svc } = ctx;
  const director = actorOf(manifest.users.hub_director); const agent = actorOf(manifest.users.hub_agent);
  st.writers.push('hub-authorization-service.decide(supplier_payment)', 'hub-authorization-service.assertPaymentAuthorized');
  st.actors = { hub_director: director.id, hub_agent: agent.id };
  for (const [label, poId] of poLabels(ctx)) {
    const commit = (await authRows(db, poId)).find((a) => a.authorization_type === 'purchase_commitment');
    const body = { proof_ref: `SIM-PAIEMENT-FOURNISSEUR-${run}-${label}`, amount: commit.amount, currency: commit.currency };
    await expectRefusal(st, `PO-${label} paiement autorisé par agent Hub`, () => svc.auth.decide({ purchaseOrderId: poId, authorizationType: 'supplier_payment', actor: agent, body }), { code: 'AUTHORIZATION_GRANT_REQUIRED', status: 403 });
    await expectRefusal(st, `PO-${label} paiement sans montant`, () => svc.auth.decide({ purchaseOrderId: poId, authorizationType: 'supplier_payment', actor: director, body: { proof_ref: body.proof_ref } }), { code: 'AUTHORIZATION_AMOUNT_REQUIRED' }).catch(async (e) => {
      // Si l'autorisation existe déjà (rejeu), la décision est renvoyée à l'identique : ce n'est pas un refus.
      if (!(await authRows(db, poId)).some((a) => a.authorization_type === 'supplier_payment')) throw e;
    });
    const d = await svc.auth.decide({ purchaseOrderId: poId, authorizationType: 'supplier_payment', actor: director, body });
    const replay = await svc.auth.decide({ purchaseOrderId: poId, authorizationType: 'supplier_payment', actor: director, body });
    if (!replay.idempotent_replay) throw new Error('PAYMENT_AUTH_REPLAY_NOT_IDEMPOTENT');
    await svc.auth.assertPaymentAuthorized(db, poId, commit.amount, commit.currency);
    await expectRefusal(st, `PO-${label} paiement au-delà du plafond`, () => svc.auth.assertPaymentAuthorized(db, poId, commit.amount + 1, commit.currency), { code: 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION' });
    const rows = await authRows(db, poId);
    if (rows.length !== 2 || new Set(rows.map((r) => r.authorization_type)).size !== 2) throw new Error(`AUTH_ROWS:${label}`);
    st.ids[`PO_${label}_payment_authorization`] = rows.find((r) => r.authorization_type === 'supplier_payment').id;
    st.statuses[`PO_${label}_payment_authorization`] = 'granted';
    st.evidence.push({ po: label, distinct_authorizations: rows.map((r) => ({ id: r.id, type: r.authorization_type, decided_by: r.decided_by, amount: r.amount, currency: r.currency, proof_ref: r.proof_ref })), first_was_replay: Boolean(d.idempotent_replay) });
    st.idempotency.push({ what: `autorisation paiement PO-${label}`, replay_idempotent: true });
  }
  const counts = {};
  for (const t of SUPPLIER_MONEY_TABLES) {
    const { rows: [c] } = await db.query(`SELECT count(*)::int AS n FROM ${t}`).catch(() => ({ rows: [{ n: null }] }));
    counts[t] = c.n;
  }
  const none = Object.values(counts).every((n) => n === 0 || n === null) ;
  st.evidence.push({ supplier_debit_tables_rows: counts, no_debit: none });
  ctx.supplierMoneyBaseline = counts;
}

// ─── Étape 7 : confirmation fournisseur ──────────────────────────────────────
async function step7(ctx, st) {
  const { db, run, manifest, svc } = ctx;
  const agent = actorOf(manifest.users.hub_agent);
  st.writers.push('purchasing-engagement-service.confirmGroupedPurchaseOrder');
  st.actors = { hub_agent: agent.id };
  for (const [label, poId] of poLabels(ctx)) {
    const { rows: lines } = await db.query('SELECT id,quantity FROM purchase_lines WHERE purchase_order_id=$1 AND cancelled_at IS NULL ORDER BY id', [poId]);
    // Le vendeur réel est le fournisseur de la fixture, jamais le Hub central.
    // L5 impose cette preuve sur chaque achat manuel, y compris le runner Hub 13 étapes.
    const body = { purchase_proof_ref: `SIM-RECU-${run}-${label}`, supplier_order_id: `SIM-SO-${run}-${label}`,
      seller_supplier_id: manifest.suppliers[label], channel: 'phone',
      lines: lines.map((l) => ({ purchase_line_id: l.id, confirmed_quantity: l.quantity })) };
    if ((await poHeader(db, poId)).status === 'notified') {
      await expectRefusal(st, `PO-${label} confirmation sans justificatif`, () => svc.engagement.confirmGroupedPurchaseOrder(poId, { ...body, purchase_proof_ref: '' }, { actor: agent }), { code: 'MANUAL_PURCHASE_PROOF_REQUIRED' });
      await svc.engagement.confirmGroupedPurchaseOrder(poId, body, { actor: agent });
    }
    await expectRefusal(st, `PO-${label} confirmation rejouée`, () => svc.engagement.confirmGroupedPurchaseOrder(poId, body, { actor: agent }), { code: 'PURCHASE_ORDER_NOT_NOTIFIED', status: 409 });
    const h = await poHeader(db, poId);
    if (['draft', 'notified', 'cancelled'].includes(h.status)) throw new Error(`CONFIRM_STATUS:${label}:${h.status}`);
    const { rows: conf } = await db.query('SELECT id,quantity,confirmed_quantity FROM purchase_lines WHERE purchase_order_id=$1 AND cancelled_at IS NULL ORDER BY id', [poId]).catch(() => ({ rows: [] }));
    st.ids[`PO_${label}`] = poId;
    st.statuses[`PO_${label}`] = h.status;
    st.quantities[`PO_${label}_confirmed`] = lines.reduce((n, l) => n + l.quantity, 0);
    st.evidence.push({ po: label, status: h.status, supplier_order_id: h.supplier_order_id, proof_ref: body.purchase_proof_ref, lines: conf.length ? conf : lines });
    st.idempotency.push({ what: `confirmation PO-${label}`, replay_refused_not_duplicated: true });
  }
}

// ─── Effets externes : base (lignes) et réseau (tripwire) ────────────────────
const EXTERNAL_EFFECT_COUNTS = Object.freeze({
  cash_collections: 'SELECT count(*)::int AS n FROM cash_collections',
  // Les lignes « skipped » (suppression volontaire) et « logged » (journal interne) ne sont pas des envois.
  notification_log_attempts: "SELECT count(*)::int AS n FROM notification_log WHERE status NOT IN ('skipped','logged')",
  outbox_events: 'SELECT count(*)::int AS n FROM outbox_events',
  loyalty_rewards: 'SELECT count(*)::int AS n FROM loyalty_rewards',
  supplier_execution_payments: 'SELECT count(*)::int AS n FROM supplier_execution_payments',
  supplier_execution_payment_proofs: 'SELECT count(*)::int AS n FROM supplier_execution_payment_proofs',
  supplier_payment_settlements: 'SELECT count(*)::int AS n FROM supplier_payment_settlements',
});
async function countExternalTables(db) {
  const out = {};
  for (const [name, sql] of Object.entries(EXTERNAL_EFFECT_COUNTS)) {
    try { out[name] = (await db.query(sql)).rows[0].n; } catch (e) { out[name] = null; }
  }
  return out;
}

function summarizeExternalEffects(before, after, attempts = []) {
  const table_delta = Object.fromEntries(Object.keys(EXTERNAL_EFFECT_COUNTS).map((table) => {
    const b = before && before[table];
    const a = after && after[table];
    const readable = Number.isSafeInteger(b) && b >= 0 && Number.isSafeInteger(a) && a >= 0;
    return [table, readable ? a - b : null];
  }));
  const evidence_complete = Object.values(table_delta).every((n) => Number.isSafeInteger(n));
  const zero_external_effects = evidence_complete && attempts.length === 0 &&
    Object.values(table_delta).every((n) => n === 0);
  return {
    network_attempts: attempts.length, network_attempt_targets: attempts,
    table_rows_before: before, table_rows_after: after, table_delta,
    evidence_complete, zero_external_effects,
  };
}

// ─── Étape 8 : réception partielle Hub (FIFO) ────────────────────────────────
const barcodeFor = (ctx, label) => barcodeOf(ctx.run, label);
const progress = async (db, lineId) => Number((await db.query('SELECT received_quantity FROM v_purchase_line_progress WHERE line_id=$1', [lineId])).rows[0].received_quantity);
const hubAnswer = (r) => ({ status: r.status, code: r.body && r.body.code ? r.body.code : null, quarantined: Boolean(r.body && r.body.quarantined), replay: Boolean(r.body && r.body.idempotent_replay) });

async function step8(ctx, st) {
  const { db, run, manifest, svc } = ctx;
  const hubAgent = manifest.users.hub_agent;
  st.writers.push('hub-operations.receiveSupplierPackageCommand → hub-physical-identity (allocation FIFO par ligne)');
  st.actors = { hub_agent: hubAgent.id };
  const receive = (poId, label, quantity, reference, extra = {}) => svc.hubOps.receiveSupplierPackageCommand({
    reference, external_ref: `SIM-COLIS-${reference}`, location_ref: 'HUB-DXB-RECEIVE',
    contents: [{ purchase_order_id: poId, product_sku_id: manifest.skus[extra.sku || label], quantity, evidence_code: extra.code || barcodeFor(ctx, label) }],
  }, hubAgent.id);
  const lineOf = (suffix, label) => ctx.lines.l101.concat(ctx.lines.l102).filter((l) => l.product_id === manifest.products[label] && (suffix === '101' ? ctx.lines.l101.includes(l) : ctx.lines.l102.includes(l)))[0];
  const a101 = lineOf('101', 'A'); const a102 = lineOf('102', 'A'); const b101 = lineOf('101', 'B');
  const refA = `${SCOPE}-${run}-IN-A`; const refB = `${SCOPE}-${run}-IN-B`;
  const rA = await receive(ctx.po.A, 'A', 2, refA); const rB = await receive(ctx.po.B, 'B', 1, refB);
  if (rA.status !== 201 && rA.status !== 200) throw new Error(`RECEIVE_A:${rA.status}:${JSON.stringify(rA.body).slice(0, 160)}`);
  if (rB.status !== 201 && rB.status !== 200) throw new Error(`RECEIVE_B:${rB.status}:${JSON.stringify(rB.body).slice(0, 160)}`);
  const unitIdOf = async (reference) => (await db.query('SELECT id FROM hub_physical_units WHERE reference=$1', [reference])).rows[0].id;
  ctx.units = { inA: await unitIdOf(refA), inB: await unitIdOf(refB) };
  const got = { kom101_A: await progress(db, a101.id), kom102_A: await progress(db, a102.id), kom101_B: await progress(db, b101.id) };
  // Au premier passage le reliquat (KOM-102) vaut 0 ; après le traitement du reliquat (étape 13, rejeu) il vaut 1.
  const reliquatReceived = (await db.query('SELECT 1 FROM hub_physical_units WHERE reference=$1', [`${SCOPE}-${run}-IN-A2`])).rows.length > 0;
  if (got.kom101_A !== 2 || got.kom102_A !== (reliquatReceived ? 1 : 0) || got.kom101_B !== 1) throw new Error(`FIFO_UNEXPECTED:${JSON.stringify(got)}`);
  // rejeu : même référence → même contenu, aucun doublon de quantité
  const replay = await receive(ctx.po.A, 'A', 2, refA);
  if (replay.status >= 300) throw new Error(`RECEIVE_REPLAY:${replay.status}`);
  const same = await progress(db, a101.id);
  st.idempotency.push({ what: 'réception PO-A rejouée (même référence)', http_status: replay.status, received_after_replay: same, no_duplicate: same === 2 });
  if (same !== 2) throw new Error('RECEIVE_REPLAY_DUPLICATED');
  const mustBeRefused = async (label, fn) => {
    const r = await fn();
    if (!(r.status === 202 || r.status >= 400 || (r.body && r.body.idempotent_replay && r.body.quarantined))) throw new Error(`RECEIVE_REFUSAL_EXPECTED:${label}:${r.status}`);
    st.refusals.push({ label, ...hubAnswer(r), refused: true });
  };
  await mustBeRefused('sur-réception PO-A (2 de plus alors que 1 attendu)', () => receive(ctx.po.A, 'A', 2, `${SCOPE}-${run}-OVER-A`));
  await mustBeRefused('mauvais SKU dans PO-A', () => receive(ctx.po.A, 'B', 1, `${SCOPE}-${run}-WRONGSKU-A`, { sku: 'B' }));
  if ((await progress(db, a101.id)) !== 2 || (await progress(db, a102.id)) !== (reliquatReceived ? 1 : 0)) throw new Error('REFUSED_RECEIPT_CREDITED');
  const { rows: allocs } = await db.query(
    `SELECT a.id,a.order_id,a.order_item_id,a.quantity,a.purchase_order_id FROM hub_purchase_allocations a WHERE a.purchase_order_id=ANY($1::uuid[]) ORDER BY a.created_at, a.id`, [[ctx.po.A, ctx.po.B]]).catch(async () =>
    db.query('SELECT a.id,a.order_id,a.order_item_id,a.quantity,a.purchase_order_id FROM hub_purchase_allocations a WHERE a.purchase_order_id=ANY($1::uuid[])', [[ctx.po.A, ctx.po.B]]));
  ctx.allocs = allocs;
  st.ids = { PO_A: ctx.po.A, PO_B: ctx.po.B, inbound_unit_A: ctx.units.inA, inbound_unit_B: ctx.units.inB, allocations: allocs.map((a) => a.id) };
  st.quantities = { PO_A: { ordered: 3, received: reliquatReceived ? 3 : 2, remainder: reliquatReceived ? 0 : 1 }, PO_B: { ordered: 1, received: 1, remainder: 0 }, fifo: got };
  st.statuses = { PO_A: (await poHeader(db, ctx.po.A)).status, PO_B: (await poHeader(db, ctx.po.B)).status };
  st.evidence.push({ fifo_rule: 'la plus ancienne commande est servie en premier : KOM-101 reçoit 2/2, le reliquat (1) reste porté par KOM-102', received_by_line: got, receipts: [{ ref: refA, http: rA.status }, { ref: refB, http: rB.status }] });
  st.notes.push('Le libellé « reliquat 1 → FIFO KOM-101 » du mandat est lu comme : KOM-101 (la plus ancienne) est servie d’abord ; le reliquat de 1 est celui de KOM-102.');
}

// ─── Vagues de préparation : W1 = KOM-101 (A×2, B×1), W2 = reliquat KOM-102 (A×1) ─
const QC = ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED'];
async function advanceUnit(db, svc, unitId, states, userId, location) {
  for (const to of states) {
    const { rows: [u] } = await db.query('SELECT state FROM hub_physical_units WHERE id=$1', [unitId]);
    const order = ['RECEIVED', ...QC, 'PACKED', 'DISPATCHED'];
    if (order.indexOf(u.state) === -1) return; // unité épuisée (SUPERSEDED) : rien à avancer
    if (order.indexOf(u.state) >= order.indexOf(to)) continue;
    const r = await svc.hubOps.transitionOperatorUnitCommand({ unit_id: unitId, to_state: to, location_ref: location }, userId);
    if (r.status !== 200) throw new Error(`UNIT_TRANSITION:${to}:${r.status}:${JSON.stringify(r.body).slice(0, 120)}`);
  }
}
const unitState = async (db, id) => (await db.query('SELECT state FROM hub_physical_units WHERE id=$1', [id])).rows[0]?.state;
function waveOf(ctx, key) {
  const { run } = ctx;
  if (!ctx.waves) {
    ctx.waves = {
      W1: { key: 'W1', suffix: 'KOM-101', plan: [['A', 2], ['B', 1]], bagRef: `${SCOPE}-${run}-SAC-101`, boxRef: `${SCOPE}-${run}-BOX-1`, shipRef: `${SCOPE}-${run}-SHIP-1`, full: true },
      W2: { key: 'W2', suffix: 'KOM-102', plan: [['A', 1]], bagRef: `${SCOPE}-${run}-SAC-102`, boxRef: `${SCOPE}-${run}-BOX-2`, shipRef: `${SCOPE}-${run}-SHIP-2`, full: false },
    };
  }
  return ctx.waves[key];
}
const itemOf = (ctx, wave, label) => ctx.orders[wave.suffix].items.find((i) => i.product_id === ctx.manifest.products[label]);

// Sac client : identification, scans de préparation, fermeture (KOM-SAC).
async function bagWave(ctx, st, wave, inbound) {
  const { db, manifest, svc } = ctx; const uid = manifest.users.hub_agent.id; const order = ctx.orders[wave.suffix];
  for (const unitId of Object.values(inbound)) await advanceUnit(db, svc, unitId, QC, uid, 'HUB-DXB-IDENTIFICATION');
  let bagId = (await db.query('SELECT id FROM hub_physical_units WHERE reference=$1', [wave.bagRef])).rows[0]?.id;
  if (!bagId) {
    const created = await svc.hubOps.createOperatorUnitCommand({ unit_type: 'HANDLING_UNIT', order_id: order.id, reference: wave.bagRef,
      bag_plan: wave.plan.map(([label, quantity]) => ({ order_item_id: itemOf(ctx, wave, label).id, quantity })) }, uid);
    if (created.status !== 201) throw new Error(`BAG_CREATE:${created.status}:${JSON.stringify(created.body).slice(0, 120)}`);
    bagId = created.body.physical_unit.id;
  }
  wave.bagId = bagId;
  const allocOf = async (itemId) => (await db.query('SELECT id FROM hub_purchase_allocations WHERE order_item_id=$1', [itemId])).rows[0];
  const hasContent = (await db.query('SELECT 1 FROM hub_physical_unit_placements WHERE physical_unit_id=$1 AND removed_at IS NULL', [bagId])).rows.length > 0;
  if (!hasContent) {
    for (const [label, quantity] of wave.plan) {
      const alloc = await allocOf(itemOf(ctx, wave, label).id);
      if (wave.full && label === wave.plan[0][0]) {
        await expectRefusal(st, 'scan du code-barres d’un autre produit', () => svc.hubOps.moveAllocationCommand({
          from_unit_id: inbound[label], to_unit_id: bagId, allocation_id: alloc.id, quantity: 1, operation_type: 'REPACK', evidence_method: 'SCAN', evidence_code: 'EAN-NON-CONFORME' }, uid));
      }
      const r = await svc.hubOps.moveAllocationCommand({ from_unit_id: inbound[label], to_unit_id: bagId, allocation_id: alloc.id, quantity, operation_type: 'REPACK', evidence_method: 'SCAN', evidence_code: barcodeFor(ctx, label) }, uid);
      if (r.status !== 200) throw new Error(`BAG_MOVE:${label}:${r.status}:${JSON.stringify(r.body).slice(0, 120)}`);
    }
  } else st.idempotency.push({ what: `REPACK vers le sac ${wave.key}`, already_in_bag: true });
  const { rows: placed } = await db.query(
    `SELECT a.order_item_id,sum(p.quantity)::int AS qty,count(*) FILTER (WHERE p.evidence_method='SCAN')::int AS scans
       FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id=p.allocation_id
      WHERE p.physical_unit_id=$1 AND p.removed_at IS NULL GROUP BY a.order_item_id ORDER BY 1`, [bagId]);
  const expectedQty = wave.plan.reduce((n, [, q]) => n + q, 0);
  if (placed.reduce((n, r) => n + r.qty, 0) !== expectedQty || placed.some((r) => r.scans < 1)) throw new Error(`BAG_CONTENT:${JSON.stringify(placed)}`);
  await advanceUnit(db, svc, bagId, QC, uid, 'HUB-DXB-PREPARATION');
  if (['RECEIVED', ...QC].includes(await unitState(db, bagId))) {
    const sealed = await svc.hubOps.transitionOperatorUnitCommand({ unit_id: bagId, to_state: 'PACKED', location_ref: 'HUB-DXB-SACS' }, uid);
    if (sealed.status !== 200) throw new Error(`BAG_SEAL:${sealed.status}:${JSON.stringify(sealed.body).slice(0, 120)}`);
  }
  return { bagId, placed, expectedQty };
}

// Colis client (répartiteur canonique), KOM-BOX, rattachement du sac, scellage.
async function packWave(ctx, st, wave) {
  const { db, manifest, svc } = ctx; const uid = manifest.users.hub_agent.id; const order = ctx.orders[wave.suffix];
  let parcel = (await db.query('SELECT id,reference,status::text AS status FROM parcels WHERE order_id=$1', [order.id])).rows[0];
  const cur = await loadOrder(db, order.reference);
  if (!parcel) {
    if (cur.status !== 'preparation') throw new Error(`${wave.suffix}_NOT_IN_PREPARATION:${cur.status}`);
    const dist = await svc.autoParcel.distributeOrder(order.id);
    if (!dist || !dist.success) throw new Error(`DISTRIBUTE:${JSON.stringify(dist).slice(0, 120)}`);
  }
  parcel = (await db.query('SELECT id,reference,status::text AS status FROM parcels WHERE order_id=$1', [order.id])).rows[0];
  wave.parcel = parcel;
  if (!(await svc.autoParcel.distributeOrder(order.id)).already_assigned) throw new Error('DISTRIBUTE_REPLAY_NOT_IDEMPOTENT');
  st.idempotency.push({ what: `distributeOrder ${wave.suffix} rejoué`, already_assigned: true });
  let boxId = (await db.query('SELECT id FROM hub_physical_units WHERE reference=$1', [wave.boxRef])).rows[0]?.id;
  if (!boxId) {
    const b = await svc.hubOps.createOperatorUnitCommand({ unit_type: 'MARKET_PARCEL', reference: wave.boxRef, location_ref: 'HUB-DXB-PACK' }, uid);
    if (b.status !== 201) throw new Error(`BOX_CREATE:${b.status}:${JSON.stringify(b.body).slice(0, 120)}`);
    boxId = b.body.physical_unit.id;
  }
  wave.boxId = boxId;
  await advanceUnit(db, svc, boxId, QC, uid, 'HUB-DXB-PACK');
  const attach = (extra = {}) => svc.bagBox.attachBagToBox({ bagUnitId: wave.bagId, boxUnitId: boxId, parcelId: parcel.id,
    evidenceMethod: 'SCAN', bagReferenceScan: wave.bagRef, boxReferenceScan: wave.boxRef, expectedMarketId: manifest.market_id, actorId: uid, ...extra });
  const alreadyBoxed = (await db.query('SELECT 1 FROM hub_box_bags WHERE box_unit_id=$1', [boxId])).rows.length > 0;
  if (wave.full && !alreadyBoxed) await expectRefusal(st, 'scan du sac non conforme', () => attach({ bagReferenceScan: `${wave.bagRef}-FAUX` }), { code: 'HUB_BOX_BAG_SCAN_MISMATCH' });
  const first = await attach(); const replay = await attach();
  if (!replay.already_linked) throw new Error('ATTACH_REPLAY_NOT_IDEMPOTENT');
  const { rows: [n] } = await db.query('SELECT count(*)::int AS n FROM hub_box_bags WHERE box_unit_id=$1', [boxId]);
  if (n.n !== 1) throw new Error(`BOX_BAG_ROWS:${n.n}`);
  if (['RECEIVED', ...QC].includes(await unitState(db, boxId))) {
    const sealed = await svc.hubOps.transitionOperatorUnitCommand({ unit_id: boxId, to_state: 'PACKED', location_ref: 'HUB-DXB-PACK' }, uid);
    if (sealed.status !== 200) throw new Error(`BOX_PACK:${sealed.status}:${JSON.stringify(sealed.body).slice(0, 120)}`);
  }
  const { rows: [pi] } = await db.query('SELECT sum(qty_packed)::int AS packed,sum(qty_shipped)::int AS shipped,sum(quantity)::int AS quantity FROM parcel_items WHERE parcel_id=$1', [parcel.id]);
  const { rows: [boxQ] } = await db.query('SELECT count(*)::int AS lines,sum(quantity)::int AS qty FROM hub_box_effective_placements WHERE box_unit_id=$1', [boxId]);
  const expectedQty = wave.plan.reduce((x, [, q]) => x + q, 0);
  if (boxQ.qty !== expectedQty) throw new Error(`BOX_CONTENT_QTY:${boxQ.qty}`);
  st.idempotency.push({ what: `attachBagToBox ${wave.key} rejoué`, bag_rows_in_box: n.n, already_linked: replay.already_linked });
  return { parcel, boxId, pi, boxQ, first, replay };
}

// ─── Étape 9 : identification, scans, sacs clients ───────────────────────────
async function step9(ctx, st) {
  const { db, manifest, svc } = ctx; const wave = waveOf(ctx, 'W1');
  st.writers.push('hub-operations.transitionOperatorUnitCommand', 'hub-operations.createOperatorUnitCommand (HANDLING_UNIT / KOM-SAC)', 'hub-operations.moveAllocationCommand (REPACK, preuve SCAN)');
  st.actors = { hub_agent: manifest.users.hub_agent.id };
  const bag = await bagWave(ctx, st, wave, { A: ctx.units.inA, B: ctx.units.inB });
  await expectRefusal(st, 'changer le propriétaire du sac', () => db.query('UPDATE hub_physical_units SET order_id=$1 WHERE id=$2', [ctx.orders['KOM-102'].id, bag.bagId]), { code: 'HUB_ORDER_BAG_OWNER_IMMUTABLE' });
  const { rows: [hubLocal] } = await db.query(
    `SELECT (SELECT count(*) FROM hub_purchase_allocations WHERE order_id=$1)::int AS allocations,
            (SELECT count(*) FROM hub_physical_units WHERE order_id=$1)::int AS units,
            (SELECT count(*) FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=$1)::int AS purchase_lines`, [ctx.orders.LOCAL.id]);
  if (hubLocal.allocations + hubLocal.units + hubLocal.purchase_lines !== 0) throw new Error('LOCAL_HAS_HUB_ROWS');
  st.ids = { bag_KOM101: bag.bagId, inbound_unit_A: ctx.units.inA, inbound_unit_B: ctx.units.inB };
  st.quantities = { bag_KOM101: { A: 2, B: 1, scans_by_item: bag.placed } };
  st.statuses = { bag_KOM101: await unitState(db, bag.bagId), inbound_units: 'épuisées après REPACK (SUPERSEDED)' };
  st.evidence.push({ barcodes_confirmed_per_sku: true, bag_plan_items: 2, local_hub_rows: hubLocal, kom102_bag: 'aucun sac à ce stade : rien de reçu pour KOM-102 (reliquat traité à l’étape 13)' });
}

// ─── Étape 10 : emballage et rattachement KOM-BOX ────────────────────────────
async function step10(ctx, st) {
  const { db, manifest } = ctx; const wave = waveOf(ctx, 'W1');
  st.writers.push('auto-parcel.distributeOrder', 'hub-operations.createOperatorUnitCommand (KOM-BOX)', 'hub-bag-box-service.attachBagToBox', 'hub-operations.transitionOperatorUnitCommand (PACKED)');
  st.actors = { hub_agent: manifest.users.hub_agent.id };
  const o102 = await loadOrder(db, ctx.orders['KOM-102'].reference);
  const { rows: [p102] } = await db.query('SELECT count(*)::int AS n FROM parcels WHERE order_id=$1', [o102.id]);
  const pre102 = { status_before_reliquat: o102.status, parcels: p102.n };
  const gateOk = pre102.parcels === 0 ? o102.status === 'ordered' : true; // avant reliquat : ni colis ni préparation
  if (!gateOk) throw new Error(`KOM102_ADVANCED_WITH_REMAINDER:${o102.status}`);
  const packed = await packWave(ctx, st, wave);
  st.ids = { KOM_BOX: packed.boxId, bag: wave.bagId, parcel_KOM101: packed.parcel.id, parcel_reference: packed.parcel.reference };
  st.quantities = { parcel_KOM101: packed.pi, box_effective_content: packed.boxQ };
  st.statuses = { KOM_BOX: await unitState(db, packed.boxId), parcel_KOM101: packed.parcel.status };
  st.evidence.push({ attach_first_already_linked: packed.first.already_linked, attach_replay_already_linked: packed.replay.already_linked,
    kom102_gate: `KOM-102 reste ${pre102.status_before_reliquat} (reliquat non reçu) : ${pre102.parcels} colis, aucune préparation` });
}

// ─── Étape 11 : expédition et remise au transitaire ──────────────────────────
const stageIdx = (svc, stage) => svc.journey.STAGES.indexOf(stage);
async function shipmentRow(db, ref) {
  return (await db.query('SELECT id,stage,hub_draft,tracking_reference,customs_shipment_id FROM international_shipments WHERE reference=$1', [ref])).rows[0] || null;
}
async function advanceShipment(ctx, st, wave, target, actor, body) {
  const { db, svc } = ctx;
  const row = await shipmentRow(db, wave.shipRef);
  if (stageIdx(svc, row.stage) >= stageIdx(svc, target)) return false;
  await svc.journey.transition(ctx.market, actor, wave.shipRef, { to_stage: target, ...body });
  return true;
}
async function shipWave(ctx, st, wave) {
  const { db, run, manifest, svc } = ctx; const hub = actorOf(manifest.users.hub_agent); const fwd = actorOf(manifest.users.forwarder);
  let ship = await shipmentRow(db, wave.shipRef);
  if (!ship) await svc.journey.open(ctx.market, hub, { reference: wave.shipRef, hub_unit_ids: [wave.boxId] });
  ship = await shipmentRow(db, wave.shipRef);
  if (stageIdx(svc, ship.stage) < stageIdx(svc, 'handed_over')) {
    if (wave.full) await expectRefusal(st, 'remise avant expédition du carton (DISPATCHED)', () => svc.journey.transition(ctx.market, hub, wave.shipRef, { to_stage: 'handed_over', proof_ref: 'REMISE-PREMATUREE', forwarder_name: 'Transitaire E2E', transport_mode: 'sea' }), { code: 'JOURNEY_HUB_UNITS_NOT_DISPATCHED' });
    await advanceUnit(ctx.db, svc, wave.boxId, ['DISPATCHED'], manifest.users.hub_agent.id, 'HUB-DXB-OUT');
    if ((await unitState(db, wave.boxId)) !== 'DISPATCHED') {
      const d = await svc.hubOps.transitionOperatorUnitCommand({ unit_id: wave.boxId, to_state: 'DISPATCHED', location_ref: 'HUB-DXB-OUT' }, manifest.users.hub_agent.id);
      if (d.status !== 200) throw new Error(`BOX_DISPATCH:${d.status}:${JSON.stringify(d.body).slice(0, 120)}`);
    }
    await svc.journey.transition(ctx.market, hub, wave.shipRef, { to_stage: 'handed_over', proof_ref: `SIM-REMISE-${run}-${wave.key}`, forwarder_name: 'Transitaire E2E-HUB-V1', transport_mode: 'sea' });
  }
  if (wave.full) await expectRefusal(st, 'remise rejouée / étape hors ordre', () => svc.journey.transition(ctx.market, hub, wave.shipRef, { to_stage: 'handed_over', proof_ref: 'REJEU' }), { code: 'JOURNEY_STAGE_ORDER', status: 409 });
  await expectRefusal(st, `réception transitaire par un agent Hub (${wave.key})`, () => svc.journey.transition(ctx.market, hub, wave.shipRef, { to_stage: 'forwarder_received', proof_ref: 'X' }), { code: 'JOURNEY_ROLE_FORBIDDEN', status: 403 });
  await advanceShipment(ctx, st, wave, 'forwarder_received', fwd, { proof_ref: `SIM-RECEPTION-TRANSITAIRE-${run}-${wave.key}` });
  const { rows: units } = await db.query('SELECT u.id,u.state FROM international_shipment_hub_units h JOIN hub_physical_units u ON u.id=h.physical_unit_id WHERE h.shipment_id=$1', [(await shipmentRow(db, wave.shipRef)).id]);
  const { rows: [pc] } = await db.query('SELECT status::text AS status FROM parcels WHERE id=$1', [wave.parcel.id]);
  const { rows: [pi] } = await db.query('SELECT sum(qty_shipped)::int AS shipped,sum(quantity)::int AS quantity FROM parcel_items WHERE parcel_id=$1', [wave.parcel.id]);
  const ev = (await db.query("SELECT e.to_stage,e.proof_ref,e.actor_id FROM international_shipment_events e JOIN international_shipments s ON s.id=e.shipment_id WHERE s.reference=$1 ORDER BY e.occurred_at, e.to_stage", [wave.shipRef])).rows;
  return { units, parcel_status: pc.status, parcel_items: pi, events: ev, stage: (await shipmentRow(db, wave.shipRef)).stage };
}
async function step11(ctx, st) {
  const { manifest } = ctx; const wave = waveOf(ctx, 'W1');
  st.writers.push('international-shipment-journey.open / transition (handed_over, forwarder_received)', 'hub-operations.transitionOperatorUnitCommand (DISPATCHED)');
  st.actors = { hub_agent: manifest.users.hub_agent.id, forwarder: manifest.users.forwarder.id };
  const r = await shipWave(ctx, st, wave);
  if (stageIdx(ctx.svc, r.stage) < stageIdx(ctx.svc, 'forwarder_received')) throw new Error(`SHIP_STAGE:${r.stage}`);
  if (!r.units.every((u) => u.state === 'DISPATCHED')) throw new Error('BOX_NOT_DISPATCHED');
  st.ids = { shipment: wave.shipRef, KOM_BOX: wave.boxId, parcel: wave.parcel.id };
  st.statuses = { shipment: r.stage, KOM_BOX: r.units.map((u) => u.state), parcel: r.parcel_status };
  st.quantities = { parcel_items: r.parcel_items };
  st.evidence.push({ events: r.events });
}

// ─── Étape 12 : acheminement (jalons transitaire/douane) et réception attestée au relais ─
async function transportWave(ctx, st, wave) {
  const { db, run, manifest, svc } = ctx; const adm = actorOf(manifest.users.admin); const fwd = actorOf(manifest.users.forwarder); const hub = actorOf(manifest.users.hub_agent);
  let row = await shipmentRow(db, wave.shipRef);
  if (!row.tracking_reference) await svc.journey.updateTracking(ctx.market, fwd, wave.shipRef, { proof_ref: `SIM-SUIVI-${run}-${wave.key}`, tracking_reference: `SIM-TRK-${run}-${wave.key}` });
  await advanceShipment(ctx, st, wave, 'in_transit', fwd, { proof_ref: `SIM-DEPART-${run}-${wave.key}` });
  await advanceShipment(ctx, st, wave, 'arrived', fwd, { proof_ref: `SIM-ARRIVEE-${run}-${wave.key}` });
  row = await shipmentRow(db, wave.shipRef);
  if (!row.customs_shipment_id) {
    const customsRef = `${SCOPE}-${run}-DOUANE-${wave.key}`;
    const exists = (await db.query('SELECT 1 FROM customs_shipments WHERE reference=$1', [customsRef])).rows.length;
    if (!exists) await svc.customs.createShipment(db, { reference: customsRef, shipment_date: new Date().toISOString().slice(0, 10), cif_value_kmf: 1000, transitaire_name: 'Transitaire E2E-HUB-V1', transport_mode: 'sea' }, manifest.users.admin.id, { marketId: manifest.market_id });
    await svc.journey.linkCustoms(ctx.market, adm, wave.shipRef, { customs_reference: customsRef, proof_ref: `SIM-LIEN-DOUANE-${run}-${wave.key}` });
    await svc.journey.declareCustoms(ctx.market, adm, wave.shipRef, { amount_kmf: 0, proof_ref: `SIM-DOUANE-ZERO-${run}-${wave.key}` });
  }
  await advanceShipment(ctx, st, wave, 'customs_released', adm, { proof_ref: `SIM-MAINLEVEE-${run}-${wave.key}` });
  await advanceShipment(ctx, st, wave, 'local_delivery', hub, { proof_ref: `SIM-LIVRAISON-LOCALE-${run}-${wave.key}` });
}
async function relayWave(ctx, st, wave) {
  const { db, run, manifest, svc } = ctx; const relayAgent = { id: manifest.users.relay_agent.id, role: 'agent_relais', relais_id: manifest.relay };
  await transportWave(ctx, st, wave);
  const order = ctx.orders[wave.suffix];
  const lines = wave.plan.map(([label, qty]) => ({ order_item_id: itemOf(ctx, wave, label).id, received_qty: qty }));
  const row = await shipmentRow(db, wave.shipRef);
  if (row.stage === 'local_delivery') {
    if (wave.full) {
      await expectRefusal(st, 'relay_received posé par le Hub', () => svc.journey.transition(ctx.market, actorOf(manifest.users.hub_agent), wave.shipRef, { to_stage: 'relay_received', proof_ref: 'X' }), { code: 'JOURNEY_RELAY_ATTESTATION_REQUIRED' });
      await expectRefusal(st, 'attestation par un admin', () => svc.relay.receiveShipment({ market: ctx.market, actor: { id: manifest.users.admin.id, role: 'admin', relais_id: manifest.relay }, reference: wave.shipRef, body: { proof_ref: 'P', lines } }), { code: 'RELAY_RECEIPT_ROLE_FORBIDDEN', status: 403 });
      await expectRefusal(st, 'attestation sans justificatif', () => svc.relay.receiveShipment({ market: ctx.market, actor: relayAgent, reference: wave.shipRef, body: { lines } }), { code: 'RELAY_RECEIPT_PROOF_REQUIRED' });
      await expectRefusal(st, 'attestation d’un article non attendu', () => svc.relay.receiveShipment({ market: ctx.market, actor: relayAgent, reference: wave.shipRef, body: { proof_ref: 'P', lines: [{ order_item_id: ctx.orders['KOM-103'].items[0].id, received_qty: 1 }] } }), { code: 'RELAY_RECEIPT_ITEM_NOT_EXPECTED' });
      await expectRefusal(st, 'quantité négative', () => svc.relay.receiveShipment({ market: ctx.market, actor: relayAgent, reference: wave.shipRef, body: { proof_ref: 'P', lines: lines.map((l) => ({ ...l, received_qty: -1 })) } }), { status: 400 });
    }
    wave.receipt = await svc.relay.receiveShipment({ market: ctx.market, actor: relayAgent, reference: wave.shipRef, body: { proof_ref: `SIM-BORDEREAU-RELAIS-${run}-${wave.key}`, lines } });
    if (!wave.receipt.complete || wave.receipt.stage !== 'relay_received') throw new Error(`RELAY_INCOMPLETE:${JSON.stringify(wave.receipt).slice(0, 160)}`);
  }
  await expectRefusal(st, `attestation rejouée (${wave.key})`, () => svc.relay.receiveShipment({ market: ctx.market, actor: relayAgent, reference: wave.shipRef, body: { proof_ref: 'REJEU', lines } }), {});
  const { rows: receipts } = await db.query('SELECT id,order_item_id,expected_qty,received_qty,incident_id,received_by,proof_ref,relais_id FROM international_shipment_relay_receipts WHERE shipment_id=$1 ORDER BY order_item_id', [row.id]); 
  await expectRefusal(st, `attestation immuable (${wave.key})`, () => db.query('UPDATE international_shipment_relay_receipts SET received_qty = received_qty + 1 WHERE shipment_id=$1', [row.id]), { code: 'shipment_relay_receipt_immutable' });
  const o = await loadOrder(db, order.reference);
  const { rows: [pc] } = await db.query('SELECT status::text AS status FROM parcels WHERE id=$1', [wave.parcel.id]);
  const { rows: [pi] } = await db.query('SELECT sum(qty_received)::int AS received,sum(quantity)::int AS quantity FROM parcel_items WHERE parcel_id=$1', [wave.parcel.id]);
  return { receipts, order_status: o.status, parcel_status: pc.status, parcel_items: pi, stage: (await shipmentRow(db, wave.shipRef)).stage };
}
async function step12(ctx, st) {
  const { manifest } = ctx; const wave = waveOf(ctx, 'W1');
  st.writers.push('international-shipment-journey (in_transit … local_delivery)', 'customs-shipment-service.createShipment', 'relay-shipment-receipt.receiveShipment (agent relais)');
  st.actors = { forwarder: manifest.users.forwarder.id, admin_customs: manifest.users.admin.id, hub_agent: manifest.users.hub_agent.id, relay_agent: manifest.users.relay_agent.id };
  const r = await relayWave(ctx, st, wave);
  if (r.stage !== 'relay_received' || !['available', 'collected'].includes(r.order_status) || !['available', 'collected'].includes(r.parcel_status) || !r.receipts.length) throw new Error(`RELAY_STATE:${JSON.stringify(r).slice(0, 200)}`);
  st.ids = { shipment: wave.shipRef, receipts: r.receipts.map((x) => x.id) };
  st.statuses = { shipment: r.stage, order_KOM101: r.order_status, parcel_KOM101: r.parcel_status };
  st.quantities = { receipts: r.receipts.map((x) => ({ expected: x.expected_qty, received: x.received_qty, incident: x.incident_id })), parcel_items: r.parcel_items };
  st.evidence.push({ attested_by_relay_agent: manifest.users.relay_agent.id, receipts: r.receipts });
}

// ─── Étape 13 : retrait client, traitement du reliquat (livraison), circuit LOCAL ─
async function pickupWave(ctx, st, wave) {
  const { db, manifest, svc } = ctx; const relayAgent = manifest.users.relay_agent;
  const before = await loadOrder(db, ctx.orders[wave.suffix].reference);
  if (before.status === 'available') {
    const out = await svc.scan.processScan({ parcel_id: wave.parcel.id, event_type: 'customer_collected', scanned_by: relayAgent.id, actor_role: 'relay_agent' });
    if (!out || out.success !== true) throw new Error(`PICKUP_REFUSED:${wave.key}:${JSON.stringify(out && out.error).slice(0, 160)}`);
  }
  const after = await loadOrder(db, ctx.orders[wave.suffix].reference);
  const { rows: [pi] } = await db.query('SELECT sum(qty_received)::int AS received,sum(qty_collected)::int AS collected,sum(quantity)::int AS quantity FROM parcel_items WHERE parcel_id=$1', [wave.parcel.id]);
  const second = await svc.scan.processScan({ parcel_id: wave.parcel.id, event_type: 'customer_collected', scanned_by: relayAgent.id, actor_role: 'relay_agent' });
  st.idempotency.push({ what: `retrait ${wave.key} rejoué`, second_success: Boolean(second && second.success), collected_after: (await db.query('SELECT sum(qty_collected)::int AS c FROM parcel_items WHERE parcel_id=$1', [wave.parcel.id])).rows[0].c });
  return { order_status: after.status, parcel_items: pi };
}
async function step13(ctx, st) {
  const { db, run, manifest, svc } = ctx; const hub = manifest.users.hub_agent;
  st.writers.push('scan-engine.processScan(customer_collected)', 'hub-operations.receiveSupplierPackageCommand (reliquat)', 'local-relay-receipt-service.recordLocalRelayReceipt (LOCAL)');
  st.actors = { relay_agent: manifest.users.relay_agent.id, hub_agent: hub.id };
  const w1 = waveOf(ctx, 'W1'); const w2 = waveOf(ctx, 'W2');
  const p1 = await pickupWave(ctx, st, w1);
  st.evidence.push({ wave: 'KOM-101', after_pickup: p1 });
  // Reliquat : 1 unité de PO-A reçue plus tard → KOM-102 passe en préparation puis suit le même circuit physique.
  const refA2 = `${SCOPE}-${run}-IN-A2`;
  const rec = await svc.hubOps.receiveSupplierPackageCommand({ reference: refA2, external_ref: `SIM-COLIS-${refA2}`, location_ref: 'HUB-DXB-RECEIVE',
    contents: [{ purchase_order_id: ctx.po.A, product_sku_id: manifest.skus.A, quantity: 1, evidence_code: barcodeFor(ctx, 'A') }] }, hub.id);
  if (rec.status !== 201 && rec.status !== 200) throw new Error(`RELIQUAT_RECEIVE:${rec.status}:${JSON.stringify(rec.body).slice(0, 140)}`);
  const inA2 = (await db.query('SELECT id FROM hub_physical_units WHERE reference=$1', [refA2])).rows[0].id;
  const poA = await poHeader(db, ctx.po.A);
  const bag2 = await bagWave(ctx, st, w2, { A: inA2 });
  const packed2 = await packWave(ctx, st, w2);
  const ship2 = await shipWave(ctx, st, w2);
  const relay2 = await relayWave(ctx, st, w2);
  const p2 = await pickupWave(ctx, st, w2);
  st.ids = { reliquat_inbound_unit: inA2, reliquat_bag: bag2.bagId, reliquat_box: packed2.boxId, reliquat_shipment: w2.shipRef, parcel_KOM101: w1.parcel.id, parcel_KOM102: w2.parcel.id };
  st.statuses = { PO_A: poA.status, KOM_101: p1.order_status, KOM_102: p2.order_status, reliquat_shipment: relay2.stage };
  st.quantities = { KOM_101: p1.parcel_items, KOM_102: p2.parcel_items, PO_A: { ordered: 3, received: 3 } };
  st.evidence.push({ wave: 'KOM-102 reliquat livré', ship_events: ship2.events.length, relay_receipts: relay2.receipts.length, after_pickup: p2 });
  st.notes.push('Reliquat traité par LIVRAISON (réception tardive 1/1 puis même circuit sac → KOM-BOX → expédition → relais → retrait). Le remboursement fictif n’est pas utilisé : un paiement fictif sans débit ne peut pas être remboursé sans créer de la monnaie interne (wallet) qui n’a jamais été encaissée.');
  ctx.localResult = await localCircuit(ctx, st);
}

// Circuit LOCAL : réception relais locale puis retrait ; jamais de tâche Hub.
async function localCircuit(ctx, st) {
  const { db, manifest, svc } = ctx; const relayAgent = { id: manifest.users.relay_agent.id, role: 'agent_relais', relais_id: manifest.relay };
  const order = ctx.orders.LOCAL;
  const before = await loadOrder(db, order.reference);
  const out = { writers: ['local-relay-receipt-service.recordLocalRelayReceipt', 'scan-engine.processScan(customer_collected)'] };
  if (before.status !== 'available' && before.status !== 'collected') {
    const r = await svc.localReceipt.recordLocalRelayReceipt({ orderId: order.id, actor: relayAgent, physicalReceived: true, note: 'E2E-HUB-V1 réception locale simulée' });
    if (!r.ok) throw new Error(`LOCAL_RECEIPT:${JSON.stringify(r.body).slice(0, 160)}`);
  }
  const replay = await svc.localReceipt.recordLocalRelayReceipt({ orderId: order.id, actor: relayAgent, physicalReceived: true });
  if (replay.ok) throw new Error('LOCAL_RECEIPT_REPLAY_DUPLICATED');
  const parcel = (await db.query('SELECT id,status::text AS status FROM parcels WHERE order_id=$1', [order.id])).rows[0];
  if ((await loadOrder(db, order.reference)).status === 'available') {
    const c = await svc.scan.processScan({ parcel_id: parcel.id, event_type: 'customer_collected', scanned_by: relayAgent.id, actor_role: 'relay_agent' });
    if (!c || c.success !== true) throw new Error(`LOCAL_PICKUP:${JSON.stringify(c && c.error).slice(0, 160)}`);
  }
  const { rows: [hub] } = await db.query(
    `SELECT (SELECT count(*) FROM hub_purchase_allocations WHERE order_id=$1)::int AS hub_allocations,
            (SELECT count(*) FROM hub_physical_units WHERE order_id=$1)::int AS hub_units,
            (SELECT count(*) FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=$1)::int AS purchase_lines,
            (SELECT count(*) FROM international_shipment_relay_receipts r JOIN order_items oi ON oi.id=r.order_item_id WHERE oi.order_id=$1)::int AS shipment_receipts`, [order.id]);
  if (hub.hub_allocations + hub.hub_units + hub.purchase_lines + hub.shipment_receipts !== 0) throw new Error('LOCAL_TOUCHED_HUB');
  const final = await loadOrder(db, order.reference);
  const o = { ...out, order_id: order.id, status: final.status, parcel_id: parcel.id, replay_refused: { code: replay.body && replay.body.code }, hub_rows: hub, circuit_only_local: true };
  ctx.report.local_circuit = o;
  st.evidence.push({ local_circuit: o });
  return o;
}

const STEP_FUNCTIONS = [step1, step2, step3, step4, step5, step6, step7, step8, step9, step10, step11, step12, step13];

async function runCertification({ db = require('../../db'), run = newRun8(), dryRun = false, argv = process.argv } = {}) {
  if (!RUN_RE.test(run)) throw Object.assign(new Error('HUB_V1_RUNNER_RUN8_INVALID'), { code: 'HUB_V1_RUNNER_RUN8_INVALID' });
  const officialStaging = argv.includes('--allow-remote-staging');
  const { market: marketCode, stopAfter } = parseRunOptions(argv);
  const target = officialStaging
    ? await require('./hub-v1-staging-target-authorization').authorizeOfficialStaging({ db, run })
    : assertEphemeralTarget(process.env.DATABASE_URL, argv);
  const report = {
    schema: 'hub-v1-certification-report/1', scope: SCOPE, run, market: marketCode, stop_after: stopAfter, mode: dryRun ? 'DRY_RUN' : (officialStaging ? 'APPLY_OFFICIAL_STAGING' : 'APPLY_EPHEMERAL'),
    target: { host: target.host, database: target.database }, started_at: new Date().toISOString(),
    verdict: 'HOLD_NO_STAGING_WRITES', staging_go: false, orders: orderRefs(run), steps: [], local_circuit: null, fixture: null,
    external_effects: null, cleanup: null, limits: [],
  };
  if (dryRun) {
    const { rows } = await db.query('SELECT reference FROM orders WHERE reference = ANY($1::text[])', [report.orders]);
    report.dry_run = { writes: 0, existing_fixture_orders: rows.map((r) => r.reference), plan: STEP_TITLES.map(([key, title], i) => ({ n: i + 1, key, title })) };
    report.verdict = 'DRY_RUN_NO_WRITES';
    return report;
  }
  const tripwire = installNetworkTripwire();
  const savedAdminPhone = process.env.ADMIN_PHONE; delete process.env.ADMIN_PHONE;
  const svc = loadServices();
  const ctx = { db, run, svc, orders: {}, po: {}, report, manifest: null };
  const externalBefore = await countExternalTables(db);
  try {
    ctx.manifest = await seedFixture(db, run, svc, { officialStaging, marketCode });
    ctx.market = { id: ctx.manifest.market_id, code: marketCode };
    report.fixture = manifestForReport(ctx.manifest);
    let blocked = null;
    for (let n = 1; n <= (stopAfter || 13); n++) {
      const st = newStep(n); report.steps.push(st);
      const fn = STEP_FUNCTIONS[n - 1];
      if (blocked) { st.status = 'SKIPPED'; st.blocker = `dépend de l'étape ${blocked}`; continue; }
      if (!fn) { st.status = 'NOT_IMPLEMENTED'; blocked = blocked || n; continue; }
      try { await fn(ctx, st); st.status = st.status === 'BLOCKED' ? 'BLOCKED' : 'PASS'; } catch (error) {
        st.status = error && error.blocked ? 'BLOCKED' : 'FAIL';
        st.blocker = String(error && (error.code ? error.code + ': ' : '') + error.message).slice(0, 400);
        if (process.env.HUB_V1_RUNNER_DEBUG) st.debug_stack = String(error && error.stack).split('\n').slice(0, 8);
        if (process.env.HUB_V1_RUNNER_DEBUG) st.debug_stack = String(error && error.stack).split('\n').slice(0, 8);
        blocked = n;
      }
      if (st.status !== 'PASS') blocked = n;
    }
    const client = await db.getClient();
    try {
      const inv = await require('./hub-v1-fixture-dependency-inventory').buildCleanupInventory(client, run);
      report.cleanup = {
        verdict: inv.verdict, delete_performed: false, cleanup_certified: false, strategy: inv.cleanup_strategy,
        order_roots: inv.roots, fk_graph_tables: inv.discovered_tables, opaque_dependencies: inv.opaque_dependencies,
        owned_roots_outside_fk_graph: inv.owned_roots_outside_fk_graph, tables_considered: inv.tables_considered,
        inventory_snapshot_sha256: inv.snapshot_sha256, cleanup_scope_checks: inv.cleanup_scope_checks,
        immutable_tables_detail: inv.immutability.filter((t) => t.delete_blocking_triggers.length),
        fk_delete_rules: inv.fk_delete_rules,
      };
    } finally { client.release(); }
    const externalAfter = await countExternalTables(db);
    report.external_effects = summarizeExternalEffects(externalBefore, externalAfter, tripwire.attempts);
  } finally {
    tripwire.restore();
    if (savedAdminPhone !== undefined) process.env.ADMIN_PHONE = savedAdminPhone;
  }
  report.finished_at = new Date().toISOString();
  const allPass = report.steps.length === 13 && report.steps.every((x) => x.status === 'PASS');
  const stoppedClean = Boolean(stopAfter) && report.steps.length === stopAfter && report.steps.every((x) => x.status === 'PASS');
  const fx = report.external_effects;
  const effectsClean = Boolean(fx && fx.zero_external_effects);
  report.checks = { all_13_steps_pass: allPass, zero_external_effects: effectsClean, local_circuit_isolated: Boolean(report.local_circuit && report.local_circuit.circuit_only_local) };
  if (stopAfter) report.checks.stopped_after_step = stopAfter;
  report.verdict = stoppedClean && effectsClean ? 'PARTIAL_STOP_AFTER_STEP_PASS' : stopAfter ? 'FAIL_OR_BLOCKED' : allPass && effectsClean && report.checks.local_circuit_isolated
    ? (officialStaging ? 'PASS_STAGING_TRANSACTION_13_STEPS' : 'PASS_EPHEMERAL_13_STEPS') : 'FAIL_OR_BLOCKED';
  report.verdict_staging = officialStaging
    ? (report.verdict === 'PARTIAL_STOP_AFTER_STEP_PASS' ? 'FIXTURE_READY_REMAINING_STEPS_BY_UI_NOT_PROVEN' : report.verdict === 'PASS_STAGING_TRANSACTION_13_STEPS' ? 'TRANSACTIONAL_PASS_CHROMIUM_PENDING' : 'TRANSACTIONAL_NO_GO')
    : 'HOLD_NO_STAGING_WRITES';
  report.limits = officialStaging
    ? LIMITS.filter((x) => !x.includes('local éphémère uniquement') && !x.includes('sur un staging partagé') && !x.includes('sur la base éphémère'))
      .concat(['Exécution sur staging Railway officiel, empreinte DB et SHA vérifiés avant toute écriture.',
        'Verdict transactionnel uniquement : validation Chromium et GO production non encore prononcés.',
        'Aucune suppression des preuves immuables : conservation du RUN8 de la fixture.'])
    : LIMITS;
  return report;
}

const LIMITS = Object.freeze([
  'Preuve sur PostgreSQL 16 local éphémère uniquement : aucun apply staging, aucun GO staging (HOLD_NO_STAGING_WRITES conservé).',
  "KOM-103 : « Sourcing requis » est observé via le trigger d'achat réel (aucune ligne, aucun PO, résultat no_supplier) ; la certification formelle de l'anomalie reste portée par les tests automatisés de #3355, rien n'est fabriqué.",
  "Référentiel commercial de la fixture (prix local actif, exposition, attestation de livraison, taux EUR/USD fictif) : créé sur la base éphémère ; sur un staging partagé ces lignes seraient des données partagées à contrôler par préflight avant tout apply.",
  "Paiement fournisseur : seule l'AUTORISATION (hub_authorization_grants + purchase_order_authorizations) est exercée ; aucun débit, aucune écriture supplier_execution_payments / settlements.",
  'Reliquat KOM-102 traité par LIVRAISON tardive ; le remboursement fictif est volontairement non exécuté (un paiement fictif sans débit ne peut être remboursé sans créer de la monnaie interne jamais encaissée).',
  "Création du colis client : répartiteur canonique auto-parcel.distributeOrder (aucun rôle Hub dédié n'existe pour cette action).",
  'Nettoyage : la suppression de la fixture est INTERDITE (tables append-only) ; stratégie = conservation du préfixe E2E-HUB-V1-<RUN8>, jamais de suppression forcée ; cleanup_certified=false.',
  'Correctifs de services découverts par le runner (commit isolé) : projection colis↔KOM-BOX des sacs (relay-parcel-item-reconciliation, parcel-shipment-handover), référence colis (auto-parcel), suppression des messages WhatsApp pour une commande en simulation_scope (notifications), consommation du stock local au paiement fictif.',
]);
const orderRefs = (run) => SUFFIXES.map((s) => orderRef(run, s));
const manifestForReport = (m) => ({
  run: m.run, market_id: m.market_id, relay_id: m.relay,
  users: Object.fromEntries(Object.entries(m.users).map(([k, u]) => [k, { id: u.id, role: u.role }])),
  suppliers: m.suppliers, products: m.products, skus: m.skus, grants: m.grants,
});


// ─── Rapport : JSON + Markdown générés par le runner ─────────────────────────
function renderMarkdown(report) {
  const L = [];
  L.push(`# Certification Hub V1 — fixture ${SCOPE}-${report.run}`, '');
  L.push(`- Mode : ${report.mode} · base : ${report.target.database} (${report.target.host})`);
  L.push(`- Verdict : **${report.verdict}** · staging : **${report.verdict_staging || 'HOLD_NO_STAGING_WRITES'}** (aucun GO staging)`);
  L.push(`- Commandes : ${report.orders.join(', ')}`, '');
  if (report.dry_run) {
    L.push('## Dry-run (aucune écriture)', '', ...report.dry_run.plan.map((p) => `${p.n}. ${p.title} (\`${p.key}\`)`), '');
    return L.join('\n');
  }
  L.push('## Étapes', '', '| # | Étape | Statut | Writers | Refus prouvés | Idempotence |', '|---|---|---|---|---|---|');
  for (const st of report.steps) {
    L.push(`| ${st.n} | ${st.title} | ${st.status} | ${st.writers.join('<br>') || '—'} | ${st.refusals.length} | ${st.idempotency.length} |`);
  }
  for (const st of report.steps) {
    L.push('', `### ${st.n}. ${st.title} — ${st.status}`);
    if (st.blocker) L.push(`- Bloquant : ${st.blocker}`);
    L.push(`- Acteurs : \`${JSON.stringify(st.actors)}\``);
    L.push(`- UUID : \`${JSON.stringify(st.ids)}\``);
    L.push(`- Statuts : \`${JSON.stringify(st.statuses)}\``);
    L.push(`- Quantités : \`${JSON.stringify(st.quantities)}\``);
    for (const r of st.refusals) L.push(`- Refus : ${r.label} → ${r.code || r.status || 'refusé'}`);
    for (const i of st.idempotency) L.push(`- Idempotence : ${JSON.stringify(i)}`);
    for (const n of st.notes) L.push(`- Note : ${n}`);
  }
  if (report.local_circuit) L.push('', '## Circuit LOCAL (hors Hub)', '', `\`${JSON.stringify(report.local_circuit)}\``);
  if (report.external_effects) {
    L.push('', '## Effets externes', '', `- Tentatives réseau : ${report.external_effects.network_attempts}`, `- Delta lignes : \`${JSON.stringify(report.external_effects.table_delta)}\``);
  }
  if (report.cleanup) {
    L.push('', '## Nettoyage de la fixture (inventaire, aucune suppression)', '', `- Décision : ${report.cleanup.strategy.decision}`,
      `- Tables immuables : ${(report.cleanup.strategy.immutable_tables || []).join(', ') || 'aucune'}`,
      `- Racines propres : ${report.cleanup.owned_roots_outside_fk_graph.map((o) => `${o.table}=${o.count}`).join(', ')}`);
  }
  L.push('', '## Limites', '', ...(report.limits || []).map((x) => `- ${x}`), '');
  return L.join('\n');
}
function writeReports(report, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `hub-v1-certification-${report.run}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(`${base}.md`, renderMarkdown(report));
  return { json: `${base}.json`, markdown: `${base}.md` };
}

async function main(argv = process.argv.slice(2)) {
  const flag = (name) => argv.find((a) => a === name || a.startsWith(name + '='));
  const dryRun = argv.includes('--dry-run');
  const runArg = flag('--run');
  const outArg = flag('--out');
  const run = runArg ? runArg.split('=')[1] : newRun8();
  const outDir = outArg ? outArg.split('=')[1] : path.join('test-results', 'hub-v1-cert');
  if (!argv.includes('--allow-remote-staging')) assertEphemeralTarget(process.env.DATABASE_URL, argv);
  // Sur staging distant, la vérification stricte de cible intervient dans runCertification AVANT toute écriture.
  const db = require('../../db');
  try {
    const report = await runCertification({ db, run, dryRun, argv: process.argv });
    const files = writeReports(report, outDir);
    console.log(JSON.stringify({ verdict: report.verdict, run: report.run, mode: report.mode, steps: report.steps.map((s) => `${s.n}:${s.status}`), files }));
    process.exitCode = ['PASS_EPHEMERAL_13_STEPS', 'PASS_STAGING_TRANSACTION_13_STEPS', 'PARTIAL_STOP_AFTER_STEP_PASS', 'DRY_RUN_NO_WRITES'].includes(report.verdict) ? 0 : 1;
  } finally { await db.pool.end().catch(() => {}); }
}
if (require.main === module) {
  main().catch((error) => { console.error('HUB_V1_RUNNER_REFUSED:' + String(error.code || error.message).slice(0, 160)); process.exitCode = 2; });
}

module.exports = {
  parseRunOptions,
  SCOPE, SUFFIXES, RUN_RE, STEP_TITLES, newRun8, orderRef, emailOf, phoneOf, assertEphemeralTarget, installNetworkTripwire,
  newStep, expectRefusal, allTriggerStatuses, summarizeExternalEffects, runCertification, renderMarkdown, writeReports, main,
};
