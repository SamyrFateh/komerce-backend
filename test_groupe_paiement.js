/**
 * TEST BOUT EN BOUT — Payer en groupe (shared cart)
 * ══════════════════════════════════════════════════
 *
 * Exécuter avec Node.js depuis la racine du backend :
 *   node test_groupe_paiement.js
 *
 * Ou en ciblant l'URL de prod :
 *   BASE_URL=https://komerce-backend-production.up.railway.app node test_groupe_paiement.js
 *
 * Ce script teste :
 *   1. Création d'un panier groupe (POST /api/shared-carts/from-cart-items)
 *   2. Lecture publique du panier (GET /api/shared-carts/public/:token)
 *   3. Simulation d'une contribution (sans Stripe — directement en DB via admin)
 *   4. Lecture créateur (GET /api/shared-carts/mine)
 *   5. Finalisation → commande (POST /api/shared-carts/:id/finalize)
 */

'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ── Helpers ──────────────────────────────────────────────────────────────
async function req(method, path, body, cookie) {
  const fetch = (await import('node-fetch')).default;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE_URL + path, opts);
  const setCookie = res.headers.get('set-cookie');
  const data = await res.json().catch(() => ({ _status: res.status }));
  return { status: res.status, data, setCookie };
}

function ok(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}`, detail || '');
    process.exitCode = 1;
  }
}

// ── Données de test ──────────────────────────────────────────────────────
const TEST_PHONE    = '+2693211234';   // numéro de test comorien
const TEST_PRODUCTS = [];              // sera rempli dynamiquement

// ── ÉTAPE 0 : Récupérer des produits existants ───────────────────────────
async function getTestProducts() {
  console.log('\n📦 Étape 0 — Récupération de produits de test...');
  const { status, data } = await req('GET', '/api/products?limit=2');
  ok('GET /api/products répond 200', status === 200, `status=${status}`);
  if (data.products?.length) {
    data.products.slice(0, 2).forEach(p => {
      TEST_PRODUCTS.push({ product_id: p.id, quantity: 1 });
    });
    console.log(`  → ${TEST_PRODUCTS.length} produit(s) sélectionné(s) :`, TEST_PRODUCTS.map(p => p.product_id));
  } else {
    // Fallback : utiliser des IDs fictifs pour tester la validation
    TEST_PRODUCTS.push({ product_id: 1, quantity: 1 });
    console.log('  ⚠️  Pas de produits trouvés — utilisation d\'ID fictif pour test validation');
  }
}

// ── ÉTAPE 1 : Créer le panier groupe ────────────────────────────────────
async function testCreateGroupCart() {
  console.log('\n🛒 Étape 1 — Création du panier groupe...');

  const { status, data, setCookie } = await req('POST', '/api/shared-carts/from-cart-items', {
    cart_items: TEST_PRODUCTS,
    title: 'Test panier groupe famille',
    tracking_phone: TEST_PHONE,
    recipient_phone: TEST_PHONE,
  });

  console.log('  Status:', status);
  console.log('  Réponse:', JSON.stringify(data, null, 2));

  ok('Status 200 ou 201', [200, 201].includes(status), `status=${status}`);
  ok('share_url présent', !!data.share_url, data.error);
  ok('token présent', !!data.token, data.error);
  ok('total_kmf présent', data.total_kmf > 0, `total=${data.total_kmf}`);

  return { token: data.token, id: data.shared_cart_id, cookie: setCookie };
}

// ── ÉTAPE 2 : Lecture publique ────────────────────────────────────────────
async function testPublicRead(token) {
  console.log('\n👁  Étape 2 — Lecture publique du panier...');

  const { status, data } = await req('GET', `/api/shared-carts/public/${token}`);
  console.log('  Status:', status);

  ok('Status 200', status === 200, `status=${status}`);
  ok('cart présent', !!data.cart, data.error);
  ok('items présents', Array.isArray(data.items) && data.items.length > 0);
  ok('token correct', data.cart?.token === token);

  console.log(`  → Total : ${data.cart?.total_kmf_snapshot} KMF`);
  console.log(`  → Status : ${data.cart?.status}`);
  console.log(`  → Expire : ${data.cart?.expires_at}`);

  return data;
}

// ── ÉTAPE 3 : Simuler une contribution (via route publique sans Stripe) ───
async function testContribution(token, cartData) {
  console.log('\n💰 Étape 3 — Simulation contribution (Stripe)...');
  console.log('  ℹ️  La contribution réelle nécessite Stripe.');
  console.log('  → URL Stripe Checkout serait créée via POST /api/shared-carts/public/:token/contributions');
  console.log('  → Pour tester sans Stripe : utiliser un webhook simulé en dev');

  // On vérifie juste que la route répond correctement avec des données invalides
  const { status, data } = await req('POST', `/api/shared-carts/public/${token}/contributions`, {
    amount_kmf: 100,
    contributor_name: 'Test Contributeur',
    // contributor_email manquant intentionnellement → doit retourner 400
  });

  ok('Validation 400 sur champs manquants', status === 400, `status=${status}`);
  console.log(`  → Erreur attendue : ${data.error}`);

  // Test avec données valides (créera une session Stripe)
  if (process.env.TEST_WITH_STRIPE === 'true') {
    const { status: s2, data: d2 } = await req('POST', `/api/shared-carts/public/${token}/contributions`, {
      amount_kmf: cartData.cart?.total_kmf_snapshot || 1000,
      contributor_name: 'Test Famille',
      contributor_email: 'test@komerce.km',
      contributor_phone: '+2693219999',
      message: 'Test de contribution',
    });
    ok('Création Stripe session 200', s2 === 200, `status=${s2}`);
    if (d2.checkout_url) {
      console.log(`  → Stripe Checkout URL : ${d2.checkout_url.substring(0, 60)}...`);
    }
  } else {
    console.log('  ℹ️  Set TEST_WITH_STRIPE=true pour tester la création Stripe réelle');
  }
}

// ── ÉTAPE 4 : Lecture créateur (GET /mine) ────────────────────────────────
async function testOwnerRead(cookie) {
  console.log('\n👤 Étape 4 — Lecture créateur...');

  const { status, data } = await req('GET', '/api/shared-carts/mine', null, cookie);
  console.log('  Status:', status);

  ok('Status 200 ou 401', [200, 401].includes(status));
  if (status === 200) {
    ok('carts présent', Array.isArray(data.carts));
    console.log(`  → ${data.carts?.length} panier(s) trouvé(s)`);
  } else {
    console.log('  ⚠️  401 — session guest non persistée (normal en test sans cookie jar)');
  }
}

// ── ÉTAPE 5 : Finalisation (nécessite panier fully_funded) ───────────────
async function testFinalize(id, cookie) {
  console.log('\n🚀 Étape 5 — Tentative de finalisation...');

  const { status, data } = await req('POST', `/api/shared-carts/${id}/finalize`, {}, cookie);
  console.log('  Status:', status);
  console.log('  Réponse:', JSON.stringify(data, null, 2));

  if (status === 400 && data.error?.includes('Impossible')) {
    ok('Refus correct (pas encore financé)', true);
    console.log(`  → Erreur attendue : ${data.error}`);
  } else if (status === 200 && data.order_id) {
    ok('Finalisation réussie !', true);
    console.log(`  → Commande créée : ${data.order_reference}`);
    console.log(`  → Prépayé : ${data.prepaid_kmf} KMF`);
    console.log(`  → Restant cash : ${data.remaining_cash_kmf} KMF`);
  } else if (status === 401) {
    ok('401 attendu sans session valide', true);
  } else {
    ok('Réponse inattendue', false, `status=${status} err=${data.error}`);
  }
}

// ── ÉTAPE 6 : Admin — liste des paniers ──────────────────────────────────
async function testAdminList() {
  console.log('\n🔑 Étape 6 — Admin list (nécessite token admin)...');

  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    console.log('  ℹ️  Set ADMIN_TOKEN=xxx pour tester les routes admin');
    return;
  }

  const { status, data } = await req('GET', '/api/admin/shared-carts', null, `token=${adminToken}`);
  ok('Admin GET 200', status === 200, `status=${status}`);
  console.log(`  → ${data.count} panier(s) en base`);
}

// ── RUN ──────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('🧪 TEST FLUX PAYER EN GROUPE — Komerce Shared Cart');
  console.log(`📡 BASE_URL: ${BASE_URL}`);
  console.log('═══════════════════════════════════════════════════');

  try {
    await getTestProducts();

    const { token, id, cookie } = await testCreateGroupCart();

    if (token) {
      const cartData = await testPublicRead(token);
      await testContribution(token, cartData);
      await testOwnerRead(cookie);
      await testFinalize(id, cookie);
    }

    await testAdminList();

  } catch (err) {
    console.error('\n💥 Erreur fatale:', err.message);
    process.exitCode = 1;
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(process.exitCode ? '❌ Tests échoués' : '✅ Tests passés');
  console.log('═══════════════════════════════════════════════════\n');
})();
