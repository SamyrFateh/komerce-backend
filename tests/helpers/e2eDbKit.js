'use strict';

/**
 * tests/helpers/e2eDbKit.js
 *
 * Socle partagé des E2E fonctionnels Feature First (tests/e2e-api/**).
 *
 * Rôle — et pourquoi il est transverse plutôt que dupliqué par feature :
 * chaque E2E à écriture doit satisfaire les mêmes quatre obligations
 * (chantier E2E Feature First, doctrine §2) :
 *
 *   1. refuser de s'exécuter contre une base de production (fail-closed) ;
 *   2. créer des identifiants uniques (pas d'UUID fixes partagés entre
 *      suites — source de collisions quand deux specs tournent sur la même
 *      base de test) ;
 *   3. nettoyer ses données, dans l'ordre inverse de création ;
 *   4. se skipper explicitement — jamais échouer en dur — quand
 *      DATABASE_URL est absent, comme le fait déjà
 *      tests/integration/alerts-contract-real-db.test.js.
 *
 * Ce kit ne mocke RIEN : il n'expose que de l'outillage d'environnement.
 * Les mocks de req/res restent dans tests/helpers/backendTestKit.js, le
 * mock de client transactionnel dans tests/integration/test-harness/mock-db.js.
 * Un E2E qui aurait besoin de l'un de ces deux-là n'est pas un E2E.
 */

const crypto = require('crypto');

// ── 1. Garde anti-production ────────────────────────────────────────────────
// Fail-closed : on n'autorise QUE ce qu'on reconnaît explicitement comme base
// de test. Une URL inconnue est refusée, pas tolérée. Le mode « je bloque une
// liste noire » laisse toujours passer l'hôte qu'on a oublié d'y mettre.
// L9 §17 (STOP-SHIP) — /^railway$/i a été retiré de cette allowlist. Railway
// nomme très souvent sa base par défaut « railway » : la garder ici couplée
// à KOMERCE_E2E_ALLOW_REMOTE revenait à protéger un hôte de prod/staging
// avec un seul opt-in générique. Un hôte marqué PROD_HOST_MARKERS avec une
// base non explicitement reconnue comme test exige maintenant un SECOND
// opt-in explicite (KOMERCE_STAGING_DB_EXPLICIT) — voir assertTestDatabase.
const TEST_DB_ALLOWLIST = [/^komerce_test$/i, /_test$/i, /^test_/i];
const PROD_HOST_MARKERS = ['railway', 'rlwy.net', 'amazonaws', 'komerce.co', 'supabase'];

function parseDbUrl(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname, database: decodeURIComponent(u.pathname.replace(/^\//, '')) };
  } catch {
    return null;
  }
}

/**
 * Lève si DATABASE_URL ne désigne pas une base de test reconnue.
 * Appelée par describeE2E() — un spec n'a normalement pas à l'appeler seul.
 */
function assertTestDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('[e2eDbKit] DATABASE_URL absent — garde non évaluable.');

  const parsed = parseDbUrl(url);
  if (!parsed) throw new Error('[e2eDbKit] DATABASE_URL illisible — refus fail-closed.');

  const hostMarker = PROD_HOST_MARKERS.find((m) => parsed.host.includes(m));
  const namedAsTest = TEST_DB_ALLOWLIST.some((rx) => rx.test(parsed.database));

  if (hostMarker) {
    // L9 §17 — double opt-in obligatoire pour tout hôte ressemblant à de la
    // production/staging (Railway, RDS, komerce.co, Supabase...).
    const remoteAllowed = process.env.KOMERCE_E2E_ALLOW_REMOTE === '1';
    if (!remoteAllowed) {
      throw new Error(
        `[e2eDbKit] REFUS — l'hôte « ${parsed.host} » ressemble à un hébergeur de production ` +
        `(marqueur « ${hostMarker} »). Les E2E à écriture ne tournent que sur une base de test. ` +
        `Posez KOMERCE_E2E_ALLOW_REMOTE=1 si vous ciblez délibérément un staging distant.`
      );
    }
    // Un hôte distant AVEC un nom de base générique (ex. « railway ») exige
    // un second opt-in explicite : KOMERCE_E2E_ALLOW_REMOTE seul ne suffit
    // plus à couvrir le cas où le nom de base ne dit rien de son usage.
    const explicitStaging = process.env.KOMERCE_STAGING_DB_EXPLICIT === '1';
    if (!namedAsTest && !explicitStaging) {
      throw new Error(
        `[e2eDbKit] REFUS — hôte distant « ${parsed.host} » + base « ${parsed.database} » ` +
        `non reconnue comme base de test. Nommez la base komerce_test/*_test/test_* ou ` +
        `posez KOMERCE_STAGING_DB_EXPLICIT=1 (second opt-in requis pour un hôte de ` +
        `production/staging avec un nom de base générique).`
      );
    }
    return { host: parsed.host, database: parsed.database };
  }

  // Hôte non marqué (ex. localhost) : la reconnaissance par nom suffit.
  if (!namedAsTest) {
    throw new Error(
      `[e2eDbKit] REFUS — la base « ${parsed.database} » n'est pas reconnue comme base de test. ` +
      `Nommez-la komerce_test, *_test ou test_* (voir .github/workflows/ci.yml).`
    );
  }
  return { host: parsed.host, database: parsed.database };
}

// ── 2. Identifiants uniques ─────────────────────────────────────────────────
// Préfixe commun à un run : permet un nettoyage de secours (« DELETE WHERE
// email LIKE 'e2e-<run>%' ») si un afterAll a été coupé.
const RUN_TAG = `e2e${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

/** UUID v4 réel — jamais un UUID fixe partagé entre suites. */
function uuid() {
  return crypto.randomUUID();
}

/** Chaîne unique et traçable, ex. tag('email') → 'e2ele1x9f-email-7c2a'. */
function tag(label) {
  return `${RUN_TAG}-${label}-${crypto.randomBytes(2).toString('hex')}`;
}

// ── 3. Registre de nettoyage ────────────────────────────────────────────────
/**
 * Empile des suppressions et les rejoue dans l'ordre inverse (LIFO), ce qui
 * respecte naturellement les clés étrangères : l'enfant créé en dernier est
 * supprimé en premier.
 */
function createCleanup(db) {
  const stack = [];

  return {
    /** @param {string} table @param {string} column @param {string} value */
    track(table, column, value) {
      stack.push({ table, column, value });
    },
    /** @param {string} sql @param {any[]} params — nettoyage sur mesure. */
    trackSql(sql, params = []) {
      stack.push({ sql, params });
    },
    async run() {
      const errors = [];
      while (stack.length) {
        const entry = stack.pop();
        try {
          if (entry.sql) await db.query(entry.sql, entry.params);
          else await db.query(`DELETE FROM ${entry.table} WHERE ${entry.column} = $1`, [entry.value]);
        } catch (err) {
          errors.push(`${entry.sql || entry.table}: ${err.message}`);
        }
      }
      // On ne masque pas un nettoyage raté : une donnée orpheline fausse le
      // run suivant, et le silence est précisément ce qui rend ce genre de
      // bug introuvable trois semaines plus tard.
      if (errors.length) {
        throw new Error(`[e2eDbKit] nettoyage incomplet :\n  - ${errors.join('\n  - ')}`);
      }
    },
  };
}

// ── 4. Enveloppe de suite ───────────────────────────────────────────────────
/**
 * Remplace `describe` dans les E2E à base réelle.
 *
 *   - DATABASE_URL absent  → suite skippée, message explicite, exit 0.
 *   - DATABASE_URL suspect → suite EN ÉCHEC (on ne skippe pas une garde de
 *     sécurité : un skip silencieux sur une URL de prod est exactement le
 *     scénario qu'on veut rendre impossible).
 *   - sinon                → suite exécutée.
 *
 * @param {string} title
 * @param {(ctx: {db: object}) => void} body
 */
function describeE2E(title, body) {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line jest/no-disabled-tests
    describe.skip(`${title} — SKIPPED: DATABASE_URL absent`, () => {
      it('exige DATABASE_URL (voir .github/workflows/ci.yml)', () => {});
    });
    return;
  }

  const target = assertTestDatabase();
  const db = require('../../db');

  describe(`${title} [db=${target.database}]`, () => {
    // Les hooks de nettoyage du scénario sont enregistrés par body()
    // avant ce finaliseur : les données sont supprimées avant le pool.
    body({ db });
    afterAll(async () => {
      if (db.pool && db.pool.end) await db.pool.end();
    });
  });
}

// ── 5. Prix local actif (achat marché) ──────────────────────────────────────
/**
 * Fixture E2E : preuve de livrabilité minimale (attestation) pour que le checkout accepte le marché de test.
 * Insertion directe, comme activateLocalPrice : vérité d'état minimale, pas le workflow central complet.
 */
async function attestMarketDeliveryForTest(db, cleanup, marketId) {
  const existing = await db.query(
    `SELECT 1 FROM market_delivery_attestations WHERE market_id = $1 AND revoked_at IS NULL AND valid_until > NOW() LIMIT 1`,
    [marketId]
  );
  if (existing.rows.length) return;
  const carrierId = uuid();
  await db.query(`INSERT INTO carriers (id, name, type, is_active) VALUES ($1,'E2E carrier','maritime',TRUE)`, [carrierId]);
  const attId = uuid();
  await db.query(
    `INSERT INTO market_delivery_attestations
       (id, market_id, carrier_id, mode, origin_ref, freight_rate, rate_currency, rate_unit, transit_days, evidence_ref, attested_by, valid_until)
     VALUES ($1,$2,$3,'SEA','E2E-ORIGIN',1,'KMF','PER_KG',30,'E2E-EVIDENCE',(SELECT id FROM users ORDER BY created_at LIMIT 1), NOW() + INTERVAL '30 days')`,
    [attId, marketId, carrierId]
  );
  // LIFO : le transporteur (parent) est empilé AVANT l'attestation (enfant) pour être supprimé après elle.
  cleanup.track('carriers', 'id', carrierId);
  cleanup.track('market_delivery_attestations', 'id', attId);
}

/**
 * Fixture E2E (lot 3) : autorise explicitement un moyen d'encaissement central (stripe_eur / paypal_eur)
 * pour un marché de test. Volontairement NON appelé par activateLocalPrice : l'autorisation est une décision
 * de test explicite, jamais implicite (le gate est fail-closed).
 */
async function authorizeCentralCollectionForTest(db, cleanup, marketId, paymentMode = 'stripe_eur') {
  await db.query(
    `INSERT INTO market_central_collection_modes (market_id, payment_mode, evidence_ref)
     VALUES ($1,$2,'E2E-EVIDENCE')
     ON CONFLICT (market_id, payment_mode) DO UPDATE SET revoked_at = NULL`,
    [marketId, paymentMode]
  );
  cleanup.trackSql(`DELETE FROM market_central_collection_modes WHERE market_id='${marketId}' AND payment_mode='${paymentMode}'`);
}

/**
 * Fixture E2E (C2) : réception PHYSIQUE complète d'une ligne de commande (PO historique + allocation + unité
 * + placement RECEIVE), pour qu'un test qui fait avancer une commande réelle jusqu'à `preparation` respecte le
 * gate de couverture physique. Insertion directe (vérité d'état minimale) ; nettoyage enregistré en LIFO sous
 * session_replication_role=replica (journaux de custody append-only).
 */
async function seedPhysicalReceiptForTest(db, cleanup, { orderId, itemId, productId, marketId, relaisId, quantity = 1 }) {
  const supplierId = uuid(); const skuId = uuid(); const poId = uuid(); const allocationId = uuid(); const unitId = uuid();
  const ref = tag('c2-unit');
  const soi = { provider: 'manual', version: 1, payload: { supplier_sku: ref } };
  cleanup.trackSql(`
    SET session_replication_role = replica;
    DELETE FROM hub_physical_unit_placements WHERE allocation_id = '${allocationId}';
    DELETE FROM hub_purchase_allocations WHERE id = '${allocationId}';
    DELETE FROM hub_physical_units WHERE id = '${unitId}';
    DELETE FROM purchase_orders WHERE id = '${poId}';
    DELETE FROM product_skus WHERE id = '${skuId}';
    DELETE FROM suppliers WHERE id = '${supplierId}';
    SET session_replication_role = origin;
  `);
  await db.query(`INSERT INTO suppliers (id, name, platform) VALUES ($1,$2,'cj')`, [supplierId, `E2E C2 Supplier ${ref}`]);
  await db.query(`INSERT INTO product_skus (id, product_id, sku, stock, is_active, source, supplier_sku, supplier_unit_ref, supplier_order_identity)
                  VALUES ($1,$2,$3,0,true,'SUPPLIER',$4,$4,$5::jsonb)`, [skuId, productId, `K-${ref}`, ref, JSON.stringify(soi)]);
  await db.query(`INSERT INTO purchase_orders (id, order_id, order_item_id, product_sku_id, supplier_id, supplier_sku, supplier_unit_ref, supplier_order_identity, qty, status)
                  VALUES ($1,$2,$3,$4,$5,$6,$6,$7::jsonb,$8,'confirmed')`, [poId, orderId, itemId, skuId, supplierId, ref, JSON.stringify(soi), quantity]);
  await db.query(`INSERT INTO hub_purchase_allocations (id, purchase_order_id, order_id, order_item_id, product_sku_id, supplier_id, supplier_unit_ref, supplier_order_identity, quantity, market_id, destination_ref)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
    [allocationId, poId, orderId, itemId, skuId, supplierId, ref, JSON.stringify(soi), quantity, marketId, `relais:${relaisId}`]);
  await db.query(`INSERT INTO hub_physical_units (id, reference, unit_type, state, external_ref, current_location_ref) VALUES ($1,$2,'SUPPLIER_PACKAGE','RECEIVED',$2,'DXB-HUB')`, [unitId, ref]);
  await db.query(`INSERT INTO hub_physical_unit_placements (physical_unit_id, allocation_id, quantity, operation_type) VALUES ($1,$2,$3,'RECEIVE')`, [unitId, allocationId, quantity]);
}

/**
 * Insertion directe d'un `product_market_price_drafts` en statut LOCAL_ACTIVE.
 *
 * Doctrine (2026-09, décision L1, services/market-local-price-resolution-
 * service.js) : dès qu'un marketId est résolu côté serveur, SEUL un
 * LOCAL_ACTIVE pour ce marché rend un produit achetable — jamais de fallback
 * silencieux vers products.price_kmf. Le chemin applicatif réel pour y
 * arriver passe par tout le gate économique (pricing-engine, CDR, politique
 * de décision marché — cf. services/market-local-price-activation-service.js),
 * volontairement lourd et non pertinent pour un E2E qui ne teste pas la
 * tarification elle-même. Ce helper court-circuite ce gate en insertion
 * directe, à l'identique de l'esprit des autres fixtures E2E/intégration
 * (markets, ceiling_templates, ...) : une vérité d'état minimale, pas un
 * rejeu du workflow applicatif complet.
 *
 * @param {object} db
 * @param {ReturnType<typeof createCleanup>} cleanup
 * @param {{ marketId: string, productId: string, amount: number|string, currency: string }} opts
 */
async function activateLocalPrice(db, cleanup, { marketId, productId, amount, currency }) {
  const id = uuid();
  await db.query(
    `INSERT INTO product_market_price_drafts
       (id, market_id, product_id, amount, currency, status, reason, authorized_at, authorization_snapshot, active_at)
     VALUES ($1,$2,$3,$4,$5,'LOCAL_ACTIVE','E2E — activation directe de test', NOW(), '{}'::jsonb, NOW())
     ON CONFLICT (market_id, product_id) DO UPDATE SET
       amount = EXCLUDED.amount,
       currency = EXCLUDED.currency,
       status = 'LOCAL_ACTIVE',
       authorized_at = NOW(),
       authorization_snapshot = '{}'::jsonb,
       active_at = NOW()`,
    [id, marketId, productId, amount, currency]
  );
  cleanup.track('product_market_price_drafts', 'id', id);
  // Exposition ENABLED : obligatoire à la transaction (checkout/panier partagé), en plus de LOCAL_ACTIVE.
  const exposureId = uuid();
  await db.query(
    `INSERT INTO product_market_exposure (id, product_id, market_id, commercial_exposure)
     VALUES ($1,$2,$3,'ENABLED')
     ON CONFLICT (product_id, market_id) DO UPDATE SET commercial_exposure = 'ENABLED', updated_at = NOW()`,
    [exposureId, productId, marketId]
  );
  cleanup.track('product_market_exposure', 'product_id', productId);
  await attestMarketDeliveryForTest(db, cleanup, marketId);
  return { id, market_id: marketId, product_id: productId, amount, currency };
}

module.exports = {
  activateLocalPrice,
  attestMarketDeliveryForTest,
  authorizeCentralCollectionForTest,
  assertTestDatabase,
  createCleanup,
  describeE2E,
  seedPhysicalReceiptForTest,
  RUN_TAG,
  tag,
  uuid,
};
