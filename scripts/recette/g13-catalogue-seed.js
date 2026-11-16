#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g13-catalogue-seed
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Outillage de recette G13 : rejoue les gestes API canoniques (import, fiche FR, revue visuelle AUTOMATED_STAGING, approbation, lien fournisseur, prix par marché, stock local W3) pour peupler le staging propre, idempotent, sans SQL d'écriture.
 * @db-read sourcing_candidates,products,catalog_media,catalog_media_visual_fr_reviews,product_suppliers,product_skus,product_market_price_drafts,product_market_exposure,boutique_categories,boutique_subcategories,markets
 * @db-write none (gestes API canoniques uniquement)
 * @impact-areas catalog,market-delegation,staging-only
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://komerce-backend-production.up.railway.app';
const CONFIRMATION = 'SEED-G13-CATALOGUE';
const MANIFEST = require('./g13-catalogue-manifest.json');
const VERDICTS = require('./g13-visual-verdicts.json').verdicts || {};
const OUT = path.resolve('test-results/g13-catalogue-seed');
const PHASES = ['validate', 'import', 'curate', 'supplier-link', 'publish', 'price', 'stock', 'census'];
const PROVIDERS = {
  cj: { supplier_id: 'cj', supplier_name: 'CJdropshipping', platform: 'cj' },
  aliexpress: { supplier_id: 'aliexpress', supplier_name: 'AliExpress', platform: 'aliexpress' },
};
const CURRENCY = { KM: 'KMF', CM: 'XAF', CG: 'XAF' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validation pure du manifeste (testée sans réseau). */
function validateManifest(man, taxonomy = null) {
  const errors = [];
  const entries = Array.isArray(man?.entries) ? man.entries : [];
  const ids = new Set();
  const perCat = {};
  for (const e of entries) {
    if (!e.id || ids.has(e.id)) errors.push(`ID_DUPLIQUE_OU_ABSENT:${e.id}`);
    ids.add(e.id);
    if (!['cj', 'aliexpress', 'central_hub'].includes(e.source)) errors.push(`SOURCE_INVALIDE:${e.id}`);
    if (!e.category || !e.subcategory) errors.push(`CATEGORIE_ABSENTE:${e.id}`);
    if (!e.name_fr || !e.description_fr) errors.push(`TEXTE_FR_ABSENT:${e.id}`);
    if (e.source === 'central_hub' && !e.manual_item) errors.push(`MANUAL_ITEM_ABSENT:${e.id}`);
    if (e.source !== 'central_hub' && !e.supplier_ref && !e.keyword) errors.push(`REFERENCE_OU_MOTCLE_ABSENT:${e.id}`);
    (perCat[e.category] ||= []).push(e);
    if (taxonomy && !taxonomy.get(e.category)?.has(e.subcategory)) errors.push(`TAXONOMIE_INCONNUE:${e.id}`);
  }
  for (const [c, list] of Object.entries(perCat)) if (list.length < 2) errors.push(`MOINS_DE_2_PRODUITS:${c}`);
  if (entries.filter((e) => e.source === 'central_hub').length < 3) errors.push('MOINS_DE_3_FOURNISSEUR_CENTRAL');
  if (!entries.some((e) => e.bulky)) errors.push('PRODUIT_VOLUMINEUX_ABSENT');
  if (!entries.some((e) => e.multi_sku)) errors.push('PRODUIT_MULTI_SKU_ABSENT');
  for (const m of man?.markets || []) {
    if (!entries.some((e) => e.local_stock && e.local_stock[m])) errors.push(`STOCK_LOCAL_ABSENT:${m}`);
  }
  return errors;
}

/** Montant de référence du moteur économique à partir du corridor (jamais inventé). */
function referenceAmount(corridor, market) {
  const currency = CURRENCY[market];
  if (!currency || corridor?.market?.currency && corridor.market.currency !== currency) return null;
  // The pricing engine calculates global economic reference prices in KMF.
  // They are not an XAF local commercial decision. Non-KM markets can only
  // use a target established from their OWN observed market-price references.
  if (currency !== 'KMF') {
    const local = corridor?.corridor?.local;
    if (local?.status !== 'READY' || local?.scope !== 'market' ||
        local?.authority !== 'OBSERVED_REFERENCE_NOT_GATE' ||
        Number(local.sample_count) < 3 ||
        local?.target?.currency !== currency) return null;
    const observed = Number(local.target.observed_amount);
    return Number.isFinite(observed) && observed > 0 ? Math.ceil(observed) : null;
  }
  const eco = corridor?.selected?.economics;
  if (!eco) return null;
  const value = Number(eco.coverage_reference_price_kmf ?? eco.minimum_safe_price_kmf);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

/**
 * Identifiants distincts dont l'image repond reellement : HTTP 200 et content-type image/*.
 * `fetchFn` et `cache` sont injectables pour les tests ; le corps n'est jamais lu.
 */
async function distinctRefsWithRealImage(products, base, cache = new Map(), fetchFn = fetch) {
  const refs = new Set();
  for (const p of products || []) {
    const raw = p.image_url || p.image;
    const ref = p.product_ref || p.id;
    if (!raw || !ref) continue;
    const url = /^https?:\/\//i.test(raw) ? raw : `${String(base).replace(/\/$/, '')}${raw.startsWith('/') ? '' : '/'}${raw}`;
    if (!cache.has(url)) {
      try {
        const res = await fetchFn(url, { redirect: 'follow' });
        const type = String(res.headers.get('content-type') || '').toLowerCase();
        cache.set(url, res.status === 200 && type.startsWith('image/'));
        if (res.body && res.body.cancel) await res.body.cancel().catch(() => {});
      } catch { cache.set(url, false); }
    }
    if (cache.get(url)) refs.add(String(ref));
  }
  return refs;
}

/**
 * Verdict borné du recensement 9 catégories x 3 marchés : exige simultanément
 * les lignes SQL commercialement activées ET 2 fiches distinctes avec images
 * réellement exposées par l'API publique pour chaque couple.
 * Ne vaut jamais GO G13 à lui seul (sources Hub, identité, économie, rôles).
 */
function evaluateG13Census(manifest, sql, http) {
  const categories = [...new Set((manifest?.entries || []).map((entry) => entry.category).filter(Boolean))];
  const markets = manifest?.markets || [];
  const cells = [];
  for (const category of categories) {
    for (const market of markets) {
      const row = (sql || []).find((x) => x.category === category && x.market === market);
      const pub = http?.[`${category}|${market}`] || {};
      const sqlCount = Number(row?.n || 0);
      const httpTotal = Number(pub.total || 0);
      const distinctWithImage = Number(pub.distinct_with_image || 0);
      cells.push({
        category, market, sql_count: sqlCount, http_status: pub.status ?? null,
        http_total: httpTotal, http_distinct_with_image: distinctWithImage,
        pass: sqlCount >= 2 && pub.status === 200 && httpTotal >= 2 && distinctWithImage >= 2,
      });
    }
  }
  const expectedMarkets = ['KM', 'CM', 'CG'];
  const validMarkets = markets.length === expectedMarkets.length && expectedMarkets.every((m) => markets.includes(m));
  const passed = categories.length === 9 && validMarkets && cells.length === 27 && cells.every((x) => x.pass);
  return { passed, expected_categories: 9, expected_markets: expectedMarkets, checked_cells: cells.length,
    passed_cells: cells.filter((x) => x.pass).length, cells, blockers: cells.filter((x) => !x.pass) };
}

/**
 * Staging-only economic reference for delegated test-market decisions.
 * A technical reference is NEVER a local competitor observation or a
 * production market price. Returned only with owner-only explicit staging opt-in.
 */
async function stagingEconomicReferenceAmount(corridor, market, convert = null) {
  const currency = CURRENCY[market];
  if (!currency || (corridor?.market?.currency && corridor.market.currency !== currency)) return null;
  const e = corridor?.selected?.economics;
  const n = x => Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null;
  const cost = n(e?.variable_cost_complete_kmf);
  const amount = n(e?.coverage_reference_price_kmf);
  const floor = n(e?.minimum_safe_price_kmf);
  if (cost == null || amount == null || amount < cost || (floor != null && amount < floor)
      || e?.strategy_risk === 'destructive') return null;
  if (currency === 'KMF') return Math.ceil(amount);
  // Resolve FX through the canonical KMF -> EUR -> market currency boundary.
  const fxProject = convert || require('../../utils/currency').projectAmount;
  const local = Number(await fxProject(amount, 'KMF', currency));
  return Number.isFinite(local) && local > 0 ? Math.ceil(local) : null;
}

class Actor {
  constructor(label, email, password) { Object.assign(this, { label, email, password, cookie: '', role: null, id: null }); }
  async login() {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (r.status !== 200) throw new Error(`LOGIN_${this.label}_${r.status}`);
    this.cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const me = await this.call('GET', '/api/auth/me');
    this.role = me.body?.role || me.body?.user?.role || null;
    this.id = me.body?.id || me.body?.user?.id || null;
  }
  async call(method, p, body, headers = {}) {
    const r = await fetch(BASE + p, {
      method,
      headers: { cookie: this.cookie, origin: BASE, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { /* corps vide */ }
    return { status: r.status, ok: r.ok, body: json };
  }
}

async function ro(db, sql, params = []) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query("SET LOCAL statement_timeout='15000ms'");
    const { rows } = await c.query(sql, params);
    return rows;
  } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
}


// A manually entered product has an internal Hub procurement owner, not an
// external CJ/AliExpress sellable-unit contract. The business proofs are its
// operator-attested cost, provenance, available quantity and own media.
// In particular, a borrowed CJ picture is NOT evidence of a Hub-owned item.
function hubManualEvidence(entry) {
  if (entry?.source !== 'central_hub') return { applicable:false, passed:true, blockers:[] };
  const item = entry.manual_item || {};
  const proof = entry.manual_evidence || {};
  const blockers = [];
  const media = String(item.image_url || '').trim();
  const url = (() => { try { return new URL(media); } catch { return null; } })();
  if (!url || url.protocol !== 'https:') blockers.push('HUB_MEDIA_HTTPS_ABSENT');
  if (url && /(^|\.)cjdropshipping\.com$/i.test(url.hostname)) blockers.push('HUB_MEDIA_CJ_NOT_MANUAL_PROVENANCE');
  if (!String(proof.media_origin_ref || '').trim()) blockers.push('HUB_MEDIA_ORIGIN_UNATTESTED');
  if (!String(proof.cost_ref || '').trim()) blockers.push('HUB_COST_UNATTESTED');
  if (!String(proof.stock_ref || '').trim()) blockers.push('HUB_STOCK_UNATTESTED');
  if (!String(proof.customs_category || '').trim()) blockers.push('HUB_CUSTOMS_UNATTESTED');
  return { applicable:true, passed:blockers.length===0, blockers };
}

// D3 for a manual Hub source is the protected procurement_supplier_id link.
// Neither a fictitious vendor SKU nor a CJ source V2 is required.
async function readHubProcurementOwner(db, productId) {
  const [row] = await ro(db,
    `SELECT s.system_key, s.is_active, s.deleted_at
       FROM products p JOIN suppliers s ON s.id = p.procurement_supplier_id
      WHERE p.id = $1 LIMIT 1`, [productId]);
  return row?.system_key === 'central_hub' && row.is_active === true && row.deleted_at == null;
}

const providerName = (e) => (e.source === 'central_hub' ? null : PROVIDERS[e.source].supplier_name);
const blocked = (r, step, code, detail) => { r.steps[step] = { status: 'BLOCKED', code, detail: detail ? String(detail).slice(0, 300) : undefined }; return false; };
const done = (r, step, status = 'OK', extra = {}) => { r.steps[step] = { status, ...extra }; return true; };
const codeOf = (res) => `HTTP_${res.status}:${res.body?.code || res.body?.error || ''}`.slice(0, 160);

async function findCandidate(db, e) {
  if (!e.supplier_ref) return null;
  const rows = await ro(db,
    `SELECT sc.candidate_ref, sc.state, sc.product_id, sc.supplier_name, UPPER(sc.scan_result->>'sourcing_decision') AS decision,
            p.product_ref, p.lifecycle_status, p.is_active,
            COALESCE(p.boutique_category_key, p.category) AS category, COALESCE(p.boutique_subcategory_key, p.subcategory) AS subcategory
       FROM sourcing_candidates sc LEFT JOIN products p ON p.id = sc.product_id
      WHERE sc.supplier_product_id = $1 ORDER BY sc.updated_at DESC LIMIT 1`, [String(e.supplier_ref)]);
  return rows[0] || null;
}

async function main(env = process.env) {
  const mode = env.G13_MODE === 'execute' ? 'execute' : 'dry-run';
  const phaseSel = env.G13_PHASE || 'all';
  const report = {
    schema: 'g13-catalogue-seed/1', run_id: env.GITHUB_RUN_ID || null, mode, phase: phaseSel,
    started_at: new Date().toISOString(), entries: [], census: null, verdict: 'NOT_PROVEN',
  };
  fs.mkdirSync(OUT, { recursive: true });
  const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const db = require('../../db');
  try {
    if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER || env.G13_CONFIRMATION !== CONFIRMATION
      || env.KOMERCE_ENV !== 'staging' || env.STAGING_BASE_URL !== BASE || env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging'
      || !String(env.PGOPTIONS || '').includes('default_transaction_read_only=on')
      || !/^\d{5,20}$/.test(env.GITHUB_RUN_ID || '')) throw new Error('G13_GUARD_REFUSED');
    const target = await require('./target-guard').confirmTarget({ db, env });
    if (!target.confirmed) throw new Error('TARGET_NOT_CONFIRMED');
    report.db_fingerprint = target.fingerprint;

    // --- validate (toujours) : manifeste, taxonomie réelle, comptes ---
    const cats = await ro(db, `SELECT bc.key AS c, bs.key AS s FROM boutique_categories bc JOIN boutique_subcategories bs ON bs.category_key = bc.key
                                WHERE bc.is_active = TRUE AND bs.is_active = TRUE`);
    const taxonomy = new Map();
    for (const r of cats) { if (!taxonomy.has(r.c)) taxonomy.set(r.c, new Set()); taxonomy.get(r.c).add(r.s); }
    report.taxonomy = Object.fromEntries([...taxonomy].map(([k, v]) => [k, v.size]));
    report.manifest_errors = validateManifest(MANIFEST, taxonomy);
    if (report.manifest_errors.length) throw new Error('MANIFEST_INVALID');

    const admin = new Actor('admin', env.E2E_ADMIN_EMAIL, env.E2E_ADMIN_PASSWORD);
    const operator = new Actor('market_operator', env.E2E_MARKET_OPERATOR_EMAIL, env.E2E_MARKET_OPERATOR_PASSWORD);
    await admin.login(); await operator.login();
    report.actors = { admin: admin.role, market_operator: operator.role };
    const operatorMarkets = {};
    for (const m of MANIFEST.markets) {
      const probe = await operator.call('GET', `/api/admin/workspaces/pricing/market/${m}/corridor`);
      operatorMarkets[m] = probe.status === 403 || probe.status === 401 ? 'REFUSED' : 'REACHABLE';
    }
    report.operator_market_access = operatorMarkets;

    const execute = mode === 'execute';
    // Diagnostic G13 = lectures SQL et GET authentifiés uniquement. Aucun POST,
    // aucun reclassement du WATCH, aucune suggestion de conversion KMF/XAF.
    if (phaseSel === 'diagnose') {
      if (execute) throw new Error('G13_DIAGNOSTIC_MUST_BE_READ_ONLY');
      report.diagnostics = [];
      for (const entry of MANIFEST.entries) {
        const candidate = await findCandidate(db, entry);
        const row = {
          id: entry.id, source: entry.source, category: entry.category,
          candidate_ref: candidate?.candidate_ref || null,
          product_ref: candidate?.product_ref || null,
          sourcing_decision: candidate?.decision || null,
          lifecycle: candidate?.lifecycle_status || null,
          product_is_active: candidate?.is_active === true,
          economic_reason: null, source_currency: null, customs_category: null,
          source_v2_present: false, source_v2_units: 0, source_v2_exact_units: 0,
          source_v2_active_units: 0, source_v2_active_exact_units: 0,
          sku_count: 0, stocked_skus: 0, supplier_links: 0,
          price_markets: {},
        };
        if (candidate) {
          const [scan] = await ro(db,
            `SELECT scan_result->>'reason' AS economic_reason,
                    currency AS source_currency,
                    komerce_category AS customs_category,
                    normalized_source_contract IS NOT NULL AS source_v2_present,
                    CASE WHEN jsonb_typeof(normalized_source_contract->'sellable_units')='array'
                         THEN jsonb_array_length(normalized_source_contract->'sellable_units')
                         ELSE 0 END AS source_v2_units,
                    (SELECT COUNT(*)::int FROM jsonb_array_elements(
                      CASE WHEN jsonb_typeof(normalized_source_contract->'sellable_units')='array'
                           THEN normalized_source_contract->'sellable_units'
                           ELSE '[]'::jsonb END
                    ) unit WHERE NULLIF(BTRIM(unit->>'supplier_sku'),'') IS NOT NULL
                             AND NULLIF(BTRIM(unit->>'supplier_unit_ref'),'') IS NOT NULL
                             AND jsonb_typeof(unit->'supplier_order_identity')='object'
                    ) AS source_v2_exact_units,
                    (SELECT COUNT(*)::int FROM jsonb_array_elements(
                      CASE WHEN jsonb_typeof(normalized_source_contract->'sellable_units')='array'
                           THEN normalized_source_contract->'sellable_units'
                           ELSE '[]'::jsonb END
                    ) unit WHERE COALESCE((unit->>'is_active')::boolean,TRUE)) AS source_v2_active_units,
                    (SELECT COUNT(*)::int FROM jsonb_array_elements(
                      CASE WHEN jsonb_typeof(normalized_source_contract->'sellable_units')='array'
                           THEN normalized_source_contract->'sellable_units'
                           ELSE '[]'::jsonb END
                    ) unit WHERE COALESCE((unit->>'is_active')::boolean,TRUE)
                             AND NULLIF(BTRIM(unit->>'supplier_sku'),'') IS NOT NULL
                             AND NULLIF(BTRIM(unit->>'supplier_unit_ref'),'') IS NOT NULL
                             AND jsonb_typeof(unit->'supplier_order_identity')='object'
                    ) AS source_v2_active_exact_units
               FROM sourcing_candidates WHERE candidate_ref=$1`,
            [candidate.candidate_ref]);
          row.economic_reason = scan?.economic_reason || null;
          row.source_currency = scan?.source_currency || null;
          row.customs_category = scan?.customs_category || null;
          row.source_v2_present = scan?.source_v2_present === true;
          row.source_v2_units = Number(scan?.source_v2_units || 0);
          row.source_v2_exact_units = Number(scan?.source_v2_exact_units || 0);
          row.source_v2_active_units = Number(scan?.source_v2_active_units || 0);
          row.source_v2_active_exact_units = Number(scan?.source_v2_active_exact_units || 0);
        }
        if (candidate?.product_id) {
          const [skus] = await ro(db,
            `SELECT COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active, COUNT(*) FILTER (WHERE is_active = TRUE AND stock > 0)::int AS stocked FROM product_skus WHERE product_id=$1`,
            [candidate.product_id]);
          row.sku_count = Number(skus?.active || 0);
          row.stocked_skus = Number(skus?.stocked || 0);
          if (entry.source === 'central_hub') {
            row.hub_procurement_owner_proven = await readHubProcurementOwner(db, candidate.product_id);
            row.supplier_links = row.hub_procurement_owner_proven ? 1 : 0;
          } else {
            const [links] = await ro(db,
              `SELECT COUNT(*)::int AS n FROM product_suppliers ps JOIN suppliers s ON s.id=ps.supplier_id AND s.is_active=TRUE AND s.deleted_at IS NULL WHERE ps.product_id=$1 AND ps.is_active=TRUE AND ps.deleted_at IS NULL`,
              [candidate.product_id]);
            row.supplier_links = Number(links?.n || 0);
          }
        }
        for (const market of MANIFEST.markets) {
          if (!candidate?.product_ref) {
            row.price_markets[market] = {status:'NO_PRODUCT'};
            continue;
          }
          const res = await operator.call('GET',
            `/api/admin/workspaces/pricing/market/${market}/corridor?product_ref=${encodeURIComponent(candidate.product_ref)}`);
          const eco = res.body?.selected?.economics || {};
          const currency = CURRENCY[market].toLowerCase();
          row.price_markets[market] = {
            http_status:res.status, currency:CURRENCY[market],
            reference_amount:res.ok ? referenceAmount(res.body,market) : null,
            local_price_keys:Object.keys(eco).filter(key=>key.includes(currency) && /price|minimum|coverage/i.test(key)),
            local_evidence_status:res.body?.corridor?.local?.status || null,
            local_observations:Number(res.body?.corridor?.local?.sample_count || 0),
            local_target_amount:res.body?.corridor?.local?.target?.observed_amount ?? null,
            local_target_currency:res.body?.corridor?.local?.target?.currency || null,
            blockers:(res.body?.blockers || res.body?.selected?.blockers || []).slice?.(0,6) || [],
            error_code:res.body?.code || res.body?.selected?.code || null,
          };
        }
        report.diagnostics.push(row);
      }
      report.verdict = 'DIAGNOSTIC_OK_NOT_G13_GO';
      return report;
    }

    // G13 partial remediation is never allowed to produce an overall G13 GO.
    // The 17th CJ item has 12 real but ALL INACTIVE source units: do not
    // promote them or fake their availability to meet the catalogue quota.
    const scope = env.G13_SCOPE || 'all';
    if (!['all','cj-ready-16','market-price-18'].includes(scope)) throw new Error('G13_SCOPE_UNSUPPORTED');
    const priceTrial = scope==='market-price-18';
    if (priceTrial && !(execute && phaseSel==='price' && env.G13_PRICE_BASIS==='STAGING_ECONOMICS'
       && env.KOMERCE_ENV==='staging' && env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER)) {
      throw new Error('G13_MARKET_PRICE_TRIAL_GUARD_REFUSED');
    }
    report.scope = scope;
    report.scope_exclusions = scope==='cj-ready-16' ? ['G13-10:ALL_SUPPLIER_UNITS_INACTIVE']
      : priceTrial ? ['G13-10:ALL_SOURCE_UNITS_INACTIVE','G13-06/12/14:CENTRAL_HUB_WATCH'] : [];
    const selectedEntries = scope==='cj-ready-16'
      ? MANIFEST.entries.filter(e=>e.source==='cj' && e.id!=='G13-10')
      : priceTrial ? MANIFEST.entries.filter(e=>e.source!=='central_hub' && e.id!=='G13-10')
        : MANIFEST.entries;
    const wanted = phaseSel === 'all' ? PHASES : [phaseSel];
    if (phaseSel === 'import-now') {
      if (!execute) { report.import_now = 'PLANIFIE'; } else {
        const res = await admin.call('POST', '/api/admin/workspaces/sourcing/sources/api:aliexpress/import-now');
        report.import_now = { status: res.status, body: JSON.stringify(res.body)?.slice(0, 600) };
      }
    }
    if (phaseSel === 'discover') {
      report.discover = [];
      for (const d of MANIFEST.discovery || []) {
        if (!execute) { report.discover.push({ ...d, status: 'PLANIFIE' }); continue; }
        const res = await admin.call('POST', '/api/admin/workspaces/sourcing/imports', { source_type: 'api', ...PROVIDERS[d.source || 'cj'], keyword: d.keyword, page: 1, size: d.size || 5 });
        report.discover.push({ keyword: d.keyword, status: res.status, code: res.body?.code || null });
      }
    }
    if (phaseSel === 'dump' || phaseSel === 'discover' || phaseSel === 'import-now' || (phaseSel === 'curate' && execute)) {
      // Lecture seule : inventaire des candidats (pour épingler) et de leurs médias actifs (pour l'inspection).
      report.dump = await ro(db,
        `SELECT sc.candidate_ref, sc.supplier_name, sc.supplier_product_id, sc.product_name, sc.supplier_category, sc.state,
                UPPER(sc.scan_result->>'sourcing_decision') AS decision, sc.purchase_price, sc.currency, sc.image_url,
                sc.stock_available, sc.komerce_category AS customs_category,
                sc.scan_result->>'reason' AS sourcing_reason,
                (sc.normalized_source_contract IS NOT NULL) AS source_v2_present,
                CASE WHEN jsonb_typeof(sc.normalized_source_contract->'sellable_units')='array'
                     THEN jsonb_array_length(sc.normalized_source_contract->'sellable_units') ELSE 0 END AS source_v2_units,
                (SELECT COUNT(*)::int FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(sc.normalized_source_contract->'sellable_units')='array'
                         THEN sc.normalized_source_contract->'sellable_units' ELSE '[]'::jsonb END
                  ) unit WHERE COALESCE((unit->>'is_active')::boolean,TRUE)
                     AND NULLIF(BTRIM(unit->>'supplier_sku'),'') IS NOT NULL
                     AND NULLIF(BTRIM(unit->>'supplier_unit_ref'),'') IS NOT NULL
                     AND jsonb_typeof(unit->'supplier_order_identity')='object') AS source_v2_active_exact_units,
                p.product_ref, p.lifecycle_status, COALESCE(p.boutique_category_key, p.category) AS category, COALESCE(p.boutique_subcategory_key, p.subcategory) AS subcategory,
                (SELECT jsonb_agg(jsonb_build_object('id', cm.id, 'source_media_id', cm.source_media_id, 'url', cm.url) ORDER BY cm.display_order, cm.created_at)
                   FROM catalog_media cm WHERE cm.product_id = p.id AND cm.is_active = TRUE) AS media
           FROM sourcing_candidates sc LEFT JOIN products p ON p.id = sc.product_id ORDER BY sc.created_at`);
    }
    const hubRes = await admin.call('GET', '/api/admin/workspaces/sourcing/catalog-suppliers');
    const hubList = hubRes.body?.suppliers || hubRes.body?.items || (Array.isArray(hubRes.body) ? hubRes.body : []);
    const hub = hubList.find((s) => s.system_key === 'central_hub') || null;

    for (const e of selectedEntries) {
      const r = { id: e.id, category: e.category, subcategory: e.subcategory, source: e.source, steps: {} };
      report.entries.push(r);
      try {
        let cand = await findCandidate(db, e);
        r.state = cand ? { candidate: cand.candidate_ref, product_ref: cand.product_ref, lifecycle: cand.lifecycle_status } : 'ABSENT';

        // Owner-only staging Hub fixtures must not bypass human provenance
        // simply by selecting curate/publish/price/stock without "import".
        // Census remains strictly read-only and independent of the fixture.
        const manualProof = hubManualEvidence(e);
        if (manualProof.applicable) r.hub_manual_evidence = manualProof;
        if (!manualProof.passed && wanted.some(step => step !== 'census' && step !== 'validate')) {
          blocked(r, 'hub-preflight', 'HUB_MANUAL_PROOFS_REQUIRED', manualProof.blockers.join(','));
          continue;
        }

        // --- import ---
        if (wanted.includes('import')) {
          if (cand) done(r, 'import', 'DEJA_PRESENT');
          else if (e.source === 'central_hub' && !e.manual_item?.image_url) blocked(r, 'import', 'MANUAL_IMAGE_HTTPS_A_EPINGLER');
          else if (e.source === 'central_hub' && !hub) blocked(r, 'import', 'FOURNISSEUR_CENTRAL_INTROUVABLE');
          else if (!execute) done(r, 'import', 'PLANIFIE');
          else {
            const body = e.source === 'central_hub'
              ? { source_type: 'manual', supplier_id: hub.id, items: [e.manual_item] }
              : { source_type: 'api', ...PROVIDERS[e.source], ...(e.supplier_ref ? { product_ids: [String(e.supplier_ref)] } : { keyword: e.keyword, page: 1, size: 5 }) };
            const res = await admin.call('POST', '/api/admin/workspaces/sourcing/imports', body);
            if (!res.ok) blocked(r, 'import', codeOf(res), JSON.stringify(res.body)?.slice(0, 900));
            else if (!e.supplier_ref) done(r, 'import', 'DECOUVERTE_A_EPINGLER', { import_ref: res.body?.import_ref });
            else { done(r, 'import', 'OK', { import_ref: res.body?.import_ref }); cand = await findCandidate(db, e); }
          }
        }
        if (!cand) { cand = await findCandidate(db, e); }
        if (!cand) { r.steps.next = { status: 'ARRET', code: e.supplier_ref ? 'CANDIDAT_ABSENT' : 'REFERENCE_A_EPINGLER' }; continue; }

        // --- curate : catégorie boutique + fiche FR ---
        if (wanted.includes('curate')) {
          if (cand.lifecycle_status === 'active') done(r, 'curate', 'DEJA_ACTIF');
          else if (!execute) done(r, 'curate', 'PLANIFIE');
          else {
            let ok = true;
            if (!cand.product_id) {
              const c1 = await admin.call('POST', `/api/admin/workspaces/sourcing/candidates/${cand.candidate_ref}/confirm-boutique-category`, { category: e.category, subcategory: e.subcategory });
              const c2 = c1.ok && await admin.call('POST', `/api/admin/workspaces/sourcing/candidates/${cand.candidate_ref}/promote`, {});
              if (!c1.ok) ok = blocked(r, 'curate', 'CATEGORIE_' + codeOf(c1));
              else if (!c2.ok) ok = blocked(r, 'curate', 'PROMOTION_' + codeOf(c2));
              cand = await findCandidate(db, e);
            }
            if (ok && cand?.product_ref) {
              if (cand.category !== e.category || cand.subcategory !== e.subcategory) {
                const cl = await admin.call('POST', `/api/admin/workspaces/catalog/products/${cand.product_ref}/classify`, { category: e.category, subcategory: e.subcategory });
                if (!cl.ok) ok = blocked(r, 'curate', 'CLASSIFICATION_' + codeOf(cl));
              }
              if (ok) {
                const fr = await admin.call('POST', `/api/admin/workspaces/catalog/approval/${cand.product_ref}/prepare-fr`, { name: e.name_fr, description: e.description_fr });
                ok = fr.ok ? done(r, 'curate', 'OK') : blocked(r, 'curate', 'FICHE_FR_' + codeOf(fr));
              }
            } else if (ok) ok = blocked(r, 'curate', 'PRODUIT_NON_CREE');
          }
        }

        // --- supplier-link (D3 : liaision fournisseur AVANT approbation) ---
        if (wanted.includes('supplier-link') && cand?.product_id && e.source === 'central_hub') {
          const linked = await readHubProcurementOwner(db, cand.product_id);
          if (linked) done(r, 'supplier-link', 'HUB_PROCUREMENT_OWNER_PROVEN');
          else blocked(r, 'supplier-link', 'HUB_PROCUREMENT_OWNER_ABSENT');
        } else if (wanted.includes('supplier-link') && cand?.product_id) {
          const links = await ro(db, `SELECT ps.id FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id AND s.is_active = TRUE AND s.deleted_at IS NULL JOIN product_skus sku ON sku.product_id = ps.product_id AND sku.supplier_sku = ps.supplier_sku AND sku.is_active = TRUE AND sku.stock > 0 WHERE ps.product_id = $1 AND ps.is_active = TRUE AND ps.deleted_at IS NULL AND ($2::text IS NULL OR LOWER(s.platform) = $2) LIMIT 1`, [cand.product_id, e.source === 'central_hub' ? null : PROVIDERS[e.source].platform]);
          if (links.length) done(r, 'supplier-link', 'DEJA_PRESENT');
          else if (!execute) done(r, 'supplier-link', 'PLANIFIE');
          else {
            const list = await admin.call('GET', '/api/purchasing/suppliers');
            const arr = Array.isArray(list.body) ? list.body : list.body?.suppliers || [];
            const platform = e.source === 'central_hub' ? null : PROVIDERS[e.source].platform;
            let sup = e.source === 'central_hub' ? (hub ? arr.find((s) => s.id === hub.id) || hub : null)
              : arr.find((s) => s.platform === platform && s.is_active !== false && !s.deleted_at);
            if (!sup && platform) {
              const c = await admin.call('POST', '/api/purchasing/suppliers', { name: providerName(e), platform, auto_order: false, notes: `G13 recette ${env.GITHUB_RUN_ID}; aucune commande fournisseur` });
              if (c.ok) sup = c.body?.supplier || c.body;
            }
            const sku = (await ro(db, `SELECT supplier_sku FROM product_skus WHERE product_id = $1 AND is_active = TRUE AND stock > 0 ORDER BY created_at LIMIT 1`, [cand.product_id]))[0];
            if (!sup?.id) blocked(r, 'supplier-link', 'FOURNISSEUR_ABSENT');
            else if (!sku) blocked(r, 'supplier-link', 'SKU_STOCKE_ABSENT');
            else {
              const m = await admin.call('POST', `/api/purchasing/suppliers/${sup.id}/map`, { product_id: cand.product_id, supplier_sku: sku.supplier_sku, notes: `G13 recette ${env.GITHUB_RUN_ID}` });
              if (!m.ok) blocked(r, 'supplier-link', codeOf(m));
              else {
                const linked = await ro(db, `SELECT ps.id FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id AND s.is_active = TRUE AND s.deleted_at IS NULL JOIN product_skus sku ON sku.product_id = ps.product_id AND sku.supplier_sku = ps.supplier_sku AND sku.is_active = TRUE AND sku.stock > 0 WHERE ps.product_id = $1 AND ps.supplier_id = $2 AND ps.supplier_sku = $3 AND ps.is_active = TRUE AND ps.deleted_at IS NULL LIMIT 1`, [cand.product_id, sup.id, sku.supplier_sku]);
                if (linked.length) done(r, 'supplier-link', 'OK');
                else blocked(r, 'supplier-link', 'MAPPING_NON_RESOLU_APRES_HTTP');
              }
            }
          }
        }


        // --- publish : revue visuelle AUTOMATED_STAGING puis approbation ---
        if (wanted.includes('publish') && cand?.product_ref) {
          if (cand.lifecycle_status === 'active') done(r, 'publish', 'DEJA_ACTIF');
          else if (cand.decision !== 'TEST') blocked(r, 'publish', 'DECISION_SOURCING_NON_TEST', cand.decision);
          else {
            const media = await ro(db, `SELECT id, source_media_id, url, option_values FROM catalog_media WHERE product_id = $1 AND is_active = TRUE ORDER BY display_order, created_at`, [cand.product_id]);
            const v = VERDICTS[e.id] || {};
            const vk = (m) => v[m.source_media_id] || v[m.url];
            const missing = media.filter((m) => !vk(m));
            r.media = { active: media.length, verdicts_missing: missing.length, urls: missing.map((m) => ({ source_media_id: m.source_media_id, url: m.url })).slice(0, 20) };
            if (!media.length) blocked(r, 'publish', 'AUCUN_MEDIA_ACTIF');
            else if (missing.length) blocked(r, 'publish', 'VERDICT_VISUEL_ABSENT', `${missing.length}/${media.length}`);
            else if (media.some((m) => vk(m).verdict !== 'APPROVED')) blocked(r, 'publish', 'IMAGE_REFUSEE_PAR_INSPECTION');
            else if (!execute) done(r, 'publish', 'PLANIFIE');
            else {
              let ok = true;
              for (const m of media) {
                const x = vk(m);
                const res = await admin.call('POST', `/api/admin/catalog/approval-queue/${cand.product_id}/media/${m.id}/visual-fr-review`, {
                  execution_mode: 'AUTOMATED_STAGING', run_id: env.GITHUB_RUN_ID, source_media_id: m.source_media_id, source_url: m.url,
                  option_values: m.option_values ?? {}, text_presence: x.text_presence,
                  source_transcription: x.source_transcription ?? null, french_translation: x.french_translation ?? null, french_presentation: x.french_presentation ?? null,
                });
                if (!(res.ok && (res.body?.status ?? 200) < 400)) { ok = blocked(r, 'publish', 'REVUE_VISUELLE_' + codeOf(res), m.source_media_id); break; }
              }
              if (ok) {
                const ap = await admin.call('POST', `/api/admin/workspaces/catalog/approval/${cand.product_ref}/approve`);
                if (ap.ok) done(r, 'publish', 'OK'); else blocked(r, 'publish', 'APPROBATION_' + codeOf(ap), JSON.stringify(ap.body?.reasons || '').slice(0, 200));
              }
            }
            cand = await findCandidate(db, e);
          }
        }

        // --- price : décision par marché avec le compte opérateur, puis activation ---
        if (wanted.includes('price') && cand?.product_ref) {
          for (const mk of MANIFEST.markets) {
            const key = `price:${mk}`;
            const act = await ro(db, `SELECT 1 FROM product_market_price_drafts d JOIN markets m ON m.id = d.market_id WHERE d.product_id = $1 AND m.code = $2 AND d.status = 'LOCAL_ACTIVE' LIMIT 1`, [cand.product_id, mk]);
            if (act.length) { done(r, key, 'DEJA_ACTIF'); continue; }
            if (cand.lifecycle_status !== 'active') { blocked(r, key, 'PRODUIT_NON_PUBLIE'); continue; }
            if (operatorMarkets[mk] === 'REFUSED') { blocked(r, key, 'OPERATEUR_HORS_MARCHE'); continue; }
            if (!execute) { done(r, key, 'PLANIFIE'); continue; }
            const base = `/api/admin/workspaces/pricing/market/${mk}/products/${cand.product_ref}/local-price`;
            const cor = await operator.call('GET', `/api/admin/workspaces/pricing/market/${mk}/corridor?product_ref=${encodeURIComponent(cand.product_ref)}`);
            const amount = !cor.ok ? null : priceTrial
              ? await stagingEconomicReferenceAmount(cor.body, mk) : referenceAmount(cor.body, mk);
            if (!amount) { blocked(r, key, cor.ok ? 'PRIX_ECONOMIQUE_ABSENT' : 'CORRIDOR_' + codeOf(cor)); continue; }
            const reason = priceTrial
              ? `RECETTE STAGING G13 ${env.GITHUB_RUN_ID} : décision du compte opérateur à partir de coûts complets; référence économique projetée par Currency Boundary, NON observation concurrentielle; sous gates économiques canoniques.`
              : `Recette G13 ${env.GITHUB_RUN_ID} : prix de référence du moteur économique, staging`;
            const d = await operator.call('POST', base, { amount, reason });
            if (!d.ok) { blocked(r, key, 'BROUILLON_' + codeOf(d)); continue; }
            const pv = await operator.call('GET', `${base}/activation-preview`);
            if (!pv.ok || pv.body?.activation?.allowed !== true) { blocked(r, key, 'GARDE_ECONOMIQUE_REFUSE', JSON.stringify(pv.body?.activation || pv.body)?.slice(0, 200)); continue; }
            const a = await operator.call('POST', `${base}/activate`, { reason });
            if (a.ok) done(r, key, 'OK', { amount, currency: CURRENCY[mk],
              basis: priceTrial ? 'COST_REFERENCE_STAGING_TEST_NOT_COMPETITOR_OBSERVATION' : 'MARKET_CORRIDOR' });
            else blocked(r, key, 'ACTIVATION_' + codeOf(a));
          }
        }

        // --- stock : writer W3, déclaration par le responsable marché ---
        if (wanted.includes('stock') && cand?.product_id && e.local_stock) {
          for (const [mk, qty] of Object.entries(e.local_stock)) {
            const key = `stock:${mk}`;
            if (!execute) { done(r, key, 'PLANIFIE'); continue; }
            if (operatorMarkets[mk] === 'REFUSED') { blocked(r, key, 'OPERATEUR_HORS_MARCHE'); continue; }
            const ls = await operator.call('GET', `/api/markets/${mk}/local-stock`);
            const relais = ls.body?.relais?.[0];
            if (!ls.ok || !relais?.id) { blocked(r, key, 'RELAIS_ABSENT_' + codeOf(ls)); continue; }
            const rc = await operator.call('POST', `/api/markets/${mk}/local-stock/receipts`, {
              product_id: cand.product_id, relais_id: relais.id, qty_received: qty,
              proof_ref: `G13-${env.GITHUB_RUN_ID}-${e.id}-${mk}`, note: 'Recette G13 : réception déclarée par le responsable marché',
            }, { 'Idempotency-Key': `g13-${e.id}-${mk}` });
            if (!rc.ok) { blocked(r, key, 'RECEPTION_' + codeOf(rc)); continue; }
            const ex = await operator.call('PUT', `/api/markets/${mk}/local-stock/${cand.product_id}/exposure`, { commercial_exposure: 'ENABLED' });
            if (ex.ok) done(r, key, 'OK', { qty }); else blocked(r, key, 'EXPOSITION_' + codeOf(ex));
          }
        }
      } catch (err) { r.steps.error = { status: 'BLOCKED', code: String(err.message).slice(0, 200) }; }
      save();
    }

    // --- census : lecture seule SQL + contrôle HTTP public ---
    if (phaseSel === 'all' || phaseSel === 'census') {
      const rows = await ro(db,
        `SELECT COALESCE(p.boutique_category_key, p.category) AS category, m.code AS market, COUNT(DISTINCT p.id)::int AS n,
                array_agg(DISTINCT COALESCE(sc.supplier_name, 'inconnu')) AS sources
           FROM products p
           JOIN product_market_price_drafts d ON d.product_id = p.id AND d.status = 'LOCAL_ACTIVE'
           JOIN markets m ON m.id = d.market_id
           JOIN product_market_exposure x ON x.product_id = p.id AND x.market_id = m.id AND x.commercial_exposure = 'ENABLED'
           LEFT JOIN sourcing_candidates sc ON sc.product_id = p.id
          WHERE p.is_active = TRUE AND p.is_available = TRUE GROUP BY 1, 2 ORDER BY 1, 2`);
      const http = {};
      const imageCache = new Map();
      for (const c of [...new Set(MANIFEST.entries.map((x) => x.category))]) {
        for (const m of MANIFEST.markets) {
          const res = await fetch(`${BASE}/api/products?market=${m}&category=${encodeURIComponent(c)}&limit=50`);
          const j = await res.json().catch(() => ({}));
          // /api/products applique deja la garde prix LOCAL_ACTIVE + exposition ;
          // on exige en plus deux identites distinctes presentant une image.
          const products = Array.isArray(j.products) ? j.products : (Array.isArray(j.items) ? j.items : []);
          // Une image ne compte que si son URL repond 200 avec un content-type image
          // (un /uploads/ efface renvoie 200 text/html via le repli SPA).
          const distinct = await distinctRefsWithRealImage(products, BASE, imageCache);
          http[`${c}|${m}`] = { status: res.status, total: j.total ?? null, distinct_with_image: distinct.size };
        }
      }
      report.census = { sql: rows, http_public: http, ...evaluateG13Census(MANIFEST, rows, http) };
    }
    const blockedSteps = report.entries.flatMap((x) => Object.values(x.steps)).filter((s) => s.status === 'BLOCKED').length;
    report.blocked_steps = blockedSteps;
    report.verdict = priceTrial
      ? (blockedSteps ? 'MARKET_TEST_PRICES_BLOCKED_NOT_G13_GO' : 'MARKET_TEST_PRICES_APPLIED_NOT_G13_GO')
      : scope==='cj-ready-16'
        ? (mode==='dry-run' ? 'SCOPED_DRY_RUN_NOT_G13_GO' : blockedSteps ? 'SCOPED_PARTIAL_BLOCKED' : 'SCOPED_PHASE_PASS_NOT_G13_GO')
      : phaseSel === 'census'
        ? (report.census?.passed ? 'CENSUS_27_PASS_NOT_G13_GO' : 'CENSUS_27_NO_GO')
        : mode === 'dry-run' ? 'DRY_RUN_OK'
          : blockedSteps ? 'PARTIAL_BLOCKED'
            : report.census?.passed ? 'SEED_PHASES_PASS_NOT_G13_GO' : 'CENSUS_27_NO_GO';
    // Le rapport n'est pas une certification si une des 27 cellules manque.
    // Une CI verte ne doit pas masquer ce NO GO commercial.
    if (report.verdict === 'CENSUS_27_NO_GO' || report.verdict === 'MARKET_TEST_PRICES_BLOCKED_NOT_G13_GO') process.exitCode = 2;
  } catch (error) {
    report.verdict = 'BLOCKED';
    report.error = String(error.message).slice(0, 300);
    process.exitCode = 2;
  } finally {
    report.finished_at = new Date().toISOString();
    save();
    await db.pool.end().catch(() => {});
    console.log(JSON.stringify({ verdict: report.verdict, error: report.error, blocked_steps: report.blocked_steps, entries: report.entries.length }));
  }
  return report;
}

if (require.main === module) main();
module.exports = { validateManifest, hubManualEvidence, referenceAmount, stagingEconomicReferenceAmount, evaluateG13Census, distinctRefsWithRealImage, PHASES, CONFIRMATION };
