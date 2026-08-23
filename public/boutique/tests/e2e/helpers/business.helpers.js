/**
 * helpers/business.helpers.js — Helpers backend pour flux E2E business complets
 *
 * Ces helpers vérifient l'état côté serveur APRÈS une action côté UI.
 * Ils complètent api.helpers.js avec des vérifications spécifiques aux
 * scénarios F05–F31 de l'inventaire E2E_BUSINESS_FLOWS_INVENTORY.
 *
 * Tous les helpers READ-ONLY (GET) sont safe en production.
 * Les helpers [DESTRUCTIF] sont marqués explicitement.
 */
'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/boutique/';
const API_BASE = BASE_URL.replace('/boutique/', '');

// ─── F07 — Stock ─────────────────────────────────────────────────────────────

/**
 * Récupère le stock d'un produit via GET /api/products/:id (public, pas d'auth).
 * Le champ `stock` est dans PUBLIC_PRODUCT_FIELDS (voir catalog-public-view.js).
 * Retourne { stock: number|null, name: string } ou null si 404.
 */
async function getProductStock(page, productId) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/products/${args.pid}`, args.base).href
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      // price_kmf est le champ public réel (voir catalog-public-view.js::
      // PUBLIC_PRODUCT_FIELDS) — il n'existe pas de champ `price` brut.
      return {
        stock: data.stock ?? null,
        name: data.name || '',
        price_kmf: data.price_kmf ?? null,
      };
    } catch { return null; }
  }, { pid: productId, base: API_BASE });
}

// ─── F05 — Documents privés ─────────────────────────────────────────────────

/**
 * Liste les documents du compte courant. Le cookie de session est la seule
 * preuve d'accès : aucun jeton public n'est accepté.
 */
async function getPrivateDocuments(page) {
  return page.evaluate(async (base) => {
    try {
      const resp = await fetch(new URL('/api/auth/me/documents', base).href, { credentials: 'include' });
      const body = await resp.json().catch(() => ({}));
      return { status: resp.status, documents: body.documents || [] };
    } catch (e) { return { status: 0, documents: [], error: e.message }; }
  }, API_BASE);
}

/** Télécharge un document avec la session du contexte Playwright courant. */
async function downloadPrivateDocument(page, downloadUrl) {
  if (
    typeof downloadUrl !== 'string' ||
    !downloadUrl.startsWith('/api/auth/me/documents/') ||
    !downloadUrl.endsWith('/download')
  ) {
    return {
      status: 0,
      contentType: '',
      bytes: 0,
      error: 'download_url document absent ou invalide',
    };
  }

  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(new URL(args.path, args.base).href, { credentials: 'include' });
      const body = await resp.arrayBuffer();
      return {
        status: resp.status,
        contentType: resp.headers.get('content-type') || '',
        bytes: body.byteLength,
      };
    } catch (e) { return { status: 0, contentType: '', bytes: 0, error: e.message }; }
  }, { path: downloadUrl, base: API_BASE });
}

// ─── F06 — Historique commande ───────────────────────────────────────────────

/**
 * Récupère l'historique des transitions d'une commande via
 * GET /api/orders/:id/history (authentifié).
 * Retourne un tableau [{ status, note, created_at }] ou [].
 */
async function getOrderHistory(page, orderId) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/orders/${args.id}/history`, args.base).href,
        { credentials: 'include' }
      );
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.history || data || [];
    } catch { return []; }
  }, { id: orderId, base: API_BASE });
}

// ─── F31 — Tracking public ──────────────────────────────────────────────────

/**
 * Récupère le détail d'une commande par référence via
 * GET /api/orders/:ref (public, softAuthenticate).
 * Retourne l'objet commande ou null.
 */
async function getOrderByRef(page, ref) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/orders/${args.ref}`, args.base).href,
        { credentials: 'include' }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.order || data;
    } catch { return null; }
  }, { ref, base: API_BASE });
}

/**
 * Récupère le tracking public via GET /api/tracking/:token (sans auth).
 * Retourne { status: number, data: object|null }.
 */
async function fetchPublicTracking(page, token) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/tracking/${args.token}`, args.base).href
      );
      if (!resp.ok) return { status: resp.status, data: null };
      const data = await resp.json();
      return { status: resp.status, data };
    } catch { return { status: 0, data: null }; }
  }, { token, base: API_BASE });
}

// ─── F21 — Panier partagé participant ────────────────────────────────────────

/**
 * Construit l'URL de la page publique du panier partagé telle que le
 * frontend la reconnaît réellement — voir js/b-group-view.js:89
 * (`url.searchParams.get('p')`). PAS `?shared=` : ce paramètre n'est lu
 * nulle part côté frontend, une page avec `?shared=` charge la boutique
 * normale sans jamais monter la vue groupe.
 */
function getSharePageUrl(token) {
  return `${BASE_URL}?p=${token}`;
}

/**
 * Soumet une estimation participant via POST /public/:token/estimations
 * (public, PAS d'auth — c'est le vrai endpoint participant, voir
 * routes/shared-cart.js:122 + services/shared-cart-estimation-service.js
 * ::validatePayload). Body réel : { participant_name, amount_kmf,
 * participant_phone? }. [DESTRUCTIF léger — staging uniquement]
 * Retourne { ok, status, estimation? , error? }.
 */
async function submitEstimation(page, token, { name, amountKmf, phone }) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/shared-carts/public/${args.token}/estimations`, args.base).href,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participant_name: args.name,
            amount_kmf: args.amountKmf,
            participant_phone: args.phone || undefined,
          }),
        }
      );
      const body = await resp.json().catch(() => ({}));
      return { ok: resp.ok, status: resp.status, estimation: body.estimation, error: body.error };
    } catch (e) { return { ok: false, status: 0, error: e.message }; }
  }, { token, name, amountKmf, phone, base: API_BASE });
}

/**
 * Lit l'agrégat public des estimations d'un panier partagé via
 * GET /public/:token/estimations (public, ne révèle ni nom ni téléphone —
 * doctrine de la route). Utile pour vérifier qu'une estimation participant
 * a bien été comptabilisée, sans dépendre du texte affiché à l'écran.
 */
async function getPublicEstimations(page, token) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/shared-carts/public/${args.token}/estimations`, args.base).href
      );
      if (!resp.ok) return null;
      return await resp.json();
    } catch { return null; }
  }, { token, base: API_BASE });
}

module.exports = {
  getProductStock,
  getPrivateDocuments,
  downloadPrivateDocument,
  getOrderHistory,
  getOrderByRef,
  fetchPublicTracking,
  getSharePageUrl,
  submitEstimation,
  getPublicEstimations,
};
