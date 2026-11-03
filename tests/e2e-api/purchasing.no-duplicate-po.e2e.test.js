'use strict';


/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-P0-PURCHASING — purchasing · besoin d'achat unique (modèle regroupé)
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
 * Contrat mesuré (services/purchasing-trigger-service.js, P0-5) :
 *   un article payé devient exactement UNE ligne d'achat ouverte (sans PO) ;
 *   le rejeu renvoie `already_exists` ; une ligne annulée ne bloque pas un
 *   nouveau besoin ; aucune PO n'est créée par commande.
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
      `INSERT INTO orders (id, user_id, relais_id, market_id, reference, status, payment_status,
                           payment_mode, total_kmf, total_eur)
       VALUES ($1, $2, $3, (SELECT market_id FROM relais WHERE id = $3), $4, 'confirmed', 'paid', 'cash_relais', 50000, 100)`,
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

  const linesOf = async (orderId) => {
    const { rows } = await db.query(
      `SELECT pl.id, pl.quantity, pl.purchase_order_id, pl.cancelled_at, pl.product_supplier_id,
              pl.product_sku_id, pl.supplier_order_identity
         FROM purchase_lines pl JOIN order_items oi ON oi.id = pl.order_item_id
        WHERE oi.order_id = $1 ORDER BY pl.created_at ASC`,
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
    const itemsOfRun = `SELECT id FROM order_items WHERE order_id IN (${ordersOfRun})`;
    cleanup.trackSql(`
      SET session_replication_role = replica;
      DELETE FROM purchase_lines WHERE order_item_id IN (${itemsOfRun});
      DELETE FROM purchase_orders WHERE supplier_id = '${supplierId}';
      DELETE FROM order_status_history WHERE order_id IN (${ordersOfRun});
      DELETE FROM invoices WHERE order_id IN (${ordersOfRun});
      DELETE FROM order_items WHERE order_id IN (${ordersOfRun});
      DELETE FROM orders WHERE user_id = '${clientId}';
      DELETE FROM product_suppliers WHERE supplier_id = '${supplierId}';
      DELETE FROM products WHERE name LIKE 'E2E Purchasing ${RUN_TAG}%';
      DELETE FROM relais WHERE id = '${relaisId}';
      DELETE FROM suppliers WHERE id = '${supplierId}';
      DELETE FROM users WHERE id = '${clientId}';
      SET session_replication_role = origin;
    `);

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

  // ── 1. NOMINAL ──────────────────────────────────────────────────────────
  it('1 — NOMINAL : un article payé devient exactement une ligne ouverte, aucune PO', async () => {
    const n = await seedNeed('nominal', { quantity: 2 });

    const result = await triggerPurchasing(n.orderId);

    expect(await posOf(n.orderId)).toHaveLength(0);
    const lines = await linesOf(n.orderId);
    expect(lines).toHaveLength(1);
    expect(lines[0].purchase_order_id).toBeNull();
    expect(Number(lines[0].quantity)).toBe(2);
    expect(lines[0].product_supplier_id).toBe(n.productSupplierId);
    expect(lines[0].product_sku_id).toBeNull();
    expect(lines[0].supplier_order_identity).toBeNull();

    expect(result.purchase_orders).toHaveLength(1);
    expect(result.purchase_orders[0]).toMatchObject({ status: 'line_opened', purchase_order_id: null, purchase_line_id: lines[0].id });
  });

  // ── 2. REJEU ────────────────────────────────────────────────────────────
  it('2 — rejeu du déclenchement : aucune seconde ligne (webhook de paiement réémis)', async () => {
    const n = await seedNeed('replay', { quantity: 3 });

    await triggerPurchasing(n.orderId);
    const afterFirst = await linesOf(n.orderId);
    expect(afterFirst).toHaveLength(1);

    const second = await triggerPurchasing(n.orderId);

    const afterSecond = await linesOf(n.orderId);
    expect(afterSecond.map((l) => l.id)).toEqual(afterFirst.map((l) => l.id));
    expect(second.purchase_orders[0].status).toBe('already_exists');
    expect(await posOf(n.orderId)).toHaveLength(0);
  });

  // ── 3. TRIPLE REJEU + CONCURRENCE ───────────────────────────────────────
  it('3 — trois déclenchements successifs puis deux concurrents : toujours une seule ligne', async () => {
    const n = await seedNeed('triple');

    await triggerPurchasing(n.orderId);
    await triggerPurchasing(n.orderId);
    await triggerPurchasing(n.orderId);
    await Promise.allSettled([triggerPurchasing(n.orderId), triggerPurchasing(n.orderId)]);

    expect(await linesOf(n.orderId)).toHaveLength(1);
    expect(await posOf(n.orderId)).toHaveLength(0);
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

  // ── 5. LIGNE ANNULÉE ────────────────────────────────────────────────────
  it('5 — une ligne annulée ne bloque pas un nouveau besoin', async () => {
    const n = await seedNeed('recreate');

    await triggerPurchasing(n.orderId);
    const [first] = await linesOf(n.orderId);

    await db.query("UPDATE purchase_lines SET cancelled_at = now(), cancel_reason = 'e2e' WHERE id = $1", [first.id]);

    await triggerPurchasing(n.orderId);

    const lines = await linesOf(n.orderId);
    expect(lines).toHaveLength(2);
    const active = lines.filter((l) => !l.cancelled_at);
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(first.id);
  });

  // ── 6. ANNULATION DE COMMANDE ────────────────────────────────────────────
  it("6 — l'annulation de la commande annule ses lignes ouvertes", async () => {
    const n = await seedNeed('cancelorder');

    await triggerPurchasing(n.orderId);
    expect(await linesOf(n.orderId)).toHaveLength(1);

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
    const stillOpen = (await linesOf(n.orderId)).filter((l) => !l.cancelled_at);
    expect(stillOpen).toHaveLength(0);
  });
});