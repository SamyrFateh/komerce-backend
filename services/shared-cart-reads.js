/**
 * @komerce-arch
 * @role          shared-cart-reads
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        token, shared_cart_id, user_id
 * @outputs       shared_cart, items
 * @depends       db.js
 * @used-by       routes/shared-cart.js
 * @db-read       order_items, orders, shared_cart_items, shared_carts, users
 * @db-write      none
 * @db-txn        none
 * @doctrine      domaine_minimal_boutique_first, lecture_derivee
 * @impact-areas  participant-flow, creator-flow
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Shared cart reads (Boutique First, domaine minimal)
 *
 * La liste n'est jamais une source de vérité transactionnelle : son état
 * d'achat se déduit des lignes de commande rattachées.
 *
 * Le snapshot SQL de CI peut être chargé avant l'application de la migration
 * 125 qui renomme beneficiary_user_id en organizer_user_id. L'expression
 * ci-dessous lit la clé métier canonique depuis la ligne sérialisée, sans
 * référencer directement une colonne potentiellement absente.
 *
 * Amendement V2 §B (PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_
 * CART_V2) : product_id est désormais exposé par ligne dans le payload
 * public — nécessaire pour ouvrir la fiche produit catalogue depuis un
 * clic sur l'image/le nom d'une ligne de liste (bus.emit('modal:open', {
 * id: item.product_id, source: 'shared-list', sharedCartItemId: item.id })).
 * Le reste du contrat public (is_creator, identifiants organisateur) reste
 * inchangé.
 */

const db = require('../db');

/**
 * Normalise product_image_snapshot en URL absolue http/https.
 *
 * Le frontend (b-cart.js::isRenderableSnapshotImageUrl) n'accepte que des
 * URL absolues — cette garde protège un incident production documenté
 * (chaîne sans schéma interprétée comme chemin relatif). Ne pas l'affaiblir.
 * On normalise côté serveur plutôt que d'assouplir le garde client.
 *
 * Cas traités :
 *   - URL absolue http(s)  → inchangée
 *   - chemin absolu (/up…) → préfixé de APP_URL ou PUBLIC_BASE_URL
 *   - chaîne vide ou null  → chaîne vide (→ fallback image côté client)
 */
const MEDIA_BASE = (process.env.APP_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

function normalizeImageUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/') && MEDIA_BASE) return `${MEDIA_BASE}${trimmed}`;
  // Chemin sans schéma ni slash initial — ambiguïté trop grande : vide → fallback.
  return '';
}

/**
 * Lot 2026-08 (GAP-05) — Contributeurs agrégés.
 *
 * Dérive [{first_name, items_count}] depuis les lignes déjà jointes
 * (buyer_user_id/buyer_full_name par ligne, cf. requête ci-dessous).
 * Agrégation en JS plutôt qu'en SQL : la jointure existe déjà par ligne,
 * une requête GROUP BY séparée n'apporterait rien qu'une itération sur un
 * tableau déjà en mémoire, et ce module fait déjà tout son travail de
 * dérivation (creator_first_name, buyer_first_name) en JS. Groupé par
 * buyer_user_id (jamais par prénom seul) pour ne jamais fusionner deux
 * acheteurs distincts qui partagent un prénom.
 */
// Mandat §11 — items_count doit représenter des UNITÉS achetées, pas des
// lignes. Une ligne de liste peut porter quantity > 1 (ex. "2 × Cadre
// photo") ; compter +1 par ligne réclamée sous-représenterait alors le
// nombre réel d'articles achetés par ce contributeur ("Ali · 1 article"
// au lieu de "Ali · 2 articles"). first_name reste dérivé uniquement de
// buyer_full_name — jamais buyer_user_id, jamais d'email/téléphone.
function aggregateContributors(items) {
  const order = [];
  const byBuyer = new Map();
  for (const item of items) {
    if (!item.claimed) continue;
    const key = item.buyer_user_id || item.buyer_full_name || 'inconnu';
    if (!byBuyer.has(key)) {
      const firstName = (item.buyer_full_name || '').trim().split(/\s+/)[0] || 'Un participant';
      byBuyer.set(key, { first_name: firstName, items_count: 0 });
      order.push(key);
    }
    byBuyer.get(key).items_count += Math.max(1, Number(item.quantity) || 1);
  }
  return order.map((key) => byBuyer.get(key));
}

const ORGANIZER_ID_SQL = `COALESCE(
  NULLIF(to_jsonb(sc)->>'organizer_user_id', '')::uuid,
  NULLIF(to_jsonb(sc)->>'beneficiary_user_id', '')::uuid
)`;

async function getSharedCartForPublic(token, viewerUserId) {
  const { rows: cartRows } = await db.query(
    `SELECT sc.id, sc.token, sc.title, sc.message, sc.status, sc.delivery_relay_id,
            sc.created_at,
            ${ORGANIZER_ID_SQL} AS organizer_user_id,
            u.full_name AS organizer_full_name
       FROM shared_carts sc
       LEFT JOIN users u ON u.id = ${ORGANIZER_ID_SQL}
      WHERE sc.token = $1`,
    [token]
  );
  if (!cartRows.length) return null;
  const cart = cartRows[0];

  const isCreator = Boolean(viewerUserId)
    && String(viewerUserId) === String(cart.organizer_user_id);

  // Demande produit 22-08-2026 — le bouton "Sauvegarder cette liste" doit
  // être grisé/masqué DÈS le premier affichage pour un visiteur qui a déjà
  // sauvegardé cette liste lors d'une session antérieure, pas seulement
  // après un clic redondant (services/shared-cart-library.js#saveShared
  // CartForUser renvoie déjà already_saved, mais uniquement à l'action
  // POST /save — jamais consulté ici, au chargement initial). Non pertinent
  // pour le créateur (ne sauvegarde jamais sa propre liste, même gating que
  // showSaveAction côté frontend) — aucune requête si isCreator ou visiteur
  // anonyme.
  let alreadySaved = false;
  if (!isCreator && viewerUserId) {
    const { rows: savedRows } = await db.query(
      `SELECT 1 FROM shared_cart_saved_access WHERE user_id = $1 AND shared_cart_id = $2`,
      [viewerUserId, cart.id]
    );
    alreadySaved = savedRows.length > 0;
  }

  // L'identité de l'acheteur (buyer_full_name) n'est jamais nécessaire ni
  // lue pour un viewer non-créateur : la jointure orders/users ci-dessous
  // n'est faite que côté requête (coût négligeable, LEFT JOIN), mais le
  // champ n'est mappé dans la réponse que si isCreator est vrai (cf.
  // items.map ci-dessous) — jamais exposé au payload participant, quel
  // que soit l'état du frontend (temps réel confirmé, doctrine identité
  // acheteur jamais accessible aux participants).
  const { rows: items } = await db.query(
    `SELECT sci.id,
            sci.product_id,
            sci.product_name_snapshot AS name,
            sci.product_image_snapshot AS image,
            sci.variant_combo_snapshot AS variant_combo,
            sci.quantity,
            sci.unit_price_kmf_snapshot AS unit_price_kmf,
            sci.line_total_kmf_snapshot AS line_total_kmf,
            (oi.id IS NOT NULL) AS claimed,
            bu.id AS buyer_user_id,
            bu.full_name AS buyer_full_name
       FROM shared_cart_items sci
       LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
       LEFT JOIN orders bo ON bo.id = oi.order_id
       LEFT JOIN users bu ON bu.id = bo.user_id
      WHERE sci.shared_cart_id = $1
      ORDER BY sci.created_at`,
    [cart.id]
  );

  const claimedCount = items.filter((item) => item.claimed).length;
  const creatorFirstName = (cart.organizer_full_name || '')
    .trim()
    .split(/\s+/)[0] || null;
  // GAP-05 — résumé agrégé, jamais mappé si !isCreator (même gating que
  // buyer_first_name par ligne, ci-dessous) : indétectable côté participant,
  // quel que soit l'état du frontend.
  const contributors = isCreator ? aggregateContributors(items) : undefined;

  return {
    cart: {
      // L'identifiant interne n'est nécessaire qu'aux commandes du créateur.
      id: isCreator ? cart.id : undefined,
      token: cart.token,
      title: cart.title,
      message: cart.message,
      status: cart.status,
      created_at: cart.created_at,
      creator_first_name: creatorFirstName,
      already_saved: alreadySaved,
    },
    items: items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      name: item.name,
      image: normalizeImageUrl(item.image),
      // GAP-07 §10/§11 — la combinaison doit être disponible côté public
      // pour afficher la variante et distinguer deux lignes du même
      // produit (renderer panier partagé). sku_id interne n'a pas besoin
      // d'être exposé (§10) — seule la combinaison l'est.
      variant_combo: item.variant_combo || null,
      quantity: item.quantity,
      unit_price_kmf: item.unit_price_kmf,
      line_total_kmf: item.line_total_kmf,
      claimed: item.claimed,
      // Jamais mappé si !isCreator — pas de fuite possible côté participant.
      buyer_first_name: isCreator
        ? ((item.buyer_full_name || '').trim().split(/\s+/)[0] || null)
        : undefined,
    })),
    items_count: items.length,
    claimed_count: claimedCount,
    is_creator: isCreator,
    contributors,
  };
}

async function getSharedCartForOwner(sharedCartId, userId) {
  const { rows } = await db.query(
    `SELECT sc.*
       FROM shared_carts sc
      WHERE sc.id = $1
        AND ${ORGANIZER_ID_SQL} = $2`,
    [sharedCartId, userId]
  );
  if (!rows.length) return null;
  const cart = rows[0];

  const { rows: items } = await db.query(
    `SELECT sci.*,
            (oi.id IS NOT NULL) AS claimed,
            oi.order_id AS claimed_by_order_id
       FROM shared_cart_items sci
       LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
      WHERE sci.shared_cart_id = $1
      ORDER BY sci.created_at`,
    [cart.id]
  );

  const totalKmf = items.reduce(
    (sum, item) => sum + Number(item.line_total_kmf_snapshot || 0),
    0
  );

  return {
    cart: { ...cart, total_kmf: totalKmf },
    items,
    claimed_count: items.filter((item) => item.claimed).length,
  };
}

async function listMySharedCarts(userId) {
  const { rows } = await db.query(
    `SELECT sc.id, sc.token, sc.title, sc.status, sc.created_at,
            sc.closed_at, sc.cancelled_at,
            COALESCE(agg.total_kmf, 0)::int AS total_kmf,
            COALESCE(agg.items_count, 0)::int AS items_count,
            COALESCE(agg.claimed_count, 0)::int AS claimed_count
       FROM shared_carts sc
       LEFT JOIN LATERAL (
         SELECT SUM(sci.line_total_kmf_snapshot) AS total_kmf,
                -- Mandat §11 — items_count/claimed_count doivent représenter
                -- des UNITÉS achetées (le libellé frontend affiche
                -- "X/Y articles"), pas des lignes. Une ligne peut porter
                -- quantity > 1 : COUNT(*) sous-représenterait alors le
                -- nombre réel d'articles de la liste.
                COALESCE(SUM(sci.quantity), 0) AS items_count,
                COALESCE(SUM(sci.quantity) FILTER (WHERE oi.id IS NOT NULL), 0) AS claimed_count
           FROM shared_cart_items sci
           LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
          WHERE sci.shared_cart_id = sc.id
       ) agg ON TRUE
      WHERE ${ORGANIZER_ID_SQL} = $1
      ORDER BY sc.created_at DESC`,
    [userId]
  );
  return rows;
}

module.exports = {
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
};
