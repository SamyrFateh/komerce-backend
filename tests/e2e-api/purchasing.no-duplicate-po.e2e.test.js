'use strict';


/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-P0-PURCHASING — purchasing · anti-doublon de bon de commande
 *
 * Feature propriétaire : purchasing
 * Features traversées  : orders (commande cliente, machine de statut),
 *                        catalog (produit), logistics (relais)
 *
 * Invariants visés (features/purchasing.feature.js) :
 *   « un besoin d'achat déjà couvert par un bon de commande existant ne recrée
 *     jamais de doublon (idempotence applicative anti-replay, I-SWEEP-3B) »
 *   « purchasing peut consommer et lire la commande cliente, mais ne possède
 *     jamais son cycle de vie — toute mutation de orders.status continue de
 *     passer exclusivement par order-status-machine.js »
 *
 * Contrat mesuré (services/purchasing-trigger-service.js, I-SWEEP-3B) :
 *   avant toute création, une recherche
 *     WHERE order_id = $1 AND product_supplier_id = $2 AND status != 'cancelled'
 *   renvoie `already_exists` et court-circuite l'INSERT. La clé d'unicité est
 *   donc le couple (commande, mapping produit→fournisseur), et un bon de
 *   commande ANNULÉ ne bloque pas un nouveau besoin — ce qui est cohérent : on
 *   doit pouvoir racheter après une annulation fournisseur.
 *
 * FRONTIÈRE RÉSEAU CONTRÔLÉE : aucune. `ADMIN_WHATSAPP` n'est pas défini dans
 * l'environnement de test, donc la notification fournisseur est désactivée à la
 * source par le service lui-même (log « WhatsApp notifications disabled »).
 * Aucun mock n'est nécessaire.
 *
 * DOCTRINE RED — les assertions expriment le contrat métier attendu.
 */

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P0-PURCHASING — purchasing · anti-doublon de bon de commande', ({ db }) => {
  const { triggerPurchasing } = require('../../services/purchasing-trigger-service');
  const { transitionOrderStatus } = require('../../services/order-status-machine');

  const clientId = uuid();
  const relaisId = uuid();
  const supplierId = uuid();

  let cleanup;

  /** Produit + mapping fournisseur + commande cliente prête à déclencher. */
  async function seedNeed(label, { quantity = 2 } = {}) {
    const productId = uuid();
    const productSupplierId = uuid();
    const orderId = uuid();
    const reference = `E2EPU-${tag(label)}`.toUpperCase();

    await db.query(
      'INSERT INTO products (id, name, price_kmf, stock, price_aed) VALUES ($1, $2, 25000, 30, 200)',
      [productId, `E2E Purchasing ${tag(label)}`]
    );
    await db.query(
      `INSERT INTO product_suppliers
         (id, product_id, supplier_id, supplier_sku, supplier_price_aed,
          min_order_qty, priority, is_active)
       VALUES ($1, $2, $3, $4, 180, 1, 1, true)`,
      [productSupplierId, productId, supplierId, `SKU-${tag(label)}`]
    );
    await db.query(
      `INSERT INTO orders (id, user_id, relais_id, reference, status, payment_status,
                           payment_mode, total_kmf, total_eur)
       VALUES ($1, $2, $3, $4, 'confirmed', 'paid', 'cash_relais', 50000, 100)`,
      [orderId, clientId, relaisId, reference]
    );
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf)
       VALUES ($1, $2, $3, $4, 25000)`,
      [uuid(), orderId, productId, quantity]
    );
    return { productId, productSupplierId, orderId, reference };
  }

  const posOf = async (orderId) => {
    const { rows } = await db.query(
      `SELECT id, status, qty, product_supplier_id
         FROM purchase_orders WHERE order_id = $1 ORDER BY created_at ASC`,
      [orderId]
    );
    return rows;
  };

  const orderStatus = async (orderId) => {
    const { rows } = await db.query('SELECT status FROM orders WHERE id = $1', [orderId]);
    return rows[0].status;
  };

  const historyOf = async (orderId) => {
    const { rows } = await db.query(
      'SELECT status FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC, status ASC',
      [orderId]
    );
    return rows.map((r) => r.status);
  };

  beforeAll(async () => {
    cleanup = createCleanup(db);

    const ordersOfRun = `SELECT id FROM orders WHERE user_id = '${clientId}'`;
    cleanup.trackSql('DELETE FROM users WHERE id = $1', [clientId]);
    cleanup.trackSql('DELETE FROM suppliers WHERE id = $1', [supplierId]);
    cleanup.trackSql('DELETE FROM products WHERE name LIKE $1', [`E2E Purchasing ${RUN_TAG}%`]);
    cleanup.trackSql('DELETE FROM relais WHERE id = $1', [relaisId]);
    cleanup.trackSql('DELETE FROM product_suppliers WHERE supplier_id = $1', [supplierId]);
    cleanup.trackSql('DELETE FROM orders WHERE user_id = $1', [clientId]);
    cleanup.trackSql(`DELETE FROM purchase_orders WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(`DELETE FROM order_status_history WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(`DELETE FROM invoices WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(`DELETE FROM order_items WHERE order_id IN (${ordersOfRun})`);

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, 'E2E Purchasing Client', $2, $3, 'client')`,
      [clientId, `${tag('puclient')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]
    );
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
       VALUES ($1, 'E2E Relais Purchasing', 'E2E Agent', '+269000111', 'Moroni Test', (SELECT id FROM markets WHERE code = 'KM'))`,
      [relaisId]
    );
    await db.query(
      `INSERT INTO suppliers (id, name, platform, contact_phone, auto_order, is_active)
       VALUES ($1, $2, 'whatsapp', '+971500000000', false, true)`,
      [supplierId, `E2E Fournisseur ${tag('sup')}`]
    );
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  // ── 1. NOMINAL ───────────────────────────────────────────────────────────
  it('1 — NOMINAL : un besoin génère un bon de commande, avec la quantité commandée', async () => {
    const n = await seedNeed('nominal', { quantity: 2 });

    const result = await triggerPurchasing(n.orderId);

    const pos = await posOf(n.orderId);
    expect(pos).toHaveLength(1);
    // Valeur mesurée, pas supposée : le bon naît `pending` puis passe à
    // `notified` parce que le fournisseur de test est sur WhatsApp et que
    // notifySupplierWhatsApp inscrit son wa_url dans la même transaction.
    // Asserter `pending` reviendrait à figer une étape intermédiaire.
    expect(pos[0].status).toBe('notified');
    expect(Number(pos[0].qty)).toBe(2);
    expect(pos[0].product_supplier_id).toBe(n.productSupplierId);

    // Contrat de retour mesuré : { purchase_orders: Array } — un seul besoin
    // couvert, rattaché au bon mapping produit->fournisseur.
    expect(Array.isArray(result.purchase_orders)).toBe(true);
    expect(result.purchase_orders).toHaveLength(1);
    expect(result.purchase_orders[0].purchase_order_id).toBe(pos[0].id);
    expect(result.purchase_orders[0].status).not.toBe('already_exists');
  });

  // ── 2. IDEMPOTENCE I-SWEEP-3B ────────────────────────────────────────────
  it('2 — rejeu du déclenchement : aucun second bon de commande (I-SWEEP-3B)', async () => {
    const n = await seedNeed('replay', { quantity: 3 });

    await triggerPurchasing(n.orderId);
    const afterFirst = await posOf(n.orderId);
    expect(afterFirst).toHaveLength(1);

    // Le rejeu est le cas réel : le webhook de paiement déclenche l'achat en
    // fire-and-forget, et Stripe peut réémettre. Deux bons de commande pour un
    // même besoin, c'est une double commande fournisseur — de l'argent réel.
    const second = await triggerPurchasing(n.orderId);

    const afterSecond = await posOf(n.orderId);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].id).toBe(afterFirst[0].id);
    expect(afterSecond[0].status).toBe(afterFirst[0].status);

    // Le service doit le dire explicitement, pas échouer en silence.
    expect(second.purchase_orders).toHaveLength(1);
    expect(second.purchase_orders[0].status).toBe('already_exists');
    expect(second.purchase_orders[0].purchase_order_id).toBe(afterFirst[0].id);
  });

  // ── 3. TRIPLE REJEU ──────────────────────────────────────────────────────
  it('3 — trois déclenchements successifs : toujours un seul bon de commande', async () => {
    const n = await seedNeed('triple');

    await triggerPurchasing(n.orderId);
    await triggerPurchasing(n.orderId);
    await triggerPurchasing(n.orderId);

    expect(await posOf(n.orderId)).toHaveLength(1);
  });

  // ── 4. FRONTIÈRE D'OWNERSHIP ─────────────────────────────────────────────
  it("4 — purchasing ne mute jamais orders.status lui-même", async () => {
    const n = await seedNeed('ownership');
    const before = await orderStatus(n.orderId);
    const historyBefore = await historyOf(n.orderId);

    await triggerPurchasing(n.orderId);

    // « purchasing […] ne possède jamais son cycle de vie » : le déclenchement
    // d'achat lit la commande et crée des bons, mais ne touche pas au statut.
    // Toute transition doit venir d'order-status-machine.js, seul écrivain de
    // order_status_history — donc aucune nouvelle ligne ici.
    expect(await orderStatus(n.orderId)).toBe(before);
    expect(await historyOf(n.orderId)).toEqual(historyBefore);
  });

  // ── 5. BON DE COMMANDE ANNULÉ ────────────────────────────────────────────
  it("5 — un bon de commande annulé ne bloque pas un nouveau besoin", async () => {
    const n = await seedNeed('recreate');

    await triggerPurchasing(n.orderId);
    const [first] = await posOf(n.orderId);

    // Annulation côté fournisseur : le besoin redevient à couvrir.
    await db.query("UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1", [first.id]);

    await triggerPurchasing(n.orderId);

    const pos = await posOf(n.orderId);
    // La garde exclut explicitement les bons `cancelled` : un nouveau bon doit
    // pouvoir naître, sinon un achat annulé condamnerait la commande cliente.
    expect(pos).toHaveLength(2);
    const active = pos.filter((p) => p.status !== 'cancelled');
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(first.id);
  });

  // ── 6. ANNULATION DE COMMANDE ────────────────────────────────────────────
  it("6 — l'annulation de la commande libère les bons de commande liés", async () => {
    const n = await seedNeed('cancelorder');

    await triggerPurchasing(n.orderId);
    expect(await posOf(n.orderId)).toHaveLength(1);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await transitionOrderStatus({
        client,
        orderId: n.orderId,
        newStatus: 'cancelled',
        actorRole: 'admin',
        source: 'e2e_purchasing_cancel',
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    expect(await orderStatus(n.orderId)).toBe('cancelled');

    // Invariant orders : « annulation libere les achats fournisseurs lies dans
    // la meme transaction ». Laisser un bon `pending` sur une commande annulée
    // ferait acheter chez le fournisseur une marchandise que personne n'attend.
    const pos = await posOf(n.orderId);
    const stillOpen = pos.filter((p) => p.status !== 'cancelled');
    expect(stillOpen).toHaveLength(0);
  });
});
