'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgres://komerce:komerce@localhost:5432/komerce_test';
process.env.NODE_ENV = 'test';

const db = require('./db');
const { createSharedCartFromCartItems } = require('./services/shared-cart-creation');

async function main() {
  // Prépare : un utilisateur + un produit vendable simple.
  const { rows: userRows } = await db.query(
    `INSERT INTO users (phone, full_name, role)
       VALUES ('3210001', 'Test Concurrence', 'client')
       RETURNING id`
  );
  const userId = userRows[0].id;

  const { rows: productRows } = await db.query(
    `INSERT INTO products (name, price_kmf, category, is_active, inventory_model)
       VALUES ('Produit test concurrence', 1000, 'test', true, 'LEGACY_VARIANTS')
       RETURNING id`
  );
  const productId = productRows[0].id;

  const cartItems = [{ product_id: productId, quantity: 1 }];

  console.log('→ Lancement de 2 créations simultanées pour le même organisateur…');
  const results = await Promise.allSettled([
    createSharedCartFromCartItems(userId, cartItems, {}),
    createSharedCartFromCartItems(userId, cartItems, {}),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  console.log(`  succès : ${fulfilled.length}, échecs : ${rejected.length}`);

  if (fulfilled.length !== 1) {
    throw new Error(`ATTENDU exactement 1 succès, obtenu ${fulfilled.length}`);
  }
  if (rejected.length !== 1) {
    throw new Error(`ATTENDU exactement 1 échec, obtenu ${rejected.length}`);
  }

  const winnerToken = fulfilled[0].value.token;
  const loserErr = rejected[0].reason;

  console.log('  gagnant.token       =', winnerToken);
  console.log('  perdant.code        =', loserErr.code);
  console.log('  perdant.status      =', loserErr.status);
  console.log('  perdant.existing_token =', loserErr.existing_token);

  if (loserErr.code !== 'open_list_exists') {
    throw new Error(`ATTENDU code=open_list_exists, obtenu ${loserErr.code}`);
  }
  if (!loserErr.existing_token) {
    throw new Error('ÉCHEC — existing_token est absent/faux sur le conflit perdant (bug §4 non corrigé)');
  }
  if (loserErr.existing_token !== winnerToken) {
    throw new Error(
      `ÉCHEC — existing_token (${loserErr.existing_token}) ne correspond pas au token gagnant (${winnerToken})`
    );
  }

  const { rows: openRows } = await db.query(
    `SELECT count(*)::int AS n FROM shared_carts WHERE organizer_user_id = $1 AND status = 'open'`,
    [userId]
  );
  console.log('  nb OPEN en DB pour cet organisateur =', openRows[0].n);
  if (openRows[0].n !== 1) {
    throw new Error(`ATTENDU exactement 1 liste OPEN en DB, obtenu ${openRows[0].n}`);
  }

  console.log('\n✔ PREUVE DE CONCURRENCE — TOUS LES INVARIANTS §4 SONT VÉRIFIÉS');
  console.log('  - 1 seule création réussit');
  console.log('  - 1 seule liste OPEN existe en DB');
  console.log('  - le conflit renvoie code=open_list_exists + existing_token correct');
  console.log('  - aucun 500 (aucune exception non gérée)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n✘ ÉCHEC DE LA PREUVE DE CONCURRENCE :', err.message);
    process.exit(1);
  });
