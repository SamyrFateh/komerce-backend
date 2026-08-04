/**
 * @komerce-arch
 * @role          shared-cart-items-update-service
 * @domain        shared-cart
 * @layer         service
 * @criticality   high
 * @inputs        shared_cart_id, cart_items, product_id, item_id, actor_identity
 * @outputs       updated_cart_items
 * @depends       db.js, services/shared-cart-internals.js
 * @used-by       routes/shared-cart.js, public/boutique/js/b-cart.js
 * @db-read       order_items, products, shared_cart_items, shared_carts
 * @db-write      shared_cart_events, shared_cart_items, shared_carts
 * @db-txn        open_cart_only
 * @doctrine      panier_ouvert_modifiable, domaine_minimal_boutique_first
 * @impact-areas  shared-cart-editing, creator-flow
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Shared cart v4 item update service (Boutique First, domaine minimal)
 *
 * Panier ouvert / concertation :
 *   - le créateur peut modifier la liste tant qu'elle est 'open' ;
 *   - aucun paiement n'est jamais compté sur la liste elle-même (migration
 *     124 — plus de contributed_kmf) : le seul guard est le statut.
 *
 * SUPPRIMÉ (Boutique First) : adjustAwaitingCartItems — le statut
 * 'awaiting_choice' n'existe plus (shared_cart_status réduit à
 * open/closed/cancelled par la migration 124). Un article déjà réclamé
 * par une commande (order_items.shared_cart_item_id) n'est PAS protégé
 * ici contre une modification de liste par le créateur — c'est un choix
 * assumé : DELETE+INSERT recrée les lignes shared_cart_items avec de
 * nouveaux id, ce qui détacherait un item déjà réclamé de sa commande.
 * ASSUMPTION (toujours ouverte pour updateOpenSharedCartItems / PUT
 * /:id/items) : cet endpoint garde sa sémantique historique inchangée par
 * décision explicite (Contrat API §5 point 4, option A — un contrat
 * existant ne se détourne jamais, on crée une nouvelle capacité à côté).
 * Il reste donc sans garde-fou contre le détachement d'un item déjà
 * réclamé, exactement comme avant.
 *
 * Ce risque est en revanche traité pour le retrait unitaire
 * (removeSharedCartItem, ci-dessous) : un article déjà réclamé ne peut
 * pas être retiré — 409 explicite plutôt qu'un détachement silencieux.
 */

const db = require('../db');
const { r, withTransaction, addEvent } = require('./shared-cart-internals');

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

function normalizeItems(cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw httpError('cart_items requis (panier vide)', 400, 'cart_items_required');
  }

  const qtyByProduct = new Map();
  for (const raw of cartItems) {
    const productId = raw?.product_id;
    if (!productId) continue;
    const qty = r(raw.quantity ?? 1);
    if (qty <= 0) continue;
    qtyByProduct.set(productId, (qtyByProduct.get(productId) || 0) + qty);
  }

  const normalized = Array.from(qtyByProduct.entries()).map(([product_id, quantity]) => ({
    product_id,
    quantity,
  }));

  if (!normalized.length) {
    throw httpError('Aucun produit valide dans le panier', 400, 'no_valid_items');
  }
  return normalized;
}

async function updateOpenSharedCartItems(sharedCartId, userId, cartItems = []) {
  const normalized = normalizeItems(cartItems);

  return withTransaction(async (client) => {
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts
        WHERE id = $1 AND organizer_user_id = $2
        FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!cartRows.length) throw httpError('Panier partagé introuvable ou non autorisé', 404, 'shared_cart_not_found');
    const cart = cartRows[0];

    if (cart.status !== 'open') {
      throw httpError(`Ce panier n'est plus modifiable (statut : ${cart.status})`, 409, 'cart_not_editable');
    }

    const productIds = normalized.map(i => i.product_id);
    const { rows: products } = await client.query(
      `SELECT id, name, image_url, category, price_kmf,
              promo_pct, is_promo, promo_until, is_active
         FROM products
        WHERE id = ANY($1)`,
      [productIds]
    );
    const productsById = new Map(products.map(p => [p.id, p]));

    const now = new Date();
    const enrichedItems = [];
    for (const item of normalized) {
      const p = productsById.get(item.product_id);
      if (!p || !p.is_active) continue;
      const promoActive = p.is_promo &&
        p.promo_pct > 0 &&
        (!p.promo_until || new Date(p.promo_until) >= now);
      const unitPrice = promoActive
        ? r(p.price_kmf * (1 - p.promo_pct / 100))
        : r(p.price_kmf || 0);
      if (unitPrice <= 0) continue;
      enrichedItems.push({
        product_id: p.id,
        name: p.name,
        image_url: p.image_url,
        category: p.category,
        quantity: r(item.quantity),
        unit_price_kmf: unitPrice,
        line_total_kmf: unitPrice * r(item.quantity),
      });
    }

    if (!enrichedItems.length) {
      throw httpError('Aucun produit actif valide après vérification serveur', 400, 'no_active_items');
    }

    const totalKmf = enrichedItems.reduce((sum, item) => sum + r(item.line_total_kmf), 0);
    if (totalKmf <= 0) throw httpError('Total panier invalide', 400, 'invalid_total');

    await client.query(`DELETE FROM shared_cart_items WHERE shared_cart_id = $1`, [sharedCartId]);

    const insertedItems = [];
    for (const it of enrichedItems) {
      const { rows } = await client.query(
        `INSERT INTO shared_cart_items (
           shared_cart_id, product_id,
           product_name_snapshot, product_image_snapshot, product_category_snapshot,
           quantity, unit_price_kmf_snapshot, line_total_kmf_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          sharedCartId, it.product_id,
          it.name, it.image_url, it.category,
          it.quantity, it.unit_price_kmf, it.line_total_kmf,
        ]
      );
      insertedItems.push(rows[0]);
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE shared_carts
          SET updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [sharedCartId]
    );

    await addEvent(client, sharedCartId, 'shared_cart_items_updated', { type: 'user', id: userId }, {
      new_total_kmf: totalKmf,
      items_count: insertedItems.length,
    });

    return { cart: { ...updatedRows[0], total_kmf: totalKmf }, items: insertedItems };
  });
}

/**
 * Ajout unitaire d'un article — Contrat API §2/§5 point 4. Une intention,
 * un appel, écriture immédiate (Invariant 20). N'existait pas avant :
 * PUT /:id/items (ci-dessus) reste inchangé, remplace toute la liste, et
 * sert un autre usage — on ne détourne pas son contrat pour ce besoin.
 */
async function addSharedCartItem(sharedCartId, userId, productId, quantity = 1) {
  if (!productId) throw httpError('product_id requis', 400, 'product_id_required');
  const qty = r(quantity);
  if (qty <= 0) throw httpError('Quantité invalide', 400, 'invalid_quantity');

  return withTransaction(async (client) => {
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts
        WHERE id = $1 AND organizer_user_id = $2
        FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!cartRows.length) throw httpError('Panier partagé introuvable ou non autorisé', 404, 'shared_cart_not_found');
    const cart = cartRows[0];

    if (cart.status !== 'open') {
      throw httpError(`Ce panier n'est plus modifiable (statut : ${cart.status})`, 409, 'cart_not_editable');
    }

    const { rows: productRows } = await client.query(
      `SELECT id, name, image_url, category, price_kmf,
              promo_pct, is_promo, promo_until, is_active
         FROM products WHERE id = $1`,
      [productId]
    );
    const p = productRows[0];
    if (!p || !p.is_active) {
      throw httpError('Produit introuvable ou inactif', 400, 'product_not_found');
    }

    const now = new Date();
    const promoActive = p.is_promo && p.promo_pct > 0 && (!p.promo_until || new Date(p.promo_until) >= now);
    const unitPrice = promoActive ? r(p.price_kmf * (1 - p.promo_pct / 100)) : r(p.price_kmf || 0);
    if (unitPrice <= 0) throw httpError('Prix produit invalide', 400, 'invalid_price');

    const lineTotal = unitPrice * qty;
    const { rows: inserted } = await client.query(
      `INSERT INTO shared_cart_items (
         shared_cart_id, product_id,
         product_name_snapshot, product_image_snapshot, product_category_snapshot,
         quantity, unit_price_kmf_snapshot, line_total_kmf_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [sharedCartId, p.id, p.name, p.image_url, p.category, qty, unitPrice, lineTotal]
    );

    await client.query(`UPDATE shared_carts SET updated_at = NOW() WHERE id = $1`, [sharedCartId]);

    await addEvent(client, sharedCartId, 'shared_cart_item_added', { type: 'user', id: userId }, {
      product_id: p.id, quantity: qty,
    });

    return { cart, item: inserted[0] };
  });
}

/**
 * Retrait unitaire d'un article — Contrat API §2/§5 point 4. Confirmation
 * exigée côté client (Invariant 21) ; côté serveur, l'action s'exécute dès
 * réception, sans confirmation supplémentaire.
 *
 * Garde-fou ajouté ici, non explicitement couvert par le contrat API mais
 * nécessaire à la sécurité des données : un article déjà réclamé par une
 * commande (order_items.shared_cart_item_id) ne peut pas être retiré. Sans
 * ce garde-fou, la suppression détacherait silencieusement une commande
 * déjà payée de sa liste (ON DELETE SET NULL) — l'ASSUMPTION documentée
 * plus haut dans ce fichier pour updateOpenSharedCartItems, ici résolue
 * dans le sens le plus sûr : on bloque plutôt que de casser une commande
 * existante. À confirmer si un autre comportement était souhaité.
 */
async function removeSharedCartItem(sharedCartId, userId, itemId) {
  if (!itemId) throw httpError('item_id requis', 400, 'item_id_required');

  return withTransaction(async (client) => {
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts
        WHERE id = $1 AND organizer_user_id = $2
        FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!cartRows.length) throw httpError('Panier partagé introuvable ou non autorisé', 404, 'shared_cart_not_found');
    const cart = cartRows[0];

    if (cart.status !== 'open') {
      throw httpError(`Ce panier n'est plus modifiable (statut : ${cart.status})`, 409, 'cart_not_editable');
    }

    const { rows: itemRows } = await client.query(
      `SELECT sci.id, (oi.id IS NOT NULL) AS claimed
         FROM shared_cart_items sci
         LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
        WHERE sci.id = $1 AND sci.shared_cart_id = $2`,
      [itemId, sharedCartId]
    );
    if (!itemRows.length) throw httpError('Article introuvable', 404, 'item_not_found');
    if (itemRows[0].claimed) {
      throw httpError('Cet article a déjà été acheté, il ne peut plus être retiré', 409, 'item_already_claimed');
    }

    await client.query(`DELETE FROM shared_cart_items WHERE id = $1`, [itemId]);
    await client.query(`UPDATE shared_carts SET updated_at = NOW() WHERE id = $1`, [sharedCartId]);

    await addEvent(client, sharedCartId, 'shared_cart_item_removed', { type: 'user', id: userId }, {
      item_id: itemId,
    });

    return { cart };
  });
}

/**
 * Modification unitaire de la quantité d'une ligne — amendement V2 §B
 * (PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART_V2). Capacité
 * nouvelle, distincte de PUT /:id/items (remplacement intégral) et de
 * addSharedCartItem/removeSharedCartItem (ajout/retrait) : ne touche que
 * la quantité d'une ligne déjà existante.
 *
 * Garde-fous, alignés sur removeSharedCartItem ci-dessus :
 *   - le panier doit être 'open' (statut) ;
 *   - un article déjà réclamé par une commande
 *     (order_items.shared_cart_item_id) ne peut pas voir sa quantité
 *     modifiée — 409 item_already_claimed, même logique que le retrait.
 *
 * Le prix unitaire snapshot (unit_price_kmf_snapshot) n'est jamais
 * recalculé depuis products — c'est un snapshot, il reste figé. Seul
 * line_total_kmf_snapshot = unit_price_kmf_snapshot * quantity est
 * recalculé ici.
 */
async function updateSharedCartItemQuantity(sharedCartId, userId, itemId, quantity) {
  if (!itemId) throw httpError('item_id requis', 400, 'item_id_required');
  // Correctif V2-B.1 §6 — r() arrondit (Math.round) : une quantité non
  // entière (ex. 2.5) passait silencieusement à 3 au lieu d'être refusée.
  // La validation d'entier doit se faire AVANT tout arrondi.
  const rawQty = Number(quantity);
  if (!Number.isInteger(rawQty) || rawQty <= 0) {
    throw httpError('Quantité invalide', 400, 'invalid_quantity');
  }
  const qty = rawQty;

  return withTransaction(async (client) => {
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts
        WHERE id = $1 AND organizer_user_id = $2
        FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!cartRows.length) throw httpError('Panier partagé introuvable ou non autorisé', 404, 'shared_cart_not_found');
    const cart = cartRows[0];

    if (cart.status !== 'open') {
      throw httpError(`Ce panier n'est plus modifiable (statut : ${cart.status})`, 409, 'cart_not_editable');
    }

    const { rows: itemRows } = await client.query(
      `SELECT sci.id, sci.quantity, sci.unit_price_kmf_snapshot,
              (oi.id IS NOT NULL) AS claimed
         FROM shared_cart_items sci
         LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
        WHERE sci.id = $1 AND sci.shared_cart_id = $2
        FOR UPDATE OF sci`,
      [itemId, sharedCartId]
    );
    if (!itemRows.length) throw httpError('Article introuvable', 404, 'item_not_found');
    const existing = itemRows[0];
    if (existing.claimed) {
      throw httpError('Cet article a déjà été acheté, sa quantité ne peut plus être modifiée', 409, 'item_already_claimed');
    }

    const previousQuantity = existing.quantity;
    const unitPrice = r(existing.unit_price_kmf_snapshot);
    const lineTotal = unitPrice * qty;

    const { rows: updated } = await client.query(
      `UPDATE shared_cart_items
          SET quantity = $1, line_total_kmf_snapshot = $2
        WHERE id = $3
        RETURNING *`,
      [qty, lineTotal, itemId]
    );

    await client.query(`UPDATE shared_carts SET updated_at = NOW() WHERE id = $1`, [sharedCartId]);

    await addEvent(client, sharedCartId, 'shared_cart_item_quantity_updated', { type: 'user', id: userId }, {
      item_id: itemId,
      previous_quantity: previousQuantity,
      quantity: qty,
    });

    return { cart, item: updated[0] };
  });
}

module.exports = {
  updateOpenSharedCartItems,
  addSharedCartItem,
  removeSharedCartItem,
  updateSharedCartItemQuantity,
};
