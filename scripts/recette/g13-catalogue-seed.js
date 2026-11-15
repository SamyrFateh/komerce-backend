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
const PHASES = ['validate', 'import', 'curate', 'publish', 'supplier-link', 'price', 'stock', 'census'];
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
  const cur = CURRENCY[market];
  const eco = corridor?.selected?.economics;
  if (!eco || !cur) return null;
  const k = cur.toLowerCase();
  const value = Number(eco[`coverage_reference_price_${k}`] ?? eco[`minimum_safe_price_${k}`]);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
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

const providerName = (e) => (e.source === 'central_hub' ? null : PROVIDERS[e.source].supplier_name);
const blocked = (r, step, code, detail) => { r.steps[step] = { status: 'BLOCKED', code, detail: detail ? String(detail).slice(0, 300) : undefined }; return false; };
const done = (r, step, status = 'OK', extra = {}) => { r.steps[step] = { status, ...extra }; return true; };
const codeOf = (res) => `HTTP_${res.status}:${res.body?.code || res.body?.error || ''}`.slice(0, 160);

async function findCandidate(db, e) {
  if (!e.supplier_ref) return null;
  const rows = await ro(db,
    `SELECT sc.candidate_ref, sc.state, sc.product_id, sc.supplier_name, UPPER(sc.scan_result->>'sourcing_decision') AS decision,
            p.product_ref, p.lifecycle_status, p.is_active, p.category, p.subcategory
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

    const wanted = phaseSel === 'all' ? PHASES : [phaseSel];
    const execute = mode === 'execute';
    if (phaseSel === 'import-now') {
      if (!execute) { report.import_now = 'PLANIFIE'; } else {
        const res = await admin.call('POST', '/api/admin/workspaces/sourcing/sources/api:aliexpress/import-now');
        report.import_now = { status: res.status, body: JSON.stringify(res.body)?.slice(0, 600) };
      }
    }
    if (phaseSel === 'dump' || phaseSel === 'import-now' || (phaseSel === 'curate' && execute)) {
      // Lecture seule : inventaire des candidats (pour épingler) et de leurs médias actifs (pour l'inspection).
      report.dump = await ro(db,
        `SELECT sc.candidate_ref, sc.supplier_name, sc.supplier_product_id, sc.product_name, sc.supplier_category, sc.state,
                UPPER(sc.scan_result->>'sourcing_decision') AS decision, sc.purchase_price, sc.currency, sc.image_url,
                p.product_ref, p.lifecycle_status, p.category, p.subcategory,
                (SELECT jsonb_agg(jsonb_build_object('id', cm.id, 'source_media_id', cm.source_media_id, 'url', cm.url) ORDER BY cm.display_order, cm.created_at)
                   FROM catalog_media cm WHERE cm.product_id = p.id AND cm.is_active = TRUE) AS media
           FROM sourcing_candidates sc LEFT JOIN products p ON p.id = sc.product_id ORDER BY sc.created_at`);
    }
    const hubRes = await admin.call('GET', '/api/admin/workspaces/sourcing/catalog-suppliers');
    const hubList = hubRes.body?.suppliers || hubRes.body?.items || (Array.isArray(hubRes.body) ? hubRes.body : []);
    const hub = hubList.find((s) => s.system_key === 'central_hub') || null;

    for (const e of MANIFEST.entries) {
      const r = { id: e.id, category: e.category, subcategory: e.subcategory, source: e.source, steps: {} };
      report.entries.push(r);
      try {
        let cand = await findCandidate(db, e);
        r.state = cand ? { candidate: cand.candidate_ref, product_ref: cand.product_ref, lifecycle: cand.lifecycle_status } : 'ABSENT';

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
              if (cand.category !== e.category || cand.subcategory !== e.subcategory) ok = blocked(r, 'curate', 'CATEGORIE_PRODUIT_DIFFERENTE', `${cand.category}/${cand.subcategory}`);
              else {
                const fr = await admin.call('POST', `/api/admin/workspaces/catalog/approval/${cand.product_ref}/prepare-fr`, { name: e.name_fr, description: e.description_fr });
                ok = fr.ok ? done(r, 'curate', 'OK') : blocked(r, 'curate', 'FICHE_FR_' + codeOf(fr));
              }
            } else if (ok) ok = blocked(r, 'curate', 'PRODUIT_NON_CREE');
          }
        }

        // --- publish : revue visuelle AUTOMATED_STAGING puis approbation ---
        if (wanted.includes('publish') && cand?.product_ref) {
          if (cand.lifecycle_status === 'active') done(r, 'publish', 'DEJA_ACTIF');
          else if (cand.decision !== 'TEST') blocked(r, 'publish', 'DECISION_SOURCING_NON_TEST', cand.decision);
          else {
            const media = await ro(db, `SELECT id, source_media_id, url, option_values FROM catalog_media WHERE product_id = $1 AND is_active = TRUE ORDER BY display_order, created_at`, [cand.product_id]);
            const v = VERDICTS[e.id] || {};
            const missing = media.filter((m) => !v[m.source_media_id]);
            r.media = { active: media.length, verdicts_missing: missing.length, urls: missing.map((m) => ({ source_media_id: m.source_media_id, url: m.url })).slice(0, 20) };
            if (!media.length) blocked(r, 'publish', 'AUCUN_MEDIA_ACTIF');
            else if (missing.length) blocked(r, 'publish', 'VERDICT_VISUEL_ABSENT', `${missing.length}/${media.length}`);
            else if (media.some((m) => v[m.source_media_id].verdict !== 'APPROVED')) blocked(r, 'publish', 'IMAGE_REFUSEE_PAR_INSPECTION');
            else if (!execute) done(r, 'publish', 'PLANIFIE');
            else {
              let ok = true;
              for (const m of media) {
                const x = v[m.source_media_id];
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

        // --- supplier-link (D3 : sans product_suppliers le produit reste invisible) ---
        if (wanted.includes('supplier-link') && cand?.product_id) {
          const links = await ro(db, `SELECT 1 FROM product_suppliers WHERE product_id = $1 AND is_active = TRUE AND deleted_at IS NULL LIMIT 1`, [cand.product_id]);
          if (links.length) done(r, 'supplier-link', 'DEJA_PRESENT');
          else if (cand.lifecycle_status !== 'active') blocked(r, 'supplier-link', 'PRODUIT_NON_PUBLIE');
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
              if (m.ok) done(r, 'supplier-link', 'OK'); else blocked(r, 'supplier-link', codeOf(m));
            }
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
            const amount = cor.ok ? referenceAmount(cor.body, mk) : null;
            if (!amount) { blocked(r, key, cor.ok ? 'PRIX_ECONOMIQUE_ABSENT' : 'CORRIDOR_' + codeOf(cor)); continue; }
            const reason = `Recette G13 ${env.GITHUB_RUN_ID} : prix de référence du moteur économique, staging`;
            const d = await operator.call('POST', base, { amount, reason });
            if (!d.ok) { blocked(r, key, 'BROUILLON_' + codeOf(d)); continue; }
            const pv = await operator.call('GET', `${base}/activation-preview`);
            if (!pv.ok || pv.body?.activation?.allowed !== true) { blocked(r, key, 'GARDE_ECONOMIQUE_REFUSE', JSON.stringify(pv.body?.activation || pv.body)?.slice(0, 200)); continue; }
            const a = await operator.call('POST', `${base}/activate`, { reason });
            if (a.ok) done(r, key, 'OK', { amount }); else blocked(r, key, 'ACTIVATION_' + codeOf(a));
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
        `SELECT p.category, m.code AS market, COUNT(DISTINCT p.id)::int AS n,
                array_agg(DISTINCT COALESCE(sc.supplier_name, 'inconnu')) AS sources
           FROM products p
           JOIN product_market_price_drafts d ON d.product_id = p.id AND d.status = 'LOCAL_ACTIVE'
           JOIN markets m ON m.id = d.market_id
           JOIN product_market_exposure x ON x.product_id = p.id AND x.market_id = m.id AND x.commercial_exposure = 'ENABLED'
           LEFT JOIN sourcing_candidates sc ON sc.product_id = p.id
          WHERE p.is_active = TRUE AND p.is_available = TRUE GROUP BY p.category, m.code ORDER BY p.category, m.code`);
      const http = {};
      for (const c of [...new Set(MANIFEST.entries.map((x) => x.category))]) {
        for (const m of MANIFEST.markets) {
          const res = await fetch(`${BASE}/api/products?market=${m}&category=${encodeURIComponent(c)}&limit=50`);
          const j = await res.json().catch(() => ({}));
          http[`${c}|${m}`] = { status: res.status, total: j.total ?? null, with_price_and_image: (j.products || []).filter((p) => p.image_url || p.image).length };
        }
      }
      report.census = { sql: rows, http_public: http };
    }
    const blockedSteps = report.entries.flatMap((x) => Object.values(x.steps)).filter((s) => s.status === 'BLOCKED').length;
    report.blocked_steps = blockedSteps;
    report.verdict = mode === 'dry-run' ? 'DRY_RUN_OK' : blockedSteps ? 'PARTIAL_BLOCKED' : 'SEED_OK';
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
module.exports = { validateManifest, referenceAmount, PHASES, CONFIRMATION };
